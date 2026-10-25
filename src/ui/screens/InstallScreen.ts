/** Installation help for browsers without a programmatic install prompt (e.g. iOS Safari). */
import { h } from '../../core/dom';
import type { InstallPlatform } from '../../features/pwa/install';
import { button, iconButton } from '../components/controls';
import { Screen } from '../ScreenManager';

export class InstallScreen extends Screen {
  readonly id = 'install';
  readonly root: HTMLElement;
  override overlay = true;
  private readonly status = h('p', { class: 'status', role: 'status' });
  private readonly promptBtn: HTMLButtonElement;

  constructor(platform: InstallPlatform, private readonly prompt: () => Promise<'accepted' | 'dismissed' | 'unavailable'>, private readonly canPrompt: () => boolean) {
    super();
    const steps = (items: string[]): HTMLElement => h('ol', { class: 'steps' }, ...items.map((s) => h('li', {}, s)));
    this.promptBtn = button('Instalar agora', () => void this.runPrompt(), { icon: 'install', variant: 'primary' });
    const ordered: [InstallPlatform, HTMLElement][] = [
      [
        'ios',
        h(
          'div',
          {},
          h('h3', { class: 'field__label' }, 'iPhone e iPad (Safari)'),
          steps(['Abra o jogo no Safari.', 'Toque no botão Compartilhar (quadrado com seta para cima).', 'Escolha "Adicionar à Tela de Início".', 'Confirme em "Adicionar".']),
        ),
      ],
      [
        'android',
        h(
          'div',
          {},
          h('h3', { class: 'field__label' }, 'Android (Chrome, Edge, Samsung Internet)'),
          steps(['Abra o menu do navegador (⋮).', 'Toque em "Instalar app" ou "Adicionar à tela inicial".', 'Confirme a instalação.']),
        ),
      ],
      [
        'desktop',
        h(
          'div',
          {},
          h('h3', { class: 'field__label' }, 'Computador (Chrome ou Edge)'),
          steps(['Clique no ícone de instalação na barra de endereço (monitor com seta) ou abra o menu do navegador.', 'Escolha "Instalar LINHA MORTA".']),
        ),
      ],
    ];
    ordered.sort(([a], [b]) => (a === platform ? -1 : b === platform ? 1 : 0));
    this.root = h(
      'div',
      { class: 'overlay', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'install-title' },
      h(
        'div',
        { class: 'panel' },
        h('header', { class: 'panel__header' }, h('h2', { class: 'panel__title', id: 'install-title' }, 'Instalar o jogo'), iconButton('close', 'Fechar', () => this.manager.back())),
        h(
          'div',
          { class: 'panel__body' },
          h('p', { class: 'lead' }, 'LINHA MORTA pode ser instalado como aplicativo web (PWA): abre em tela própria, com ícone, e inicia mais rápido.'),
          this.promptBtn,
          this.status,
          ...ordered.map(([, el]) => el),
          h(
            'p',
            { class: 'muted' },
            'Importante: instalar como PWA é diferente de baixar um APK Android ou um aplicativo da loja. Não existe APK oficial do jogo; o PWA usa o próprio navegador do aparelho.',
          ),
        ),
        h('footer', { class: 'panel__footer' }, button('Fechar', () => this.manager.back())),
      ),
    );
  }

  protected override onShow(): void {
    this.promptBtn.hidden = !this.canPrompt();
    this.status.textContent = '';
  }

  private async runPrompt(): Promise<void> {
    const outcome = await this.prompt();
    this.promptBtn.hidden = !this.canPrompt();
    this.status.className = 'status';
    this.status.textContent =
      outcome === 'accepted'
        ? 'Instalação aceita. O navegador está concluindo a instalação.'
        : outcome === 'dismissed'
          ? 'Instalação cancelada. Você pode instalar depois quando quiser.'
          : 'O navegador não ofereceu instalação automática agora. Siga as instruções abaixo.';
  }
}
