/**
 * DOAR — voluntary PIX support. Shows the real key, copies it with the Clipboard API (with a
 * manual fallback), and never simulates or confirms payments.
 */
import { copyText, selectElementText } from '../../core/clipboard';
import { h } from '../../core/dom';
import { DONATION_MESSAGE, DONATION_STEPS, DONATION_TITLE, PIX_KEY, PIX_KEY_TYPE } from '../../features/donation/pix';
import { button, iconButton } from '../components/controls';
import { Screen } from '../ScreenManager';

export class DonateScreen extends Screen {
  readonly id = 'donate';
  readonly root: HTMLElement;
  override shot = 'focus' as const;
  override overlay = true;
  private readonly status: HTMLElement;
  private readonly keyEl: HTMLElement;
  private readonly copyBtn: HTMLButtonElement;

  constructor(private readonly onResult: (ok: boolean) => void) {
    super();
    this.status = h('p', { class: 'status', role: 'status', 'aria-live': 'polite' });
    this.keyEl = h('code', { class: 'pix__key', id: 'pix-key', tabindex: '0', 'aria-label': `Chave PIX: ${PIX_KEY}` }, PIX_KEY);
    this.keyEl.addEventListener('focus', () => selectElementText(this.keyEl));
    this.copyBtn = button('Copiar chave PIX', () => void this.copy(), { icon: 'copy', variant: 'primary' });
    const steps = h('ol', { class: 'steps' }, ...DONATION_STEPS.map((s) => h('li', {}, s)));
    this.root = h(
      'div',
      { class: 'overlay', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'donate-title', 'aria-describedby': 'donate-desc' },
      h(
        'div',
        { class: 'panel' },
        h('header', { class: 'panel__header' }, h('h2', { class: 'panel__title', id: 'donate-title' }, DONATION_TITLE), iconButton('close', 'Fechar', () => this.manager.back())),
        h(
          'div',
          { class: 'panel__body' },
          h('p', { class: 'lead', id: 'donate-desc' }, DONATION_MESSAGE),
          h(
            'div',
            { class: 'pix' },
            h('div', { class: 'pix__label' }, h('label', { for: 'pix-key' }, 'Chave PIX'), h('span', {}, PIX_KEY_TYPE)),
            this.keyEl,
            h('div', { class: 'pix__actions' }, this.copyBtn),
            this.status,
          ),
          h('h3', { class: 'field__label' }, 'Como doar'),
          steps,
          h('p', { class: 'muted' }, 'A doação é opcional e não muda nada no jogo. LINHA MORTA nunca pede seus dados bancários e não confirma pagamentos: a transferência acontece somente no aplicativo do seu banco.'),
        ),
        h('footer', { class: 'panel__footer' }, button('Fechar', () => this.manager.back())),
      ),
    );
    this.root.addEventListener('click', (event) => {
      if (event.target === this.root) this.manager.back();
    });
  }

  protected override onShow(): void {
    this.setStatus('', '');
  }

  private setStatus(text: string, kind: '' | 'ok' | 'error'): void {
    this.status.textContent = text;
    this.status.className = `status${kind ? ` status--${kind}` : ''}`;
  }

  private async copy(): Promise<void> {
    this.copyBtn.disabled = true;
    const result = await copyText(PIX_KEY);
    this.copyBtn.disabled = false;
    if (result.ok) {
      this.setStatus('Chave PIX copiada. Cole no aplicativo do seu banco e confira os dados do destinatário.', 'ok');
      this.onResult(true);
      return;
    }
    selectElementText(this.keyEl);
    this.keyEl.focus();
    const reason = result.reason === 'denied' ? 'O navegador não permitiu acessar a área de transferência.' : 'Não foi possível copiar automaticamente.';
    this.setStatus(`${reason} A chave foi selecionada: use Ctrl+C (ou toque e segure e escolha "Copiar").`, 'error');
    this.onResult(false);
  }

  override initialFocus(): HTMLElement | null {
    return this.copyBtn;
  }
}
