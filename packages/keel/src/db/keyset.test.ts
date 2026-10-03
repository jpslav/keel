import { describe, expectTypeOf, it } from 'vitest'
import { keysetPage, type KeysetOrderColumn } from './keyset'

// Compile-time only: `tsc` (the root program covers this file) is the assertion, and nothing here
// touches a database. The SQL behaviour of `orderBy` is proven where a real engine is — the app half
// of the composed RLS suite (keel/test-fixture/app-config/db/rls-proofs.ts), on pglite and Postgres.
describe('KeysetOrderColumn', () => {
    it('admits a table’s NOT NULL columns, and only those', () => {
        type DocketOrder = KeysetOrderColumn<'dockets'>
        expectTypeOf<'created_at'>().toExtend<DocketOrder>()
        expectTypeOf<'last_touched_at'>().toExtend<DocketOrder>()
        // `due_on` is nullable: a NULL key makes the row-value comparison never true, so it is refused.
        expectTypeOf<'due_on'>().not.toExtend<DocketOrder>()
        // Not a column of this table (it belongs to `jobs`).
        expectTypeOf<'result_key'>().not.toExtend<DocketOrder>()
        expectTypeOf<'no_such_column'>().not.toExtend<DocketOrder>()
    })

    it('is the type of keysetPage’s trailing, optional parameter', () => {
        expectTypeOf(keysetPage<'dockets', { id: string }>)
            .parameter(3)
            .toEqualTypeOf<KeysetOrderColumn<'dockets'> | undefined>()
    })
})
