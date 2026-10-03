import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { mkdir, readdir, readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import type { StoragePort, StoredObject, UploadConstraints, UploadTarget } from '../../ports/storage'
import { writeFileAtomic, writeFileAtomicSync } from './atomic-write'
import { dataDir } from './data-dir'

const META_SUFFIX = '.meta.json'
const UPLOAD_SECRET_FILE = 'upload-secret'
/** In-flight temp file from writeFileAtomic (`<target>.<pid>.<uuid>.tmp`). */
const TEMP_FILE = /\.\d+\.[0-9a-f-]{36}\.tmp$/

/** Resolve a storage key inside the base dir, refusing path escapes. */
function resolveKey(key: string): string {
    const base = dataDir('storage')
    const resolved = path.resolve(base, key)
    if (!resolved.startsWith(base + path.sep)) throw new Error(`invalid storage key: ${key}`)
    return resolved
}

/**
 * The store shares one directory with the fake's own bookkeeping (a `<key>.meta.json` sidecar per
 * object, plus the upload secret at the root), and `list` hides those by name. So a key that could BE
 * one is never an object: `put` refuses it rather than silently overwriting the bookkeeping, `get`
 * finds nothing, and `delete` leaves it alone. Real S3 would accept such a key; keep keys off these names.
 */
function isReserved(key: string): boolean {
    return key.endsWith(META_SUFFIX) || resolveKey(key) === path.join(dataDir('storage'), UPLOAD_SECRET_FILE)
}

/** Every file under `dir`, as `/`-separated paths relative to `root`. A missing `dir` is empty. */
async function walk(root: string, dir: string): Promise<string[]> {
    let entries
    try {
        entries = await readdir(dir, { withFileTypes: true })
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
        throw error
    }
    const nested = await Promise.all(
        entries.map(async (entry) => {
            const full = path.join(dir, entry.name)
            if (entry.isDirectory()) return walk(root, full)
            return [path.relative(root, full).split(path.sep).join('/')]
        }),
    )
    return nested.flat()
}

/**
 * Stable per-checkout HMAC secret for signing fake upload targets, mirroring fake auth's dev-secret
 * (packages/keel/src/adapters/fake/auth.ts): a random 32-byte hex written once, 0600, and reused across restarts.
 * Never used in real mode (AWS signs presigned POSTs there). It exists so the fake upload endpoint can
 * prove a target it receives was minted by THIS server and not tampered with — the same trust model as
 * the shared webhook secret, applied to a browser-facing form.
 */
function uploadSecret(): Buffer {
    const file = path.join(dataDir('storage'), 'upload-secret')
    // NOTE: existsSync-then-write is still a TOCTOU (two concurrent first-callers can both see
    // "missing" and both mint a secret) — the atomic rename below only guarantees whichever write
    // lands last is never a torn/spliced file, not that it's the only writer. Out of scope here;
    // this mirrors the same accepted gap in auth.ts's dev-secret and service-auth.ts's key/webhook
    // secrets, none of which are security-sensitive in simulated mode.
    if (!existsSync(file)) writeFileAtomicSync(file, randomBytes(32).toString('hex'), { mode: 0o600 })
    return Buffer.from(readFileSync(file, 'utf8'), 'utf8')
}

/** Upload targets die after 15 minutes — the same window createRealStorage gives an S3 presigned
 *  POST, so fake and real agree that a minted target is short-lived, not a forever-capability to
 *  silently swap an artifact's bytes after confirm. */
const UPLOAD_TARGET_TTL_SECONDS = 900

/** Canonical string the signature covers — order-fixed so signer and verifier never disagree. The
 *  expiry is INSIDE the signature, so a caller can't extend a target's life by editing the field. */
function canonical(key: string, contentType: string, maxBytes: number, expires: number): string {
    return `${key}\n${contentType}\n${maxBytes}\n${expires}`
}

/** HMAC-SHA256 (hex) over the upload target's constraints — module-internal (mint signs, verify checks). */
function signUploadFields(key: string, contentType: string, maxBytes: number, expires: number): string {
    return createHmac('sha256', uploadSecret())
        .update(canonical(key, contentType, maxBytes, expires))
        .digest('hex')
}

/** The verified constraints carried by a fake upload target's signed fields. */
export interface VerifiedUploadFields {
    key: string
    contentType: string
    maxBytes: number
}

/**
 * Verify the signed fields of a fake upload POST and return the constraints they attest to, or null
 * when anything is missing/malformed or the signature doesn't match (a timing-safe compare). The fake
 * upload endpoint calls this FIRST — a null result is the local twin of S3 rejecting a POST whose
 * policy signature is wrong. Simulated-mode-only (NOT part of StoragePort).
 */
export function verifyUploadFields(fields: Record<string, string | undefined>): VerifiedUploadFields | null {
    const key = fields.key
    const contentType = fields['content-type']
    const maxBytesRaw = fields['max-bytes']
    const expiresRaw = fields.expires
    const signature = fields.signature
    if (!key || !contentType || !maxBytesRaw || !expiresRaw || !signature) return null
    const maxBytes = Number(maxBytesRaw)
    if (!Number.isInteger(maxBytes) || maxBytes < 0) return null
    const expires = Number(expiresRaw)
    if (!Number.isInteger(expires) || expires < 0) return null
    const expected = signUploadFields(key, contentType, maxBytes, expires)
    const got = Buffer.from(signature, 'utf8')
    const want = Buffer.from(expected, 'utf8')
    if (got.length !== want.length || !timingSafeEqual(got, want)) return null
    // Expiry check AFTER the signature check, so the timestamp we trust is the one that was signed.
    if (expires * 1000 < Date.now()) return null
    return { key, contentType, maxBytes }
}

export const fakeStorage: StoragePort = {
    async put(key, body, contentType) {
        if (isReserved(key)) throw new Error(`invalid storage key: ${key} (reserved by the fake store)`)
        const file = resolveKey(key)
        await mkdir(path.dirname(file), { recursive: true })
        await writeFileAtomic(file, body)
        // Not JSON.stringify(..., null, 2) — this sidecar has never been pretty-printed and nothing
        // reads it by hand, so writeFileAtomic (not writeJsonAtomic) keeps the byte-for-byte format.
        await writeFileAtomic(`${file}.meta.json`, JSON.stringify({ contentType }))
    },

    async get(key): Promise<StoredObject | null> {
        if (isReserved(key)) return null
        const file = resolveKey(key)
        if (!existsSync(file)) return null
        const [body, meta] = await Promise.all([readFile(file), readFile(`${file}.meta.json`, 'utf8')])
        return { body: new Uint8Array(body), contentType: (JSON.parse(meta) as { contentType: string }).contentType }
    },

    async list(prefix): Promise<string[]> {
        // dataDir creates the store, so a fresh checkout lists as empty; the ENOENT guard in walk
        // covers the store being wiped (world reset) between that call and the read.
        const base = dataDir('storage')
        const files = await walk(base, base)
        return files
            .filter((file) => !file.endsWith(META_SUFFIX) && file !== UPLOAD_SECRET_FILE && !TEMP_FILE.test(file))
            .filter((key) => key.startsWith(prefix))
            .sort()
    },

    async delete(keys) {
        for (const key of keys) {
            if (isReserved(key)) continue
            const file = resolveKey(key)
            await rm(file, { force: true })
            await rm(`${file}${META_SUFFIX}`, { force: true })
        }
    },

    async getSignedDownloadUrl(key): Promise<string> {
        // Served by the simulated-mode-only /api/storage route; "signing" is meaningless locally.
        return `/api/storage/${key.split('/').map(encodeURIComponent).join('/')}`
    },

    async createUploadTarget(key, { contentType, maxBytes }: UploadConstraints): Promise<UploadTarget> {
        // Point the browser at the local fake upload endpoint and hand it signed constraints. The
        // signature ties the target to THIS key/type/size ceiling AND a 15-minute expiry, so the
        // endpoint can trust them without a session — the local stand-in for an S3 presigned POST
        // policy (validated there by AWS, here by verifyUploadFields). resolveKey rejects escapes
        // when the bytes finally land.
        const expires = Math.floor(Date.now() / 1000) + UPLOAD_TARGET_TTL_SECONDS
        return {
            url: '/api/storage-upload',
            fields: {
                key,
                'content-type': contentType,
                'max-bytes': String(maxBytes),
                expires: String(expires),
                signature: signUploadFields(key, contentType, maxBytes, expires),
            },
        }
    },
}
