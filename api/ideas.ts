/**
 * POST /api/ideas — receives player suggestions and forwards them to IDEAS_WEBHOOK_URL.
 * GET  /api/ideas — reports whether automatic delivery is configured (never reveals the URL).
 *
 * Runs as a Vercel Node.js function (Web Request/Response signature). It is self-contained on purpose
 * (no relative imports) so `vite dev`/`vite preview` can execute the very same file locally.
 *
 * Security: IDEAS_WEBHOOK_URL is a server-only variable. Never expose it through a VITE_* variable.
 */

export const IDEA_CATEGORY_IDS = ['melhoria', 'missao', 'mecanica', 'historia', 'outro-jogo', 'outro'] as const;
const CATEGORY_LABELS: Record<(typeof IDEA_CATEGORY_IDS)[number], string> = {
  melhoria: 'Melhoria',
  missao: 'Missão',
  mecanica: 'Mecânica',
  historia: 'História',
  'outro-jogo': 'Outro jogo',
  outro: 'Outro',
};

export const API_LIMITS = {
  title: { min: 4, max: 80 },
  description: { min: 20, max: 2000 },
  author: { max: 40 },
  maxBodyBytes: 8 * 1024,
  minElapsedMs: 2500,
  maxLinks: 3,
  rateLimit: { windowMs: 10 * 60 * 1000, max: 5 },
  webhookTimeoutMs: 8000,
} as const;

export interface IdeaPayload {
  title: string;
  category: (typeof IDEA_CATEGORY_IDS)[number];
  description: string;
  author: string;
}

type ValidationResult = { ok: true; idea: IdeaPayload } | { ok: false; status: number; code: string; message: string };

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const collapse = (s: string): string => s.replace(CONTROL_CHARS, '').replace(/\s+/g, ' ').trim();
const multiline = (s: string): string => s.replace(CONTROL_CHARS, '').replace(/\r\n?/g, '\n').replace(/\n{4,}/g, '\n\n\n').trim();

/** Validates and normalizes an untrusted body. Exported for unit tests. */
export function validateIdeaBody(body: unknown): ValidationResult {
  const reject = (message: string, code = 'invalid'): ValidationResult => ({ ok: false, status: 422, code, message });
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return reject('Formato inválido.');
  const b = body as Record<string, unknown>;

  // Spam protection: hidden honeypot and minimum time spent on the form.
  if (typeof b.website === 'string' && b.website.trim() !== '') return { ok: false, status: 400, code: 'spam', message: 'Envio recusado.' };
  if (typeof b.elapsedMs !== 'number' || !Number.isFinite(b.elapsedMs) || b.elapsedMs < API_LIMITS.minElapsedMs)
    return { ok: false, status: 400, code: 'too_fast', message: 'Envio muito rápido. Revise sua ideia e tente novamente.' };

  if (typeof b.title !== 'string' || typeof b.description !== 'string' || typeof b.category !== 'string')
    return reject('Preencha título, categoria e descrição.');
  const title = collapse(b.title);
  const description = multiline(b.description);
  const author = typeof b.author === 'string' ? collapse(b.author) : '';

  if (title.length < API_LIMITS.title.min || title.length > API_LIMITS.title.max)
    return reject(`O título deve ter entre ${API_LIMITS.title.min} e ${API_LIMITS.title.max} caracteres.`);
  if (description.length < API_LIMITS.description.min || description.length > API_LIMITS.description.max)
    return reject(`A descrição deve ter entre ${API_LIMITS.description.min} e ${API_LIMITS.description.max} caracteres.`);
  if (author.length > API_LIMITS.author.max) return reject(`O nome deve ter no máximo ${API_LIMITS.author.max} caracteres.`);
  if (!IDEA_CATEGORY_IDS.includes(b.category as IdeaPayload['category'])) return reject('Categoria inválida.');
  const links = (description.match(/https?:\/\//gi) ?? []).length + (title.match(/https?:\/\//gi) ?? []).length;
  if (links > API_LIMITS.maxLinks) return { ok: false, status: 400, code: 'spam', message: 'Muitos links na mensagem.' };

  return { ok: true, idea: { title, description, author, category: b.category as IdeaPayload['category'] } };
}

/** Builds the outgoing request body according to the destination (Discord, Slack or generic JSON). */
export function buildWebhookBody(webhookUrl: URL, idea: IdeaPayload, receivedAt: string): unknown {
  const label = CATEGORY_LABELS[idea.category];
  const host = webhookUrl.hostname.toLowerCase();
  if (host === 'discord.com' || host === 'discordapp.com' || host.endsWith('.discord.com')) {
    return {
      username: 'LINHA MORTA — Ideias',
      allowed_mentions: { parse: [] },
      embeds: [
        {
          title: idea.title.slice(0, 256),
          description: idea.description.slice(0, 4000),
          color: 0x8a1f1f,
          fields: [
            { name: 'Categoria', value: label, inline: true },
            ...(idea.author ? [{ name: 'Enviada por', value: idea.author, inline: true }] : []),
          ],
          timestamp: receivedAt,
        },
      ],
    };
  }
  if (host === 'hooks.slack.com') {
    const author = idea.author ? `\n_Enviada por:_ ${idea.author}` : '';
    return { text: `*Nova ideia para LINHA MORTA* — ${label}\n*${idea.title}*\n${idea.description}${author}` };
  }
  return { source: 'linha-morta', type: 'idea', receivedAt, categoryLabel: label, ...idea };
}

export function parseWebhookUrl(raw: string | undefined): URL | null {
  if (!raw || raw.trim() === '') return null;
  try {
    const url = new URL(raw.trim());
    const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
    if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) return null;
    return url;
  } catch {
    return null;
  }
}

// Best-effort, per-instance rate limiting (serverless instances do not share memory).
const hits = new Map<string, number[]>();

export function isRateLimited(key: string, now = Date.now()): boolean {
  const { windowMs, max } = API_LIMITS.rateLimit;
  const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (recent.length >= max) {
    hits.set(key, recent);
    return true;
  }
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > 5000) hits.clear();
  return false;
}

export function resetRateLimits(): void {
  hits.clear();
}

const json = (status: number, body: unknown, extra: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra },
  });

/** Reads process.env without depending on Node typings (the file is also type-checked with the web config). */
function serverEnv(): Record<string, string | undefined> {
  return (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};
}

export interface HandlerDeps {
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

function clientKey(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return forwarded || request.headers.get('x-real-ip') || 'anonymous';
}

export async function handleIdeasRequest(request: Request, deps: HandlerDeps = {}): Promise<Response> {
  const env = deps.env ?? serverEnv();
  const fetchImpl = deps.fetchImpl ?? fetch;
  const webhook = parseWebhookUrl(env.IDEAS_WEBHOOK_URL);

  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { Allow: 'GET, POST, OPTIONS' } });
  if (request.method === 'GET') return json(200, { ok: true, configured: webhook !== null });
  if (request.method !== 'POST') return json(405, { ok: false, code: 'method_not_allowed', message: 'Método não permitido.' }, { Allow: 'GET, POST, OPTIONS' });

  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().includes('application/json'))
    return json(415, { ok: false, code: 'unsupported_media_type', message: 'Envie os dados em JSON.' });

  const declared = Number(request.headers.get('content-length') ?? '0');
  if (declared > API_LIMITS.maxBodyBytes) return json(413, { ok: false, code: 'too_large', message: 'A ideia é grande demais.' });

  let raw: string;
  try {
    raw = await request.text();
  } catch {
    return json(400, { ok: false, code: 'bad_request', message: 'Não foi possível ler os dados enviados.' });
  }
  if (new TextEncoder().encode(raw).length > API_LIMITS.maxBodyBytes)
    return json(413, { ok: false, code: 'too_large', message: 'A ideia é grande demais.' });

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return json(400, { ok: false, code: 'bad_json', message: 'JSON inválido.' });
  }

  const result = validateIdeaBody(body);
  if (!result.ok) return json(result.status, { ok: false, code: result.code, message: result.message });

  if (!webhook) {
    return json(503, {
      ok: false,
      code: 'not_configured',
      message: 'O envio automático de ideias ainda não está configurado.',
    });
  }

  if (isRateLimited(clientKey(request), deps.now?.())) {
    return json(429, { ok: false, code: 'rate_limited', message: 'Muitas ideias em pouco tempo. Tente novamente mais tarde.' }, { 'Retry-After': '600' });
  }

  const receivedAt = new Date(deps.now?.() ?? Date.now()).toISOString();
  try {
    const response = await fetchImpl(webhook.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'linha-morta-ideas/1.0' },
      body: JSON.stringify(buildWebhookBody(webhook, result.idea, receivedAt)),
      signal: AbortSignal.timeout(API_LIMITS.webhookTimeoutMs),
    });
    if (!response.ok) {
      console.error(`[api/ideas] destination responded with HTTP ${response.status}`);
      return json(502, { ok: false, code: 'delivery_failed', message: 'O destino não confirmou o recebimento. Tente novamente mais tarde.' });
    }
  } catch (error) {
    console.error('[api/ideas] delivery failed', error instanceof Error ? error.name : 'unknown');
    return json(502, { ok: false, code: 'delivery_failed', message: 'Não foi possível entregar a ideia agora. Tente novamente mais tarde.' });
  }

  return json(200, { ok: true, code: 'sent', message: 'Ideia enviada ao criador. Obrigado!' });
}

export function GET(request: Request): Promise<Response> {
  return handleIdeasRequest(request);
}

export function POST(request: Request): Promise<Response> {
  return handleIdeasRequest(request);
}

export function OPTIONS(request: Request): Promise<Response> {
  return handleIdeasRequest(request);
}
