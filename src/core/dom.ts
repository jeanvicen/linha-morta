/**
 * Tiny DOM helpers. User-provided text is only ever assigned through `textContent`,
 * never as HTML, so untrusted content cannot be injected.
 */
type Attrs = Record<string, string | number | boolean | null | undefined>;
type Child = Node | string | null | undefined | false;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') el.className = String(value);
    else if (value === true) el.setAttribute(key, '');
    else el.setAttribute(key, String(value));
  }
  append(el, ...children);
  return el;
}

export function append(parent: Element | DocumentFragment, ...children: Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    parent.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
}

export function clear(el: Element): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}

/** Inline SVG icon from a static, trusted path list (never from user input). */
export function icon(name: IconName, size = 20): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.classList.add('icon');
  for (const d of ICONS[name]) {
    const path = document.createElementNS(ns, 'path');
    path.setAttribute('d', d);
    svg.append(path);
  }
  return svg;
}

const ICONS = {
  soundOn: ['M4 9v6h4l5 4V5L8 9H4z', 'M16 8.5a5 5 0 0 1 0 7', 'M18.5 6a8.5 8.5 0 0 1 0 12'],
  soundOff: ['M4 9v6h4l5 4V5L8 9H4z', 'M17 9l5 6', 'M22 9l-5 6'],
  close: ['M6 6l12 12', 'M18 6L6 18'],
  install: ['M12 4v11', 'M7 10l5 5 5-5', 'M5 19h14'],
  copy: ['M9 9h10v11H9z', 'M5 15V4h10'],
  share: ['M12 3v12', 'M7 8l5-5 5 5', 'M5 13v7h14v-7'],
  instagram: ['M7 3h10a4 4 0 0 1 4 4v10a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V7a4 4 0 0 1 4-4z', 'M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z', 'M17.5 6.5h.01'],
  back: ['M15 5l-7 7 7 7'],
  check: ['M5 12l5 5 9-10'],
  alert: ['M12 4l9 16H3z', 'M12 10v4', 'M12 17h.01'],
  fullscreen: ['M4 9V4h5', 'M20 9V4h-5', 'M4 15v5h5', 'M20 15v5h-5'],
  refresh: ['M20 11a8 8 0 1 0-2.3 5.7', 'M20 5v6h-6'],
} as const;

export type IconName = keyof typeof ICONS;

export const prefersReducedMotionQuery = (): MediaQueryList | null =>
  typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;

export const nextFrame = (): Promise<void> => new Promise((resolve) => requestAnimationFrame(() => resolve()));

/** Yields to the browser so long procedural work does not freeze the loading screen. */
export const yieldToMain = (): Promise<void> =>
  new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => resolve();
    channel.port2.postMessage(null);
  });

export const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
