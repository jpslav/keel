# Theme should generate from one token source, not one hand-written file

**Priority:** P2 · **Status:** open

`packages/keel/src/theme.ts` is a single hand-written file producing a Mantine theme. An app that
also styles with a CSS-in-JS/atomic system (Panda or similar) alongside Mantine has to hand-maintain a
second, parallel set of the same color/spacing/radius values, with no mechanism keeping the two in
sync.

**Need:** a `ThemeTokens`-shaped source of truth (colors, spacing, radii — the generic shape every
theme consumer needs, with no concrete values baked into the framework) that a per-app build function
turns into a Mantine `createTheme()` config, and that a second build function turns into another
system's preset, so changing one token value changes every consumer's output from one edit. Watch for
one specific landmine when building the Mantine side: a theme's `components` map must use plain
`{ defaultProps, styles }` objects rather than Mantine's `Component.extend()` factory API, which can
silently resolve `undefined` under some bundlers' SSR/ESM interop at real request time rather than at
build time.

**Paired lint need:** once a token pipeline exists, a raw style literal (a hex color, a bare pixel
size) anywhere outside it is drift waiting to happen. An ESLint rule flagging a color/size literal in
`style`/`styles` props and Mantine's own spacing-scale JSX props (not just object literals, and not
just top-level — CSS shorthand strings like `padding: '4px 8px'` hide literals too), scoped to app
screens/kit/shell and NOT to simulator/test/story files, keeps new code honest once the token scale
exists to lint against.

Evidence: `packages/keel/src/theme.ts` (today's single hand-written theme), the colour/spacing props
already used throughout `packages/keel/src/components/**` (the literals a token scale would replace).
