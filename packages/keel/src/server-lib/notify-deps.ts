import { db, email, isSimulated } from '../adapters/index'
import type { NotifyDeps } from './notify'
import { sendSms } from './sms'

/**
 * Build the notification fan-out's injected dependencies for a request path (routes call this; the fake
 * job executor assembles its own deps from the fake adapters directly, to stay off the @/adapters cycle).
 * In simulated mode it wires the person-locale resolver so demo emails/SMS render in the recipient's
 * language; in real mode `resolveLocale` is omitted and copy falls back to the app default (the auth
 * port exposes no per-user locale — a noted simplification, see the decision log).
 */
export async function makeNotifyDeps(): Promise<NotifyDeps> {
    const resolveLocale = isSimulated ? (await import('../adapters/fake/auth')).personLocale : undefined
    return { db, email, sms: sendSms, resolveLocale }
}
