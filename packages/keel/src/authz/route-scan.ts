import { readdirSync } from 'node:fs'
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
 * - in the handler's body, before any statement that always leaves the block (`return`, `throw`, `break`,
 *   `continue`, or an `if`/`try` whose every branch does);
 * - not in a branch a constant condition rules out: `if (false)`, `false && …`, `true ? … : here`,
 *   `'x' ?? …`, or a `const` bound to such a literal. Constants are literals, `!`, `void` and parentheses;
 *   nothing else is evaluated;
 * - in a function literal passed as an argument (`withPortErrors(async () => { … })`), which the call is
 *   ASSUMED to invoke. That is the wrapper idiom every route uses, and the one trust this module extends:
 *   it cannot read an imported wrapper to see whether it really calls its argument;
 * - in a function declared in the SAME module and called (or passed as an argument) from the handler's
 *   path, followed to any depth. A function that is only defined is not followed.
 *
 * What is NOT followed, and so does not count: a call into another module (an imported helper that calls
 * `authorize` inside it), a method on an object, a getter, a class body, and a parameter or destructuring
 * default (it runs only when the value is missing). Each of those fails the handler.
 *
 * WHAT COUNTS AS `authorize`: a call to the `authorize` imported from one of `ScanOptions.authorizeModules`
 * (keel's `keel/authz/authorize` by default), under any local name or through a namespace import. A local
 * function that happens to be named `authorize` is followed like any other, so it counts only if it calls
 * the real one.
 *
 * A handler the module cannot resolve at all (a destructured export, a `let`, an unresolvable re-export,
 * a file that does not parse) is REFUSED with the reason, and a refusal is a failure.
 */

/** The verbs that mutate. GET, HEAD and OPTIONS are never judged. */
const MUTATING_VERBS: readonly string[] = ['POST', 'PUT', 'PATCH', 'DELETE']

// Next.js routes route.ts/tsx/js/jsx/mjs. All of them, or the scan is bypassable by filename.
const ROUTE_FILE = /^route\.(?:mjs|[jt]sx?)$/

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
 * What an exemption's gate requires of ONE handler. Each kind is checked per verb:
 *
 * - `wrapped-by`: the handler IS a call to one of `callees` (`export const POST = withWebhookSecret(…)`).
 *   For a guard that wraps the handler, reaching it is not enough: the guard has to be what Next calls.
 * - `calls`: the handler reaches a call to one of `callees` (dotted names, `auth.updateProfile`).
 * - `opens-with-simulated-404`: the handler's FIRST statement is `if (!isSimulated) return/throw …`.
 */
export type Gate =
    | { kind: 'wrapped-by'; callees: readonly string[] }
    | { kind: 'calls'; callees: readonly string[] }
    | { kind: 'opens-with-simulated-404' }

/** What the analyser found on one handler's path. */
export interface HandlerFacts {
    /** A call to `authorize` imported from one of the scan's authorize modules is on the handler's path. */
    reachesAuthorize: boolean
    /** Dotted callee of the call the handler IS (`export const POST = withX(…)` → `withX`), or null. */
    wrappedBy: string | null
    /** Dotted callee of every call on the handler's path (`auth.updateProfile`, `withPortErrors`). */
    calls: ReadonlySet<string>
    /** The handler's first statement is `if (!isSimulated) <return|throw>`. */
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
            return `the handler is itself a call to ${names(gate.callees)}, as in \`export const POST = ${gate.callees[0]}(…)\``
        case 'calls':
            return `the handler reaches a call to ${names(gate.callees)} on its own path`
        case 'opens-with-simulated-404':
            return 'the handler opens with `if (!isSimulated) return …` (or `throw`)'
    }
}

/** Why `handler` fails the scan, or undefined if it passes. */
export function judge(route: ScannedRoute, handler: Handler, policy: ScanPolicy): string | undefined {
    const where = `${route.root}: ${route.rel} ${handler.verb}`
    if (handler.refusal !== undefined) {
        return `${where} cannot be checked: ${handler.refusal}. The scan fails a handler it cannot follow rather than pass it.`
    }
    const exemption = exemptionFor(policy, route.rel)
    if (exemption) {
        if (gateHolds(exemption.mustMatch, handler.facts)) return undefined
        return (
            `${where} sits under an exemption that holds only when ${describeGate(exemption.mustMatch)}, and this ` +
            `handler does not: the exemption's justification does not hold here. Add the gate to THIS handler, or call ` +
            `authorize(...). (A string, a comment, or the gate on another verb does not count.)`
        )
    }
    const required = requiredFor(policy, route.rel)
    if (required && !gateHolds(required.mustMatch, handler.facts)) {
        return `${where} must also satisfy: ${describeGate(required.mustMatch)}. ${required.reason}`
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
        } else if (assignsCommonJsExports(sf)) {
            result =
                'the file assigns `module.exports` or `exports`, which the scan does not read (route modules are ES modules)'
        } else result = { fileName, sf, checker: program.getTypeChecker() }
        this.sources.set(fileName, result)
        return result
    }

    private resolve(from: Source, specifier: string): Source | string {
        const resolved = ts.resolveModuleName(specifier, from.fileName, this.resolution, ts.sys).resolvedModule
        if (!resolved) return `'${specifier}' does not resolve from ${from.fileName}`
        if (/\.d\.[cm]?ts$/.test(resolved.resolvedFileName)) {
            return `'${specifier}' resolves to a declaration file (${resolved.resolvedFileName}), which has no handler body to read`
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

    private handlerOf(binding: Binding, seen: Set<ts.Node>): HandlerNode | Refusal {
        if (binding.kind === 'refused') return { reason: binding.reason }
        if (binding.kind === 'module') {
            const target = this.resolve(binding.src, binding.specifier)
            if (typeof target === 'string') return { reason: `the handler is re-exported from ${target}` }
            const next = this.exportNamed(target, binding.name, new Set())
            if (!next) return { reason: `'${binding.specifier}' has no export named \`${binding.name}\`` }
            return this.handlerOf(next, seen)
        }
        const { src, decl } = binding
        if (seen.has(decl)) return { reason: 'the handler is defined in terms of itself' }
        seen.add(decl)
        if (ts.isFunctionDeclaration(decl)) {
            return decl.body ? { src, fn: decl } : { reason: 'the handler is a declaration with no body' }
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
        return { reason: `the handler is a ${ts.SyntaxKind[decl.kind]}, not a function` }
    }

    private handlerFromExpression(src: Source, expression: ts.Expression, seen: Set<ts.Node>): HandlerNode | Refusal {
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
        reach.visit(node.call)
        return {
            reachesAuthorize: reach.authorize,
            wrappedBy: dottedName(node.call.expression) ?? null,
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
        // Parameter defaults are not visited: Next passes the request and context, so a default on a
        // handler never runs, and on a helper it runs only when the caller leaves the argument out.
        if (!fn.body) return
        if (ts.isBlock(fn.body)) this.statements(fn.body.statements)
        else this.visit(fn.body)
    }

    visit(node: ts.Node): void {
        // A function or class body runs only when called; a type never runs.
        if (ts.isFunctionLike(node) || ts.isClassLike(node) || ts.isTypeNode(node)) return
        if (ts.isCallExpression(node) || ts.isNewExpression(node)) return this.call(node)
        // The initializer runs; a default inside a destructuring pattern runs only when the value is missing.
        if (ts.isVariableDeclaration(node)) return node.initializer && this.visit(node.initializer)
        if (ts.isConditionalExpression(node)) {
            const condition = constantTruth(this.src, node.condition)
            if (condition === undefined) this.visit(node.condition)
            if (condition !== false) this.visit(node.whenTrue)
            if (condition !== true) this.visit(node.whenFalse)
            return
        }
        if (ts.isBinaryExpression(node) && isShortCircuit(node.operatorToken.kind)) {
            if (!rightIsDead(this.src, node)) {
                this.visit(node.left)
                this.visit(node.right)
            }
            return
        }
        ts.forEachChild(node, (child) => this.visit(child))
    }

    private call(node: ts.CallExpression | ts.NewExpression): void {
        const callee = unwrap(node.expression)
        const name = dottedName(callee)
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
        if (ts.isFunctionDeclaration(decl)) return decl.body ? decl : undefined
        if (ts.isVariableDeclaration(decl) && isConst(decl) && decl.initializer) {
            const init = unwrap(decl.initializer)
            if (isFunctionLiteral(init)) return init
        }
        return undefined
    }

    private isAuthorize(callee: ts.Expression): boolean {
        if (ts.isIdentifier(callee)) {
            const decl = declarationOf(this.src, callee)
            return (
                decl !== undefined &&
                ts.isImportSpecifier(decl) &&
                !decl.isTypeOnly &&
                exportNameText(decl.propertyName ?? decl.name) === 'authorize' &&
                this.authorizeModules.includes(importModuleOf(decl))
            )
        }
        if (
            ts.isPropertyAccessExpression(callee) &&
            callee.name.text === 'authorize' &&
            ts.isIdentifier(callee.expression)
        ) {
            const decl = declarationOf(this.src, callee.expression)
            return (
                decl !== undefined && ts.isNamespaceImport(decl) && this.authorizeModules.includes(importModuleOf(decl))
            )
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
            if (condition === undefined) this.visit(s.expression)
            if (condition !== false) this.statement(s.thenStatement)
            if (condition !== true && s.elseStatement) this.statement(s.elseStatement)
        } else if (ts.isBlock(s)) this.statements(s.statements)
        else if (ts.isTryStatement(s)) {
            this.statements(s.tryBlock.statements)
            if (s.catchClause) this.statements(s.catchClause.block.statements)
            if (s.finallyBlock) this.statements(s.finallyBlock.statements)
        } else if (ts.isWhileStatement(s)) {
            const condition = constantTruth(this.src, s.expression)
            if (condition === undefined) this.visit(s.expression)
            if (condition !== false) this.statement(s.statement)
        } else if (ts.isDoStatement(s)) {
            this.statement(s.statement)
            this.visit(s.expression)
        } else if (ts.isForStatement(s)) {
            if (s.initializer) this.visit(s.initializer)
            const condition = s.condition ? constantTruth(this.src, s.condition) : true
            if (s.condition && condition === undefined) this.visit(s.condition)
            if (condition !== false) {
                this.statement(s.statement)
                if (s.incrementor) this.visit(s.incrementor)
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
                        const decl = src.checker.getExportSpecifierLocalTargetSymbol(element)?.declarations?.[0]
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
        if (
            !hasModifier(statement, ts.SyntaxKind.ExportKeyword) ||
            hasModifier(statement, ts.SyntaxKind.DefaultKeyword)
        ) {
            continue
        }
        if (ts.isFunctionDeclaration(statement) && statement.name) {
            // An overload signature has no body; the implementation is the handler.
            if (statement.body || !named.has(statement.name.text)) {
                named.set(statement.name.text, { kind: 'decl', src, decl: statement })
            }
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
    if (ts.isImportSpecifier(decl)) {
        return {
            kind: 'module',
            src,
            specifier: importModuleOf(decl),
            name: exportNameText(decl.propertyName ?? decl.name),
        }
    }
    if (ts.isImportClause(decl)) return { kind: 'module', src, specifier: importModuleOf(decl), name: 'default' }
    if (ts.isNamespaceImport(decl)) return { kind: 'refused', reason: 'a namespace import is not a handler' }
    return { kind: 'decl', src, decl }
}

function boundNames(pattern: ts.BindingName): string[] {
    if (ts.isIdentifier(pattern)) return [pattern.text]
    return pattern.elements.flatMap((element) => (ts.isOmittedExpression(element) ? [] : boundNames(element.name)))
}

function exportNameText(name: ts.ModuleExportName): string {
    return name.text
}

function importModuleOf(decl: ts.ImportSpecifier | ts.ImportClause | ts.NamespaceImport): string {
    let node: ts.Node = decl
    while (!ts.isImportDeclaration(node)) node = node.parent
    return ts.isStringLiteral(node.moduleSpecifier) ? node.moduleSpecifier.text : ''
}

function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
    return ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some((m) => m.kind === kind)
}

function declarationOf(src: Source, id: ts.Identifier): ts.Declaration | undefined {
    return src.checker.getSymbolAtLocation(id)?.declarations?.[0]
}

function isConst(decl: ts.VariableDeclaration): boolean {
    return (ts.getCombinedNodeFlags(decl) & ts.NodeFlags.Const) !== 0
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
    if (ts.isIdentifier(e) && depth < 4) {
        const decl = declarationOf(src, e)
        if (!decl) return e.text === 'undefined' ? false : undefined
        if (ts.isVariableDeclaration(decl) && isConst(decl) && decl.initializer && ts.isIdentifier(decl.name)) {
            return constantTruth(src, decl.initializer, depth + 1)
        }
    }
    return undefined
}

/** Whether the value is a literal known not to be null or undefined (so `??` never reaches its right side). */
function constantlyNonNullish(src: Source, expression: ts.Expression): boolean {
    const e = unwrap(expression)
    if (e.kind === ts.SyntaxKind.NullKeyword || e.kind === ts.SyntaxKind.VoidExpression) return false
    if (ts.isIdentifier(e)) return false
    return constantTruth(src, e) !== undefined
}

function isShortCircuit(kind: ts.SyntaxKind): boolean {
    return (
        kind === ts.SyntaxKind.AmpersandAmpersandToken ||
        kind === ts.SyntaxKind.BarBarToken ||
        kind === ts.SyntaxKind.QuestionQuestionToken
    )
}

/** For `a && b`, `a || b` and `a ?? b`: whether a constant left side means `b` never runs (nor does `a` call anything). */
function rightIsDead(src: Source, node: ts.BinaryExpression): boolean {
    const kind = node.operatorToken.kind
    if (kind === ts.SyntaxKind.QuestionQuestionToken) return constantlyNonNullish(src, node.left)
    const left = constantTruth(src, node.left)
    if (left === undefined) return false
    return kind === ts.SyntaxKind.AmpersandAmpersandToken ? left === false : left === true
}

/** Whether control never falls through `s` to the statement after it. */
function alwaysExits(src: Source, s: ts.Statement): boolean {
    if (ts.isReturnStatement(s) || ts.isThrowStatement(s) || ts.isBreakStatement(s) || ts.isContinueStatement(s)) {
        return true
    }
    if (ts.isBlock(s)) return s.statements.some((inner) => alwaysExits(src, inner))
    if (ts.isIfStatement(s)) {
        const condition = constantTruth(src, s.expression)
        if (condition === true) return alwaysExits(src, s.thenStatement)
        if (condition === false) return s.elseStatement !== undefined && alwaysExits(src, s.elseStatement)
        return s.elseStatement !== undefined && alwaysExits(src, s.thenStatement) && alwaysExits(src, s.elseStatement)
    }
    if (ts.isTryStatement(s)) {
        if (s.finallyBlock && alwaysExits(src, s.finallyBlock)) return true
        return alwaysExits(src, s.tryBlock) && (!s.catchClause || alwaysExits(src, s.catchClause.block))
    }
    return false
}

/** The handler's first statement is `if (!isSimulated) <a statement that always exits>`. */
function opensWithSimulated404(src: Source, fn: ts.FunctionLikeDeclaration): boolean {
    if (!fn.body || !ts.isBlock(fn.body)) return false
    const [first] = fn.body.statements
    if (!first || !ts.isIfStatement(first)) return false
    const condition = unwrap(first.expression)
    return (
        ts.isPrefixUnaryExpression(condition) &&
        condition.operator === ts.SyntaxKind.ExclamationToken &&
        ts.isIdentifier(unwrap(condition.operand)) &&
        (unwrap(condition.operand) as ts.Identifier).text === 'isSimulated' &&
        alwaysExits(src, first.thenStatement)
    )
}

/** A top-level `module.exports = …`, `module.exports.X = …` or `exports.X = …`. */
function assignsCommonJsExports(sf: ts.SourceFile): boolean {
    return sf.statements.some((statement) => {
        if (!ts.isExpressionStatement(statement)) return false
        const e = statement.expression
        if (!ts.isBinaryExpression(e) || e.operatorToken.kind !== ts.SyntaxKind.EqualsToken) return false
        const target = dottedName(e.left)
        return (
            target !== undefined &&
            (target === 'module.exports' || target.startsWith('module.exports.') || target.startsWith('exports.'))
        )
    })
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
