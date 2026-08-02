import { defineConfig } from '@pandacss/dev'

export default defineConfig({
    preflight: true,

    jsxFramework: 'react',

    include: [
        // the framework package's screens ship styled components too (ADR-0012)
        '../../packages/keel/src/**/*.{ts,tsx}',
        './src/components/**/*.{ts,tsx}',
        './src/app/**/*.{ts,tsx}',
        './src/app-config/**/*.{ts,tsx}',
        './src/domain/**/*.{ts,tsx}',
    ],

    exclude: [],

    theme: {
        extend: {},
    },

    outdir: 'src/styles/generated',
})
