/** Small confirmation dialog. */
import { h } from '../../core/dom';
import { button } from '../components/controls';
import { Screen } from '../ScreenManager';

export class ConfirmDialog extends Screen {
  readonly id = 'confirm';
  readonly root: HTMLElement;
  override overlay = true;
  private readonly title = h('h2', { class: 'panel__title', id: 'confirm-title' });
  private readonly message = h('p', { class: 'lead', id: 'confirm-desc' });
  private readonly actions = h('footer', { class: 'panel__footer' });
  private cancelBtn: HTMLButtonElement | null = null;

  constructor() {
    super();
    this.root = h(
      'div',
      { class: 'overlay', role: 'alertdialog', 'aria-modal': 'true', 'aria-labelledby': 'confirm-title', 'aria-describedby': 'confirm-desc' },
      h('div', { class: 'panel', style: 'width:min(480px,100%)' }, h('header', { class: 'panel__header' }, this.title), h('div', { class: 'panel__body' }, this.message), this.actions),
    );
  }

  ask(title: string, message: string, confirmLabel: string, onConfirm: () => void, cancelLabel = 'Cancelar'): void {
    this.title.textContent = title;
    this.message.textContent = message;
    this.cancelBtn = button(cancelLabel, () => this.manager.close(this));
    this.actions.replaceChildren(
      this.cancelBtn,
      button(confirmLabel, () => {
        this.manager.close(this);
        onConfirm();
      }, { variant: 'primary' }),
    );
    this.manager.open(this);
  }

  override initialFocus(): HTMLElement | null {
    return this.cancelBtn;
  }
}
