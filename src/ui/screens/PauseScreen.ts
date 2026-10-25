/** In-game pause menu (prologue). */
import { h } from '../../core/dom';
import { Screen } from '../ScreenManager';

export interface PauseActions {
  resume: () => void;
  settings: () => void;
  quit: () => void;
}

export class PauseScreen extends Screen {
  readonly id = 'pause';
  readonly root: HTMLElement;
  override overlay = true;
  private readonly resumeBtn: HTMLButtonElement;
  private readonly info = h('p', { class: 'muted', style: 'margin-top:1.2rem' });

  constructor(private readonly actions: PauseActions) {
    super();
    const item = (label: string, onClick: () => void): HTMLButtonElement => {
      const b = h('button', { type: 'button', class: 'menu__item' }, h('span', { class: 'menu__label' }, label)) as HTMLButtonElement;
      b.addEventListener('click', onClick);
      return b;
    };
    this.resumeBtn = item('Continuar', actions.resume);
    this.root = h(
      'div',
      { class: 'overlay overlay--side', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'pause-title', 'data-arrow-nav': 'true' },
      h(
        'div',
        { style: 'padding:24px clamp(24px,7vw,120px)' },
        h('h2', { class: 'menu__title', id: 'pause-title', style: 'font-size:clamp(2rem,5vw,3.4rem)' }, 'PAUSA'),
        h('ul', { class: 'menu__list', role: 'list', style: 'margin-top:1.6rem' }, h('li', {}, this.resumeBtn), h('li', {}, item('Configurações', actions.settings)), h('li', {}, item('Salvar e voltar ao menu', actions.quit))),
        this.info,
      ),
    );
  }

  setInfo(text: string): void {
    this.info.textContent = text;
  }

  override onBack(): boolean {
    this.actions.resume();
    return true;
  }

  override initialFocus(): HTMLElement | null {
    return this.resumeBtn;
  }
}
