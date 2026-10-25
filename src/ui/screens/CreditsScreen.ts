/** CRÉDITOS — exactly the identity supplied by the creator (no invented collaborators). */
import { h } from '../../core/dom';
import { CREDITS } from '../../features/credits';
import { button } from '../components/controls';
import { Screen } from '../ScreenManager';

export class CreditsScreen extends Screen {
  readonly id = 'credits';
  readonly root: HTMLElement;
  override shot = 'credits' as const;
  override overlay = true;
  private readonly backBtn: HTMLButtonElement;

  constructor() {
    super();
    this.backBtn = button('Voltar', () => this.manager.back(), { icon: 'back', variant: 'primary' });
    const list = h('div', { class: 'credits__list' });
    CREDITS.forEach((c, i) => {
      const name = c.href
        ? h('a', { href: c.href, target: '_blank', rel: 'noopener noreferrer', 'aria-label': `${c.name} no Instagram (abre em nova aba)` }, c.name)
        : c.name;
      const entry = h('div', { class: 'credits__entry' }, h('p', { class: 'credits__role' }, c.role), h('p', { class: 'credits__name' }, name));
      entry.style.animationDelay = `${0.4 + i * 0.35}s`;
      list.append(entry);
    });
    this.root = h(
      'section',
      { class: 'credits', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'credits-title' },
      h('h2', { class: 'credits__title', id: 'credits-title' }, 'LINHA MORTA'),
      h('p', { class: 'credits__tagline' }, 'O mundo não esquece você.'),
      list,
      this.backBtn,
    );
  }

  override initialFocus(): HTMLElement | null {
    return this.backBtn;
  }
}
