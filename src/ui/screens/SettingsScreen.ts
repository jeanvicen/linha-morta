/**
 * CONFIGURAÇÕES: graphics, audio, display, accessibility and controls. Every control changes real
 * behaviour and is persisted locally by the SettingsStore.
 */
import { h } from '../../core/dom';
import type { DeviceProfile } from '../../core/device';
import {
  LIMITS,
  applyPreset,
  withGraphicsDetail,
  type FpsLimit,
  type PostProcessing,
  type QualityLevel,
  type QualityPreset,
  type ReducedMotion,
  type ReflectionQuality,
  type Settings,
  type ShadowQuality,
} from '../../features/settings/settings';
import type { SettingsStore } from '../../features/settings/SettingsStore';
import { button, iconButton, segmented, settingRow, slider, toggle, type Control } from '../components/controls';
import { Screen } from '../ScreenManager';

type TabId = 'graphics' | 'audio' | 'display' | 'accessibility' | 'controls';

const LEVEL_LABEL: Record<QualityLevel, string> = { low: 'Baixa', medium: 'Média', high: 'Alta', ultra: 'Ultra' };
const pct = (v: number): string => `${Math.round(v * 100)}%`;

export interface SettingsContext {
  store: SettingsStore;
  device: DeviceProfile;
  webgl: boolean;
  isFullscreen: () => boolean;
  toggleFullscreen: () => Promise<boolean>;
}

export class SettingsScreen extends Screen {
  readonly id = 'settings';
  readonly root: HTMLElement;
  override shot = 'settings' as const;
  override overlay = true;
  private readonly tabs = new Map<TabId, { tab: HTMLButtonElement; panel: HTMLElement }>();
  private readonly sync: ((s: Settings) => void)[] = [];
  private active: TabId = 'graphics';
  private readonly autoInfo = h('span', { class: 'setting__desc' });
  private readonly fsStatus = h('p', { class: 'status', role: 'status' });
  private fsToggle!: Control<boolean>;

  constructor(private readonly ctx: SettingsContext) {
    super();
    const tabList = h('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Categorias de configuração' });
    const body = h('div', { class: 'panel__body' });
    const add = (id: TabId, label: string, panel: HTMLElement): void => {
      const tab = h('button', { type: 'button', class: 'tab', role: 'tab', id: `tab-${id}`, 'aria-controls': `panel-${id}`, 'aria-selected': 'false', tabindex: '-1' }, label) as HTMLButtonElement;
      tab.addEventListener('click', () => this.select(id));
      tab.addEventListener('keydown', (event) => {
        const order: TabId[] = ['graphics', 'audio', 'display', 'accessibility', 'controls'];
        const i = order.indexOf(id);
        if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
          event.preventDefault();
          const next = order[(i + (event.key === 'ArrowRight' ? 1 : -1) + order.length) % order.length]!;
          this.select(next);
          this.tabs.get(next)?.tab.focus();
        }
      });
      panel.id = `panel-${id}`;
      panel.setAttribute('role', 'tabpanel');
      panel.setAttribute('aria-labelledby', `tab-${id}`);
      panel.hidden = true;
      tabList.append(tab);
      body.append(panel);
      this.tabs.set(id, { tab, panel });
    };
    add('graphics', 'Gráficos', this.graphicsPanel());
    add('audio', 'Áudio', this.audioPanel());
    add('display', 'Tela', this.displayPanel());
    add('accessibility', 'Acessibilidade', this.accessibilityPanel());
    add('controls', 'Controles', this.controlsPanel());

    const persistNote = ctx.store.persistent
      ? 'As configurações são salvas neste dispositivo.'
      : 'O armazenamento local está bloqueado: as configurações valem apenas nesta sessão.';

    this.root = h(
      'div',
      { class: 'overlay overlay--side', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'settings-title' },
      h(
        'div',
        { class: 'panel' },
        h('header', { class: 'panel__header' }, h('h2', { class: 'panel__title', id: 'settings-title' }, 'Configurações'), iconButton('close', 'Fechar configurações', () => this.manager.back())),
        tabList,
        body,
        h(
          'footer',
          { class: 'panel__footer panel__footer--split' },
          h('span', { class: 'muted' }, persistNote),
          h(
            'div',
            { style: 'display:flex;gap:10px;flex-wrap:wrap' },
            button('Restaurar padrões', () => this.ctx.store.reset(), { variant: 'ghost', small: true }),
            button('Voltar', () => this.manager.back(), { variant: 'primary', icon: 'back' }),
          ),
        ),
      ),
    );
    this.root.addEventListener('click', (event) => {
      if (event.target === this.root) this.manager.back();
    });
    ctx.store.on('change', ({ settings }) => this.refresh(settings));
    this.select('graphics');
    this.refresh(ctx.store.value);
  }

  private select(id: TabId): void {
    this.active = id;
    for (const [key, { tab, panel }] of this.tabs) {
      const on = key === id;
      tab.setAttribute('aria-selected', String(on));
      tab.tabIndex = on ? 0 : -1;
      panel.hidden = !on;
    }
  }

  override initialFocus(): HTMLElement | null {
    return this.tabs.get(this.active)?.tab ?? null;
  }

  private refresh(s: Settings): void {
    for (const fn of this.sync) fn(s);
    const level = this.ctx.store.resolvedAutoLevel;
    this.autoInfo.textContent =
      s.graphics.preset === 'auto'
        ? `Automático: qualidade ${LEVEL_LABEL[level]} escolhida para este dispositivo (ajusta-se se o desempenho cair).`
        : s.graphics.preset === 'custom'
          ? 'Personalizado: você alterou opções individuais.'
          : `Predefinição ${LEVEL_LABEL[s.graphics.preset as QualityLevel]}.`;
    document.documentElement.style.setProperty('--text-scale', String(s.accessibility.textScale));
  }

  private bind<T>(control: Control<T>, read: (s: Settings) => T): Control<T> {
    this.sync.push((s) => control.set(read(s)));
    return control;
  }

  private update(mutator: (s: Settings) => void): void {
    this.ctx.store.update((draft) => {
      mutator(draft);
      return draft;
    });
  }

  private graphicsPanel(): HTMLElement {
    const store = this.ctx.store;
    const presetOptions: { value: QualityPreset; label: string }[] = [
      { value: 'auto', label: 'Automática' },
      { value: 'low', label: 'Baixa' },
      { value: 'medium', label: 'Média' },
      { value: 'high', label: 'Alta' },
      { value: 'ultra', label: 'Ultra' },
      { value: 'custom', label: 'Personalizada' },
    ];
    const preset = this.bind(
      segmented('Qualidade gráfica', presetOptions, store.value.graphics.preset, (v) =>
        this.update((s) => {
          s.graphics = applyPreset(s.graphics, v, store.resolvedAutoLevel);
        }),
      ),
      (s) => s.graphics.preset,
    );
    const detail = <K extends 'particles' | 'density'>(key: K, label: string): Control<QualityLevel> =>
      this.bind(
        segmented(
          label,
          (['low', 'medium', 'high', 'ultra'] as QualityLevel[]).map((v) => ({ value: v, label: LEVEL_LABEL[v] })),
          store.graphics[key],
          (v) => this.update((s) => (s.graphics = withGraphicsDetail({ ...store.graphics, preset: s.graphics.preset }, key, v))),
        ),
        () => store.graphics[key],
      );
    const resolution = this.bind(
      slider('Resolução de renderização', LIMITS.resolutionScale.min, LIMITS.resolutionScale.max, 0.05, store.graphics.resolutionScale, pct, (v) =>
        this.update((s) => (s.graphics = withGraphicsDetail({ ...store.graphics, preset: s.graphics.preset }, 'resolutionScale', v))),
      ),
      () => store.graphics.resolutionScale,
    );
    const shadows = this.bind(
      segmented<ShadowQuality>(
        'Qualidade das sombras',
        [
          { value: 'off', label: 'Desligadas' },
          { value: 'low', label: 'Baixa' },
          { value: 'high', label: 'Alta' },
          { value: 'ultra', label: 'Ultra' },
        ],
        store.graphics.shadows,
        (v) => this.update((s) => (s.graphics = withGraphicsDetail({ ...store.graphics, preset: s.graphics.preset }, 'shadows', v))),
      ),
      () => store.graphics.shadows,
    );
    const post = this.bind(
      segmented<PostProcessing>(
        'Pós-processamento',
        [
          { value: 'off', label: 'Mínimo' },
          { value: 'low', label: 'Leve' },
          { value: 'high', label: 'Completo' },
        ],
        store.graphics.postProcessing,
        (v) => this.update((s) => (s.graphics = withGraphicsDetail({ ...store.graphics, preset: s.graphics.preset }, 'postProcessing', v))),
      ),
      () => store.graphics.postProcessing,
    );
    const reflections = this.bind(
      segmented<ReflectionQuality>(
        'Reflexos no asfalto',
        [
          { value: 'off', label: 'Simples' },
          { value: 'low', label: 'Baixa' },
          { value: 'high', label: 'Alta' },
        ],
        store.graphics.reflections,
        (v) => this.update((s) => (s.graphics = withGraphicsDetail({ ...store.graphics, preset: s.graphics.preset }, 'reflections', v))),
      ),
      () => store.graphics.reflections,
    );
    const fps = this.bind(
      segmented<FpsLimit>(
        'Limite de FPS',
        [
          { value: 0, label: 'Tela' },
          { value: 60, label: '60' },
          { value: 30, label: '30' },
        ],
        store.value.graphics.fpsLimit,
        (v) => this.update((s) => (s.graphics.fpsLimit = v)),
      ),
      (s) => s.graphics.fpsLimit,
    );
    const disabledNote = this.ctx.webgl ? null : h('p', { class: 'status status--info' }, 'O cenário 3D não está disponível neste navegador (WebGL 2 ausente). As opções gráficas serão aplicadas quando o 3D estiver disponível.');
    return h(
      'div',
      {},
      disabledNote,
      settingRow('Qualidade', null, preset.el, true),
      h('div', { style: 'margin:-0.4rem 0 0.4rem' }, this.autoInfo),
      settingRow('Resolução', 'Porcentagem da resolução nativa usada para renderizar a cena.', resolution.el),
      settingRow('Partículas', 'Quantidade de gotas de chuva, respingos e bancos de neblina.', detail('particles', 'Partículas').el),
      settingRow('Sombras', 'Resolução e quantidade de luzes que projetam sombras.', shadows.el),
      settingRow('Pós-processamento', 'Mínimo: só correção de tom. Leve: + granulação e vinheta. Completo: + bloom e aberração.', post.el),
      settingRow('Reflexos', 'Reflexo planar do asfalto molhado. "Simples" usa apenas o reflexo do céu.', reflections.el),
      settingRow('Densidade da cena', 'Quantidade de árvores, capim e distância de detalhe da vegetação.', detail('density', 'Densidade da cena').el),
      settingRow('Limite de FPS', '"Tela" acompanha a taxa de atualização do monitor. 30 economiza bateria.', fps.el),
    );
  }

  private audioPanel(): HTMLElement {
    const a = this.ctx.store.value.audio;
    const enabled = this.bind(toggle('Ativar áudio', a.enabled, (v) => this.update((s) => (s.audio.enabled = v))), (s) => s.audio.enabled);
    const vol = (key: 'master' | 'music' | 'ambience' | 'sfx', label: string): Control<number> =>
      this.bind(
        slider(label, 0, 1, 0.05, a[key], pct, (v) => this.update((s) => (s.audio[key] = v))),
        (s) => s.audio[key],
      );
    return h(
      'div',
      {},
      settingRow('Áudio', 'Liga ou silencia todo o som do jogo.', enabled.el),
      settingRow('Volume geral', null, vol('master', 'Volume geral').el),
      settingRow('Música ambiente', 'Trilha atmosférica generativa.', vol('music', 'Música ambiente').el),
      settingRow('Ambiente', 'Chuva, vento, rádio e atmosfera de baixa frequência.', vol('ambience', 'Ambiente').el),
      settingRow('Efeitos sonoros', 'Cliques, trovões, sons metálicos e passos.', vol('sfx', 'Efeitos sonoros').el),
      h('p', { class: 'muted', style: 'margin-top:1rem' }, 'O navegador só permite iniciar o som depois de uma interação sua (clique, toque ou tecla).'),
    );
  }

  private displayPanel(): HTMLElement {
    const d = this.ctx.store.value.display;
    const supported = this.ctx.device.fullscreenSupported;
    this.fsToggle = toggle('Tela cheia', this.ctx.isFullscreen(), async (v) => {
      const ok = await this.ctx.toggleFullscreen();
      this.fsToggle.set(this.ctx.isFullscreen());
      this.fsStatus.textContent = ok ? '' : v ? 'O navegador recusou a tela cheia.' : '';
    });
    this.fsToggle.setDisabled?.(!supported);
    document.addEventListener('fullscreenchange', () => this.fsToggle.set(this.ctx.isFullscreen()));
    const fpsCounter = this.bind(toggle('Mostrar FPS', d.showFps, (v) => this.update((s) => (s.display.showFps = v))), (s) => s.display.showFps);
    const fov = this.bind(
      slider('Campo de visão', LIMITS.fov.min, LIMITS.fov.max, 1, d.fov, (v) => `${Math.round(v)}°`, (v) => this.update((s) => (s.display.fov = v))),
      (s) => s.display.fov,
    );
    const fsDesc = supported
      ? 'Ocupa a tela inteira. Pressione Esc para sair.'
      : this.ctx.device.ios
        ? 'O iPhone não permite tela cheia em páginas web. Para uma experiência sem barras, instale o jogo na Tela de Início (Compartilhar > Adicionar à Tela de Início).'
        : 'Este navegador não oferece tela cheia para páginas.';
    return h(
      'div',
      {},
      settingRow('Tela cheia', fsDesc, this.fsToggle.el),
      this.fsStatus,
      settingRow('Campo de visão', 'Usado na exploração em primeira pessoa.', fov.el),
      settingRow('Contador de FPS', 'Exibe os quadros por segundo no canto da tela.', fpsCounter.el),
    );
  }

  private accessibilityPanel(): HTMLElement {
    const acc = this.ctx.store.value.accessibility;
    const motion = this.bind(
      segmented<ReducedMotion>(
        'Movimento reduzido',
        [
          { value: 'system', label: 'Sistema' },
          { value: 'on', label: 'Ativado' },
          { value: 'off', label: 'Desativado' },
        ],
        acc.reducedMotion,
        (v) => this.update((s) => (s.accessibility.reducedMotion = v)),
      ),
      (s) => s.accessibility.reducedMotion,
    );
    const flashes = this.bind(toggle('Reduzir flashes', acc.reduceFlashes, (v) => this.update((s) => (s.accessibility.reduceFlashes = v))), (s) => s.accessibility.reduceFlashes);
    const contrast = this.bind(toggle('Alto contraste', acc.highContrast, (v) => this.update((s) => (s.accessibility.highContrast = v))), (s) => s.accessibility.highContrast);
    const text = this.bind(
      segmented(
        'Tamanho do texto',
        [
          { value: 1, label: '100%' },
          { value: 1.15, label: '115%' },
          { value: 1.3, label: '130%' },
        ],
        acc.textScale,
        (v) => this.update((s) => (s.accessibility.textScale = v)),
      ),
      (s) => s.accessibility.textScale,
    );
    const subs = this.bind(toggle('Legendas', acc.subtitles, (v) => this.update((s) => (s.accessibility.subtitles = v))), (s) => s.accessibility.subtitles);
    const systemNote = this.ctx.device.prefersReducedMotion ? 'Seu sistema pede movimento reduzido.' : 'Seu sistema não pede movimento reduzido.';
    return h(
      'div',
      {},
      settingRow('Movimento reduzido', `Remove o balanço da câmera e transições longas. ${systemNote}`, motion.el),
      settingRow('Reduzir flashes', 'Suaviza relâmpagos e o piscar de luzes.', flashes.el),
      settingRow('Alto contraste', 'Painéis mais escuros, bordas e textos mais fortes.', contrast.el),
      settingRow('Tamanho do texto', null, text.el),
      settingRow('Legendas', 'Mostra falas e sons importantes do prólogo em texto.', subs.el),
    );
  }

  private controlsPanel(): HTMLElement {
    const c = this.ctx.store.value.controls;
    const sens = this.bind(
      slider('Sensibilidade', LIMITS.mouseSensitivity.min, LIMITS.mouseSensitivity.max, 0.1, c.mouseSensitivity, (v) => `${v.toFixed(1)}×`, (v) => this.update((s) => (s.controls.mouseSensitivity = v))),
      (s) => s.controls.mouseSensitivity,
    );
    const invert = this.bind(toggle('Inverter eixo Y', c.invertY, (v) => this.update((s) => (s.controls.invertY = v))), (s) => s.controls.invertY);
    const row = (keys: string, action: string): HTMLElement => h('li', {}, h('strong', {}, keys), ` — ${action}`);
    return h(
      'div',
      {},
      settingRow('Sensibilidade da câmera', 'Mouse, toque e controle.', sens.el),
      settingRow('Inverter eixo Y', null, invert.el),
      h('h3', { class: 'field__label', style: 'margin-top:1.4rem' }, 'Teclado e mouse'),
      h(
        'ul',
        { class: 'steps' },
        row('W A S D / setas', 'andar'),
        row('Shift', 'correr'),
        row('Mouse', 'olhar ao redor'),
        row('E / clique', 'interagir'),
        row('F', 'lanterna'),
        row('Esc', 'pausar'),
      ),
      h('h3', { class: 'field__label' }, 'Controle (gamepad)'),
      h('ul', { class: 'steps' }, row('Analógico esquerdo', 'andar'), row('Analógico direito', 'olhar'), row('A', 'interagir'), row('Y', 'lanterna'), row('Start', 'pausar')),
      h('h3', { class: 'field__label' }, 'Toque'),
      h('ul', { class: 'steps' }, row('Círculo à esquerda', 'andar'), row('Arrastar à direita', 'olhar'), row('Botões', 'interagir e lanterna')),
    );
  }
}
