/**
 * Cinematic black loading screen. Progress is shown as completed stages out of the real stage
 * list (never an invented percentage); the active stage animates indeterminately.
 */
import { h, icon } from '../../core/dom';
import { button } from '../components/controls';

export interface LoadingActions {
  onEnableSound: () => void;
  onRetry: () => void;
  onFallback: () => void;
}

export class LoadingScreen {
  readonly root: HTMLElement;
  private readonly segments: HTMLElement;
  private readonly stageText: HTMLElement;
  private readonly countText: HTMLElement;
  private readonly actions: HTMLElement;
  private readonly hint: HTMLElement;
  private readonly errorBox: HTMLElement;
  private readonly soundBtn: HTMLButtonElement;
  private total = 1;

  constructor(private readonly handlers: LoadingActions) {
    this.stageText = h('span', { class: 'loading__stage' }, 'Preparando…');
    this.countText = h('span', {});
    this.segments = h('div', { class: 'loading__segments', 'aria-hidden': 'true' });
    this.soundBtn = button('Ativar som', () => this.handlers.onEnableSound(), { icon: 'soundOn', variant: 'ghost' });
    this.actions = h('div', { class: 'loading__actions' }, this.soundBtn);
    this.hint = h('p', { class: 'loading__hint' }, 'Recomendado: fones de ouvido.');
    this.errorBox = h('div', { class: 'loading__error', role: 'alert', hidden: true });
    this.root = h(
      'section',
      { class: 'loading', 'aria-busy': 'true', 'aria-labelledby': 'loading-title' },
      h('h1', { class: 'loading__title', id: 'loading-title' }, 'LINHA MORTA'),
      h('p', { class: 'loading__tagline' }, 'O mundo não esquece você.'),
      h(
        'div',
        { class: 'loading__progress' },
        this.segments,
        h('div', { class: 'loading__status', role: 'status', 'aria-live': 'polite' }, this.stageText, this.countText),
      ),
      this.errorBox,
      this.actions,
      this.hint,
    );
  }

  setStages(count: number): void {
    this.total = count;
    this.segments.replaceChildren(...Array.from({ length: count }, () => h('div', { class: 'loading__segment' })));
  }

  setStage(index: number, label: string): void {
    this.stageText.textContent = label;
    this.countText.textContent = `Etapa ${Math.min(index + 1, this.total)} de ${this.total}`;
    [...this.segments.children].forEach((seg, i) => {
      seg.classList.toggle('is-done', i < index);
      seg.classList.toggle('is-active', i === index);
    });
  }

  markAllDone(label: string): void {
    this.stageText.textContent = label;
    this.countText.textContent = `${this.total} de ${this.total}`;
    for (const seg of this.segments.children) {
      seg.classList.add('is-done');
      seg.classList.remove('is-active');
    }
    this.root.setAttribute('aria-busy', 'false');
  }

  setSoundState(state: 'locked' | 'on' | 'off' | 'unavailable'): void {
    this.soundBtn.hidden = state === 'unavailable';
    const label = this.soundBtn.querySelector('span');
    if (label) label.textContent = state === 'on' ? 'Som ativado' : state === 'off' ? 'Som desativado' : 'Ativar som';
    this.soundBtn.disabled = state === 'on';
    this.soundBtn.querySelector('svg')?.replaceWith(icon(state === 'on' || state === 'locked' ? 'soundOn' : 'soundOff', 18));
    this.hint.hidden = state === 'on' || state === 'unavailable';
  }

  showError(title: string, message: string, allowFallback: boolean): void {
    this.errorBox.hidden = false;
    this.errorBox.replaceChildren(h('strong', {}, title), h('span', {}, message));
    const retry = button('Tentar novamente', () => this.handlers.onRetry(), { icon: 'refresh', variant: 'primary' });
    if (allowFallback) this.actions.replaceChildren(retry, button('Continuar sem 3D', () => this.handlers.onFallback()), this.soundBtn);
    else this.actions.replaceChildren(retry, this.soundBtn);
    this.root.setAttribute('aria-busy', 'false');
    (this.actions.querySelector('button') as HTMLButtonElement | null)?.focus();
  }

  /** Shown when loading takes much longer than expected; loading keeps going in the background. */
  showSlowNotice(): void {
    if (!this.errorBox.hidden) return;
    this.errorBox.hidden = false;
    this.errorBox.replaceChildren(
      h('strong', {}, 'Ainda carregando'),
      h('span', {}, 'O carregamento está demorando mais que o normal neste dispositivo. Você pode continuar esperando ou abrir o menu em modo simplificado, sem o cenário 3D.'),
    );
    if (!this.actions.querySelector('[data-fallback]')) {
      const b = button('Continuar sem 3D', () => this.handlers.onFallback());
      b.dataset.fallback = 'true';
      this.actions.prepend(b);
    }
  }

  resetError(): void {
    this.errorBox.hidden = true;
    this.errorBox.replaceChildren();
    this.actions.replaceChildren(this.soundBtn);
    this.root.setAttribute('aria-busy', 'true');
  }

  finish(): void {
    this.root.classList.add('is-done');
    window.setTimeout(() => this.root.remove(), 1600);
  }
}
