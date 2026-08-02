import { isSimulated, storage } from 'keel/adapters/index'

/** Serves fake-adapter storage objects locally (real mode uses S3 signed URLs instead). */
export async function GET(_request: Request, context: { params: Promise<{ key: string[] }> }): Promise<Response> {
    if (!isSimulated) return Response.json({ error: 'not found' }, { status: 404 })
    const { key } = await context.params
    const object = await storage.get(key.join('/'))
    if (!object) return Response.json({ error: 'not found' }, { status: 404 })
    // nosniff + attachment: stored content must never execute on the app origin, even once an
    // upload path exists.
    return new Response(object.body as unknown as BodyInit, {
        headers: {
            'content-type': object.contentType,
            'x-content-type-options': 'nosniff',
            'content-disposition': 'attachment',
        },
    })
}
