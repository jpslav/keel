export default {
    // The eight extensions eslint.config.mjs fences (its SRC_EXT): a staged `.mts` is linted like a `.ts`.
    '*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}': ['eslint --fix', 'prettier --write'],
    '*.{json,md,yaml,yml,css}': ['prettier --write'],
}
