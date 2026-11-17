import { makeTestTmpDir } from '../../../../tests/support/tmp-dir'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
    type Gate,
    type Handler,
    type HandlerFacts,
    type ScanOptions,
    type ScanPolicy,
    type ScanRoot,
    type ScannedRoute,
    describeGate,
    exemptionFor,
    gateHolds,
    judge,
    scanRoutes,
} from './route-scan'

/**
 * The analyser's own cases: which export forms it reads, what counts as a handler's path, what it refuses.
 * The policy (the real exemption map, the real roots) is authorized-mutations.test.ts; this file feeds the
 * analyser small route trees written to a scratch directory and checks what it found.
 */

const SCRATCH = makeTestTmpDir('route-scan-')
let caseNumber = 0

/** Writes `files` under a fresh directory and scans it as one root. `route.ts` is the usual subject. */
function scanTree(
    files: Record<string, string>,
    root: (dir: string) => Partial<ScanRoot> = () => ({}),
    options?: ScanOptions,
): ScannedRoute[] {
    const dir = path.join(SCRATCH, `case-${++caseNumber}`)
    for (const [rel, src] of Object.entries(files)) {
        mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true })
        writeFileSync(path.join(dir, rel), src)
    }
    return scanRoutes([{ label: 'case', dir, exemptDir: dir, ...root(dir) }], options)
}

type Outcome = 'authorized' | 'open' | RegExp

function outcome(handler: Handler): string {
    if (handler.refusal !== undefined) return `refused: ${handler.refusal}`
    return handler.facts.reachesAuthorize ? 'authorized' : 'open'
}

/** The verbs of the one `route.ts` in the tree, each with its outcome. */
function verdicts(files: Record<string, string>, root?: (dir: string) => Partial<ScanRoot>, options?: ScanOptions) {
    const route = scanTree(files, root, options).find((r) => r.rel === 'route.ts')
    if (!route) throw new Error('no route.ts in the case')
    return Object.fromEntries(route.handlers.map((handler) => [handler.verb, outcome(handler)]))
}

function expectVerdicts(actual: Record<string, string>, expected: Record<string, Outcome>): void {
    expect(Object.keys(actual)).toEqual(Object.keys(expected))
    for (const [verb, want] of Object.entries(expected)) {
        if (want instanceof RegExp) expect(actual[verb], verb).toMatch(want)
        else expect(actual[verb], verb).toBe(want)
    }
}

/** The facts on the route's one handler (fails the test if it was refused). */
function factsOf(src: string, verb = 'POST'): HandlerFacts {
    const route = scanTree({ 'route.ts': src }).find((r) => r.rel === 'route.ts')
    const handler = route?.handlers.find((h) => h.verb === verb)
    if (!handler?.facts) throw new Error(`no facts for ${verb}: ${handler?.refusal ?? 'no handler'}`)
    return handler.facts
}

const AUTHORIZE = "import { authorize } from 'keel/authz/authorize'\n"
const CALL = 'authorize(actor, "update", subject)'
const DECLS = 'declare const actor: never\ndeclare const subject: never\ndeclare const cond: boolean\n'

/** A route.ts that imports the real authorize, with `body` as POST's body. */
function post(body: string, prelude = ''): Record<string, string> {
    return {
        'route.ts': `${AUTHORIZE}${DECLS}${prelude}\nexport async function POST(request: Request) {\n${body}\n}\n`,
    }
}

describe('the export forms a mutating handler can take', () => {
    const cases: Array<{ name: string; files: Record<string, string>; expect: Record<string, Outcome> }> = [
        {
            name: 'export async function',
            files: { 'route.ts': `${AUTHORIZE}${DECLS}export async function POST() { ${CALL} }` },
            expect: { POST: 'authorized' },
        },
        {
            name: 'export function (sync, returning a promise)',
            files: { 'route.ts': `${AUTHORIZE}${DECLS}export function PUT() { ${CALL}; return Promise.resolve() }` },
            expect: { PUT: 'authorized' },
        },
        {
            name: 'export const = arrow',
            files: { 'route.ts': `${AUTHORIZE}${DECLS}export const PATCH = async () => { ${CALL} }` },
            expect: { PATCH: 'authorized' },
        },
        {
            name: 'export const = function expression, behind `satisfies`',
            files: {
                'route.ts': `${AUTHORIZE}${DECLS}export const DELETE = (function () { ${CALL} }) satisfies unknown`,
            },
            expect: { DELETE: 'authorized' },
        },
        {
            name: 'export const = a wrapper call around the handler',
            files: {
                'route.ts': `${AUTHORIZE}${DECLS}declare const wrap: Function\nexport const POST = wrap(async () => { ${CALL} })`,
            },
            expect: { POST: 'authorized' },
        },
        {
            name: 'export const = a same-file const that is itself the handler',
            files: {
                'route.ts': `${AUTHORIZE}${DECLS}const handler = async () => { ${CALL} }\nexport const POST = handler`,
            },
            expect: { POST: 'authorized' },
        },
        {
            name: 'export { handler as POST }, and an open one as PATCH',
            files: {
                'route.ts': `${AUTHORIZE}${DECLS}async function handler() { ${CALL} }\nconst open = async () => {}\nexport { handler as POST, open as PATCH }`,
            },
            expect: { POST: 'authorized', PATCH: 'open' },
        },
        {
            name: "export { handler as 'DELETE' } (a string export name)",
            files: { 'route.ts': "const handler = async () => {}\nexport { handler as 'DELETE' }" },
            expect: { DELETE: 'open' },
        },
        {
            name: 'an overloaded function: the implementation is the handler',
            files: {
                'route.ts': `${AUTHORIZE}${DECLS}export function POST(): Promise<void>\nexport function POST(request?: Request) { ${CALL}; return Promise.resolve() }`,
            },
            expect: { POST: 'authorized' },
        },
        {
            name: 'export { POST } from a relative module, read in that module',
            files: {
                'route.ts': "export { POST, DELETE } from './impl'",
                'impl.ts': `${AUTHORIZE}${DECLS}export async function POST() { ${CALL} }\nexport async function DELETE() {}`,
            },
            expect: { POST: 'authorized', DELETE: 'open' },
        },
        {
            name: 'export { handler as POST } from a module',
            files: {
                'route.ts': "export { handler as POST } from './impl'",
                'impl.ts': `${AUTHORIZE}${DECLS}export const handler = async () => { ${CALL} }`,
            },
            expect: { POST: 'authorized' },
        },
        {
            name: 'an imported handler, exported by name and as an initializer',
            files: {
                'route.ts':
                    "import { open, guarded } from './impl'\nexport const POST = guarded\nexport { open as DELETE }",
                'impl.ts': `${AUTHORIZE}${DECLS}export const guarded = async () => { ${CALL} }\nexport const open = async () => {}`,
            },
            expect: { POST: 'authorized', DELETE: 'open' },
        },
        {
            name: 'export * from a module: each of its verbs is judged',
            files: {
                'route.ts': "export * from './impl'\nexport async function GET() {}",
                'impl.ts': `${AUTHORIZE}${DECLS}export async function POST() { ${CALL} }\nexport async function DELETE() {}\nexport async function GET() {}`,
            },
            expect: { POST: 'authorized', DELETE: 'open' },
        },
        {
            name: 'export * through two modules, where the route also names a verb itself',
            files: {
                'route.ts': "export * from './a'\nexport async function PUT() {}",
                'a.ts': "export * from './b'",
                'b.ts': `${AUTHORIZE}${DECLS}export async function PATCH() { ${CALL} }\nexport async function PUT() { ${CALL} }`,
            },
            expect: { PUT: 'open', PATCH: 'authorized' },
        },
        {
            name: 'a named re-export of a name the module itself gets through export *',
            files: {
                'route.ts': "export { POST, DELETE } from './a'",
                'a.ts': "export * from './b'",
                'b.ts': `${AUTHORIZE}${DECLS}export async function POST() { ${CALL} }\nexport async function DELETE() {}`,
            },
            expect: { POST: 'authorized', DELETE: 'open' },
        },
        {
            name: 'a re-export through a tsconfig `paths` alias',
            files: {
                'route.ts': "export { POST } from '@/impl'",
                'src/impl.ts': `${AUTHORIZE}${DECLS}export async function POST() { ${CALL} }`,
                'tsconfig.json': JSON.stringify({
                    compilerOptions: { moduleResolution: 'bundler', module: 'esnext', paths: { '@/*': ['./src/*'] } },
                }),
            },
            expect: { POST: 'authorized' },
        },
        {
            name: 'export { h as POST } where h is overloaded',
            files: {
                'route.ts': `${AUTHORIZE}${DECLS}function h(): Promise<void>\nfunction h(r?: Request) { ${CALL}; return Promise.resolve() }\nexport { h as POST }`,
            },
            expect: { POST: 'authorized' },
        },
        {
            name: "a module's default function, re-exported as a verb",
            files: {
                'route.ts': "export { default as POST } from './impl'",
                'impl.ts': `${AUTHORIZE}${DECLS}export default async function () { ${CALL} }`,
            },
            expect: { POST: 'authorized' },
        },
        {
            name: "a module's default expression, re-exported as a verb",
            files: {
                'route.ts': "export { default as POST, default as DELETE } from './impl'",
                'impl.ts': `${AUTHORIZE}${DECLS}export default async () => { ${CALL} }`,
            },
            expect: { POST: 'authorized', DELETE: 'authorized' },
        },
        {
            name: "a module's default, imported and exported as a verb",
            files: {
                'route.ts': "import h from './impl'\nexport { h as POST }",
                'impl.ts': 'export default async function named() {}',
            },
            expect: { POST: 'open' },
        },
        {
            name: "a module's default class is not a handler",
            files: { 'route.ts': "export { default as POST } from './impl'", 'impl.ts': 'export default class {}' },
            expect: { POST: /ClassDeclaration, not a function/ },
        },
        {
            name: 'a GET-only route has no mutating handler',
            files: { 'route.ts': 'export async function GET() {}\nexport const HEAD = async () => {}' },
            expect: {},
        },
        {
            name: 'a type-only export is not a handler',
            files: { 'route.ts': 'type POST = () => void\nexport type { POST }' },
            expect: {},
        },
    ]

    it.each(cases)('$name', ({ files, expect: expected }) => {
        const root =
            'tsconfig.json' in files ? (dir: string) => ({ tsconfig: path.join(dir, 'tsconfig.json') }) : undefined
        expectVerdicts(verdicts(files, root), expected)
    })
})

describe('what the analyser refuses, and says why', () => {
    const cases: Array<{ name: string; files: Record<string, string>; expect: Record<string, RegExp> }> = [
        {
            name: 'a destructured export',
            files: {
                'route.ts':
                    'declare const handlers: Record<string, unknown>\nexport const { POST, other: [DELETE] } = handlers as never',
            },
            expect: { POST: /destructured/, DELETE: /destructured/ },
        },
        {
            name: 'a `let` handler, which can be reassigned',
            files: { 'route.ts': `${AUTHORIZE}${DECLS}export let POST = async () => { ${CALL} }` },
            expect: { POST: /`let` or `var`/ },
        },
        {
            name: 'a handler that is a property of another value',
            files: { 'route.ts': 'declare const handlers: { post: () => void }\nexport const POST = handlers.post' },
            expect: { POST: /PropertyAccessExpression/ },
        },
        {
            name: 'an ambient handler with no initializer',
            files: { 'route.ts': 'export declare const POST: () => Promise<Response>' },
            expect: { POST: /no initializer/ },
        },
        {
            name: 'a handler defined in terms of itself',
            files: { 'route.ts': 'export const POST = other\nconst other = POST' },
            expect: { POST: /in terms of itself/ },
        },
        {
            name: 'a class exported under a verb',
            files: { 'route.ts': 'export class POST {}' },
            expect: { POST: /ClassDeclaration, not a function/ },
        },
        {
            name: 'a namespace re-export under a verb',
            files: { 'route.ts': "export * as POST from './impl'", 'impl.ts': 'export const x = 1' },
            expect: { POST: /namespace re-export/ },
        },
        {
            name: '`export import … =` under a verb',
            files: {
                'route.ts': 'namespace handlers { export const post = () => {} }\nexport import POST = handlers.post',
            },
            expect: { POST: /export import/ },
        },
        {
            name: 'a re-export that does not resolve',
            files: { 'route.ts': "export { POST } from './missing'" },
            expect: { POST: /does not resolve/ },
        },
        {
            name: 'a re-export of a name the module does not export',
            files: { 'route.ts': "export { POST } from './impl'", 'impl.ts': 'export const GET = async () => {}' },
            expect: { POST: /has no export named `POST`/ },
        },
        {
            name: 'a named re-export from a module whose export * does not resolve',
            files: { 'route.ts': "export { POST } from './a'", 'a.ts': "export * from './missing'" },
            expect: { POST: /does not resolve/ },
        },
        {
            name: 'a re-export into a declaration file',
            files: { 'route.ts': "export { POST } from './impl'", 'impl.d.ts': 'export declare function POST(): void' },
            expect: { POST: /declaration file/ },
        },
        {
            name: 'a re-export into a module that does not parse',
            files: { 'route.ts': "export { POST } from './impl'", 'impl.ts': 'export async function POST( {' },
            expect: { POST: /does not parse/ },
        },
        {
            name: 'export * from a module that does not resolve: which verbs is unknown',
            files: { 'route.ts': "export * from './missing'\nexport async function GET() {}" },
            expect: { '*': /which verbs it exports is unknown/ },
        },
        {
            name: 'an import of a module that does not resolve, exported as a verb',
            files: { 'route.ts': "import { handler } from 'no-such-package'\nexport { handler as POST }" },
            expect: { POST: /does not resolve/ },
        },
        {
            name: 'a namespace import exported as a verb',
            files: {
                'route.ts': "import * as impl from './impl'\nexport { impl as POST }",
                'impl.ts': 'export const x = 1',
            },
            expect: { POST: /namespace import/ },
        },
        {
            name: 'a route file that does not parse',
            files: { 'route.ts': 'export async function POST( {' },
            expect: { '*': /does not parse/ },
        },
        {
            name: 'a route file that assigns module.exports',
            files: { 'route.ts': 'module.exports.POST = async () => {}' },
            expect: { '*': /module\.exports/ },
        },
        {
            name: 'a handler function the file reassigns',
            files: {
                'route.ts': `${AUTHORIZE}${DECLS}export async function POST() { ${CALL} }\nPOST = async () => {}`,
            },
            expect: { POST: /reassigns/ },
        },
        {
            name: 'a route file with exports and an exports[...] assignment',
            files: { 'route.ts': "export const GET = 1\nexports['POST'] = async () => {}" },
            expect: { '*': /module\.exports/ },
        },
        {
            name: 'a route file with exports and Object.assign(module.exports, …)',
            files: { 'route.ts': 'export const GET = 1\nObject.assign(module.exports, { POST: async () => {} })' },
            expect: { '*': /module\.exports/ },
        },
        {
            name: "a route file with exports and module['exports'] in a block",
            files: { 'route.ts': "export const GET = 1\n{ module['exports'] = {} }" },
            expect: { '*': /module\.exports/ },
        },
        {
            name: 'a route file with exports and a bare exports passed along',
            files: { 'route.ts': 'export const GET = 1\nObject.assign(exports, {})' },
            expect: { '*': /module\.exports/ },
        },
        {
            name: 'a route file that is no module at all',
            files: { 'route.ts': 'const x = 1' },
            expect: { '*': /not an ES module/ },
        },
        {
            name: 'export * into a CommonJS module',
            files: { 'route.ts': "export * from './impl.js'", 'impl.js': 'module.exports = { POST: async () => {} }' },
            expect: { '*': /not an ES module/ },
        },
        {
            name: 'a route file that assigns exports.X',
            files: { 'route.ts': 'exports.DELETE = async () => {}' },
            expect: { '*': /module\.exports/ },
        },
    ]

    it.each(cases)('$name', ({ files, expect: expected }) => {
        expectVerdicts(verdicts(files), expected)
    })
})

describe("what counts as a handler's own path", () => {
    const cases: Array<{ name: string; files: Record<string, string>; expect: Outcome }> = [
        { name: 'a direct call', files: post(CALL), expect: 'authorized' },
        {
            name: "'authorize(' in a string",
            files: post(`return Response.json({ why: 'authorize(' })`),
            expect: 'open',
        },
        { name: "'authorize(' in a template", files: post('return `authorize(actor)`'), expect: 'open' },
        { name: 'authorize(...) in a comment', files: post(`// ${CALL}\n/* ${CALL} */`), expect: 'open' },
        { name: 'under if (false)', files: post(`if (false) ${CALL}`), expect: 'open' },
        { name: 'under if (0)', files: post(`if (0) { ${CALL} }`), expect: 'open' },
        { name: "under if ('')", files: post(`if ('') ${CALL}`), expect: 'open' },
        { name: 'under if (!true)', files: post(`if (!true) ${CALL}`), expect: 'open' },
        { name: 'under if (void 0)', files: post(`if (void 0) ${CALL}`), expect: 'open' },
        { name: 'under if (null)', files: post(`if (null) ${CALL}`), expect: 'open' },
        { name: 'under if (undefined)', files: post(`if (undefined) ${CALL}`), expect: 'open' },
        {
            name: 'under a const bound to false',
            files: post(`if (NEVER) ${CALL}`, 'const NEVER = false\n'),
            expect: 'open',
        },
        {
            name: 'under a const bound to a const bound to false',
            files: post(`if (OFF) ${CALL}`, 'const NEVER = false\nconst OFF = NEVER\n'),
            expect: 'open',
        },
        {
            name: 'under a let bound to false (could change)',
            files: post(`if (maybe) ${CALL}`, 'let maybe = false\n'),
            expect: 'authorized',
        },
        { name: 'in the else of if (true)', files: post(`if (true) {} else ${CALL}`), expect: 'open' },
        { name: 'in the then of if (true)', files: post(`if (true) ${CALL}`), expect: 'authorized' },
        { name: 'in the else of if (false)', files: post(`if (false) {} else ${CALL}`), expect: 'authorized' },
        { name: 'under an unknown condition', files: post(`if (cond) ${CALL}`), expect: 'authorized' },
        { name: 'in the condition itself', files: post(`if (${CALL}) {}`), expect: 'authorized' },
        { name: 'right of false &&', files: post(`false && ${CALL}`), expect: 'open' },
        { name: 'right of true ||', files: post(`true || ${CALL}`), expect: 'open' },
        { name: "right of 'x' ??", files: post(`'x' ?? ${CALL}`), expect: 'open' },
        { name: 'right of null ??', files: post(`null ?? ${CALL}`), expect: 'authorized' },
        { name: 'right of cond &&', files: post(`cond && ${CALL}`), expect: 'authorized' },
        { name: 'right of true &&', files: post(`true && ${CALL}`), expect: 'authorized' },
        { name: 'right of false ||', files: post(`false || ${CALL}`), expect: 'authorized' },
        { name: 'right of an unknown ??', files: post(`cond ?? ${CALL}`), expect: 'authorized' },
        { name: 'right of a const string ??', files: post(`OK ?? ${CALL}`, "const OK = 'yes'\n"), expect: 'open' },
        { name: 'right of a const false ??', files: post(`NO ?? ${CALL}`, 'const NO = false\n'), expect: 'open' },
        {
            name: 'right of a const null ??',
            files: post(`NONE ?? ${CALL}`, 'const NONE = null\n'),
            expect: 'authorized',
        },
        {
            name: 'right of a let string ??',
            files: post(`ok ?? ${CALL}`, "let ok: string | null = 'yes'\n"),
            expect: 'authorized',
        },
        { name: 'right of undefined ??', files: post(`undefined ?? ${CALL}`), expect: 'authorized' },
        { name: 'the false arm of true ? :', files: post(`true ? 1 : ${CALL}`), expect: 'open' },
        { name: 'the true arm of false ? :', files: post(`false ? ${CALL} : 1`), expect: 'open' },
        { name: 'either arm of an unknown ? :', files: post(`cond ? 1 : ${CALL}`), expect: 'authorized' },
        { name: 'in the condition of an unknown ? :', files: post(`;(${CALL}) ? 1 : 2`), expect: 'authorized' },
        { name: 'the true arm of true ? :', files: post(`true ? ${CALL} : 1`), expect: 'authorized' },
        { name: 'in while (false)', files: post(`while (false) ${CALL}`), expect: 'open' },
        { name: 'in while (cond)', files: post(`while (cond) ${CALL}`), expect: 'authorized' },
        { name: 'in a while condition', files: post(`while (${CALL}) {}`), expect: 'authorized' },
        { name: 'in for (;false;)', files: post(`for (;false;) ${CALL}`), expect: 'open' },
        { name: 'in for (;;) with a break first', files: post(`for (;;) { break; ${CALL} }`), expect: 'open' },
        { name: 'in a for initializer', files: post(`for (let i = ${CALL}; cond; ) {}`), expect: 'authorized' },
        { name: 'in a for condition', files: post(`for (; ${CALL}; ) {}`), expect: 'authorized' },
        { name: 'in a for incrementor', files: post(`for (; cond; ${CALL}) {}`), expect: 'authorized' },
        { name: 'in a for body', files: post(`for (let i = 0; i < 1; i++) ${CALL}`), expect: 'authorized' },
        { name: 'in a for-of body', files: post(`for (const x of [1]) ${CALL}`), expect: 'authorized' },
        { name: 'in a for-in expression', files: post(`for (const k in ${CALL}) {}`), expect: 'authorized' },
        { name: 'in a do-while body', files: post(`do { ${CALL} } while (false)`), expect: 'authorized' },
        { name: 'in a do-while condition', files: post(`do {} while (${CALL})`), expect: 'authorized' },
        {
            name: 'in a for-of body after continue',
            files: post(`for (const x of [1]) { continue; ${CALL} }`),
            expect: 'open',
        },
        { name: 'in a switch case', files: post(`switch (cond) { case true: ${CALL}; break }`), expect: 'authorized' },
        { name: 'in a switch subject', files: post(`switch (${CALL}) { default: break }`), expect: 'authorized' },
        { name: 'in a switch case label', files: post(`switch (cond) { case ${CALL}: break }`), expect: 'authorized' },
        {
            name: 'in a switch case after its break',
            files: post(`switch (cond) { default: break; ${CALL} }`),
            expect: 'open',
        },
        { name: 'in a labeled block', files: post(`outer: { ${CALL} }`), expect: 'authorized' },
        {
            name: 'after a switch whose every clause returns, with a default',
            files: post(`switch (cond) { case true: return 1; default: return 2 }\n${CALL}`),
            expect: 'open',
        },
        {
            name: 'after a switch whose clauses fall through to a return',
            files: post(`switch (cond) { case true: default: return 2 }\n${CALL}`),
            expect: 'open',
        },
        {
            name: 'after a switch with no default',
            files: post(`switch (cond) { case true: return 1 }\n${CALL}`),
            expect: 'authorized',
        },
        {
            name: 'after a switch a clause breaks out of',
            files: post(`switch (cond) { case true: break; default: return 2 }\n${CALL}`),
            expect: 'authorized',
        },
        {
            name: 'after a switch whose last clause falls off the end',
            files: post(`switch (cond) { default: return 2; case true: }\n${CALL}`),
            expect: 'authorized',
        },
        {
            name: 'after a switch whose inner loop breaks (not out of the switch)',
            files: post(`switch (cond) { default: for (;;) { break } return 2 }\n${CALL}`),
            expect: 'open',
        },
        { name: 'after while (true) that returns', files: post(`while (true) { return 1 }\n${CALL}`), expect: 'open' },
        { name: 'after for (;;) that returns', files: post(`for (;;) { return 1 }\n${CALL}`), expect: 'open' },
        {
            name: 'after for (; true;) that returns',
            files: post(`for (; true; ) { return 1 }\n${CALL}`),
            expect: 'open',
        },
        {
            name: 'after while (true) that can break',
            files: post(`while (true) { if (cond) break; return 1 }\n${CALL}`),
            expect: 'authorized',
        },
        {
            name: 'after while (true) whose body is a break',
            files: post(`while (true) break\n${CALL}`),
            expect: 'authorized',
        },
        {
            name: 'after while (true) whose only break is in an inner loop',
            files: post(`while (true) { for (;;) { break } return 1 }\n${CALL}`),
            expect: 'open',
        },
        {
            name: 'after while (true) whose inner loop breaks it by label',
            files: post(`outer: while (true) { for (;;) { break outer } }\n${CALL}`),
            expect: 'authorized',
        },
        {
            // Invalid (a break cannot cross a function), but it parses, and must not count as leaving the loop.
            name: 'after while (true) whose only bare break is in a nested function',
            files: post(`while (true) { ;(() => { break })(); return 1 }\n${CALL}`),
            expect: 'open',
        },
        {
            name: 'after while (cond) that returns',
            files: post(`while (cond) { return 1 }\n${CALL}`),
            expect: 'authorized',
        },
        { name: 'after do that returns', files: post(`do { return 1 } while (cond)\n${CALL}`), expect: 'open' },
        {
            name: 'after do that continues',
            files: post(`do { continue } while (false)\n${CALL}`),
            expect: 'authorized',
        },
        { name: 'after do-while (true)', files: post(`do {} while (true)\n${CALL}`), expect: 'open' },
        {
            name: 'after do-while (true) that breaks',
            files: post(`do { break } while (true)\n${CALL}`),
            expect: 'authorized',
        },
        {
            name: 'after do-while (cond) with an empty body',
            files: post(`do {} while (cond)\n${CALL}`),
            expect: 'authorized',
        },
        { name: 'after a labeled block that returns', files: post(`l: { return 1 }\n${CALL}`), expect: 'open' },
        {
            name: 'after a labeled block a break names',
            files: post(`l: { if (cond) break l; return 1 }\n${CALL}`),
            expect: 'authorized',
        },
        {
            name: 'after a labeled if a break names',
            files: post(`l: if (cond) { break l } else { return 1 }\n${CALL}`),
            expect: 'authorized',
        },
        {
            name: 'after a labeled try a break names',
            files: post(`l: try { break l } finally { return 1 }\n${CALL}`),
            expect: 'authorized',
        },
        {
            name: 'after a labeled try whose catch a break names',
            files: post(`l: try { return 1 } catch { break l }\n${CALL}`),
            expect: 'authorized',
        },
        {
            name: 'after a labeled try that returns',
            files: post(`l: try { return 1 } catch { return 2 }\n${CALL}`),
            expect: 'open',
        },
        {
            name: 'after a labeled block whose if returns both ways',
            files: post(`l: if (cond) { return 1 } else { return 2 }\n${CALL}`),
            expect: 'open',
        },
        {
            name: 'after a labeled if (true) that returns',
            files: post(`l: if (true) { return 1 }\n${CALL}`),
            expect: 'open',
        },
        {
            name: 'after a labeled if (false) whose else returns',
            files: post(`l: if (false) {} else { return 1 }\n${CALL}`),
            expect: 'open',
        },
        {
            name: 'after a labeled while (true) a break names',
            files: post(`l: while (true) { break l }\n${CALL}`),
            expect: 'authorized',
        },
        {
            name: 'after a labeled while (true) that returns',
            files: post(`l: while (true) { return 1 }\n${CALL}`),
            expect: 'open',
        },
        {
            name: 'after a labeled do whose continue names it',
            files: post(`l: do { if (cond) continue l; return 1 } while (false)\n${CALL}`),
            expect: 'authorized',
        },
        {
            name: 'after a labeled switch a break names',
            files: post(`l: switch (cond) { default: if (cond) break l; return 1 }\n${CALL}`),
            expect: 'authorized',
        },
        { name: 'after return', files: post(`return Response.json({})\n${CALL}`), expect: 'open' },
        { name: 'after throw', files: post(`throw new Error('no')\n${CALL}`), expect: 'open' },
        { name: 'in the returned expression', files: post(`return ${CALL}`), expect: 'authorized' },
        { name: 'in the thrown expression', files: post(`throw ${CALL}`), expect: 'authorized' },
        { name: 'after a block that returns', files: post(`{ return 1 }\n${CALL}`), expect: 'open' },
        {
            name: 'after an if whose both arms return',
            files: post(`if (cond) return 1\nelse return 2\n${CALL}`),
            expect: 'open',
        },
        { name: 'after an if (true) that returns', files: post(`if (true) return 1\n${CALL}`), expect: 'open' },
        {
            name: 'after an if (false) whose else returns',
            files: post(`if (false) {} else return 2\n${CALL}`),
            expect: 'open',
        },
        { name: 'after an if (false) with no else', files: post(`if (false) return 1\n${CALL}`), expect: 'authorized' },
        {
            name: 'after an if with one arm returning',
            files: post(`if (cond) return 1\n${CALL}`),
            expect: 'authorized',
        },
        {
            name: 'after an if/else where only one arm returns',
            files: post(`if (cond) return 1\nelse {}\n${CALL}`),
            expect: 'authorized',
        },
        {
            name: 'after an if/else where only the else returns',
            files: post(`if (cond) {}\nelse return 1\n${CALL}`),
            expect: 'authorized',
        },
        {
            name: 'after try/catch that both return',
            files: post(`try { return 1 } catch { return 2 }\n${CALL}`),
            expect: 'open',
        },
        {
            name: 'after try that returns with no catch',
            files: post(`try { return 1 } finally {}\n${CALL}`),
            expect: 'open',
        },
        { name: 'after a finally that returns', files: post(`try {} finally { return 1 }\n${CALL}`), expect: 'open' },
        {
            name: 'after a try that returns, catch that does not',
            files: post(`try { return 1 } catch {}\n${CALL}`),
            expect: 'authorized',
        },
        { name: 'inside try', files: post(`try { ${CALL} } catch {}`), expect: 'authorized' },
        { name: 'inside catch', files: post(`try {} catch { ${CALL} }`), expect: 'authorized' },
        { name: 'inside finally', files: post(`try {} finally { ${CALL} }`), expect: 'authorized' },
        { name: 'in a variable initializer', files: post(`const x = ${CALL}`), expect: 'authorized' },
        {
            name: 'in a destructuring default (runs only when missing)',
            files: post(`const { a = ${CALL} } = {} as { a?: 1 }`),
            expect: 'open',
        },
        {
            name: 'in a parameter default',
            files: { 'route.ts': `${AUTHORIZE}${DECLS}export async function POST(request = ${CALL}) {}` },
            expect: 'open',
        },
        { name: 'nested inside another call’s argument', files: post(`Response.json(${CALL})`), expect: 'authorized' },
        {
            name: 'in a callback passed to a wrapper',
            files: post(`return wrap(async () => { ${CALL} })`, 'declare const wrap: Function\n'),
            expect: 'authorized',
        },
        {
            name: 'in a function expression passed to a wrapper',
            files: post(`return wrap(async function () { ${CALL} })`, 'declare const wrap: Function\n'),
            expect: 'authorized',
        },
        { name: 'in a callback passed to a method', files: post(`;[1].forEach(() => ${CALL})`), expect: 'authorized' },
        { name: 'in a Promise executor', files: post(`await new Promise(() => ${CALL})`), expect: 'authorized' },
        { name: 'in an IIFE', files: post(`;(() => { ${CALL} })()`), expect: 'authorized' },
        {
            name: 'in a closure that is never called',
            files: post(`const check = () => ${CALL}\nreturn typeof check`),
            expect: 'open',
        },
        {
            name: 'in a closure that is called',
            files: post(`const check = () => ${CALL}\ncheck()`),
            expect: 'authorized',
        },
        {
            name: 'in a let closure that is called (could be reassigned)',
            files: post(`let check = () => ${CALL}\ncheck()`),
            expect: 'open',
        },
        {
            name: 'in a closure passed by name to a wrapper',
            files: post(`const check = async () => { ${CALL} }\nreturn wrap(check)`, 'declare const wrap: Function\n'),
            expect: 'authorized',
        },
        {
            name: 'in a same-file function declaration that is called',
            files: post('check()', `function check() { ${CALL} }\n`),
            expect: 'authorized',
        },
        {
            name: 'in a same-file function declared after the call',
            files: post('return check()\nfunction check() { ' + CALL + ' }'),
            expect: 'authorized',
        },
        {
            name: 'in a same-file function that is never called',
            files: post('return 1', `function check() { ${CALL} }\n`),
            expect: 'open',
        },
        {
            name: 'in a same-file function two calls deep, through a cycle',
            files: post('a()', `function a(): void { b() }\nfunction b(): void { if (cond) a(); ${CALL} }\n`),
            expect: 'authorized',
        },
        {
            name: 'in a nested function declaration that is never called',
            files: post(`function check() { ${CALL} }\nreturn 1`),
            expect: 'open',
        },
        {
            name: 'in an object method that is called',
            files: post(`const h = { run() { ${CALL} } }\nh.run()`),
            expect: 'open',
        },
        { name: 'in a class body', files: post(`class C { static { ${CALL} } }\nnew C()`), expect: 'open' },
        {
            name: 'in a class expression (not followed, though a static block would run)',
            files: post(`const C = class { static { ${CALL} } }\nreturn C`),
            expect: 'open',
        },
        {
            name: 'an import type clause of authorize',
            files: {
                'route.ts': `import type { authorize } from 'keel/authz/authorize'\n${DECLS}export async function POST() { ${CALL} }`,
            },
            expect: 'open',
        },
        {
            name: 'a same-file helper the file reassigns',
            files: post('check()', `function check() { ${CALL} }\ncheck = () => {}\n`),
            expect: 'open',
        },
        {
            name: 'a same-file helper the file increments (still a write)',
            files: post('check()', `function check() { ${CALL} }\ncheck++\n`),
            expect: 'open',
        },
        {
            name: 'an overloaded same-file helper',
            files: post(
                'check(1)',
                `function check(a: string): void\nfunction check(a: number): void\nfunction check(a: unknown) { ${CALL} }\n`,
            ),
            expect: 'authorized',
        },
        {
            name: 'a type-only import of authorize',
            files: {
                'route.ts': `import { type authorize } from 'keel/authz/authorize'\n${DECLS}export async function POST() { ${CALL} }`,
            },
            expect: 'open',
        },
        {
            name: 'in a helper imported from another module',
            files: {
                ...post('check()', "import { check } from './helper'\n"),
                'helper.ts': `${AUTHORIZE}${DECLS}export function check() { ${CALL} }`,
            },
            expect: 'open',
        },
        {
            name: 'a local function named authorize',
            files: {
                'route.ts': `${DECLS}function authorize(..._: unknown[]) {}\nexport async function POST() { ${CALL} }`,
            },
            expect: 'open',
        },
        {
            name: 'a local function named authorize that calls the real one',
            files: {
                'route.ts': `import { authorize as real } from 'keel/authz/authorize'\n${DECLS}function authorize(...a: never[]) { real(...a) }\nexport async function POST() { ${CALL} }`,
            },
            expect: 'authorized',
        },
        {
            name: 'authorize imported from another module',
            files: {
                'route.ts': `import { authorize } from './my-authz'\n${DECLS}export async function POST() { ${CALL} }`,
            },
            expect: 'open',
        },
        {
            name: 'authorize imported under another name',
            files: {
                'route.ts': `import { authorize as az } from 'keel/authz/authorize'\n${DECLS}export async function POST() { az(actor, 'update', subject) }`,
            },
            expect: 'authorized',
        },
        {
            name: 'a different keel export imported as authorize',
            files: {
                'route.ts': `import { canInActiveOrg as authorize } from 'keel/authz/authorize'\n${DECLS}export async function POST() { ${CALL} }`,
            },
            expect: 'open',
        },
        {
            name: 'authorize through a namespace import of keel',
            files: {
                'route.ts': `import * as authz from 'keel/authz/authorize'\n${DECLS}export async function POST() { authz.authorize(actor, 'update', subject) }`,
            },
            expect: 'authorized',
        },
        {
            name: 'another export through a namespace import of keel',
            files: {
                'route.ts': `import * as authz from 'keel/authz/authorize'\n${DECLS}export async function POST() { authz.canInActiveOrg(actor) }`,
            },
            expect: 'open',
        },
        {
            name: 'authorize through a namespace import of another module',
            files: {
                'route.ts': `import * as authz from './my-authz'\n${DECLS}export async function POST() { authz.authorize(actor, 'update', subject) }`,
            },
            expect: 'open',
        },
        {
            name: 'authorize as a property of something that is not an import',
            files: {
                'route.ts': `${DECLS}declare const authz: { authorize: Function }\nexport async function POST() { authz.authorize(actor) }`,
            },
            expect: 'open',
        },
    ]

    it.each(cases)('$name', ({ files, expect: expected }) => {
        expectVerdicts(verdicts(files), { POST: expected })
    })

    it("a call in one handler is not on another handler's path", () => {
        expectVerdicts(
            verdicts({
                'route.ts': `${AUTHORIZE}${DECLS}export async function PATCH() { ${CALL} }\nexport async function DELETE() {}\nexport async function GET() { ${CALL} }`,
            }),
            { PATCH: 'authorized', DELETE: 'open' },
        )
    })

    it('two handlers sharing a same-file helper both reach what it calls', () => {
        expectVerdicts(
            verdicts({
                'route.ts': `${AUTHORIZE}${DECLS}function check() { ${CALL} }\nexport async function PATCH() { check() }\nexport async function DELETE() { check() }`,
            }),
            { PATCH: 'authorized', DELETE: 'authorized' },
        )
    })

    it('the authorize modules are an option, so an adopter can name its own', () => {
        const files = {
            'route.ts': `import { authorize } from '@acme/authz'\n${DECLS}export async function POST() { ${CALL} }`,
        }
        expectVerdicts(verdicts(files), { POST: 'open' })
        expectVerdicts(verdicts(files, undefined, { authorizeModules: ['@acme/authz'] }), { POST: 'authorized' })
    })

    it('a JSDoc @import in a route.js is a type, not the choke point, and does not stop the scan', () => {
        const route = scanTree({
            'route.js':
                "/** @import { authorize } from 'keel/authz/authorize' */\nexport async function POST() { authorize() }",
        })[0]
        expect(route?.handlers.map((h) => [h.verb, outcome(h)])).toEqual([['POST', 'open']])
    })

    it('a route.js that reassigns its handler is refused', () => {
        const route = scanTree({
            'route.js': `${AUTHORIZE}export async function POST() { authorize() }\nPOST = async () => {}`,
        })[0]
        expect(route?.handlers[0]?.refusal).toMatch(/reassigns/)
    })

    it('reads a route.js the same way', () => {
        const route = scanTree({
            'route.js': `${AUTHORIZE}export async function POST() { authorize() }\nexport function DELETE() {}`,
        })[0]
        expect(route?.handlers.map((h) => [h.verb, outcome(h)])).toEqual([
            ['POST', 'authorized'],
            ['DELETE', 'open'],
        ])
    })
})

describe('the facts a gate is judged on', () => {
    const WITH_X = "import { withX } from './wrappers'\n"
    const SIM = "import { isSimulated } from 'keel/adapters/index'\n"

    it('wrappedBy is the imported callee of the call the handler IS, with type arguments and wrappers seen through', () => {
        expect(factsOf(`${WITH_X}export const POST = withX(async () => {})`).wrappedBy).toBe('withX')
        expect(factsOf(`${WITH_X}export const POST = (withX<{ id: string }>(async () => {})) as never`).wrappedBy).toBe(
            'withX',
        )
        expect(factsOf("import * as a from './w'\nexport const POST = a.b.withX(async () => {})").wrappedBy).toBe(
            'a.b.withX',
        )
        expect(factsOf(`${WITH_X}const inner = withX(async () => {})\nexport const POST = inner`).wrappedBy).toBe(
            'withX',
        )
        expect(factsOf("import withX from './w'\nexport const POST = withX(async () => {})").wrappedBy).toBe('withX')
    })

    it('wrappedBy is null for a wrapper that is not a value import: a local look-alike is not the guard', () => {
        expect(
            factsOf('const withX = (h: unknown) => h\nexport const POST = withX(async () => {})').wrappedBy,
        ).toBeNull()
        expect(factsOf('declare const withX: Function\nexport const POST = withX(async () => {})').wrappedBy).toBeNull()
        expect(
            factsOf("import type { withX } from './w'\nexport const POST = withX(async () => {})").wrappedBy,
        ).toBeNull()
        expect(
            factsOf("import { type withX } from './w'\nexport const POST = withX(async () => {})").wrappedBy,
        ).toBeNull()
    })

    it('wrappedBy is null for a function handler, even one that returns the wrapper', () => {
        expect(factsOf(`${WITH_X}export async function POST() { return withX(async () => {}) }`).wrappedBy).toBeNull()
        expect(factsOf('export const POST = async () => {}').wrappedBy).toBeNull()
    })

    it('wrappedBy is null for a callee that is not a dotted name', () => {
        expect(factsOf("import { make } from './w'\nexport const POST = make()(async () => {})").wrappedBy).toBeNull()
        expect(factsOf("import * as w from './w'\nexport const POST = w['withX'](async () => {})").wrappedBy).toBeNull()
    })

    it('calls holds the imported dotted callees on the path, and only those', () => {
        const facts = factsOf(
            "import { auth, other } from 'keel/adapters/index'\nconst local = { signOut() {} }\n" +
                "const note = 'auth.signOut('\n" +
                'export async function POST() { await auth.updateProfile({}); local.signOut(); if (false) other.thing(); return note }\n' +
                'export async function DELETE() { other.elsewhere() }',
        )
        expect([...facts.calls].sort()).toEqual(['auth.updateProfile'])
    })

    it('calls ignores a local look-alike of a port', () => {
        const facts = factsOf(
            'const auth = { updateProfile: () => {} }\nexport async function PUT() { auth.updateProfile() }',
            'PUT',
        )
        expect([...facts.calls]).toEqual([])
    })

    it("a wrapper handler's path is the functions handed to it, not what ran when the module loaded", () => {
        const route = (src: string) => verdicts({ 'route.ts': `${AUTHORIZE}${DECLS}${WITH_X}${src}` })
        // Load-time: the wrapper's own other arguments, and a same-file factory's body.
        expectVerdicts(route(`export const POST = withX(async () => {}, ${CALL})`), { POST: 'open' })
        expectVerdicts(route(`function make() { ${CALL}; return async () => {} }\nexport const POST = make()`), {
            POST: 'open',
        })
        // Per request: a function literal, a same-file function by name, a nested wrapper's function.
        expectVerdicts(route(`export const POST = withX(async () => { ${CALL} })`), { POST: 'authorized' })
        expectVerdicts(route(`async function h() { ${CALL} }\nexport const POST = withX(h)`), { POST: 'authorized' })
        expectVerdicts(route(`export const POST = withX(withX(async () => { ${CALL} }))`), { POST: 'authorized' })
        expectVerdicts(route(`export const POST = withX({ run: async () => { ${CALL} } })`), { POST: 'open' })
    })

    it('opensWithSimulated404 needs the imported gate as the first statement, with a branch that only exits', () => {
        const gate = (body: string, prelude = SIM) =>
            factsOf(`${prelude}declare const db: { wipe(): Promise<void> }\nexport async function POST() {\n${body}\n}`)
                .opensWithSimulated404
        expect(gate('if (!isSimulated) return new Response(null, { status: 404 })\nreturn 1')).toBe(true)
        expect(gate("if (!isSimulated) { return Response.json({ error: 'not found' }, { status: 404 }) }")).toBe(true)
        expect(gate("if (!isSimulated) throw new Error('no')")).toBe(true)
        expect(gate('if (!(isSimulated)) return new Response(null)')).toBe(true)
        expect(gate('if (!isSimulated) return new Response(null)\nelse return 2')).toBe(true)
        expect(gate('if (!isSimulated) { return new Response(null); }')).toBe(true)
        expect(
            gate(
                'if (!isSimulated) return NextResponse.json({})',
                `${SIM}import { NextResponse } from 'next/server'\n`,
            ),
        ).toBe(true)
        // Not first, not exiting, not this condition.
        expect(gate('const x = 1\nif (!isSimulated) return new Response(x)')).toBe(false)
        expect(gate('if (!isSimulated) console.log(1)')).toBe(false)
        expect(gate('if (isSimulated === false) return new Response(null)')).toBe(false)
        expect(gate('if (!other) return new Response(null)', `${SIM}import { other } from 'k'\n`)).toBe(false)
        expect(gate('if (isSimulated) return new Response(null)')).toBe(false)
        expect(gate('if (-isSimulated) return new Response(null)')).toBe(false)
        expect(gate('return 1')).toBe(false)
        expect(gate('')).toBe(false)
        // Not the imported isSimulated.
        expect(gate('if (!isSimulated) return new Response(null)', 'const isSimulated = true\n')).toBe(false)
        expect(gate('if (!isSimulated) return new Response(null)', 'declare const isSimulated: boolean\n')).toBe(false)
        expect(gate('if (!isSimulated) return new Response(null)', "import type { isSimulated } from 'k'\n")).toBe(
            false,
        )
        // A real-mode branch that does something before, or while, it exits.
        expect(gate('if (!isSimulated) { await db.wipe(); return new Response(null) }')).toBe(false)
        expect(gate('if (!isSimulated) return db.wipe()')).toBe(false)
        expect(gate('if (!isSimulated) throw await db.wipe()')).toBe(false)
        expect(gate('if (!isSimulated) throw new Error(String(db.wipe()))')).toBe(false)
        expect(gate('if (!isSimulated) return new Response(await db.wipe())')).toBe(false)
        expect(gate('if (!isSimulated) return Response.json({ x: db.wipe() })')).toBe(false)
        expect(gate('if (!isSimulated) return new Response(null, { status: n++ })', `${SIM}let n = 0\n`)).toBe(false)
        expect(gate('if (!isSimulated) return new Response(null, { status: (n = 1) })', `${SIM}let n = 0\n`)).toBe(
            false,
        )
        expect(
            gate('if (!isSimulated) return new Response(null, { s: delete o.x })', `${SIM}const o: any = {}\n`),
        ).toBe(false)
        expect(gate('if (!isSimulated) return new Response(tag`x`)', `${SIM}declare const tag: any\n`)).toBe(false)
        expect(gate('if (!isSimulated) return new Response(() => 1)')).toBe(false)
        expect(gate('if (!isSimulated) return new Response(new Uint8Array())')).toBe(false)
        expect(gate('if (!isSimulated) return')).toBe(false)
        expect(gate('if (!isSimulated) { log(); return new Response(null) }', `${SIM}declare const log: any\n`)).toBe(
            false,
        )
        expect(gate('if (!isSimulated) try { return new Response(null) } finally { await db.wipe() }')).toBe(false)
        expect(gate('if (!isSimulated) return db.Response(null)')).toBe(false)
        expect(gate('if (!isSimulated) return new Response(null)', `${SIM}const Response = class {}\n`)).toBe(false)
        expect(gate('if (!isSimulated) throw make()', `${SIM}declare const make: any\n`)).toBe(false)
        expect(factsOf(`${SIM}export const POST = async () => (!isSimulated ? 1 : 2)`).opensWithSimulated404).toBe(
            false,
        )
        expect(
            factsOf(
                `${SIM}${WITH_X}export const POST = withX(async () => { if (!isSimulated) return new Response(null) })`,
            ).opensWithSimulated404,
        ).toBe(false)
    })
})

describe('judging a handler against a policy', () => {
    const facts = (over: Partial<HandlerFacts>): HandlerFacts => ({
        reachesAuthorize: false,
        wrappedBy: null,
        calls: new Set(),
        opensWithSimulated404: false,
        ...over,
    })
    const route = (rel: string): ScannedRoute => ({ root: 'r', rel, file: `/x/${rel}`, handlers: [] })
    const policy: ScanPolicy = {
        exemptPrefixes: {
            'hooks/': { reason: 'machine caller', mustMatch: { kind: 'wrapped-by', callees: ['withSecret'] } },
        },
        exemptFiles: {
            'hooks/special/route.ts': { reason: 'port call', mustMatch: { kind: 'calls', callees: ['port.call'] } },
            'sim/route.ts': { reason: 'simulated', mustMatch: { kind: 'opens-with-simulated-404' } },
        },
        requiredAlongside: {
            'svc/': {
                reason: 'the wrapper builds the actor',
                mustMatch: { kind: 'wrapped-by', callees: ['withCaller'] },
            },
        },
        hint: 'HINT-TEXT',
    }

    it('passes a handler that reaches authorize, and fails one that does not, with the hint', () => {
        expect(
            judge(route('items/route.ts'), { verb: 'POST', facts: facts({ reachesAuthorize: true }) }, policy),
        ).toBeUndefined()
        const failure = judge(route('items/route.ts'), { verb: 'POST', facts: facts({}) }, policy)
        expect(failure).toMatch(/^r: items\/route\.ts POST exports a mutating handler that does not reach authorize/)
        expect(failure).toContain('HINT-TEXT')
        expect(
            judge(route('items/route.ts'), { verb: 'POST', facts: facts({}) }, { ...policy, hint: undefined }),
        ).not.toContain('undefined')
    })

    it('fails a refused handler, whatever its path', () => {
        expect(judge(route('hooks/a/route.ts'), { verb: 'PUT', refusal: 'WHY' }, policy)).toMatch(
            /^r: hooks\/a\/route\.ts PUT cannot be checked: WHY\./,
        )
    })

    it('holds an exempted handler to its gate, not to authorize', () => {
        expect(
            judge(route('hooks/a/route.ts'), { verb: 'POST', facts: facts({ wrappedBy: 'withSecret' }) }, policy),
        ).toBeUndefined()
        const failure = judge(
            route('hooks/a/route.ts'),
            { verb: 'POST', facts: facts({ reachesAuthorize: true, wrappedBy: 'other' }) },
            policy,
        )
        expect(failure).toMatch(
            /exemption that holds only when the handler is itself a call to an imported withSecret\(…\)/,
        )
    })

    it('an exact exemption wins over the prefix it sits under', () => {
        expect(exemptionFor(policy, 'hooks/special/route.ts')?.reason).toBe('port call')
        expect(exemptionFor(policy, 'hooks/other/route.ts')?.reason).toBe('machine caller')
        expect(exemptionFor(policy, '../hooks/route.ts')).toBeUndefined()
        expect(exemptionFor(policy, 'items/route.ts')).toBeUndefined()
        expect(
            judge(
                route('hooks/special/route.ts'),
                { verb: 'POST', facts: facts({ calls: new Set(['port.call']) }) },
                policy,
            ),
        ).toBeUndefined()
        expect(
            judge(route('hooks/special/route.ts'), { verb: 'POST', facts: facts({ wrappedBy: 'withSecret' }) }, policy),
        ).toBeDefined()
        expect(
            judge(route('sim/route.ts'), { verb: 'POST', facts: facts({ opensWithSimulated404: true }) }, policy),
        ).toBeUndefined()
    })

    it('requires a required-alongside gate AND authorize', () => {
        const svc = route('svc/jobs/route.ts')
        expect(
            judge(svc, { verb: 'POST', facts: facts({ reachesAuthorize: true, wrappedBy: 'withCaller' }) }, policy),
        ).toBeUndefined()
        expect(judge(svc, { verb: 'POST', facts: facts({ reachesAuthorize: true }) }, policy)).toMatch(
            /must also satisfy: the handler is itself a call to an imported withCaller\(…\).*the wrapper builds the actor/,
        )
        expect(judge(svc, { verb: 'POST', facts: facts({ wrappedBy: 'withCaller' }) }, policy)).toMatch(
            /does not reach authorize/,
        )
    })

    it('a gate holds only on the facts it names', () => {
        const wrapped: Gate = { kind: 'wrapped-by', callees: ['withA', 'withB'] }
        expect(gateHolds(wrapped, facts({ wrappedBy: 'withB' }))).toBe(true)
        expect(gateHolds(wrapped, facts({ wrappedBy: null, calls: new Set(['withA']) }))).toBe(false)
        const calls: Gate = { kind: 'calls', callees: ['a.b', 'c'] }
        expect(gateHolds(calls, facts({ calls: new Set(['c']) }))).toBe(true)
        expect(gateHolds(calls, facts({ wrappedBy: 'a.b' }))).toBe(false)
        expect(
            gateHolds(
                { kind: 'opens-with-simulated-404' },
                facts({ opensWithSimulated404: false, reachesAuthorize: true }),
            ),
        ).toBe(false)
    })

    it('describes each gate in words an author can act on', () => {
        expect(describeGate({ kind: 'wrapped-by', callees: ['withA', 'withB'] })).toBe(
            'the handler is itself a call to an imported withA(…) or withB(…), as in `export const POST = withA(…)`',
        )
        expect(describeGate({ kind: 'calls', callees: ['a.b'] })).toBe(
            'the handler reaches a call to an imported a.b(…) on its own path',
        )
        expect(describeGate({ kind: 'opens-with-simulated-404' })).toMatch(
            /opens with `if \(!isSimulated\) return new Response\(null, \{ status: 404 \}\)` \(an imported `isSimulated`/,
        )
    })
})

describe('the walk', () => {
    it('finds every route file name Next serves, and nothing else', () => {
        const routes = scanTree({
            'a/route.ts': '',
            'b/route.tsx': '',
            'c/route.js': '',
            'd/route.jsx': '',
            'e/route.mjs': '',
            'f/route.test.ts': '',
            'g/page.ts': '',
            'h/route.cjs': '',
        })
        expect(routes.map((r) => r.rel)).toEqual([
            'a/route.ts',
            'b/route.tsx',
            'c/route.js',
            'd/route.jsx',
            'e/route.mjs',
        ])
    })

    it('measures rel from exemptDir, so a route outside it gets a ../ path', () => {
        const routes = scanTree({ 'api/x/route.ts': '', 'page/route.ts': '' }, (dir) => ({
            exemptDir: path.join(dir, 'api'),
        }))
        expect(routes.map((r) => r.rel)).toEqual(['x/route.ts', '../page/route.ts'])
    })
})
