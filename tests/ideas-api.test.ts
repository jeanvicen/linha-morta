import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  API_LIMITS,
  IDEA_CATEGORY_IDS,
  buildWebhookBody,
  handleIdeasRequest,
  parseWebhookUrl,
  resetRateLimits,
  validateIdeaBody,
} from '../api/ideas';
import { IDEA_CATEGORIES, IDEA_LIMITS, formatIdeaText, submitIdea, validateIdea } from '../src/features/ideas/ideas';

const idea = {
  title: 'Posto abandonado',
  category: 'missao',
  description: 'Uma missão em um posto de gasolina abandonado durante o apagão.',
  author: 'Ana',
  website: '',
  elapsedMs: 9000,
};

const post = (body: unknown, headers: Record<string, string> = {}): Request =>
  new Request('http://localhost/api/ideas', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '203.0.113.7', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

afterEach(() => resetRateLimits());

describe('client and server agree on limits and categories', () => {
  it('uses the same categories', () => {
    expect(IDEA_CATEGORIES.map((c) => c.id)).toEqual([...IDEA_CATEGORY_IDS]);
  });
  it('uses the same text limits', () => {
    expect(IDEA_LIMITS.title).toEqual(API_LIMITS.title);
    expect(IDEA_LIMITS.description).toEqual(API_LIMITS.description);
    expect(IDEA_LIMITS.author.max).toBe(API_LIMITS.author.max);
  });
});

describe('validateIdeaBody', () => {
  it('accepts and normalizes a valid idea', () => {
    const r = validateIdeaBody({ ...idea, title: '  Posto   abandonado  ' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.idea.title).toBe('Posto abandonado');
  });

  it('rejects the honeypot, too-fast submissions and bad categories', () => {
    expect(validateIdeaBody({ ...idea, website: 'http://spam' })).toMatchObject({ ok: false, code: 'spam' });
    expect(validateIdeaBody({ ...idea, elapsedMs: 200 })).toMatchObject({ ok: false, code: 'too_fast' });
    expect(validateIdeaBody({ ...idea, category: 'admin' })).toMatchObject({ ok: false, status: 422 });
  });

  it('enforces length limits and link spam', () => {
    expect(validateIdeaBody({ ...idea, title: 'abc' }).ok).toBe(false);
    expect(validateIdeaBody({ ...idea, description: 'x'.repeat(API_LIMITS.description.max + 1) }).ok).toBe(false);
    expect(validateIdeaBody({ ...idea, description: 'veja http://a http://b http://c http://d agora mesmo por favor' })).toMatchObject({ code: 'spam' });
  });

  it('strips control characters', () => {
    const r = validateIdeaBody({ ...idea, title: 'Posto\u0007 abandonado' });
    expect(r.ok && r.idea.title).toBe('Posto abandonado');
  });
});

describe('handleIdeasRequest without IDEAS_WEBHOOK_URL', () => {
  it('reports that delivery is not configured (GET)', async () => {
    const res = await handleIdeasRequest(new Request('http://localhost/api/ideas'), { env: {} });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, configured: false });
  });

  it('never pretends a valid idea was delivered', async () => {
    const fetchImpl = vi.fn();
    const res = await handleIdeasRequest(post(idea), { env: {}, fetchImpl });
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ ok: false, code: 'not_configured' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('still validates input', async () => {
    const res = await handleIdeasRequest(post({ ...idea, title: '' }), { env: {} });
    expect(res.status).toBe(422);
  });
});

describe('handleIdeasRequest with IDEAS_WEBHOOK_URL', () => {
  const env = { IDEAS_WEBHOOK_URL: 'https://discord.com/api/webhooks/123/abc' };

  it('forwards to Discord and confirms only after success', async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 204 }));
    const res = await handleIdeasRequest(post(idea), { env, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, code: 'sent' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(env.IDEAS_WEBHOOK_URL);
    const body = JSON.parse(String(init.body));
    expect(body.embeds[0].title).toBe(idea.title);
    expect(body.allowed_mentions).toEqual({ parse: [] });
  });

  it('reports failure when the destination fails', async () => {
    const fetchImpl = vi.fn(async () => new Response('nope', { status: 500 }));
    const res = await handleIdeasRequest(post(idea), { env, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ ok: false, code: 'delivery_failed' });
  });

  it('reports failure on network errors', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('network down');
    });
    const res = await handleIdeasRequest(post(idea), { env, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(res.status).toBe(502);
  });

  it('does not expose the webhook URL in responses', async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 204 }));
    for (const req of [new Request('http://localhost/api/ideas'), post(idea)]) {
      const res = await handleIdeasRequest(req, { env, fetchImpl: fetchImpl as unknown as typeof fetch });
      expect(await res.text()).not.toContain('discord.com');
    }
  });

  it('rate limits bursts from the same client', async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 204 }));
    const statuses: number[] = [];
    for (let i = 0; i < API_LIMITS.rateLimit.max + 1; i++) {
      statuses.push((await handleIdeasRequest(post(idea), { env, fetchImpl: fetchImpl as unknown as typeof fetch })).status);
    }
    expect(statuses.slice(0, -1).every((s) => s === 200)).toBe(true);
    expect(statuses.at(-1)).toBe(429);
  });

  it('rejects oversized payloads, wrong content type and bad JSON', async () => {
    const big = { ...idea, description: 'x'.repeat(API_LIMITS.maxBodyBytes) };
    expect((await handleIdeasRequest(post(big), { env })).status).toBe(413);
    expect((await handleIdeasRequest(post(idea, { 'Content-Type': 'text/plain' }), { env })).status).toBe(415);
    expect((await handleIdeasRequest(post('{"oops"'), { env })).status).toBe(400);
  });

  it('rejects other methods', async () => {
    const res = await handleIdeasRequest(new Request('http://localhost/api/ideas', { method: 'DELETE' }), { env });
    expect(res.status).toBe(405);
  });
});

describe('webhook helpers', () => {
  it('only accepts https destinations (http only for localhost)', () => {
    expect(parseWebhookUrl(undefined)).toBeNull();
    expect(parseWebhookUrl('')).toBeNull();
    expect(parseWebhookUrl('not a url')).toBeNull();
    expect(parseWebhookUrl('http://example.com/hook')).toBeNull();
    expect(parseWebhookUrl('http://localhost:8787/hook')?.hostname).toBe('localhost');
    expect(parseWebhookUrl('https://example.com/hook')?.hostname).toBe('example.com');
  });

  it('formats Slack and generic payloads', () => {
    const v = validateIdeaBody(idea);
    if (!v.ok) throw new Error('invalid');
    expect(buildWebhookBody(new URL('https://hooks.slack.com/services/x'), v.idea, 'now')).toHaveProperty('text');
    expect(buildWebhookBody(new URL('https://example.com/x'), v.idea, 'now')).toMatchObject({ source: 'linha-morta', title: idea.title, categoryLabel: 'Missão' });
  });
});

describe('client helpers', () => {
  it('validates drafts with Portuguese messages', () => {
    const errors = validateIdea({ title: 'a', category: '', description: 'curta', author: '' });
    expect(errors.title).toMatch(/caracteres/);
    expect(errors.category).toBe('Escolha uma categoria.');
    expect(errors.description).toMatch(/pelo menos/);
  });

  it('formats a shareable text', () => {
    const text = formatIdeaText({ title: 'Posto', category: 'missao', description: 'Descrição longa o bastante.', author: '' });
    expect(text).toContain('Ideia para LINHA MORTA');
    expect(text).toContain('Categoria: Missão');
    expect(text).not.toContain('Enviada por');
  });

  it('maps server responses honestly', async () => {
    const draft = { title: 'Posto abandonado', category: 'missao' as const, description: idea.description, author: '' };
    const meta = { website: '', elapsedMs: 9000 };
    const respond = (status: number, body: unknown) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
    expect(await submitIdea(draft, meta, respond(200, { ok: true }))).toEqual({ status: 'sent' });
    expect(await submitIdea(draft, meta, respond(503, { ok: false, code: 'not_configured' }))).toEqual({ status: 'not_configured' });
    expect((await submitIdea(draft, meta, respond(429, { ok: false }))).status).toBe('rate_limited');
    expect((await submitIdea(draft, meta, respond(502, { ok: false }))).status).toBe('error');
    const html404 = (async () => new Response('<html>', { status: 404 })) as unknown as typeof fetch;
    expect(await submitIdea(draft, meta, html404)).toEqual({ status: 'not_configured' });
    const offline = (async () => {
      throw new TypeError('offline');
    }) as unknown as typeof fetch;
    expect((await submitIdea(draft, meta, offline)).status).toBe('error');
  });
});
