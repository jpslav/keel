export interface StoredObject {
    body: Uint8Array
    contentType: string
}

/** What `head` reports about a stored object: everything but its bytes. */
export interface StoredObjectInfo {
    /** Size of the body in bytes. */
    size: number
    /** The content type the object was stored with, as `get` reports it. */
    contentType: string
    /**
     * An OPAQUE identifier of this version of the object. Compare two for equality; pass one back UNCHANGED
     * as `copy`'s `ifMatch`; never parse it or assume a format or a length. Heads of one key that give different
     * `etag`s mean its bytes changed in between. The same `etag` means the same BYTES, not that the object was
     * not rewritten: a rewrite with identical bytes and another content type keeps it on the fake, and S3
     * promises nothing about it, so rely on neither. Compare etags only between heads of the SAME
     * key: the port does not promise that a copy has its source's etag (the fake's does). The real adapter returns S3's ETag exactly as S3 sent it (quotes included);
     * the fake returns a quoted SHA-256 of the bytes.
     */
    etag: string
    /** When the object was last written: S3's `Last-Modified`, the fake's file modification time. */
    lastModified: Date
}

/** Options for `StoragePort.copy`. */
export interface CopyOptions {
    /**
     * Copy only if the source is STILL the version `head` reported: pass `info.etag` unchanged. When it no
     * longer matches, `copy` throws `PreconditionFailedError` and copies nothing. S3 evaluates this as part of
     * the copy (`CopySourceIfMatch`); the fake compares the very bytes it is about to publish. Without it,
     * `copy` copies whatever is at `from` when it runs. It pins the BYTES, and so the size; it does not pin the
     * content type, which neither adapter's etag covers, so a content-type check made from `head` stays advisory
     * (an upload target's `eq Content-Type` condition is what holds the type at upload).
     */
    ifMatch?: string
}

/** Constraints the storage backend must enforce on a browser upload (mirrored on both adapters). */
export interface UploadConstraints {
    /** Exact content-type the upload must declare (S3: an `eq $Content-Type` policy condition). */
    contentType: string
    /** Hard ceiling on the object size in bytes (S3: a `content-length-range` policy condition). */
    maxBytes: number
}

/**
 * A browser-direct upload target. The browser POSTs `multipart/form-data` to `url` with every entry
 * of `fields` appended first, then the file as the final `file` part — the exact shape S3's presigned
 * POST expects, so the client code is identical whichever adapter minted it.
 */
export interface UploadTarget {
    url: string
    fields: Record<string, string>
}

export interface StoragePort {
    put(key: string, body: Uint8Array | string, contentType: string): Promise<void>
    get(key: string): Promise<StoredObject | null>
    /** Time-limited URL a browser can GET the object from. */
    getSignedDownloadUrl(key: string, expiresInSeconds?: number): Promise<string>
    /**
     * Mint a target the browser uploads a file to directly (never through the app server). `key` is
     * ALWAYS server-built by the caller (an upload route builds `<prefix>/<tenant>/<uuid>/<name>`);
     * the browser cannot choose it. Real adapter = an S3 presigned POST; fake adapter = a local
     * multipart endpoint that verifies the same constraints. The size ceiling is `constraints.maxBytes`
     * above, which the app owns — only the app knows what it accepts.
     */
    createUploadTarget(key: string, constraints: UploadConstraints): Promise<UploadTarget>
    /**
     * Every stored key that begins with `prefix`, as FULL keys (never relative to the prefix), sorted
     * ascending. `prefix` is a literal string prefix on the key, not a directory boundary — S3's
     * `ListObjectsV2` `Prefix` semantics, which both adapters match: `'a/b'` also returns `'a/bc'`, so
     * pass a trailing `/` to mean "inside this folder". No match is `[]`; `''` lists every key.
     */
    list(prefix: string): Promise<string[]>
    /**
     * Remove objects. Idempotent: a key that does not exist is not an error. Each entry is a FULL key,
     * never a prefix — this method never scans, so to delete everything under a prefix `list` it first.
     * Real adapter batches against S3's 1000-keys-per-request cap; an empty array does nothing. A failed
     * batch throws naming its FIRST failing key only; earlier batches have already been deleted.
     */
    delete(keys: readonly string[]): Promise<void>
    /**
     * Copy the object at `from` to `to`, inside the one store. S3 does it server-side (one `CopyObject`),
     * so the bytes never pass through the app — which is the point: a stage-then-finalize flow that read
     * and re-`put` every file would stream each one through the app's Lambda.
     *
     * Both arguments are FULL keys, never prefixes, and the port inspects neither: tenant scoping is the
     * CALLER's, as for `put` and `get`. Build both keys server-side from the same tenant (for example
     * `uploads/<tenant>/<uuid>/<name>` to `<tenant>/<name>`), never from client input. The port cannot
     * cross a bucket: the source is always the store's own.
     *
     * The copy keeps the source's content type and metadata, leaves the source where it is (follow with
     * `delete` to move), and OVERWRITES an existing `to`, exactly as `put` does. It resolves once `to` is
     * complete: neither adapter ever shows a half-copied `to` (S3 publishes it when the copy finishes; the
     * fake renames it into place).
     *
     * With `options.ifMatch` it also throws `PreconditionFailedError` (`keel/ports/errors`) when the source is
     * no longer the version that etag names, and copies nothing; an `ifMatch` that is empty or `*` is refused first of all, with a plain `Error`
     * (HTTP's If-Match gives them meanings an etag never has). The order of the other checks is: same key, missing
     * source, then the precondition; the real adapter leaves the last two to S3, whose order for a missing source
     * with an `ifMatch` is unconfirmed (cutover row `storage-head`).
     *
     * A missing `from` throws `NotFoundError` (`keel/ports/errors`), on both adapters (the real one needs `s3:ListBucket`;
     * without it S3 answers a missing key with an access-denied error, which is not mapped). `from === to` throws
     * a plain `Error` on both, whether or not the key exists: a copy onto itself changes nothing, and is nearly always a caller that built
     * its two keys the same way. The real adapter has one limit the fake does not: a single `CopyObject`
     * copies at most 5 GB (AWS's CopyObject reference), and a larger object throws an `Error` saying so.
     * Multipart copy is not implemented. `UploadConstraints.maxBytes` is the app's own, so an app that
     * accepts uploads above that size cannot copy them with this method: keep `maxBytes` below it.
     */
    copy(from: string, to: string, options?: CopyOptions): Promise<void>
    /**
     * An object's size, content type, ETag and last-modified time WITHOUT its bytes (S3 `HeadObject`; the
     * fake stats the file, reads its sidecar and hashes the body). `null` when nothing is stored at `key`, as
     * for `get`: a read has a natural "nothing" to return, so a caller asks `if (!info)`. (`copy` throws
     * instead, because it has nothing to return.) A bookkeeping name is `null` as it is for `get`; so is a
     * directory, where the fake's `get` throws on one (it answers ENOENT for the missing sidecar).
     *
     * A check made from this is ADVISORY: the object can change between `head` and whatever the caller does
     * next. To act on exactly the version that was checked, pass `info.etag` as `copy`'s `ifMatch`.
     *
     * Real adapter: needs `s3:GetObject`, and `s3:ListBucket` for a missing key to be a 404; without it S3
     * answers 403, which is not mapped and throws (AWS's HeadObject reference). A HEAD response has no body, so
     * S3 gives only a generic status ("It's not possible to retrieve the exact exception"): a missing BUCKET, which S3 also
     * reports as a 404 (not stated on the HeadObject page; the cutover row confirms it), could not be told
     * apart, and reads as `null` here as a missing key does. A response without a size, ETag or
     * last-modified time throws rather than reporting a size of 0.
     */
    head(key: string): Promise<StoredObjectInfo | null>
}
