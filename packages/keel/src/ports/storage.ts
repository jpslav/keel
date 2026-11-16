export interface StoredObject {
    body: Uint8Array
    contentType: string
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
}
