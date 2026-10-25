/** Application error type with a player-facing message in Portuguese. */
export type ErrorCode =
  | 'webgl_unavailable'
  | 'webgl_context_lost'
  | 'scene_build_failed'
  | 'shader_compile_failed'
  | 'audio_unavailable'
  | 'loading_timeout'
  | 'network'
  | 'unknown';

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly userMessage: string;

  constructor(code: ErrorCode, userMessage: string, options?: { cause?: unknown }) {
    super(`${code}: ${userMessage}`, options);
    this.name = 'AppError';
    this.code = code;
    this.userMessage = userMessage;
  }
}

export function toAppError(error: unknown, fallback: ErrorCode = 'unknown'): AppError {
  if (error instanceof AppError) return error;
  const message = error instanceof Error ? error.message : String(error);
  return new AppError(fallback, 'Ocorreu um erro inesperado.', { cause: message });
}

/** Logs unexpected errors without crashing the experience. No data is sent anywhere. */
export function installGlobalErrorHandlers(onFatal?: (error: AppError) => void): void {
  window.addEventListener('error', (event) => {
    console.error('[linha-morta] erro não tratado', event.error ?? event.message);
  });
  window.addEventListener('unhandledrejection', (event) => {
    console.error('[linha-morta] promessa rejeitada sem tratamento', event.reason);
    if (event.reason instanceof AppError && onFatal) onFatal(event.reason);
  });
}
