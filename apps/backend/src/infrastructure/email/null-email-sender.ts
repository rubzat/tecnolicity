import type { EmailSender, EmailMessage } from '../../domain/email/email-sender.js';

/**
 * Se usa cuando ELASTIC_EMAIL_API_KEY no está configurado (PR13). La
 * evaluación de alertas sigue corriendo normalmente — solo el envío se
 * reemplaza por un log, así ningún despliegue existente se rompe por no
 * tener el proveedor de correo configurado todavía.
 */
export class NullEmailSender implements EmailSender {
  async send(message: EmailMessage): Promise<void> {
    console.warn(
      `[alerts] ELASTIC_EMAIL_API_KEY no configurado — se habría enviado a ${message.to}: "${message.subject}"`,
    );
  }
}
