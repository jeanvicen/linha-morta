/**
 * ENVIAR UMA IDEIA — suggestion form. Delivery is only reported as successful when /api/ideas
 * confirms the configured destination accepted it. Without a destination, the player gets an
 * honest message plus copy / native share and the creator's Instagram.
 */
import { copyText } from '../../core/clipboard';
import { h, icon } from '../../core/dom';
import {
  IDEA_CATEGORIES,
  IDEA_LIMITS,
  INSTAGRAM_HANDLE,
  INSTAGRAM_URL,
  fetchIdeasStatus,
  formatIdeaText,
  submitIdea,
  validateIdea,
  type IdeaDraft,
  type IdeaErrors,
} from '../../features/ideas/ideas';
import { button, iconButton, nextId } from '../components/controls';
import { Screen } from '../ScreenManager';

type FieldEl = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

export class IdeasScreen extends Screen {
  readonly id = 'ideas';
  readonly root: HTMLElement;
  override shot = 'focus' as const;
  override overlay = true;
  private readonly form: HTMLFormElement;
  private readonly fields: Record<keyof IdeaDraft, FieldEl>;
  private readonly errors: Record<keyof IdeaDraft, HTMLElement>;
  private readonly availability: HTMLElement;
  private readonly status: HTMLElement;
  private readonly sendBtn: HTMLButtonElement;
  private readonly shareBtn: HTMLButtonElement;
  private readonly honeypot: HTMLInputElement;
  private openedAt = 0;
  private sending = false;
  private delivery: 'configured' | 'not_configured' | 'unknown' = 'unknown';

  constructor(private readonly sound: (kind: 'success' | 'error') => void) {
    super();
    const field = <T extends FieldEl>(key: keyof IdeaDraft, label: string, control: T, max?: number, hint?: string): HTMLElement => {
      const id = nextId(`idea-${key}`);
      const errId = `${id}-error`;
      control.id = id;
      control.setAttribute('aria-describedby', errId);
      const count = max ? h('span', { class: 'field__count', 'aria-hidden': 'true' }, `0/${max}`) : null;
      if (max && count) {
        control.addEventListener('input', () => {
          count.textContent = `${control.value.length}/${max}`;
        });
      }
      const err = h('span', { class: 'field__error', id: errId });
      this.errors[key] = err;
      this.fields[key] = control;
      control.addEventListener('input', () => {
        if (control.getAttribute('aria-invalid') === 'true') {
          control.removeAttribute('aria-invalid');
          err.textContent = '';
        }
      });
      return h('div', { class: 'field' }, h('label', { class: 'field__label', for: id }, h('span', {}, label), count), control, hint ? h('span', { class: 'field__hint' }, hint) : null, err);
    };
    this.fields = {} as Record<keyof IdeaDraft, FieldEl>;
    this.errors = {} as Record<keyof IdeaDraft, HTMLElement>;

    const title = h('input', { class: 'input', type: 'text', maxlength: IDEA_LIMITS.title.max, autocomplete: 'off', required: true, placeholder: 'Ex.: Uma missão no posto abandonado' }) as HTMLInputElement;
    const category = h('select', { class: 'select', required: true }, h('option', { value: '' }, 'Escolha uma categoria'), ...IDEA_CATEGORIES.map((c) => h('option', { value: c.id }, c.label))) as HTMLSelectElement;
    const description = h('textarea', { class: 'textarea', maxlength: IDEA_LIMITS.description.max, required: true, placeholder: 'Descreva sua ideia: o que acontece, onde, por que seria interessante…' }) as HTMLTextAreaElement;
    const author = h('input', { class: 'input', type: 'text', maxlength: IDEA_LIMITS.author.max, autocomplete: 'nickname', placeholder: 'Opcional' }) as HTMLInputElement;
    this.honeypot = h('input', { type: 'text', name: 'website', tabindex: '-1', autocomplete: 'off' }) as HTMLInputElement;

    this.availability = h('p', { class: 'status status--info', role: 'note' }, 'Verificando se o envio automático está disponível…');
    this.status = h('p', { class: 'status', role: 'status', 'aria-live': 'polite' });
    this.sendBtn = button('Enviar ideia', () => undefined, { variant: 'primary', type: 'submit' });
    this.shareBtn = button('Compartilhar', () => void this.share(), { icon: 'share' });
    this.shareBtn.hidden = typeof navigator.share !== 'function';

    this.form = h(
      'form',
      { class: 'panel__body', novalidate: true },
      h('p', { class: 'lead' }, 'Sugira melhorias, missões, mecânicas, histórias ou até outros jogos. Não é preciso criar conta.'),
      this.availability,
      field('title', 'Título da ideia', title, IDEA_LIMITS.title.max),
      field('category', 'Categoria', category),
      field('description', 'Descrição', description, IDEA_LIMITS.description.max),
      field('author', 'Seu nome ou @ (opcional)', author, IDEA_LIMITS.author.max, 'Só será enviado se você preencher, para o criador poder dar crédito.'),
      h('div', { class: 'honeypot', 'aria-hidden': 'true' }, h('label', {}, 'Não preencha este campo', this.honeypot)),
      this.status,
      h(
        'p',
        { class: 'muted' },
        'Também é possível falar direto com o criador no Instagram: ',
        h('a', { href: INSTAGRAM_URL, target: '_blank', rel: 'noopener noreferrer' }, INSTAGRAM_HANDLE),
        '.',
      ),
    ) as HTMLFormElement;
    this.form.addEventListener('submit', (event) => {
      event.preventDefault();
      void this.send();
    });

    const insta = h('a', { class: 'btn btn--ghost', href: INSTAGRAM_URL, target: '_blank', rel: 'noopener noreferrer' }, icon('instagram', 18), h('span', {}, INSTAGRAM_HANDLE));
    this.sendBtn.setAttribute('form', 'idea-form');
    this.form.id = 'idea-form';
    this.root = h(
      'div',
      { class: 'overlay', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'ideas-title' },
      h(
        'div',
        { class: 'panel' },
        h('header', { class: 'panel__header' }, h('h2', { class: 'panel__title', id: 'ideas-title' }, 'Enviar uma ideia'), iconButton('close', 'Fechar', () => this.manager.back())),
        this.form,
        h('footer', { class: 'panel__footer' }, insta, button('Copiar ideia', () => void this.copy(), { icon: 'copy' }), this.shareBtn, this.sendBtn),
      ),
    );
    this.root.addEventListener('click', (event) => {
      if (event.target === this.root) this.manager.back();
    });
  }

  protected override onShow(): void {
    this.openedAt = performance.now();
    this.setStatus('', '');
    void fetchIdeasStatus().then((s) => this.setDelivery(s));
  }

  private setDelivery(state: 'configured' | 'not_configured' | 'unknown'): void {
    this.delivery = state;
    if (state === 'configured') {
      this.availability.hidden = true;
      this.sendBtn.hidden = false;
    } else if (state === 'not_configured') {
      this.availability.hidden = false;
      this.availability.textContent = `O envio automático de ideias ainda não está disponível. Você pode copiar a ideia completa ou compartilhá-la e mandar para o criador pelo Instagram ${INSTAGRAM_HANDLE}. Copiar ou compartilhar não envia a ideia automaticamente.`;
      this.sendBtn.hidden = true;
    } else {
      this.availability.hidden = false;
      this.availability.textContent = 'Não foi possível verificar o servidor agora. Você ainda pode tentar enviar, copiar ou compartilhar a ideia.';
      this.sendBtn.hidden = false;
    }
  }

  private draft(): IdeaDraft {
    return {
      title: this.fields.title.value,
      category: this.fields.category.value as IdeaDraft['category'],
      description: this.fields.description.value,
      author: this.fields.author.value,
    };
  }

  private showErrors(errors: IdeaErrors): boolean {
    let first: FieldEl | null = null;
    for (const key of Object.keys(this.fields) as (keyof IdeaDraft)[]) {
      const msg = errors[key];
      this.errors[key].textContent = msg ?? '';
      if (msg) {
        this.fields[key].setAttribute('aria-invalid', 'true');
        first ??= this.fields[key];
      } else this.fields[key].removeAttribute('aria-invalid');
    }
    first?.focus();
    return first === null;
  }

  private setStatus(text: string, kind: '' | 'ok' | 'error'): void {
    this.status.textContent = text;
    this.status.className = `status${kind ? ` status--${kind}` : ''}`;
  }

  private async send(): Promise<void> {
    if (this.sending) return;
    const draft = this.draft();
    if (!this.showErrors(validateIdea(draft))) {
      this.sound('error');
      return;
    }
    this.sending = true;
    this.sendBtn.disabled = true;
    const label = this.sendBtn.querySelector('span');
    if (label) label.textContent = 'Enviando…';
    this.form.setAttribute('aria-busy', 'true');
    this.setStatus('Enviando sua ideia…', '');
    const result = await submitIdea(draft, { website: this.honeypot.value, elapsedMs: performance.now() - this.openedAt });
    this.sending = false;
    this.sendBtn.disabled = false;
    if (label) label.textContent = 'Enviar ideia';
    this.form.removeAttribute('aria-busy');
    switch (result.status) {
      case 'sent':
        this.setStatus('Ideia enviada ao criador. Obrigado por contribuir com LINHA MORTA!', 'ok');
        this.sound('success');
        this.form.reset();
        this.form.querySelectorAll('.field__count').forEach((c) => (c.textContent = c.textContent?.replace(/^\d+/, '0') ?? ''));
        break;
      case 'not_configured':
        this.setDelivery('not_configured');
        this.setStatus('A ideia NÃO foi enviada: o envio automático ainda não está configurado. Copie ou compartilhe o texto para mandar ao criador.', 'error');
        this.sound('error');
        break;
      default:
        this.setStatus(`A ideia não foi enviada. ${result.message}`, 'error');
        this.sound('error');
    }
  }

  private async copy(): Promise<void> {
    const draft = this.draft();
    if (!this.showErrors(validateIdea(draft))) return;
    const result = await copyText(formatIdeaText(draft));
    if (result.ok) this.setStatus(`Ideia copiada. Cole em uma mensagem para ${INSTAGRAM_HANDLE} no Instagram — copiar não envia automaticamente.`, 'ok');
    else this.setStatus('Não foi possível copiar automaticamente. Selecione o texto da descrição e copie manualmente.', 'error');
  }

  private async share(): Promise<void> {
    const draft = this.draft();
    if (!this.showErrors(validateIdea(draft))) return;
    try {
      await navigator.share({ title: `Ideia para LINHA MORTA: ${draft.title.trim()}`, text: formatIdeaText(draft) });
      this.setStatus(`Compartilhamento aberto. Para o criador receber, envie para ${INSTAGRAM_HANDLE}.`, 'ok');
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      this.setStatus('O compartilhamento não está disponível agora. Use "Copiar ideia".', 'error');
    }
  }

  override initialFocus(): HTMLElement | null {
    return this.fields.title;
  }

  /** Exposed for tests/diagnostics. */
  get deliveryState(): string {
    return this.delivery;
  }
}
