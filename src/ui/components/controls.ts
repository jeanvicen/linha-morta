/** Reusable accessible form controls built with plain DOM (no innerHTML). */
import { h, icon, type IconName } from '../../core/dom';

let uid = 0;
export const nextId = (prefix: string): string => `${prefix}-${++uid}`;

export interface ButtonOptions {
  variant?: 'primary' | 'ghost' | 'default';
  small?: boolean;
  icon?: IconName;
  ariaLabel?: string;
  type?: 'button' | 'submit';
}

export function button(label: string, onClick: (event: MouseEvent) => void, opts: ButtonOptions = {}): HTMLButtonElement {
  const cls = ['btn', opts.variant && opts.variant !== 'default' ? `btn--${opts.variant}` : '', opts.small ? 'btn--small' : ''].filter(Boolean).join(' ');
  const el = h('button', { type: opts.type ?? 'button', class: cls, 'aria-label': opts.ariaLabel });
  if (opts.icon) el.append(icon(opts.icon, 18));
  el.append(h('span', {}, label));
  el.addEventListener('click', onClick);
  return el;
}

export function iconButton(name: IconName, label: string, onClick: () => void): HTMLButtonElement {
  const el = h('button', { type: 'button', class: 'icon-btn', 'aria-label': label, title: label }, icon(name, 20));
  el.addEventListener('click', onClick);
  return el;
}

export interface Control<T> {
  el: HTMLElement;
  set(value: T): void;
  setDisabled?(disabled: boolean): void;
}

/** Radio-group style segmented control (arrow keys move the selection). */
export function segmented<T extends string | number>(
  label: string,
  options: readonly { value: T; label: string }[],
  value: T,
  onChange: (value: T) => void,
): Control<T> {
  const el = h('div', { class: 'segmented', role: 'radiogroup', 'aria-label': label });
  const buttons = options.map((opt) => {
    const b = h('button', { type: 'button', role: 'radio', 'aria-checked': 'false', 'data-value': String(opt.value) }, opt.label);
    b.addEventListener('click', () => {
      set(opt.value);
      onChange(opt.value);
    });
    el.append(b);
    return { b, value: opt.value };
  });
  el.addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    const index = buttons.findIndex((x) => x.b.getAttribute('aria-checked') === 'true');
    const dir = event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1;
    const next = buttons[(index + dir + buttons.length) % buttons.length]!;
    event.preventDefault();
    next.b.focus();
    set(next.value);
    onChange(next.value);
  });
  const set = (v: T): void => {
    for (const x of buttons) {
      const on = x.value === v;
      x.b.setAttribute('aria-checked', String(on));
      x.b.tabIndex = on ? 0 : -1;
    }
    if (!buttons.some((x) => x.value === v) && buttons[0]) buttons[0].b.tabIndex = 0;
  };
  set(value);
  return { el, set };
}

export function slider(
  label: string,
  min: number,
  max: number,
  step: number,
  value: number,
  format: (v: number) => string,
  onInput: (v: number) => void,
): Control<number> {
  const id = nextId('range');
  const input = h('input', { type: 'range', id, min, max, step, value, 'aria-label': label }) as HTMLInputElement;
  const out = h('output', { for: id }, format(value));
  input.addEventListener('input', () => {
    const v = Number(input.value);
    out.textContent = format(v);
    input.setAttribute('aria-valuetext', format(v));
    onInput(v);
  });
  input.setAttribute('aria-valuetext', format(value));
  const el = h('div', { class: 'range' }, input, out);
  return {
    el,
    set(v) {
      input.value = String(v);
      out.textContent = format(v);
      input.setAttribute('aria-valuetext', format(v));
    },
    setDisabled(d) {
      input.disabled = d;
    },
  };
}

export function toggle(label: string, checked: boolean, onChange: (v: boolean) => void): Control<boolean> {
  const el = h('button', { type: 'button', class: 'switch', role: 'switch', 'aria-checked': String(checked), 'aria-label': label }) as HTMLButtonElement;
  el.addEventListener('click', () => {
    const v = el.getAttribute('aria-checked') !== 'true';
    el.setAttribute('aria-checked', String(v));
    onChange(v);
  });
  return {
    el,
    set(v) {
      el.setAttribute('aria-checked', String(v));
    },
    setDisabled(d) {
      el.disabled = d;
    },
  };
}

export function settingRow(label: string, description: string | null, control: HTMLElement, stack = false): HTMLElement {
  return h(
    'div',
    { class: `setting${stack ? ' setting--stack' : ''}` },
    h('div', { class: 'setting__text' }, h('span', { class: 'setting__label' }, label), description ? h('span', { class: 'setting__desc' }, description) : null),
    control,
  );
}

/** Keeps keyboard focus inside a dialog while it is open. */
export function trapFocus(container: HTMLElement, event: KeyboardEvent): void {
  if (event.key !== 'Tab') return;
  const focusables = focusableWithin(container);
  if (focusables.length === 0) return;
  const first = focusables[0]!;
  const last = focusables[focusables.length - 1]!;
  const active = document.activeElement;
  if (event.shiftKey && (active === first || !container.contains(active))) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && active === last) {
    event.preventDefault();
    first.focus();
  }
}

export function focusableWithin(container: HTMLElement): HTMLElement[] {
  const selector = 'button:not([disabled]), [href], input:not([disabled]):not([tabindex="-1"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
  return [...container.querySelectorAll<HTMLElement>(selector)].filter((el) => el.offsetParent !== null || el === document.activeElement);
}

export class Toasts {
  readonly el = h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' });

  show(message: string, action?: { label: string; onClick: () => void }, ms = 5000): void {
    const toast = h('div', { class: 'toast' }, h('span', {}, message));
    if (action) {
      toast.append(
        button(action.label, () => {
          action.onClick();
          toast.remove();
        }, { small: true, variant: 'primary' }),
      );
    }
    this.el.append(toast);
    if (ms > 0) window.setTimeout(() => toast.remove(), ms);
  }
}
