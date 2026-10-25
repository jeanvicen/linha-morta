/** Main menu over the live 3D scene. Every entry performs a real action. */
import { h, icon } from '../../core/dom';
import type { AudioState } from '../../audio/AudioManager';
import { Screen } from '../ScreenManager';

export interface MainMenuActions {
  newGame: () => void;
  continueGame: () => void;
  settings: () => void;
  donate: () => void;
  ideas: () => void;
  credits: () => void;
  toggleSound: () => void;
  install: () => void;
}

export class MainMenu extends Screen {
  readonly id = 'menu';
  readonly root: HTMLElement;
  override shot = 'menu' as const;
  private readonly continueBtn: HTMLButtonElement;
  private readonly continueNote: HTMLElement;
  private readonly soundChip: HTMLButtonElement;
  private readonly installChip: HTMLButtonElement;
  private readonly notice: HTMLElement;
  private readonly newGameBtn: HTMLButtonElement;

  constructor(actions: MainMenuActions, version: string) {
    super();
    const item = (label: string, onClick: () => void, note?: HTMLElement): HTMLButtonElement => {
      const b = h('button', { type: 'button', class: 'menu__item' }, h('span', { class: 'menu__label' }, label), note ?? null);
      b.addEventListener('click', () => {
        if (b.disabled || b.getAttribute('aria-disabled') === 'true') return;
        onClick();
      });
      return b;
    };
    this.continueNote = h('span', { class: 'menu__note', id: 'continue-note' });
    this.newGameBtn = item('Novo jogo', actions.newGame);
    this.continueBtn = item('Continuar', actions.continueGame, this.continueNote);
    this.continueBtn.setAttribute('aria-describedby', 'continue-note');

    this.soundChip = h('button', { type: 'button', class: 'chip', 'aria-pressed': 'false', 'data-sound-toggle': 'true' }) as HTMLButtonElement;
    this.soundChip.addEventListener('click', () => actions.toggleSound());
    this.installChip = h('button', { type: 'button', class: 'chip', hidden: true }, icon('install', 18), h('span', {}, 'Instalar')) as HTMLButtonElement;
    this.installChip.addEventListener('click', () => actions.install());
    this.notice = h('p', { class: 'menu__notice', hidden: true, role: 'note' });

    this.root = h(
      'nav',
      { class: 'menu', 'aria-label': 'Menu principal', 'data-arrow-nav': 'true' },
      h(
        'header',
        { class: 'menu__brand' },
        h('h1', { class: 'menu__title' }, 'LINHA MORTA'),
        h('p', { class: 'menu__tagline' }, 'O mundo não esquece você.'),
      ),
      h(
        'div',
        {},
        h(
          'ul',
          { class: 'menu__list', role: 'list' },
          h('li', {}, this.newGameBtn),
          h('li', {}, this.continueBtn),
          h('li', {}, item('Configurações', actions.settings)),
          h('li', {}, item('Doar', actions.donate)),
          h('li', {}, item('Enviar uma ideia', actions.ideas)),
          h('li', {}, item('Créditos', actions.credits)),
        ),
        this.notice,
      ),
      h('footer', { class: 'menu__footer' }, this.soundChip, this.installChip, h('span', { class: 'menu__version' }, `Versão ${version}`)),
    );
  }

  /** Enables "Continuar" only when a valid save exists. */
  setContinue(available: boolean, description: string | null): void {
    this.continueBtn.disabled = !available;
    this.continueBtn.setAttribute('aria-disabled', String(!available));
    this.continueNote.textContent = description ?? (available ? '' : 'Nenhum jogo salvo ainda');
  }

  setSound(state: AudioState): void {
    const on = state === 'on';
    const label = state === 'unavailable' ? 'Som indisponível' : state === 'off' ? 'Som desligado' : state === 'locked' ? 'Toque para ativar o som' : 'Som ligado';
    this.soundChip.replaceChildren(icon(on || state === 'locked' ? 'soundOn' : 'soundOff', 18), h('span', {}, label));
    this.soundChip.setAttribute('aria-pressed', String(on));
    this.soundChip.setAttribute('aria-label', on ? 'Som ligado. Desligar som' : state === 'locked' ? 'Ativar som' : 'Som desligado. Ligar som');
    this.soundChip.classList.toggle('is-attention', state === 'locked');
    this.soundChip.disabled = state === 'unavailable';
  }

  setInstallVisible(visible: boolean): void {
    this.installChip.hidden = !visible;
  }

  setNotice(text: string | null): void {
    this.notice.hidden = !text;
    this.notice.textContent = text ?? '';
  }

  override initialFocus(): HTMLElement | null {
    return this.newGameBtn;
  }
}
