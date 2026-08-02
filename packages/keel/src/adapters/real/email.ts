import Mailgun from 'mailgun.js'
import type { EmailPort } from '../../ports/email'

/**
 * AUTHORED — CUTOVER (`email-outbound`): typechecked against mailgun.js, never sent for real.
 */
export function createRealEmail(domain: string, apiKey: string, from: string): EmailPort {
    const mailgun = new Mailgun(FormData)
    const client = mailgun.client({ username: 'api', key: apiKey })

    return {
        async send(message) {
            await client.messages.create(domain, {
                from,
                to: [message.to],
                subject: message.subject,
                html: message.html,
                text: message.text,
            })
        },
    }
}
