export interface EmailMessage {
    to: string
    subject: string
    html: string
    text: string
}

/**
 * Email port (ADR-0011). Templates are react-email components rendered by packages/keel/src/email/send.ts;
 * the port only transports. The fake adapter stores messages for the Simulator panel's Mail tab.
 */
export interface EmailPort {
    send(message: EmailMessage): Promise<void>
}
