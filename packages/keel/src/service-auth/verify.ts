import { decodeJwt, importSPKI, jwtVerify } from 'jose'
import { activeKeysForOrgSlug } from '../db/service-keys'
import type { DbPort } from '../ports/db'
import { AuthRequiredError } from '../ports/errors'
import { APP_SLUG } from '@app-config/identity'

/** Audience every service JWT must carry — a token minted for one purpose can't be replayed at another. */
export const SERVICE_JWT_AUDIENCE = `${APP_SLUG}-service`

/** The verified caller behind an M2M request: which org (hence tenant) the signed token proves. */
export interface ServiceIdentity {
    kind: 'org-service'
    tenantId: string
    tenantSlug: string
    orgId: string
    orgSlug: string
}

/**
 * Verifies an inbound service caller and resolves it to an org identity — the M2M analog of
 * auth.requireUser(). ONE code path in both fake and real modes on purpose: the fake token minter
 * signs real RS256 JWTs against keys stored in `service_keys`, so a demo/dev caller exercises the
 * EXACT production verification here — there is no fake shortcut to drift from.
 *
 * The unverified `iss` claim is read only to ROUTE to candidate public keys; nothing about the
 * caller is trusted until a key cryptographically verifies the signature (the winning key's row IS
 * the identity — the slug never grants it). Every failure — missing/malformed header, undecodable
 * token, no matching key, expired/wrong-audience/wrong-alg — collapses to the SAME opaque
 * AuthRequiredError, so a caller learns only "not authorized", never which check tripped.
 */
export async function verifyServiceCaller(db: DbPort, request: Request): Promise<ServiceIdentity> {
    const header = request.headers.get('authorization')
    if (!header || !header.startsWith('Bearer ')) throw new AuthRequiredError()
    const token = header.slice('Bearer '.length)

    // Unverified decode for routing ONLY — read `iss` to pick candidate keys. Never trusted.
    let iss: string
    try {
        const claims = decodeJwt(token)
        if (typeof claims.iss !== 'string' || claims.iss.length === 0) throw new Error('missing iss')
        iss = claims.iss
    } catch {
        throw new AuthRequiredError()
    }

    const keys = await activeKeysForOrgSlug(db, iss)
    for (const key of keys) {
        try {
            await jwtVerify(token, await importSPKI(key.publicKeyPem, 'RS256'), {
                algorithms: ['RS256'],
                issuer: iss,
                audience: SERVICE_JWT_AUDIENCE,
                requiredClaims: ['iat', 'exp'],
                maxTokenAge: '15m',
                clockTolerance: '30s',
            })
            return {
                kind: 'org-service',
                tenantId: key.tenantId,
                tenantSlug: key.tenantSlug,
                orgId: key.orgId,
                orgSlug: key.orgSlug,
            }
        } catch {
            // Signature/claims didn't check out against this candidate — try the next (rotation or a
            // cross-tenant slug collision). If none verify, fall through to the opaque failure below.
        }
    }
    throw new AuthRequiredError()
}
