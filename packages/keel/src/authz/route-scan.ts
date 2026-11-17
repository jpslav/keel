import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import ts from 'typescript'

/**
 * The analyser behind the authorization scan (`authorized-mutations.test.ts`), split out so the scan's
 * POLICY (which roots, which exemptions) is input rather than something this module knows. It reads route
 * files with the TypeScript compiler's parser and binder, never a regex over their text, and judges EACH
 * exported mutating handler on its own: a string, a comment, a call in another handler or a call in
 * statically dead code proves nothing about the handler in front of it.
 *
 * WHAT "REACHES" MEANS. A call counts for a handler when it sits on that handler's own path:
 *
 * - in the handler's body, before any statement control cannot get past: `return`, `throw`, `break`,
 *   `continue`; an `if`, `try`, `switch` or labeled block every way through which does; a `while (true)` or
 *   `for (;;)` nothing breaks out of; a `do` whose body never falls through;
 * - not in a branch a constant condition rules out: `if (false)`, `false && …`, `true ? … : here`,
 *   `'x' ?? …`, or a `const` bound to such a literal. Constants are literals, `!`, `void` and parentheses;
 *   nothing else is evaluated;
 * - in a function literal passed as an argument (`withPortErrors(async () => { … })`), which the call is
 *   ASSUMED to invoke. That is the wrapper idiom every route uses, and the one trust this module extends:
 *   it cannot read an imported wrapper to see whether it really calls its argument;
 * - in a function declared in the SAME module and called (or passed as an argument) from the handler's
 *   path, followed to any depth. A function that is only defined, or that the file reassigns, is not
 *   followed.
 *
 * For a handler that is a wrapper's result (`export const POST = withX(fn)`), the wrapper call itself and
 * its other arguments run once, when the module loads; only the functions handed to it run per request, so
 * only those are the handler's path.
 *
 * What is NOT followed, and so does not count: a call into another module (an imported helper that calls
 * `authorize` inside it), a method on an object, a getter, a class body, and a parameter or destructuring
 * default (it runs only when the value is missing). Each of those fails the handler.
 *
 * WHAT COUNTS AS `authorize`: a call to the `authorize` imported from one of `ScanOptions.authorizeModules`
 * (keel's `keel/authz/authorize` by default), under any local name or through a namespace import, by a
 * value import (not `import type`, not a JSDoc `@import`). A local function that happens to be named
 * `authorize` is followed like any other, so it counts only if it calls the real one.
 *
 * WHAT COUNTS AS A GATE'S NAME: the same rule, by binding. `withWebhookSecret`, `auth.updateProfile`,
 * `isSimulated` count only when the name (the head of a dotted one) is a value import, from any module; a
 * local look-alike (`const isSimulated = true`) is not the gate.
 *
 * A handler the module cannot resolve at all (a destructured export, a `let`, a reassigned function, an
 * unresolvable re-export, a file that does not parse, a module that is not an ES module) is REFUSED with
 * the reason, and a refusal is a failure.
 */

/** The verbs that mutate. GET, HEAD and OPTIONS are never judged. */
const MUTATING_VERBS: readonly string[] = ['POST', 'PUT', 'PATCH', 'DELETE']

// Next.js routes route.ts/tsx/js/jsx/mjs. All of them, or the scan is bypassable by filename.
const ROUTE_FILE = /^route\.(?:mjs|[jt]sx?)$/

/** The extensions one extensionless module specifier can land on, in TypeScript's resolution or the bundler's. */
const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs']

/**
 * Every file the module TypeScript resolved to could have been, by the bundler's rules: `impl` with any source
 * extension, `impl/index` with any, and `impl/package.json` (whose `main` the bundler may follow). For a resolved
 * `impl/index.ts`, the module is `impl`.
 */
function moduleCandidates(resolvedFile: string): string[] {
    const stem = resolvedFile.replace(/\.[cm]?[jt]sx?$/, '')
    const base = path.basename(stem) === 'index' ? path.dirname(stem) : stem
    return [
        ...SOURCE_EXTENSIONS.map((ext) => base + ext),
        ...SOURCE_EXTENSIONS.map((ext) => path.join(base, `index${ext}`)),
        path.join(base, 'package.json'),
    ].filter((file) => existsSync(file))
}

export interface ScanRoot {
    /** Human label: disambiguates identical route paths across roots. */
    label: string
    /** Where the walk starts. */
    dir: string
    /** Where exemption paths are measured from. A file outside it gets a `../` path no exemption can match. */
    exemptDir: string
    /**
     * The tsconfig whose module resolution (its `paths`, its `moduleResolution`) re-exports and imported
     * handlers are followed with. Without one, relative specifiers and packages resolve, aliases do not.
     */
    tsconfig?: string
}

/**
 * What an exemption's gate requires of ONE handler. Each kind is checked per verb, and every name in it
 * must be a value import in the route's module (see the header):
 *
 * - `wrapped-by`: the handler IS a call to one of `callees` (`export const POST = withWebhookSecret(…)`).
 *   For a guard that wraps the handler, reaching it is not enough: the guard has to be what Next calls.
 * - `calls`: the handler reaches a call to one of `callees` (dotted names, `auth.updateProfile`).
 * - `opens-with-simulated-404`: the handler's FIRST statement is `if (!isSimulated)` and its branch does
 *   nothing but return or throw a response built from literals (`return new Response(null, { status: 404 })`,
 *   `return Response.json(…)`, `throw new NotFoundError(…)`), and no parameter runs code before it (a default),
 *   so the real-mode path does nothing.
 */
export type Gate =
    | { kind: 'wrapped-by'; callees: readonly string[] }
    | { kind: 'calls'; callees: readonly string[] }
    | { kind: 'opens-with-simulated-404' }

/** What the analyser found on one handler's path. */
export interface HandlerFacts {
    /** A call to `authorize` imported from one of the scan's authorize modules is on the handler's path. */
    reachesAuthorize: boolean
    /** Dotted callee of the call the handler IS (`export const POST = withX(…)` → `withX`), if imported; else null. */
    wrappedBy: string | null
    /** Dotted callee of every call on the handler's path whose head is a value import (`auth.updateProfile`). */
    calls: ReadonlySet<string>
    /** The handler's first statement is the inert `if (!isSimulated)` gate, `isSimulated` imported. */
    opensWithSimulated404: boolean
}

/** One exported mutating handler: its facts, or why it could not be read (a refusal is a failure). */
export type Handler =
    { verb: string; facts: HandlerFacts; refusal?: never } | { verb: string; refusal: string; facts?: never }

export interface ScannedRoute {
    root: string
    /** Path relative to the root's `exemptDir`, `/`-separated. */
    rel: string
    file: string
    /** One entry per exported mutating verb. Empty for a route that mutates nothing. */
    handlers: Handler[]
}

export interface ScanOptions {
    /** Module specifiers whose `authorize` export is the choke point. Default: keel's. */
    authorizeModules?: readonly string[]
}

/** Every route file under every root, each with its exported mutating handlers analysed. */
export function scanRoutes(roots: readonly ScanRoot[], options: ScanOptions = {}): ScannedRoute[] {
    const authorizeModules = options.authorizeModules ?? ['keel/authz/authorize']
    return roots.flatMap((root) => {
        const scanner = new RootScanner(root, authorizeModules)
        return routeFiles(root.dir).map((file) => ({
            root: root.label,
            rel: path.relative(root.exemptDir, file).split(path.sep).join('/'),
            file,
            handlers: scanner.handlers(file),
        }))
    })
}

function routeFiles(dir: string): string[] {
    const out: string[] = []
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) out.push(...routeFiles(full))
        else if (ROUTE_FILE.test(entry.name)) out.push(full)
    }
    return out.sort()
}

// ---------------------------------------------------------------------------------------------------------
// Policy: exemptions and the gates they rest on.
// ---------------------------------------------------------------------------------------------------------

export interface Exemption {
    reason: string
    /** The gate the reason rests on. Checked on every exempted handler, per verb, in every root. */
    mustMatch: Gate
}

export interface ScanPolicy {
    /** Exemptions by path prefix, relative to a root's `exemptDir`. */
    exemptPrefixes: Readonly<Record<string, Exemption>>
    /** Exemptions by exact path. An exact entry wins over a prefix. */
    exemptFiles: Readonly<Record<string, Exemption>>
    /** Gates a non-exempt handler under a prefix must pass IN ADDITION to reaching `authorize`. */
    requiredAlongside: Readonly<Record<string, Exemption>>
    /** Appended to the "does not reach authorize" failure. */
    hint?: string
}

export function exemptionFor(policy: ScanPolicy, rel: string): Exemption | undefined {
    const exact = policy.exemptFiles[rel]
    if (exact) return exact
    const prefix = Object.keys(policy.exemptPrefixes).find((p) => rel.startsWith(p))
    return prefix === undefined ? undefined : policy.exemptPrefixes[prefix]
}

function requiredFor(policy: ScanPolicy, rel: string): Exemption | undefined {
    const prefix = Object.keys(policy.requiredAlongside).find((p) => rel.startsWith(p))
    return prefix === undefined ? undefined : policy.requiredAlongside[prefix]
}

export function gateHolds(gate: Gate, facts: HandlerFacts): boolean {
    switch (gate.kind) {
        case 'wrapped-by':
            return facts.wrappedBy !== null && gate.callees.includes(facts.wrappedBy)
        case 'calls':
            return gate.callees.some((callee) => facts.calls.has(callee))
        case 'opens-with-simulated-404':
            return facts.opensWithSimulated404
    }
}

export function describeGate(gate: Gate): string {
    const names = (callees: readonly string[]) => callees.map((c) => `${c}(…)`).join(' or ')
    switch (gate.kind) {
        case 'wrapped-by':
            return `the handler is itself a call to an imported ${names(gate.callees)}, as in \`export const POST = ${gate.callees[0]}(…)\``
        case 'calls':
            return `the handler reaches a call to an imported ${names(gate.callees)} on its own path`
        case 'opens-with-simulated-404':
            return (
                'the handler takes no parameter that runs code (a default) and opens with ' +
                '`if (!isSimulated) return new Response(null, { status: 404 })` (an imported ' +
                '`isSimulated`, and a branch that only returns or throws a response built from inert values)'
            )
    }
}

/** Why `handler` fails the scan, or undefined if it passes. */
export function judge(route: ScannedRoute, handler: Handler, policy: ScanPolicy): string | undefined {
    const where = `${route.root}: ${route.rel} ${handler.verb}`
    if (handler.refusal !== undefined) {
        return `${where} cannot be checked: ${handler.refusal}. The scan fails a handler it cannot follow rather than pass it.`
    }
    // An exemption is an alternative to authorize(...), never a ban on it: a handler under an exempted path that
    // does not pass the gate is judged like any other, so one that authorizes passes.
    const exemption = exemptionFor(policy, route.rel)
    if (exemption && gateHolds(exemption.mustMatch, handler.facts)) return undefined
    const required = requiredFor(policy, route.rel)
    if (required && !gateHolds(required.mustMatch, handler.facts)) {
        return `${where} must also satisfy: ${describeGate(required.mustMatch)}. ${required.reason}`
    }
    if (!handler.facts.reachesAuthorize && exemption) {
        return (
            `${where} sits under an exemption that holds only when ${describeGate(exemption.mustMatch)}, and this ` +
            `handler does not: the exemption's justification does not hold here. Add the gate to THIS handler, or call ` +
            `authorize(...). (A string, a comment, a look-alike, or the gate on another verb does not count.)`
        )
    }
    if (!handler.facts.reachesAuthorize) {
        return (
            `${where} exports a mutating handler that does not reach authorize(...) on its own path, and the route is ` +
            `not in the exemption map. A call in a string, a comment, another handler, a dead branch, an uncalled ` +
            `function or another module does not count. Call authorize(...) in this handler (or in a function in this ` +
            `file that it calls), or, only if it is genuinely not a per-actor product mutation, add a justified ` +
            `exemption.` +
            (policy.hint ? ` ${policy.hint}` : '')
        )
    }
    return undefined
}

// ---------------------------------------------------------------------------------------------------------
// Analysis.
// ---------------------------------------------------------------------------------------------------------

interface Source {
    fileName: string
    sf: ts.SourceFile
    checker: ts.TypeChecker
    /** Symbols the file assigns to (`POST = …`, `check = …`, `x++`): never trusted as a handler or helper. */
    reassigned: ReadonlySet<ts.Symbol>
}

/** What an exported name is bound to. */
type Binding =
    | { kind: 'decl'; src: Source; decl: ts.Declaration }
    | { kind: 'module'; src: Source; specifier: string; name: string }
    | { kind: 'refused'; reason: string }

/** A handler resolved to code: a function Next calls, or a call whose result Next calls. */
type HandlerNode = { src: Source; fn: ts.FunctionLikeDeclaration } | { src: Source; call: ts.CallExpression }

type Refusal = { reason: string }

// Parse and bind one file at a time: no lib, no import resolution. Every question asked of the checker is
// about a binding in the file itself; following an import is this module's job, done explicitly below.
const ANALYSIS_OPTIONS: ts.CompilerOptions = {
    noResolve: true,
    noLib: true,
    types: [],
    allowJs: true,
    jsx: ts.JsxEmit.Preserve,
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    noEmit: true,
}

const DEFAULT_RESOLUTION: ts.CompilerOptions = {
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    allowJs: true,
}

class RootScanner {
    private readonly sources = new Map<string, Source | string>()
    private readonly resolution: ts.CompilerOptions

    constructor(
        root: ScanRoot,
        private readonly authorizeModules: readonly string[],
    ) {
        this.resolution = root.tsconfig ? readCompilerOptions(root.tsconfig) : DEFAULT_RESOLUTION
    }

    handlers(file: string): Handler[] {
        const src = this.load(file)
        if (typeof src === 'string') return [{ verb: '*', refusal: src }]
        return this.mutatingExports(src, new Set()).map(([verb, binding]) => {
            const node = this.handlerOf(binding, new Set())
            return 'reason' in node ? { verb, refusal: node.reason } : { verb, facts: this.facts(node) }
        })
    }

    private load(fileName: string): Source | string {
        const cached = this.sources.get(fileName)
        if (cached !== undefined) return cached
        const program = ts.createProgram({ rootNames: [fileName], options: ANALYSIS_OPTIONS })
        const sf = program.getSourceFile(fileName)
        let result: Source | string
        if (!sf) result = 'the file could not be read'
        else if (program.getSyntacticDiagnostics(sf).length > 0) {
            const [first] = program.getSyntacticDiagnostics(sf)
            result = `the file does not parse (${ts.flattenDiagnosticMessageText(first?.messageText, ' ')})`
        } else {
            const checker = program.getTypeChecker()
            // `export =` makes TypeScript call the file a module, but it compiles to `module.exports =`, and Next
            // serves the handlers on it: it is CommonJS for this purpose.
            const exportEquals = sf.statements.some((s) => ts.isExportAssignment(s) && s.isExportEquals)
            if (!ts.isExternalModule(sf) || exportEquals || usesCommonJsExports(sf, checker)) {
                result =
                    'the file is not an ES module, or uses `export =`, `module.exports` or `exports`, which the scan ' +
                    'does not read (route modules are ES modules)'
            } else result = { fileName, sf, checker, reassigned: reassignedSymbols(sf, checker) }
        }
        this.sources.set(fileName, result)
        return result
    }

    private resolve(from: Source, specifier: string): Source | string {
        const resolved = ts.resolveModuleName(specifier, from.fileName, this.resolution, ts.sys).resolvedModule
        if (!resolved) return `'${specifier}' does not resolve from ${from.fileName}`
        if (/\.d\.[cm]?ts$/.test(resolved.resolvedFileName)) {
            return `'${specifier}' resolves to a declaration file (${resolved.resolvedFileName}), which has no handler body to read`
        }
        // TypeScript and Next's bundler do not pick the same file from every layout: TypeScript prefers `impl.ts`
        // where the bundler may load `impl.js` beside it, skips `impl.mjs` for an extensionless specifier and reads
        // `impl/index.ts` instead, and follows a package.json's `types` where the bundler follows `main`. With more
        // than one candidate for the one module, the scan cannot know which file is served, so it reads none.
        const candidates = moduleCandidates(resolved.resolvedFileName)
        if (candidates.length > 1) {
            const names = candidates.map((file) => path.relative(path.dirname(from.fileName), file)).join(', ')
            return `'${specifier}' could load any of ${names}, and the scan cannot tell which Next serves`
        }
        const loaded = this.load(resolved.resolvedFileName)
        return typeof loaded === 'string' ? `'${specifier}' (${resolved.resolvedFileName}): ${loaded}` : loaded
    }

    /** `[verb, binding]` for every mutating verb the module exports, through `export *` as well. */
    private mutatingExports(src: Source, seen: Set<string>): Array<[string, Binding]> {
        const { named, stars } = exportsOf(src)
        const out = [...named].filter(([name]) => MUTATING_VERBS.includes(name))
        if (seen.has(src.fileName)) return out
        seen.add(src.fileName)
        for (const specifier of stars) {
            const target = this.resolve(src, specifier)
            if (typeof target === 'string') {
                const reason = `\`export * from '${specifier}'\` cannot be followed (${target}), so which verbs it exports is unknown`
                out.push(['*', { kind: 'refused', reason }])
                continue
            }
            for (const [verb, binding] of this.mutatingExports(target, seen)) {
                if (!out.some(([known]) => known === verb)) out.push([verb, binding])
            }
        }
        return out
    }

    /** The binding a module exports under `name`, through `export *` as well. */
    private exportNamed(src: Source, name: string, seen: Set<string>): Binding | undefined {
        const { named, stars } = exportsOf(src)
        const direct = named.get(name)
        if (direct) return direct
        if (seen.has(src.fileName)) return undefined
        seen.add(src.fileName)
        for (const specifier of stars) {
            const target = this.resolve(src, specifier)
            if (typeof target === 'string') return { kind: 'refused', reason: target }
            const found = this.exportNamed(target, name, seen)
            if (found) return found
        }
        return undefined
    }

    private handlerOf(binding: Binding, seen: Set<unknown>): HandlerNode | Refusal {
        if (binding.kind === 'refused') return { reason: binding.reason }
        if (binding.kind === 'module') {
            const target = this.resolve(binding.src, binding.specifier)
            if (typeof target === 'string') return { reason: `the handler is re-exported from ${target}` }
            const key = `${target.fileName}\0${binding.name}`
            if (seen.has(key)) return { reason: `the re-export of \`${binding.name}\` leads back to itself` }
            seen.add(key)
            const next = this.exportNamed(target, binding.name, new Set())
            if (!next) return { reason: `'${binding.specifier}' has no export named \`${binding.name}\`` }
            return this.handlerOf(next, seen)
        }
        const { src, decl } = binding
        if (seen.has(decl)) return { reason: 'the handler is defined in terms of itself' }
        seen.add(decl)
        if (ts.isFunctionDeclaration(decl)) {
            if (!decl.body) return { reason: 'the handler is a declaration with no body' }
            if (isReassigned(src, decl)) {
                return {
                    reason: 'the handler is a function the file reassigns, so the declaration is not what Next calls',
                }
            }
            if (isRedeclared(decl)) {
                return {
                    reason:
                        'the handler is declared more than once in its scope, and the last declaration is the one that ' +
                        'runs; declare it once',
                }
            }
            return { src, fn: decl }
        }
        if (ts.isVariableDeclaration(decl)) {
            if (!isConst(decl)) {
                return {
                    reason:
                        'the handler is a `let` or `var`, which can be reassigned after the binding the scan reads; ' +
                        'declare it `const` or as a function',
                }
            }
            if (!decl.initializer) return { reason: 'the handler has no initializer' }
            return this.handlerFromExpression(src, decl.initializer, seen)
        }
        if (ts.isExportAssignment(decl) && !decl.isExportEquals)
            return this.handlerFromExpression(src, decl.expression, seen)
        return { reason: `the handler is a ${ts.SyntaxKind[decl.kind]}, not a function` }
    }

    private handlerFromExpression(src: Source, expression: ts.Expression, seen: Set<unknown>): HandlerNode | Refusal {
        const e = unwrap(expression)
        if (isFunctionLiteral(e)) return { src, fn: e }
        if (ts.isCallExpression(e)) return { src, call: e }
        if (ts.isIdentifier(e)) {
            const decl = declarationOf(src, e)
            if (!decl) return { reason: `\`${e.text}\` is not declared in this file` }
            return this.handlerOf(bindingOfDeclaration(src, decl), seen)
        }
        return {
            reason:
                `the handler is a ${ts.SyntaxKind[e.kind]}, which the scan cannot follow; export a function, ` +
                'or a call that wraps one',
        }
    }

    private facts(node: HandlerNode): HandlerFacts {
        const reach = new Reach(node.src, this.authorizeModules)
        if ('fn' in node) {
            reach.invoke(node.fn)
            return {
                reachesAuthorize: reach.authorize,
                wrappedBy: null,
                calls: reach.calls,
                opensWithSimulated404: opensWithSimulated404(node.src, node.fn),
            }
        }
        reach.wrapped(node.call)
        return {
            reachesAuthorize: reach.authorize,
            wrappedBy: gateName(node.src, node.call.expression) ?? null,
            calls: reach.calls,
            opensWithSimulated404: false,
        }
    }
}

/** Walks one handler's path, collecting the calls on it. One instance per handler, never shared. */
class Reach {
    readonly calls = new Set<string>()
    authorize = false
    private readonly invoked = new Set<ts.Node>()

    constructor(
        private readonly src: Source,
        private readonly authorizeModules: readonly string[],
    ) {}

    invoke(fn: ts.FunctionLikeDeclaration): void {
        if (this.invoked.has(fn)) return
        this.invoked.add(fn)
        // Calling a generator runs none of its body; it only makes an iterator.
        if (fn.asteriskToken) return
        // Parameter defaults are not visited: one runs only when its argument is missing, which for a handler
        // depends on what Next passes, and for a helper on the caller. Not counting them fails closed.
        if (!fn.body) return
        if (ts.isBlock(fn.body)) this.statements(fn.body.statements)
        else this.visit(fn.body)
    }

    /**
     * A handler that is a call's result. The call and its non-function arguments ran when the module loaded;
     * per request, only the functions handed to it run (a nested wrapper's, too: `withA(withB(fn))`).
     */
    wrapped(call: ts.CallExpression): void {
        for (const argument of call.arguments) {
            const a = unwrap(argument)
            if (isFunctionLiteral(a)) this.invoke(a)
            else if (ts.isCallExpression(a)) this.wrapped(a)
            else {
                const local = this.localFunction(a)
                if (local) this.invoke(local)
            }
        }
    }

    visit(node: ts.Node): void {
        // A function or class body runs only when called; a type never runs.
        if (ts.isFunctionLike(node) || ts.isClassLike(node) || ts.isTypeNode(node)) return
        if (ts.isCallExpression(node) || ts.isNewExpression(node)) return this.call(node)
        // The initializer runs; a default inside a destructuring pattern runs only when the value is missing.
        if (ts.isVariableDeclaration(node)) return node.initializer && this.visit(node.initializer)
        // A condition always runs; only the branch it rules out is dead.
        if (ts.isConditionalExpression(node)) {
            const condition = constantTruth(this.src, node.condition)
            this.visit(node.condition)
            if (condition !== false) this.visit(node.whenTrue)
            if (condition !== true) this.visit(node.whenFalse)
            return
        }
        if (ts.isBinaryExpression(node) && isShortCircuit(node.operatorToken.kind)) {
            this.visit(node.left)
            if (!rightIsDead(this.src, node)) this.visit(node.right)
            return
        }
        ts.forEachChild(node, (child) => this.visit(child))
    }

    private call(node: ts.CallExpression | ts.NewExpression): void {
        const callee = unwrap(node.expression)
        const name = gateName(this.src, callee)
        if (name) this.calls.add(name)
        if (this.isAuthorize(callee)) this.authorize = true
        this.callable(callee)
        for (const argument of node.arguments ?? []) this.callable(argument)
    }

    /** A callee or an argument: a function literal or a same-file function by name runs; anything else is visited. */
    private callable(expression: ts.Expression): void {
        const e = unwrap(expression)
        if (isFunctionLiteral(e)) return this.invoke(e)
        this.visit(e)
        const local = this.localFunction(e)
        if (local) this.invoke(local)
    }

    private localFunction(e: ts.Expression): ts.FunctionLikeDeclaration | undefined {
        if (!ts.isIdentifier(e)) return undefined
        const decl = declarationOf(this.src, e)
        if (!decl) return undefined
        if (ts.isFunctionDeclaration(decl)) {
            return decl.body && !isReassigned(this.src, decl) && !isRedeclared(decl) ? decl : undefined
        }
        if (ts.isVariableDeclaration(decl) && isConst(decl) && decl.initializer) {
            const init = unwrap(decl.initializer)
            if (isFunctionLiteral(init)) return init
        }
        return undefined
    }

    private isAuthorize(callee: ts.Expression): boolean {
        if (ts.isIdentifier(callee)) {
            const imported = valueImportOf(declarationOf(this.src, callee))
            return (
                imported?.kind === 'named' &&
                imported.name === 'authorize' &&
                this.authorizeModules.includes(imported.module)
            )
        }
        if (
            ts.isPropertyAccessExpression(callee) &&
            callee.name.text === 'authorize' &&
            ts.isIdentifier(callee.expression)
        ) {
            const imported = valueImportOf(declarationOf(this.src, callee.expression))
            return imported?.kind === 'namespace' && this.authorizeModules.includes(imported.module)
        }
        return false
    }

    private statements(list: readonly ts.Statement[]): void {
        for (const statement of list) {
            this.statement(statement)
            if (alwaysExits(this.src, statement)) return
        }
    }

    private statement(s: ts.Statement): void {
        if (ts.isExpressionStatement(s)) this.visit(s.expression)
        else if (ts.isVariableStatement(s)) this.visit(s.declarationList)
        else if (ts.isReturnStatement(s) || ts.isThrowStatement(s)) {
            if (s.expression) this.visit(s.expression)
        } else if (ts.isIfStatement(s)) {
            const condition = constantTruth(this.src, s.expression)
            this.visit(s.expression)
            if (condition !== false) this.statement(s.thenStatement)
            if (condition !== true && s.elseStatement) this.statement(s.elseStatement)
        } else if (ts.isBlock(s)) this.statements(s.statements)
        else if (ts.isTryStatement(s)) {
            this.statements(s.tryBlock.statements)
            if (s.catchClause) this.statements(s.catchClause.block.statements)
            if (s.finallyBlock) this.statements(s.finallyBlock.statements)
        } else if (ts.isWhileStatement(s)) {
            const condition = constantTruth(this.src, s.expression)
            this.visit(s.expression)
            if (condition !== false) this.statement(s.statement)
        } else if (ts.isDoStatement(s)) {
            this.statement(s.statement)
            // The condition runs only when the body falls through or continues; a body that always returns
            // never reaches it.
            if (reachesLoopEnd(this.src, s)) this.visit(s.expression)
        } else if (ts.isForStatement(s)) {
            if (s.initializer) this.visit(s.initializer)
            const condition = s.condition ? constantTruth(this.src, s.condition) : true
            if (s.condition) this.visit(s.condition)
            if (condition !== false) {
                this.statement(s.statement)
                if (s.incrementor && reachesLoopEnd(this.src, s)) this.visit(s.incrementor)
            }
        } else if (ts.isForOfStatement(s) || ts.isForInStatement(s)) {
            this.visit(s.expression)
            this.statement(s.statement)
        } else if (ts.isSwitchStatement(s)) {
            this.visit(s.expression)
            for (const clause of s.caseBlock.clauses) {
                if (ts.isCaseClause(clause)) this.visit(clause.expression)
                this.statements(clause.statements)
            }
        } else if (ts.isLabeledStatement(s)) this.statement(s.statement)
        // Anything else (a function or class declaration, an import, an enum) runs nothing on this path that
        // the scan credits: fail closed.
    }
}

// ---------------------------------------------------------------------------------------------------------
// Helpers over the syntax tree.
// ---------------------------------------------------------------------------------------------------------

function exportsOf(src: Source): { named: Map<string, Binding>; stars: string[] } {
    const named = new Map<string, Binding>()
    const stars: string[] = []
    for (const statement of src.sf.statements) {
        if (ts.isExportDeclaration(statement)) {
            if (statement.isTypeOnly) continue
            const specifier =
                statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)
                    ? statement.moduleSpecifier.text
                    : undefined
            const clause = statement.exportClause
            if (!clause) {
                if (specifier !== undefined) stars.push(specifier)
            } else if (ts.isNamespaceExport(clause)) {
                named.set(exportNameText(clause.name), {
                    kind: 'refused',
                    reason: 'a namespace re-export (`export * as …`) is not a handler',
                })
            } else {
                for (const element of clause.elements) {
                    if (element.isTypeOnly) continue
                    const exported = exportNameText(element.name)
                    if (specifier !== undefined) {
                        named.set(exported, {
                            kind: 'module',
                            src,
                            specifier,
                            name: exportNameText(element.propertyName ?? element.name),
                        })
                    } else {
                        const decl = preferBody(src.checker.getExportSpecifierLocalTargetSymbol(element)?.declarations)
                        named.set(
                            exported,
                            decl
                                ? bindingOfDeclaration(src, decl)
                                : { kind: 'refused', reason: `\`${exported}\` is not declared in this file` },
                        )
                    }
                }
            }
            continue
        }
        if (ts.isExportAssignment(statement)) {
            // `export default <expression>`. (`export =` is CommonJS: the file was refused when it loaded.)
            if (!statement.isExportEquals) named.set('default', { kind: 'decl', src, decl: statement })
            continue
        }
        if (!hasModifier(statement, ts.SyntaxKind.ExportKeyword)) continue
        const isDefault = hasModifier(statement, ts.SyntaxKind.DefaultKeyword)
        if (ts.isFunctionDeclaration(statement) && (statement.name || isDefault)) {
            const name = isDefault ? 'default' : statement.name!.text
            // An overload signature has no body; the implementation is the handler.
            if (statement.body || !named.has(name)) named.set(name, { kind: 'decl', src, decl: statement })
        } else if (isDefault) {
            if (ts.isClassDeclaration(statement)) named.set('default', { kind: 'decl', src, decl: statement })
        } else if (ts.isVariableStatement(statement)) {
            for (const decl of statement.declarationList.declarations) {
                if (ts.isIdentifier(decl.name)) named.set(decl.name.text, { kind: 'decl', src, decl })
                else {
                    for (const name of boundNames(decl.name)) {
                        named.set(name, {
                            kind: 'refused',
                            reason: `\`${name}\` is destructured out of another value, which the scan cannot follow`,
                        })
                    }
                }
            }
        } else if (ts.isImportEqualsDeclaration(statement)) {
            named.set(statement.name.text, { kind: 'refused', reason: '`export import … =` is not followed' })
        } else if (
            (ts.isClassDeclaration(statement) ||
                ts.isEnumDeclaration(statement) ||
                ts.isModuleDeclaration(statement)) &&
            statement.name &&
            ts.isIdentifier(statement.name)
        ) {
            named.set(statement.name.text, { kind: 'decl', src, decl: statement })
        }
    }
    return { named, stars }
}

function bindingOfDeclaration(src: Source, decl: ts.Declaration): Binding {
    if (ts.isImportSpecifier(decl) || ts.isImportClause(decl) || ts.isNamespaceImport(decl)) {
        const imported = valueImportOf(decl)
        if (!imported) return { kind: 'refused', reason: 'the handler is a type-only import' }
        if (imported.kind === 'namespace') return { kind: 'refused', reason: 'a namespace import is not a handler' }
        return { kind: 'module', src, specifier: imported.module, name: imported.name }
    }
    return { kind: 'decl', src, decl }
}

type ValueImport = { kind: 'named'; module: string; name: string } | { kind: 'namespace'; module: string }

/**
 * What a declaration imports, when it is a VALUE import of an `import` statement: not `import type`, not
 * `import { type x }`, not a JSDoc `@import` (whose parent chain is a comment's, not an import's).
 */
function valueImportOf(decl: ts.Declaration | undefined): ValueImport | undefined {
    if (!decl) return undefined
    let clause: ts.ImportClause
    if (ts.isImportSpecifier(decl)) {
        if (decl.isTypeOnly) return undefined
        clause = decl.parent.parent
    } else if (ts.isNamespaceImport(decl)) clause = decl.parent
    else if (ts.isImportClause(decl)) clause = decl
    else return undefined
    const statement = clause.parent
    if (clause.isTypeOnly || !ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) {
        return undefined
    }
    const from = statement.moduleSpecifier.text
    if (ts.isImportSpecifier(decl)) {
        return { kind: 'named', module: from, name: exportNameText(decl.propertyName ?? decl.name) }
    }
    if (ts.isNamespaceImport(decl)) return { kind: 'namespace', module: from }
    return { kind: 'named', module: from, name: 'default' }
}

/**
 * The dotted name a gate is matched against (`auth.updateProfile`), or undefined when the name's head is not a
 * value import that keeps the name it is exported under. A named import counts under its exported name only, so
 * `import { identity as withWebhookSecret }` is not the guard. A namespace import's head is dropped, so
 * `respond.withWebhookSecret` reads as `withWebhookSecret`. A default import has no exported name to check and
 * counts under its local one.
 *
 * WHICH module exports the name is not checked: an app may re-export keel's `isSimulated` from its own module, and
 * the wrappers are the app's. So a module that exports a fake under the real name passes. The scan catches a
 * route that lost its gate; it does not stand against one written to fool it (ADR-0012).
 */
function gateName(src: Source, callee: ts.Expression): string | undefined {
    const members: string[] = []
    let head = unwrap(callee)
    while (ts.isPropertyAccessExpression(head)) {
        if (!ts.isIdentifier(head.name)) return undefined
        members.unshift(head.name.text)
        head = unwrap(head.expression)
    }
    if (!ts.isIdentifier(head)) return undefined
    const imported = valueImportOf(declarationOf(src, head))
    if (!imported) return undefined
    if (imported.kind === 'namespace') return members.length > 0 ? members.join('.') : undefined
    if (imported.name !== 'default' && imported.name !== head.text) return undefined
    return [head.text, ...members].join('.')
}

function boundNames(pattern: ts.BindingName): string[] {
    if (ts.isIdentifier(pattern)) return [pattern.text]
    return pattern.elements.flatMap((element) => (ts.isOmittedExpression(element) ? [] : boundNames(element.name)))
}

function exportNameText(name: ts.ModuleExportName): string {
    return name.text
}

function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
    return ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some((m) => m.kind === kind)
}

/** An overloaded function has a declaration per signature; the one with a body is the function. */
function preferBody(declarations: readonly ts.Declaration[] | undefined): ts.Declaration | undefined {
    return declarations?.find((d) => ts.isFunctionDeclaration(d) && d.body !== undefined) ?? declarations?.[0]
}

function declarationOf(src: Source, id: ts.Identifier): ts.Declaration | undefined {
    return preferBody(src.checker.getSymbolAtLocation(id)?.declarations)
}

function isConst(decl: ts.VariableDeclaration): boolean {
    return (ts.getCombinedNodeFlags(decl) & ts.NodeFlags.Const) !== 0
}

/**
 * A function declared twice in one scope, or also declared as a `var` (`function check() {…} function check() {}`,
 * `var check = …`): TypeScript rejects both, but nothing typechecks a route.js, and at run time the LAST one is what
 * the name holds. An overload signature has no body and is not a second declaration.
 */
function isRedeclared(decl: ts.FunctionDeclaration): boolean {
    // Read from the syntax, not the binder: in a JS file the binder gives `function check` and `var check` separate
    // symbols, and an exported function its own export symbol, so neither shows as a second declaration there.
    const name = decl.name?.text
    if (name === undefined) return false
    let scope: ts.Node = decl.parent
    while (!ts.isSourceFile(scope) && !ts.isFunctionLike(scope)) scope = scope.parent
    let count = 0
    const walk = (node: ts.Node): void => {
        if (node !== scope && (ts.isFunctionLike(node) || ts.isClassLike(node))) {
            // A nested function's NAME belongs to this scope; nothing inside it does.
            if (ts.isFunctionDeclaration(node) && node.body !== undefined && node.name?.text === name) count++
            return
        }
        if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name) count++
        ts.forEachChild(node, walk)
    }
    walk(scope)
    return count > 1
}

function isReassigned(src: Source, decl: ts.FunctionDeclaration): boolean {
    const symbol = decl.name ? src.checker.getSymbolAtLocation(decl.name) : undefined
    return symbol !== undefined && src.reassigned.has(symbol)
}

/**
 * Every symbol the file writes to by name: an assignment or compound assignment, including each name in a
 * destructuring target (`[POST] = …`, `({ open: POST } = …)`), a `for (x of …)`/`for (x in …)` target, and `++`/`--`.
 */
function reassignedSymbols(sf: ts.SourceFile, checker: ts.TypeChecker): Set<ts.Symbol> {
    const out = new Set<ts.Symbol>()
    const mark = (target: ts.Expression): void => {
        const e = unwrap(target)
        if (ts.isIdentifier(e)) {
            const symbol = checker.getSymbolAtLocation(e)
            if (symbol) out.add(symbol)
        } else if (ts.isArrayLiteralExpression(e)) {
            for (const element of e.elements) mark(ts.isSpreadElement(element) ? element.expression : element)
        } else if (ts.isObjectLiteralExpression(e)) {
            for (const property of e.properties) {
                if (ts.isPropertyAssignment(property)) mark(property.initializer)
                else if (ts.isShorthandPropertyAssignment(property)) {
                    // The name's own symbol is the object property; the variable written is this one.
                    const symbol = checker.getShorthandAssignmentValueSymbol(property)
                    if (symbol) out.add(symbol)
                } else if (ts.isSpreadAssignment(property)) mark(property.expression)
            }
        }
        // A default inside a target (`[POST = x] = …`) is an assignment expression itself; the walk marks it.
    }
    const walk = (node: ts.Node): void => {
        if (
            ts.isBinaryExpression(node) &&
            node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
            node.operatorToken.kind <= ts.SyntaxKind.LastAssignment
        ) {
            mark(node.left)
        } else if (
            (ts.isForOfStatement(node) || ts.isForInStatement(node)) &&
            !ts.isVariableDeclarationList(node.initializer)
        ) {
            mark(node.initializer)
        } else if (
            (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
            (node.operator === ts.SyntaxKind.PlusPlusToken || node.operator === ts.SyntaxKind.MinusMinusToken)
        ) {
            mark(node.operand)
        }
        ts.forEachChild(node, walk)
    }
    walk(sf)
    return out
}

function isFunctionLiteral(node: ts.Node): node is ts.ArrowFunction | ts.FunctionExpression {
    return ts.isArrowFunction(node) || ts.isFunctionExpression(node)
}

/** Strips parentheses and type-only wrappers (`as`, `satisfies`, `!`, `<T>x`). */
function unwrap(e: ts.Expression): ts.Expression {
    while (
        ts.isParenthesizedExpression(e) ||
        ts.isAsExpression(e) ||
        ts.isSatisfiesExpression(e) ||
        ts.isNonNullExpression(e) ||
        ts.isTypeAssertionExpression(e)
    ) {
        e = e.expression
    }
    return e
}

/** `auth.updateProfile` for that callee; undefined for anything that is not a plain dotted name. */
function dottedName(e: ts.Expression): string | undefined {
    const node = unwrap(e)
    if (ts.isIdentifier(node)) return node.text
    if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.name)) {
        const head = dottedName(node.expression)
        return head === undefined ? undefined : `${head}.${node.name.text}`
    }
    return undefined
}

/** The `const` initializer an identifier is bound to, followed a few names deep; undefined if it is not one. */
function constInitializer(src: Source, e: ts.Expression, depth: number): ts.Expression | undefined {
    if (!ts.isIdentifier(e) || depth >= 4) return undefined
    const decl = declarationOf(src, e)
    if (decl && ts.isVariableDeclaration(decl) && isConst(decl) && decl.initializer && ts.isIdentifier(decl.name)) {
        return decl.initializer
    }
    return undefined
}

/**
 * The truthiness of a condition the scan can decide without running anything, or undefined. Literals,
 * `!`, `void`, and a `const` bound to one of those (to a depth of a few names); nothing else.
 */
function constantTruth(src: Source, expression: ts.Expression, depth = 0): boolean | undefined {
    const e = unwrap(expression)
    switch (e.kind) {
        case ts.SyntaxKind.TrueKeyword:
            return true
        case ts.SyntaxKind.FalseKeyword:
        case ts.SyntaxKind.NullKeyword:
            return false
        case ts.SyntaxKind.VoidExpression:
            return false
    }
    if (ts.isNumericLiteral(e)) return Number(e.text) !== 0
    if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return e.text !== ''
    if (ts.isPrefixUnaryExpression(e) && e.operator === ts.SyntaxKind.ExclamationToken) {
        const inner = constantTruth(src, e.operand, depth)
        return inner === undefined ? undefined : !inner
    }
    if (ts.isIdentifier(e)) {
        if (e.text === 'undefined' && !declarationOf(src, e)) return false
        const init = constInitializer(src, e, depth)
        return init === undefined ? undefined : constantTruth(src, init, depth + 1)
    }
    return undefined
}

/** Whether the value is a constant known not to be null or undefined (so `??` never reaches its right side). */
function constantlyNonNullish(src: Source, expression: ts.Expression, depth = 0): boolean {
    const e = unwrap(expression)
    if (e.kind === ts.SyntaxKind.NullKeyword || e.kind === ts.SyntaxKind.VoidExpression) return false
    if (ts.isIdentifier(e)) {
        const init = constInitializer(src, e, depth)
        return init !== undefined && constantlyNonNullish(src, init, depth + 1)
    }
    return constantTruth(src, e) !== undefined
}

function isShortCircuit(kind: ts.SyntaxKind): boolean {
    return (
        kind === ts.SyntaxKind.AmpersandAmpersandToken ||
        kind === ts.SyntaxKind.BarBarToken ||
        kind === ts.SyntaxKind.QuestionQuestionToken
    )
}

/** For `a && b`, `a || b` and `a ?? b`: whether a constant left side means `b` never runs. */
function rightIsDead(src: Source, node: ts.BinaryExpression): boolean {
    const kind = node.operatorToken.kind
    if (kind === ts.SyntaxKind.QuestionQuestionToken) return constantlyNonNullish(src, node.left)
    const left = constantTruth(src, node.left)
    if (left === undefined) return false
    return kind === ts.SyntaxKind.AmpersandAmpersandToken ? left === false : left === true
}

/**
 * Whether control never falls through `s` to the statement after it. `labels` are the labels `s` carries
 * (`a: b: { … }` carries both), so a `break` naming any of them counts as falling through.
 */
function alwaysExits(src: Source, s: ts.Statement, labels: readonly string[] = []): boolean {
    if (ts.isReturnStatement(s) || ts.isThrowStatement(s) || ts.isBreakStatement(s) || ts.isContinueStatement(s)) {
        return true
    }
    // A labeled block, `if` or `try` falls through after all when a `break` names its label.
    const named = (exits: boolean) => exits && (labels.length === 0 || !breaksOut(s, labels, false, false))
    if (ts.isBlock(s)) return named(s.statements.some((inner) => alwaysExits(src, inner)))
    if (ts.isIfStatement(s)) {
        const condition = constantTruth(src, s.expression)
        if (condition === true) return named(alwaysExits(src, s.thenStatement))
        if (condition === false) return named(s.elseStatement !== undefined && alwaysExits(src, s.elseStatement))
        return named(
            s.elseStatement !== undefined && alwaysExits(src, s.thenStatement) && alwaysExits(src, s.elseStatement),
        )
    }
    if (ts.isTryStatement(s)) {
        if (s.finallyBlock && alwaysExits(src, s.finallyBlock)) return named(true)
        return named(alwaysExits(src, s.tryBlock) && (!s.catchClause || alwaysExits(src, s.catchClause.block)))
    }
    if (ts.isLabeledStatement(s)) return alwaysExits(src, s.statement, [...labels, s.label.text])
    // A loop that only a `break` can leave: `while (true)`, `for (;;)`, `for (; true;)`.
    if (ts.isWhileStatement(s) || ts.isForStatement(s)) {
        const condition = ts.isWhileStatement(s) ? s.expression : s.condition
        const forever = condition === undefined || constantTruth(src, condition) === true
        return forever && !breaksOut(s.statement, labels, true, false)
    }
    if (ts.isDoStatement(s)) {
        if (alwaysExits(src, s.statement) && !breaksOut(s.statement, labels, true, true)) return true
        return constantTruth(src, s.expression) === true && !breaksOut(s.statement, labels, true, false)
    }
    // A switch with a default that nothing breaks out of: control leaves only through the last clause's end.
    if (ts.isSwitchStatement(s)) {
        const clauses = s.caseBlock.clauses
        const last = clauses[clauses.length - 1]
        return (
            clauses.some(ts.isDefaultClause) &&
            last !== undefined &&
            last.statements.some((inner) => alwaysExits(src, inner)) &&
            !breaksOut(s.caseBlock, labels, true, false)
        )
    }
    return false
}

/** The labels a statement carries: those of the labeled statements directly around it. */
function labelsOf(s: ts.Statement): string[] {
    const labels: string[] = []
    for (let parent = s.parent; ts.isLabeledStatement(parent); parent = parent.parent) labels.push(parent.label.text)
    return labels
}

/**
 * Whether a `do` or `for` loop's body can reach the end of an iteration, where the `do` condition or the `for`
 * incrementor runs: it falls through, or a `continue` aims at this loop. A body that always returns never does.
 */
function reachesLoopEnd(src: Source, loop: ts.DoStatement | ts.ForStatement): boolean {
    return !alwaysExits(src, loop.statement) || breaksOut(loop.statement, labelsOf(loop), false, true)
}

/**
 * Whether `body` holds a jump that lands just after the statement it belongs to: a `break` naming one of
 * `labels`; with `unlabeled`, a bare `break` not inside a nested loop or switch; with `continues`, a bare
 * `continue` not inside a nested loop, or one naming one of `labels` (a loop's continue goes to its end, then on).
 */
function breaksOut(body: ts.Node, labels: readonly string[], unlabeled: boolean, continues: boolean): boolean {
    let found = false
    const walk = (node: ts.Node, loops: number, switches: number): void => {
        if (found || ts.isFunctionLike(node) || ts.isClassLike(node)) return
        if (ts.isBreakStatement(node)) {
            if (node.label ? labels.includes(node.label.text) : unlabeled && loops + switches === 0) found = true
            return
        }
        if (ts.isContinueStatement(node)) {
            if (continues && (node.label ? labels.includes(node.label.text) : loops === 0)) found = true
            return
        }
        const loop = ts.isIterationStatement(node, false) ? 1 : 0
        const swtch = ts.isSwitchStatement(node) ? 1 : 0
        ts.forEachChild(node, (child) => walk(child, loops + loop, switches + swtch))
    }
    walk(body, 0, 0)
    return found
}

/**
 * The handler's first statement is `if (!isSimulated) <branch>` with `isSimulated` imported under that name, the
 * branch does nothing but return or throw a response built from literals, and nothing runs before it (no
 * parameter default or destructuring), so in real mode the handler does nothing at all.
 */
function opensWithSimulated404(src: Source, fn: ts.FunctionLikeDeclaration): boolean {
    if (!fn.body || !ts.isBlock(fn.body)) return false
    if (!fn.parameters.every(runsNothing)) return false
    const [first] = fn.body.statements
    if (!first || !ts.isIfStatement(first)) return false
    const condition = unwrap(first.expression)
    if (!ts.isPrefixUnaryExpression(condition) || condition.operator !== ts.SyntaxKind.ExclamationToken) return false
    if (gateName(src, condition.operand) !== 'isSimulated') return false
    return isInertExit(src, first.thenStatement)
}

/**
 * A parameter that runs no code when the handler is called: no default anywhere in it, and no computed key in a
 * destructuring pattern. Next's own `(request, { params })` is fine; `{ params = wipe() }` is not.
 */
function runsNothing(p: ts.ParameterDeclaration | ts.BindingElement): boolean {
    if (p.initializer !== undefined) return false
    if (ts.isBindingElement(p) && p.propertyName !== undefined && ts.isComputedPropertyName(p.propertyName))
        return false
    if (ts.isIdentifier(p.name)) return true
    return p.name.elements.every((element) => ts.isOmittedExpression(element) || runsNothing(element))
}

const RESPONSE_CONSTRUCTORS = ['Response', 'NextResponse']
/** A global constructor that may be thrown from the gate: an `Error`, which does nothing when built. */
const GLOBAL_ERROR = /^(?:[A-Z][A-Za-z]*)?Error$/
const RESPONSE_FACTORIES = ['Response.json', 'Response.redirect', 'NextResponse.json', 'NextResponse.redirect']

/** `return <response>` or `throw new X(…)`, alone or alone in a block, built from literals only. */
function isInertExit(src: Source, s: ts.Statement): boolean {
    if (ts.isBlock(s)) return s.statements.length === 1 && isInertExit(src, s.statements[0]!)
    if (ts.isReturnStatement(s)) {
        const e = s.expression && unwrap(s.expression)
        if (!e || !(ts.isNewExpression(e) || ts.isCallExpression(e))) return false
        const name = globalOrGateName(src, e.expression)
        const allowed = ts.isNewExpression(e) ? RESPONSE_CONSTRUCTORS : RESPONSE_FACTORIES
        return name !== undefined && allowed.includes(name) && (e.arguments ?? []).every((a) => isLiteralValue(src, a))
    }
    if (ts.isThrowStatement(s)) {
        // An imported constructor falls under the gate-name trust (gateName); a global must be an Error, since
        // other globals (a WebSocket) do I/O when built.
        const e = unwrap(s.expression)
        if (!ts.isNewExpression(e)) return false
        const name = globalOrGateName(src, e.expression)
        const global = isGlobal(src, e.expression)
        return (
            name !== undefined &&
            (!global || GLOBAL_ERROR.test(name)) &&
            (e.arguments ?? []).every((a) => isLiteralValue(src, a))
        )
    }
    return false
}

/** The callee's head is declared nowhere in the file. */
function isGlobal(src: Source, callee: ts.Expression): boolean {
    let head = unwrap(callee)
    while (ts.isPropertyAccessExpression(head)) head = unwrap(head.expression)
    return ts.isIdentifier(head) && declarationOf(src, head) === undefined
}

/** A callee's dotted name when its head is a global (declared nowhere in the file), or its gate name if imported. */
function globalOrGateName(src: Source, callee: ts.Expression): string | undefined {
    let head = unwrap(callee)
    while (ts.isPropertyAccessExpression(head)) head = unwrap(head.expression)
    if (!ts.isIdentifier(head)) return undefined
    return declarationOf(src, head) === undefined ? dottedName(callee) : gateName(src, callee)
}

/**
 * A value whose construction runs no code: a literal, `undefined`, a signed number, an array or object literal
 * of those (plain properties only, no spread, computed key, method or accessor), or `JSON.stringify` of one. An
 * identifier or a property read is not one: it can be an object whose `toJSON` or getter runs on use.
 */
function isLiteralValue(src: Source, expression: ts.Expression): boolean {
    const e = unwrap(expression)
    switch (e.kind) {
        case ts.SyntaxKind.StringLiteral:
        case ts.SyntaxKind.NumericLiteral:
        case ts.SyntaxKind.BigIntLiteral:
        case ts.SyntaxKind.NoSubstitutionTemplateLiteral:
        case ts.SyntaxKind.TrueKeyword:
        case ts.SyntaxKind.FalseKeyword:
        case ts.SyntaxKind.NullKeyword:
            return true
    }
    if (ts.isIdentifier(e)) return e.text === 'undefined' && declarationOf(src, e) === undefined
    if (ts.isPrefixUnaryExpression(e)) {
        return (
            (e.operator === ts.SyntaxKind.MinusToken || e.operator === ts.SyntaxKind.PlusToken) &&
            ts.isNumericLiteral(unwrap(e.operand))
        )
    }
    if (ts.isArrayLiteralExpression(e)) {
        return e.elements.every((element) => ts.isOmittedExpression(element) || isLiteralValue(src, element))
    }
    if (ts.isObjectLiteralExpression(e)) {
        return e.properties.every(
            (p) =>
                ts.isPropertyAssignment(p) && !ts.isComputedPropertyName(p.name) && isLiteralValue(src, p.initializer),
        )
    }
    if (ts.isCallExpression(e)) {
        return (
            globalOrGateName(src, e.expression) === 'JSON.stringify' &&
            e.arguments.every((argument) => isLiteralValue(src, argument))
        )
    }
    return false
}

/** The file reads `module.exports`, `module['exports']` or a free `exports`: CommonJS, whatever else it has. */
function usesCommonJsExports(sf: ts.SourceFile, checker: ts.TypeChecker): boolean {
    let found = false
    const free = (node: ts.Node, name: string) =>
        ts.isIdentifier(node) && node.text === name && !checker.getSymbolAtLocation(node)?.declarations?.length
    const walk = (node: ts.Node): void => {
        if (found) return
        if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
            const member = ts.isPropertyAccessExpression(node)
                ? node.name.text
                : ts.isStringLiteralLike(node.argumentExpression)
                  ? node.argumentExpression.text
                  : undefined
            if ((free(node.expression, 'module') && member === 'exports') || free(node.expression, 'exports')) {
                found = true
                return
            }
        }
        if (ts.isCallExpression(node) && node.arguments.some((a) => free(a, 'exports'))) {
            found = true
            return
        }
        ts.forEachChild(node, walk)
    }
    walk(sf)
    return found
}

function readCompilerOptions(tsconfig: string): ts.CompilerOptions {
    const parsed = ts.getParsedCommandLineOfConfigFile(
        tsconfig,
        {},
        {
            ...ts.sys,
            // Only the options are wanted; listing the project's files would walk the whole app for nothing.
            readDirectory: () => [],
            onUnRecoverableConfigFileDiagnostic: (diagnostic) => {
                throw new Error(`${tsconfig}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ')}`)
            },
        },
    )
    if (!parsed) throw new Error(`${tsconfig}: could not be read`)
    return parsed.options
}
