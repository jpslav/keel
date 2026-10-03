/**
 * The Standard Schema v1 interface, VENDORED (types only) from `@standard-schema/spec`
 * (https://github.com/standard-schema/standard-schema, MIT licence). Valibot, Zod and ArkType all
 * implement it, so a framework contract typed against THIS rather than against one library lets an app
 * write its schemas in whichever library it already uses. keel's own preset-operation schemas happen to
 * be Valibot (./presets.ts); nothing in this file knows that.
 *
 * Copied rather than depended on: it is one interface with no runtime, and its authors publish it to be
 * copied. The spec groups these under a `StandardSchemaV1` namespace; here they are flattened into
 * top-level names, because typescript-eslint's recommended `no-namespace` rule (which this repo runs)
 * refuses namespaces. Structural typing compares shapes, not names, so a Valibot or Zod schema still
 * satisfies `StandardSchemaV1` unchanged.
 */

/** A schema any Standard Schema library produced: everything lives under the `~standard` key. */
export interface StandardSchemaV1<Input = unknown, Output = Input> {
    readonly '~standard': StandardSchemaV1Props<Input, Output>
}

export interface StandardSchemaV1Props<Input = unknown, Output = Input> {
    /** The version of the standard. */
    readonly version: 1
    /** The library that produced the schema. */
    readonly vendor: string
    /** Validates an unknown value. MAY return a Promise; a caller that must be synchronous treats one as a
     *  failure of its own (see presetProblems). */
    readonly validate: (value: unknown) => StandardSchemaV1Result<Output> | Promise<StandardSchemaV1Result<Output>>
    /** Inferred types, carried for type-level inference only. */
    readonly types?: StandardSchemaV1Types<Input, Output> | undefined
}

export type StandardSchemaV1Result<Output> = StandardSchemaV1SuccessResult<Output> | StandardSchemaV1FailureResult

export interface StandardSchemaV1SuccessResult<Output> {
    readonly value: Output
    readonly issues?: undefined
}

export interface StandardSchemaV1FailureResult {
    readonly issues: ReadonlyArray<StandardSchemaV1Issue>
}

export interface StandardSchemaV1Issue {
    readonly message: string
    /** Where in the value the issue is: keys, or segments carrying a key. Absent for the value itself. */
    readonly path?: ReadonlyArray<PropertyKey | StandardSchemaV1PathSegment> | undefined
}

export interface StandardSchemaV1PathSegment {
    readonly key: PropertyKey
}

export interface StandardSchemaV1Types<Input = unknown, Output = Input> {
    readonly input: Input
    readonly output: Output
}
