import type { EmailSender, EmailMessage } from '../../domain/email/email-sender.js';

const ELASTIC_EMAIL_API_URL = 'https://api.elasticemail.com/v4/emails';

/** Cliente delgado sobre la API HTTP v4 de Elastic Email (PR13). */
export class ElasticEmailClient implements EmailSender {
  constructor(
    private readonly apiKey: string,
    private readonly from: string,
  ) {}

  async send(message: EmailMessage): Promise<void> {
    const res = await fetch(ELASTIC_EMAIL_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-ElasticEmail-ApiKey': this.apiKey,
      },
      body: JSON.stringify({
        Recipients: [{ Email: message.to }],
        Content: {
          From: this.from,
          Subject: message.subject,
          Body: [
            { ContentType: 'HTML', Content: message.html },
            { ContentType: 'PlainText', Content: message.text },
          ],
        },
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Elastic Email request failed: ${res.status} ${body}`);
    }
  }
}
