import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The fail-closed guard in `adapters/index.ts` is the one thing standing between a production build
 * and silently serving fake auth. It now has TWO explicit ways past it — `DEMO_MODE=1` for demo
 * builds, `E2E_BUILD=1` for production-build e2e — and every added bypass is a new way for the guard
 * to be defeated by accident. These tests exist so that adding a third has to be a deliberate act
 * that updates this file.
 *
 * Deliberately source-level rather than behavioural: `adapters/index.ts` evaluates the guard at module
 * load and dynamically imports the real adapters, so importing it under a fake NODE_ENV would pull in
 * the AWS/Clerk SDKs. The guard is a static expression; reading it is the honest way to assert it.
 */
const adaptersIndex = readFileSync(path.join(__dirname, 'index.ts'), 'utf8')

describe('the production fail-closed guard', () => {
    it('still requires simulated mode AND production AND the absence of every opt-in', () => {
        // If this fails, the guard's shape changed — re-derive whether it still fails CLOSED before
        // updating the expectation.
        expect(adaptersIndex).toContain(
            "if (isSimulated && process.env.NODE_ENV === 'production' && !isDemoMode && !isE2eBuild) {",
        )
    })

    it('names exactly the opt-ins this test knows about', () => {
        // The guard's negated conditions, in source order. A new bypass lands here or the test fails.
        const negated = [...adaptersIndex.matchAll(/&& !(is[A-Za-z0-9]+)/g)].map((m) => m[1])
        expect(negated).toEqual(['isDemoMode', 'isE2eBuild'])
    })

    it('does not offer the bypasses as remedies in its error message', () => {
        // The message is read by someone whose production deploy just refused to boot. Listing the
        // bypasses there hands them two ways to make the error stop that also make the app serve
        // passwordless sign-in. It must point at APP_MODE=real and warn AGAINST the other two.
        const message = adaptersIndex.slice(adaptersIndex.indexOf('throw new Error('))
        expect(message).toContain('A deployment must set APP_MODE=real')
        expect(message).toMatch(/do not set DEMO_MODE\s*'?\s*\+?\s*'?\s*or E2E_BUILD to silence it/)
        expect(message).not.toMatch(/set .{0,4}DEMO_MODE=1/)
        expect(message).not.toMatch(/or E2E_BUILD=1 \(/)
    })

    it('warns loudly at boot whenever a bypass is actually in effect', () => {
        // Getting past the guard on fakes is legitimate for a demo build and catastrophic anywhere
        // else, and the process cannot tell which it is — so it must not start quietly.
        expect(adaptersIndex).toContain("if (isSimulated && process.env.NODE_ENV === 'production') {")
        expect(adaptersIndex).toContain('FAKE ADAPTERS IN A PRODUCTION BUILD — bypass active:')
        expect(adaptersIndex).toContain('console.warn(')
    })

    it('reads each opt-in from its own explicit env var, never from a default', () => {
        expect(adaptersIndex).toContain("export const isDemoMode = process.env.DEMO_MODE === '1'")
        // Not exported: unlike isDemoMode (which the layout reads to render the badge), nothing
        // outside this module needs to know, and knip fails an export with no consumer.
        expect(adaptersIndex).toContain("const isE2eBuild = process.env.E2E_BUILD === '1'")
    })
})

describe('deployed environments', () => {
    const stack = readFileSync(path.join(__dirname, '../../../../infra/stack.ts'), 'utf8')

    it('never set an opt-in that would let fake adapters serve a real deployment', () => {
        // The whole point of the guard. A deploy that set either flag would boot happily on fakes —
        // real users, fake auth, no error. Nothing in the CDK stack may mention them.
        expect(stack).not.toMatch(/DEMO_MODE/)
        expect(stack).not.toMatch(/E2E_BUILD/)
    })

    it('still pins APP_MODE=real, which is what makes the guard irrelevant in production', () => {
        expect(stack).toContain("APP_MODE: 'real'")
    })
})
