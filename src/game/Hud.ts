/** In-game HUD: objective, interaction prompt, subtitles, notes, ending card. */
import { h, icon } from '../core/dom';
import { button } from '../ui/components/controls';

export interface SubtitleLine {
  text: string;
  speaker?: string;
  duration: number;
}

export class Hud {
  readonly root: HTMLElement;
  private readonly objective = h('div', { class: 'hud__objective', role: 'status', 'aria-live': 'polite' });
  private readonly prompt = h('div', { class: 'hud__prompt', hidden: true });
  private readonly subtitle = h('div', { class: 'hud__subtitle', hidden: true, 'aria-live': 'polite' });
  private readonly crosshair = h('div', { class: 'hud__crosshair', 'aria-hidden': 'true' });
  private readonly clickToPlay = h('button', { type: 'button', class: 'hud__click', hidden: true }, 'Clique para jogar');
  private readonly pauseBtn: HTMLButtonElement;
  private note: HTMLElement | null = null;
  private ending: HTMLElement | null = null;
  private queue: SubtitleLine[] = [];
  private subtitleTimer = 0;
  subtitlesEnabled = true;

  constructor(touch: HTMLElement | null, onPause: () => void, onClickToPlay: () => void) {
    this.pauseBtn = h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Pausar' }, icon('back', 20)) as HTMLButtonElement;
    this.pauseBtn.addEventListener('click', onPause);
    this.clickToPlay.addEventListener('click', onClickToPlay);
    this.root = h(
      'div',
      { class: 'hud', hidden: true },
      touch,
      this.objective,
      this.crosshair,
      this.prompt,
      this.subtitle,
      h('div', { class: 'hud__pause-hint' }, this.pauseBtn),
      this.clickToPlay,
    );
  }

  show(): void {
    this.root.hidden = false;
  }

  hide(): void {
    this.root.hidden = true;
    this.clearSubtitles();
    this.closeNote();
    this.ending?.remove();
    this.ending = null;
  }

  setObjective(title: string | null, text = ''): void {
    if (!title) {
      this.objective.hidden = true;
      return;
    }
    this.objective.hidden = false;
    this.objective.replaceChildren(h('small', {}, title), text);
  }

  setPrompt(key: string | null, text = ''): void {
    if (!key) {
      this.prompt.hidden = true;
      return;
    }
    this.prompt.hidden = false;
    this.prompt.replaceChildren(h('kbd', {}, key), text);
  }

  setCrosshair(visible: boolean): void {
    this.crosshair.hidden = !visible;
  }

  setClickToPlay(visible: boolean): void {
    this.clickToPlay.hidden = !visible;
  }

  say(lines: SubtitleLine[]): void {
    this.queue.push(...lines);
    if (this.subtitleTimer <= 0) this.nextSubtitle();
  }

  clearSubtitles(): void {
    this.queue = [];
    this.subtitleTimer = 0;
    this.subtitle.hidden = true;
  }

  get speaking(): boolean {
    return this.subtitleTimer > 0 || this.queue.length > 0;
  }

  private nextSubtitle(): void {
    const line = this.queue.shift();
    if (!line) {
      this.subtitle.hidden = true;
      this.subtitleTimer = 0;
      return;
    }
    this.subtitleTimer = line.duration;
    this.subtitle.hidden = !this.subtitlesEnabled;
    this.subtitle.replaceChildren(line.speaker ? h('em', {}, `${line.speaker}: `) : '', line.text);
  }

  update(dt: number): void {
    if (this.subtitleTimer > 0) {
      this.subtitleTimer -= dt;
      if (this.subtitleTimer <= 0) this.nextSubtitle();
    }
  }

  get noteOpen(): boolean {
    return this.note !== null;
  }

  showNote(paragraphs: string[], signature: string, onClose: () => void): void {
    this.closeNote();
    const close = button('Fechar', () => {
      this.closeNote();
      onClose();
    }, { variant: 'primary' });
    this.note = h(
      'div',
      { class: 'hud__note', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Bilhete' },
      h('div', { style: 'display:flex;flex-direction:column;align-items:center;gap:18px' }, h('div', { class: 'hud__paper' }, ...paragraphs.map((p) => h('p', {}, p)), h('p', {}, signature), h('small', {}, 'Papel úmido, escrito à caneta.')), close),
    );
    this.root.append(this.note);
    window.setTimeout(() => close.focus(), 50);
  }

  closeNote(): void {
    this.note?.remove();
    this.note = null;
  }

  showEnding(onMenu: () => void, onIdeas: () => void, onDonate: () => void): void {
    this.setObjective(null);
    this.setPrompt(null);
    this.setCrosshair(false);
    this.clearSubtitles();
    const menuBtn = button('Voltar ao menu', onMenu, { variant: 'primary' });
    this.ending = h(
      'section',
      { class: 'ending', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'ending-title' },
      h('p', { class: 'ending__line' }, 'O mundo não esquece você.'),
      h('h2', { class: 'chapter__title', id: 'ending-title', style: 'font-size:clamp(1.8rem,5vw,3rem)' }, 'FIM DO PRÓLOGO'),
      h('p', { class: 'chapter__note', style: 'margin-top:1rem' }, 'O Capítulo 1 de LINHA MORTA está em desenvolvimento. Obrigado por jogar até aqui.'),
      h('div', { class: 'chapter__actions' }, menuBtn, button('Enviar uma ideia', onIdeas), button('Apoiar o projeto', onDonate)),
    );
    this.root.append(this.ending);
    requestAnimationFrame(() => this.ending?.classList.add('is-visible'));
    window.setTimeout(() => menuBtn.focus(), 400);
  }
}
