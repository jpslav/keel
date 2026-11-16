# StoragePort needs list() and delete()

**Priority:** P2 · **Status:** RESOLVED 2026-10-03

`packages/keel/src/ports/storage.ts`'s `StoragePort` has `put`, `get`, `getSignedDownloadUrl` and a
browser-direct upload target, but no way to enumerate what has been stored under a prefix, and no way
to delete an object. Two gaps that show up independently:

1. **Enumeration.** A caller that needs to know which keys exist under a prefix — a workspace file
   browser, a per-tenant storage audit — has no port method to ask. Need: `list(prefix): Promise<string[]>`,
   every key under `prefix` sorted ascending, matching S3 `ListObjectsV2`'s literal string-prefix
   semantics (so both adapters agree on what "under a prefix" means).

2. **Deletion.** Nothing on the port can remove a stored object — relevant the moment any erasure or
   cleanup flow exists. Need: `delete(keys: string[]): Promise<void>`, idempotent (a missing key is
   not an error), each entry a full key rather than a prefix, batched sanely against whatever limit
   the real backend imposes on a single delete call (S3's is 1000 keys per request).

Evidence: `packages/keel/src/ports/storage.ts` (today's `StoragePort` interface, missing both
methods).

## Resolution

`StoragePort` has `list(prefix)` and `delete(keys)`. `list` returns full keys in ascending order, with
S3's literal-prefix semantics. `delete` is idempotent and treats every entry as a full key.

- **Real adapter:** follows `ListObjectsV2`'s continuation token, and sends `DeleteObjects` in batches
  of 1000 with `Quiet: true`, throwing on the first reported error with that key's name. Both are
  unit-tested against a stubbed client.
- **Fake adapter:** walks its store and hides its own bookkeeping (the `.meta.json` sidecars, the upload
  secret and in-flight atomic-write temp files). It now refuses keys that would collide with those
  names. Real S3 would accept them, so the fake is deliberately stricter.
- **Cutover:** the real calls have never run against a bucket. That is the `storage-list-delete` row in
  `docs/cutover-checklist.md`. The CDK `grantReadWrite` already covers `s3:List*` and `s3:DeleteObject*`.
