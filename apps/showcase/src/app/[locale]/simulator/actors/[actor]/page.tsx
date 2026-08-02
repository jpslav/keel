import { setRequestLocale } from 'next-intl/server'
import { notFound } from 'next/navigation'
import { isSimulated } from 'keel/adapters/index'
import { isActorId } from '@app-config/actors'

/**
 * The actor frame's page — OUTSIDE (protected), so it renders signed-out (the actor drives the
 * simulator/service surfaces itself; there is no user session here). Mode gate FIRST line, then the
 * id gate, then a dynamic import of the client host so no actor client code exists outside fake
 * builds. Locale reaches the frame purely via the URL segment; ?paused=1 is read client-side in the
 * host after mount (see actor-host.tsx). Standalone output renders this dynamically — no static
 * params needed.
 */
export default async function ActorPage({ params }: { params: Promise<{ locale: string; actor: string }> }) {
    if (!isSimulated) notFound()
    const { locale, actor } = await params
    if (!isActorId(actor)) notFound()
    setRequestLocale(locale)
    const { ActorHost } = await import('./actor-host')
    return <ActorHost actor={actor} />
}
