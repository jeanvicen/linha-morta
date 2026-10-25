/**
 * Client side of the "ENVIAR UMA IDEIA" feature: validation, submission to /api/ideas and
 * honest fallbacks (copy / native share) when automatic delivery is not configured.
 * Limits and categories must match api/ideas.ts (enforced by tests/ideas-api.test.ts).
 */
export const IDEA_CATEGORIES = [
  { id: 'melhoria', label: 'Melhoria' },
  { id: 'missao', label: 'Missão' },
  { id: 'mecanica', label: 'Mecânica' },
  { id: 'historia', label: 'História' },
  { id: 'outro-jogo', label: 'Outro jogo' },
  { id: 'outro', label: 'Outro' },
] as const;

export type IdeaCategory = (typeof IDEA_CATEGORIES)[number]['id'];

export const IDEA_LIMITS = {
  title: { min: 4, max: 80 },
  description: { min: 20, max: 2000 },
  author: { max: 40 },
} as const;

export const INSTAGRAM_HANDLE = '@0neajx';
export const INSTAGRAM_URL = 'https://www.instagram.com/0neajx/';

export interface IdeaDraft {
  title: string;
  category: IdeaCategory | '';
  description: string;
  author: string;
}

export type IdeaErrors = Partial<Record<keyof IdeaDraft, string>>;

const normalize = (s: string): string => s.replace(/\s+/g, ' ').trim();

export function validateIdea(draft: IdeaDraft): IdeaErrors {
  const errors: IdeaErrors = {};
  const title = normalize(draft.title);
  const description = draft.description.trim();
  if (title.length < IDEA_LIMITS.title.min) errors.title = `Use pelo menos ${IDEA_LIMITS.title.min} caracteres.`;
  else if (title.length > IDEA_LIMITS.title.max) errors.title = `Use no máximo ${IDEA_LIMITS.title.max} caracteres.`;
  if (!IDEA_CATEGORIES.some((c) => c.id === draft.category)) errors.category = 'Escolha uma categoria.';
  if (description.length < IDEA_LIMITS.description.min)
    errors.description = `Descreva com pelo menos ${IDEA_LIMITS.description.min} caracteres.`;
  else if (description.length > IDEA_LIMITS.description.max)
    errors.description = `Use no máximo ${IDEA_LIMITS.description.max} caracteres.`;
  if (normalize(draft.author).length > IDEA_LIMITS.author.max) errors.author = `Use no máximo ${IDEA_LIMITS.author.max} caracteres.`;
  return errors;
}

export function categoryLabel(id: string): string {
  return IDEA_CATEGORIES.find((c) => c.id === id)?.label ?? id;
}

/** Plain-text version of the idea for copying or sharing manually. */
export function formatIdeaText(draft: IdeaDraft): string {
  const lines = [
    'Ideia para LINHA MORTA',
    `Título: ${normalize(draft.title)}`,
    `Categoria: ${categoryLabel(draft.category)}`,
  ];
  const author = normalize(draft.author);
  if (author) lines.push(`Enviada por: ${author}`);
  lines.push('', draft.description.trim());
  return lines.join('\n');
}

export type SubmitResult =
  | { status: 'sent' }
  | { status: 'not_configured' }
  | { status: 'rejected'; message: string }
  | { status: 'rate_limited'; message: string }
  | { status: 'error'; message: string };

export interface SubmitMeta {
  /** Hidden honeypot value; real players never fill it. */
  website: string;
  /** Milliseconds the form was open before submission. */
  elapsedMs: number;
}

/** Sends the idea to /api/ideas. Success is reported only when the server confirms delivery. */
export async function submitIdea(draft: IdeaDraft, meta: SubmitMeta, fetchImpl: typeof fetch = fetch): Promise<SubmitResult> {
  let response: Response;
  try {
    response = await fetchImpl('/api/ideas', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: normalize(draft.title),
        category: draft.category,
        description: draft.description.trim(),
        author: normalize(draft.author),
        website: meta.website,
        elapsedMs: Math.round(meta.elapsedMs),
      }),
      signal: AbortSignal.timeout ? AbortSignal.timeout(15000) : undefined,
    });
  } catch {
    return { status: 'error', message: 'Não foi possível conectar ao servidor. Verifique sua conexão.' };
  }

  let body: { ok?: boolean; code?: string; message?: string } = {};
  try {
    body = (await response.json()) as typeof body;
  } catch {
    // Static hosting without the API (e.g. a plain file server) returns HTML or nothing.
    if (response.status === 404 || response.status === 405) return { status: 'not_configured' };
    return { status: 'error', message: 'Resposta inesperada do servidor.' };
  }

  if (response.ok && body.ok === true) return { status: 'sent' };
  if (body.code === 'not_configured' || response.status === 404) return { status: 'not_configured' };
  if (response.status === 429) return { status: 'rate_limited', message: body.message ?? 'Muitas tentativas. Aguarde um pouco.' };
  if (response.status === 400 || response.status === 413 || response.status === 422)
    return { status: 'rejected', message: body.message ?? 'A ideia não pôde ser validada.' };
  return { status: 'error', message: body.message ?? 'O servidor não conseguiu entregar a ideia agora.' };
}

/** Asks the server whether automatic delivery is configured (no secrets are returned). */
export async function fetchIdeasStatus(fetchImpl: typeof fetch = fetch): Promise<'configured' | 'not_configured' | 'unknown'> {
  try {
    const response = await fetchImpl('/api/ideas', { method: 'GET', headers: { Accept: 'application/json' } });
    if (!response.ok) return response.status === 404 ? 'not_configured' : 'unknown';
    const body = (await response.json()) as { configured?: unknown };
    return body.configured === true ? 'configured' : 'not_configured';
  } catch {
    return 'unknown';
  }
}
