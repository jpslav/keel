import { RuleTester } from 'eslint'
import { describe, it } from 'vitest'
import { keelNoDirectMkdtempRuleForTests } from '../../eslint.config.mjs'

/**
 * Pins what `keel/no-direct-mkdtemp` (eslint.config.mjs) does and does not match. The rule is a lint
 * gate, so a rule that quietly stops matching is invisible until a leak has already happened — these
 * cases are what makes the silence loud. RuleTester reports through vitest's own describe/it.
 */
RuleTester.describe = describe
RuleTester.it = it

const ruleTester = new RuleTester({ languageOptions: { ecmaVersion: 'latest', sourceType: 'module' } })

ruleTester.run('keel/no-direct-mkdtemp', keelNoDirectMkdtempRuleForTests, {
    valid: [
        { code: "const dir = makeTestTmpDir('app-x-')" },
        { code: "const dir = await makeTestTmpDirAsync('app-x-')" },
        // not the temp-dir factory
        { code: "fs.mkdirSync('x')" },
        { code: 'const mkdtempSync = 1' },
        // a computed key is not matched by name — documented as outside the rule's reach
        { code: "fs['mkdtempSync']('x')" },
    ],
    invalid: [
        {
            code: "const dir = mkdtempSync(path.join(tmpdir(), 'app-x-'))",
            errors: [{ messageId: 'direct', data: { name: 'mkdtempSync' } }],
        },
        {
            code: "async function f() { return await mkdtemp(path.join(tmpdir(), 'app-x-')) }",
            errors: [{ messageId: 'direct', data: { name: 'mkdtemp' } }],
        },
        {
            code: "const pg = new Thing({ databaseDir: mkdtempSync(path.join(tmpdir(), 'app-x-')) })",
            errors: [{ messageId: 'direct', data: { name: 'mkdtempSync' } }],
        },
        {
            code: "const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'app-x-'))",
            errors: [{ messageId: 'direct', data: { name: 'mkdtempSync' } }],
        },
        {
            code: "const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'app-x-'))",
            errors: [{ messageId: 'direct', data: { name: 'mkdtemp' } }],
        },
    ],
})
