/** Clipboard helper with permission handling and a legacy fallback. */
export type CopyResult = { ok: true; method: 'clipboard-api' | 'legacy' } | { ok: false; reason: 'denied' | 'unsupported' | 'failed' };

export async function copyText(text: string): Promise<CopyResult> {
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return { ok: true, method: 'clipboard-api' };
    } catch (error) {
      const denied = error instanceof DOMException && (error.name === 'NotAllowedError' || error.name === 'SecurityError');
      const legacy = legacyCopy(text);
      if (legacy) return { ok: true, method: 'legacy' };
      return { ok: false, reason: denied ? 'denied' : 'failed' };
    }
  }
  return legacyCopy(text) ? { ok: true, method: 'legacy' } : { ok: false, reason: 'unsupported' };
}

function legacyCopy(text: string): boolean {
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.top = '-1000px';
  area.style.opacity = '0';
  document.body.append(area);
  const selection = document.getSelection();
  const previous = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
  area.select();
  area.setSelectionRange(0, text.length);
  let ok: boolean;
  try {
    // Deprecated but still the only option on some older mobile browsers.
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  area.remove();
  if (previous && selection) {
    selection.removeAllRanges();
    selection.addRange(previous);
  }
  return ok;
}

/** Selects the text inside an element so the player can copy it manually. */
export function selectElementText(el: HTMLElement): void {
  const selection = window.getSelection();
  if (!selection) return;
  const range = document.createRange();
  range.selectNodeContents(el);
  selection.removeAllRanges();
  selection.addRange(range);
}
