import { render } from '@react-email/render'
import type { ReactElement } from 'react'
import type { EmailPort } from '../ports/email'

/** Renders a react-email template to html+text and hands it to whichever email adapter is wired. */
export async function sendTemplate(
    port: EmailPort,
    options: { to: string; subject: string; template: ReactElement },
): Promise<void> {
    const [html, text] = await Promise.all([render(options.template), render(options.template, { plainText: true })])
    await port.send({ to: options.to, subject: options.subject, html, text })
}
