import { describe, it, expect, vi, afterEach } from 'vitest';
import { ElasticEmailClient } from './elastic-email-client.js';

describe('ElasticEmailClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('POSTs a la API v4 de Elastic Email con el contenido del mensaje', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response('{}', { status: 200 });
    });

    const client = new ElasticEmailClient('test-api-key', 'alertas@tecnolicity.mx');
    await client.send({ to: 'user@example.com', subject: 'Asunto', text: 'texto', html: '<p>html</p>' });

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('https://api.elasticemail.com/v4/emails');

    const init = calls[0]!.init;
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['X-ElasticEmail-ApiKey']).toBe('test-api-key');

    const body = JSON.parse(init.body as string) as {
      Recipients: { Email: string }[];
      Content: { From: string; Subject: string; Body: { ContentType: string; Content: string }[] };
    };
    expect(body.Recipients).toEqual([{ Email: 'user@example.com' }]);
    expect(body.Content.From).toBe('alertas@tecnolicity.mx');
    expect(body.Content.Subject).toBe('Asunto');
    expect(body.Content.Body).toEqual([
      { ContentType: 'HTML', Content: '<p>html</p>' },
      { ContentType: 'PlainText', Content: 'texto' },
    ]);
  });

  it('lanza un error cuando la API responde con un status no-2xx', async () => {
    vi.stubGlobal('fetch', async () => new Response('bad key', { status: 401 }));
    const client = new ElasticEmailClient('bad-key', 'alertas@tecnolicity.mx');
    await expect(
      client.send({ to: 'user@example.com', subject: 's', text: 't', html: '<p>h</p>' }),
    ).rejects.toThrow(/401/);
  });
});
