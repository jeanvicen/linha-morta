/**
 * Prologue title card shown after "Novo jogo"/"Continuar". It states clearly what is playable now
 * (a short prologue) and that Chapter 1 is still in development.
 */
import { h } from '../../core/dom';
import { button } from '../components/controls';
import { Screen } from '../ScreenManager';

export interface ChapterOptions {
  canPlay: boolean;
  touch: boolean;
  resume: string | null;
  onStart: () => void;
  onBack: () => void;
}

export class ChapterScreen extends Screen {
  readonly id = 'chapter';
  readonly root: HTMLElement;
  override shot = 'newgame' as const;
  override overlay = true;
  private readonly body: HTMLElement;
  private startBtn: HTMLButtonElement | null = null;

  constructor() {
    super();
    this.body = h('div', { class: 'chapter__inner' });
    this.root = h('section', { class: 'chapter', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'chapter-title' }, this.body);
  }

  configure(opts: ChapterOptions): void {
    const kbd = (k: string): HTMLElement => h('kbd', {}, k);
    const controls = opts.touch
      ? h(
          'div',
          { class: 'chapter__controls', 'aria-label': 'Controles' },
          h('span', {}, 'Círculo à esquerda: andar'),
          h('span', {}, 'Arrastar à direita: olhar'),
          h('span', {}, 'Botão USAR: interagir'),
          h('span', {}, 'Botão LUZ: lanterna'),
        )
      : h(
          'div',
          { class: 'chapter__controls', 'aria-label': 'Controles' },
          h('span', {}, kbd('W'), kbd('A'), kbd('S'), kbd('D'), ' andar'),
          h('span', {}, kbd('Shift'), ' correr'),
          h('span', {}, kbd('E'), ' interagir'),
          h('span', {}, kbd('F'), ' lanterna'),
          h('span', {}, 'Mouse: olhar'),
          h('span', {}, kbd('Esc'), ' pausar'),
        );
    this.startBtn = opts.canPlay ? button(opts.resume ? 'Continuar prólogo' : 'Começar', opts.onStart, { variant: 'primary' }) : null;
    this.body.replaceChildren(
      h('p', { class: 'chapter__kicker' }, 'PRÓLOGO'),
      h('h2', { class: 'chapter__title', id: 'chapter-title' }, 'A ESTRADA'),
      h('p', { class: 'chapter__meta' }, opts.resume ?? 'Rodovia sem nome · km 113 · 23h47 · noite do apagão'),
      h(
        'p',
        { class: 'chapter__text' },
        'A energia acabou em todo lugar ao mesmo tempo. Você acorda no asfalto molhado, ao lado do carro. O pisca-alerta ainda funciona. O resto do mundo, não.',
      ),
      opts.canPlay ? controls : h('p', { class: 'status status--info' }, 'O prólogo jogável precisa de gráficos 3D (WebGL 2), que não estão disponíveis neste navegador ou dispositivo.'),
      h('p', { class: 'chapter__note' }, 'Este prólogo curto é a primeira parte jogável de LINHA MORTA. O Capítulo 1 e os sistemas de sobrevivência estão em desenvolvimento.'),
      h('div', { class: 'chapter__actions' }, this.startBtn, button('Voltar ao menu', opts.onBack, { icon: 'back' })),
    );
  }

  override onBack(): boolean {
    return false;
  }

  override initialFocus(): HTMLElement | null {
    return this.startBtn ?? (this.body.querySelector('button') as HTMLElement | null);
  }
}
