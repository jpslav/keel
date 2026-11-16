// The suffix of the empty sibling file that tests/support/tmp-dir.ts drops next to every scratch
// directory it creates (`<dir>` + this suffix). It lives in its own plain-.mjs module so the leak
// guard (scripts/check-tmpdir-leak.mjs), which runs under bare node with no TypeScript loader, can
// read the same constant the helper writes with — one spelling, two consumers, no drift.
export const TMP_DIR_MARKER_SUFFIX = '.keel-test-tmp'
