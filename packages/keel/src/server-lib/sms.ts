import { isSimulated } from '../adapters/index'

/**
 * The SMS channel seam — app-owned server machinery, NOT a vendor port (this slice ships ZERO
 * vendor code). It is the same shape as the outbound-webhook DISPATCH seam (packages/keel/src/server-lib/webhook-
 * dispatch.ts): a thin interface with the fake selected behind `isSimulated`. The fake records each
 * message into `.data/sms/` (the mail/webhooks catch-store pattern) for the Simulator Messages tab; the
 * real branch is a deliberate NO-OP stub — an instance turns SMS on by following docs/recipes/sms-twilio.md
 * (drop a Twilio adapter behind THIS function and add the credential cutover rows). Keeping the fake as
 * the only shipped consumer is what keeps the channel abstraction honest without a vendor adapter nobody
 * in the template uses. See the decision log for why this lives in server-lib + adapters/fake, not a port.
 */
export interface SmsMessage {
    /** A display address for the recipient (a name/email stand-in — seed people carry no phone). */
    to: string
    /** The composed message text (i18n'd by the fan-out before it reaches here). */
    body: string
    /** The NotificationKind that produced this message (packages/keel/src/core/notifications.ts) — for the tab filter. */
    kind: string
    /** The opaque recipient actor id — lets the Simulator tab scope messages per person. */
    recipientUserId: string
}

/** The SMS channel signature the fan-out (packages/keel/src/server-lib/notify.ts) depends on, so it can be injected
 *  in tests and the twin exactly like WebhookDispatch. */
export type SmsChannel = (message: SmsMessage) => Promise<void>

/**
 * Send an SMS through whichever channel run mode selects. Simulated mode dynamically imports the catch-store
 * recorder (its node `fs` code is never reached in a real build — the /api/simulator first-line-404
 * containment shape, and the dispatchWebhook precedent). Real mode is a no-op stub: an instance replaces
 * this branch with a Twilio adapter per docs/recipes/sms-twilio.md.
 */
export const sendSms: SmsChannel = async (message) => {
    if (isSimulated) {
        const { fakeSendSms } = await import('../adapters/fake/sms')
        await fakeSendSms(message)
        return
    }
    // REAL MODE: no vendor is shipped. An instance wires Twilio (or another gateway) here — the seam is
    // the single swap point. Until then, real mode drops SMS silently rather than pretending to send.
    // See docs/recipes/sms-twilio.md for the adapter shape and the credential cutover rows.
}
