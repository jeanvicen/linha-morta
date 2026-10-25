/**
 * Application bootstrap and orchestration: loading flow, 3D scene, menus, audio, settings,
 * PWA installation/updates and the playable prologue.
 */
import { AudioManager } from '../audio/AudioManager';
import { detectDevice, estimateQuality, type DeviceProfile } from '../core/device';
import { h, nextFrame, wait } from '../core/dom';
import { AppError, installGlobalErrorHandlers, toAppError } from '../core/errors';
import { SaveStore, describeSave } from '../features/save/save';
import { resolveReducedMotion, type QualityLevel, type Settings } from '../features/settings/settings';
import { SettingsStore } from '../features/settings/SettingsStore';
import { InstallManager, registerServiceWorker } from '../features/pwa/install';
import { Prologue } from '../game/Prologue';
import { RenderManager } from '../render/RenderManager';
import { CameraRig } from '../world/cameraRig';
import { World } from '../world/World';
import { Toasts } from '../ui/components/controls';
import { ScreenManager } from '../ui/ScreenManager';
import { ChapterScreen } from '../ui/screens/ChapterScreen';
import { ConfirmDialog } from '../ui/screens/ConfirmDialog';
import { GameScreen } from '../ui/screens/GameScreen';
import { CreditsScreen } from '../ui/screens/CreditsScreen';
import { DonateScreen } from '../ui/screens/DonateScreen';
import { IdeasScreen } from '../ui/screens/IdeasScreen';
import { InstallScreen } from '../ui/screens/InstallScreen';
import { LoadingScreen } from '../ui/screens/LoadingScreen';
import { MainMenu } from '../ui/screens/MainMenu';
import { PauseScreen } from '../ui/screens/PauseScreen';
import { SettingsScreen } from '../ui/screens/SettingsScreen';
import { LoadingFlow, type LoadingStage } from './LoadingFlow';
import { APP_VERSION } from './version';

const LEVEL_LABEL: Record<QualityLevel, string> = { low: 'Baixa', medium: 'Média', high: 'Alta', ultra: 'Ultra' };

interface DocumentFullscreen extends Document {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void>;
}

interface ElementFullscreen extends HTMLElement {
  webkitRequestFullscreen?: () => Promise<void>;
}

export class App {
  private readonly settings = new SettingsStore();
  private readonly saves = new SaveStore();
  private readonly device: DeviceProfile = detectDevice();
  private readonly audio: AudioManager;
  private readonly install: InstallManager;
  private readonly toasts = new Toasts();
  private readonly ui: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly fadeEl = h('div', { class: 'fade', 'aria-hidden': 'true' });
  private readonly fpsEl = h('div', { class: 'fps', hidden: true, 'aria-hidden': 'true' });
  private readonly screens: ScreenManager;
  private render: RenderManager | null = null;
  private world: World | null = null;
  private rig: CameraRig | null = null;
  private game: Prologue | null = null;
  private loading!: LoadingScreen;
  private menu!: MainMenu;
  private settingsScreen!: SettingsScreen;
  private credits!: CreditsScreen;
  private donate!: DonateScreen;
  private ideas!: IdeasScreen;
  private chapter!: ChapterScreen;
  private confirm!: ConfirmDialog;
  private installScreen!: InstallScreen;
  private pause!: PauseScreen;
  private gameScreen: GameScreen | null = null;
  private webgl: boolean;
  private mode: 'loading' | 'menu' | 'game' | 'fallback' = 'loading';
  private flow: LoadingFlow | null = null;
  private padLoop = 0;
  private autoLevel: QualityLevel;

  constructor() {
    this.ui = document.getElementById('ui') as HTMLElement;
    this.canvas = document.getElementById('scene') as HTMLCanvasElement;
    this.audio = new AudioManager(this.settings.value.audio);
    this.install = new InstallManager(this.device.ios ? 'ios' : this.device.android ? 'android' : 'desktop');
    this.webgl = this.device.gpu.webgl2;
    this.autoLevel = estimateQuality(this.device);
    this.settings.setAutoLevel(this.autoLevel);
    this.screens = new ScreenManager(this.ui, {
      onShotChange: (shot) => this.rig?.go(shot, shot === 'menu' ? 0.9 : 1.1),
      onOpen: () => this.audio.ui('open'),
      onClose: () => this.audio.ui('back'),
    });
  }

  start(): void {
    installGlobalErrorHandlers();
    this.applyAccessibility(this.settings.value);
    document.body.append(this.fadeEl, this.fpsEl, this.toasts.el);
    this.buildScreens();
    document.getElementById('boot')?.remove();
    this.ui.append(this.loading.root);
    this.setupAudioUnlock();
    this.setupUiSounds();
    this.settings.on('change', ({ settings }) => this.onSettings(settings));
    this.audio.on('state', (state) => {
      this.loading.setSoundState(state);
      this.menu.setSound(state);
    });
    this.loading.setSoundState(this.audio.state);
    this.menu.setSound(this.audio.state);
    this.install.on('change', () => this.menu.setInstallVisible(this.install.offerInstall));
    this.install.on('installed', () => this.toasts.show('LINHA MORTA foi instalado neste dispositivo.'));
    this.menu.setInstallVisible(this.install.offerInstall);
    void registerServiceWorker({
      onNeedRefresh: (apply) => this.toasts.show('Uma nova versão de LINHA MORTA está disponível.', { label: 'Atualizar', onClick: apply }, 0),
      onOfflineReady: () => this.toasts.show('Pronto para abrir offline: menu e prólogo ficam salvos neste dispositivo.'),
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.mode === 'game' && this.game?.isActive && !this.screens.hasOverlay) this.openPause();
    });
    void this.runLoading();
  }

  // ------------------------------------------------------------------------------------------
  // Screens
  // ------------------------------------------------------------------------------------------

  private buildScreens(): void {
    this.loading = new LoadingScreen({
      onEnableSound: () => void this.audio.unlock().then(() => this.audio.setScene(this.mode === 'loading' ? 'loading' : 'menu')),
      onRetry: () => void this.retryLoading(),
      onFallback: () => this.enterFallback(),
    });
    this.menu = new MainMenu(
      {
        newGame: () => this.onNewGame(),
        continueGame: () => this.onContinue(),
        settings: () => this.screens.open(this.settingsScreen),
        donate: () => this.screens.open(this.donate),
        ideas: () => this.screens.open(this.ideas),
        credits: () => this.screens.open(this.credits),
        toggleSound: () => this.toggleSound(),
        install: () => void this.onInstall(),
      },
      APP_VERSION,
    );
    this.settingsScreen = new SettingsScreen({
      store: this.settings,
      device: this.device,
      webgl: this.webgl,
      isFullscreen: () => Boolean(document.fullscreenElement ?? (document as DocumentFullscreen).webkitFullscreenElement),
      toggleFullscreen: () => this.toggleFullscreen(),
    });
    this.credits = new CreditsScreen();
    this.donate = new DonateScreen((ok) => this.audio.ui(ok ? 'success' : 'error'));
    this.ideas = new IdeasScreen((kind) => this.audio.ui(kind));
    this.chapter = new ChapterScreen();
    this.confirm = new ConfirmDialog();
    this.installScreen = new InstallScreen(this.install.platform, () => this.install.prompt(), () => this.install.canPrompt);
    this.pause = new PauseScreen({
      resume: () => this.closePause(),
      settings: () => this.screens.open(this.settingsScreen),
      quit: () => void this.exitGame(true),
    });
    for (const s of [this.menu, this.settingsScreen, this.credits, this.donate, this.ideas, this.chapter, this.confirm, this.installScreen, this.pause]) this.screens.register(s);
    this.refreshContinue();
  }

  private refreshContinue(): void {
    const save = this.saves.load();
    const available = this.saves.hasValidSave();
    const finished = save?.checkpoint === 'ending';
    this.menu.setContinue(available, available && save ? describeSave(save) : finished ? 'Prólogo concluído · Capítulo 1 em desenvolvimento' : null);
  }

  // ------------------------------------------------------------------------------------------
  // Loading
  // ------------------------------------------------------------------------------------------

  private stages(): LoadingStage[] {
    const level = (): QualityLevel => (this.settings.value.graphics.preset === 'auto' ? this.autoLevel : this.levelForPreset());
    return [
      {
        label: 'Verificando compatibilidade',
        run: () => {
          if (!this.webgl) throw new AppError('webgl_unavailable', 'Seu navegador ou dispositivo não oferece WebGL 2, necessário para o cenário 3D.');
        },
      },
      {
        label: 'Preparando o ambiente',
        run: () => {
          this.render?.dispose();
          this.world?.dispose();
          this.render = new RenderManager(this.canvas, this.device.mobile);
          this.world = new World(this.render.renderer);
          this.rig = new CameraRig(this.render.camera);
          this.render.onViewport((w, hgt) => this.rig?.setViewport(w, hgt));
          this.render.addUpdater((dt, time) => {
            this.rig?.update(dt, time);
            if (this.mode === 'menu' || (this.mode === 'game' && this.screens.hasOverlay)) this.screens.pollGamepad(performance.now());
          });
          this.render.on('autodowngrade', (lvl) => {
            this.autoLevel = lvl;
            this.settings.setAutoLevel(lvl);
            this.toasts.show(`Qualidade automática ajustada para ${LEVEL_LABEL[lvl]} para manter a fluidez.`);
          });
          this.render.on('fps', (fps) => {
            this.fpsEl.textContent = `${Math.round(fps)} FPS`;
          });
          this.render.on('contextlost', () => this.toasts.show('O contexto gráfico foi perdido. Tentando restaurar…', undefined, 4000));
          this.render.on('contextrestored', () => void this.rebuildWorld());
        },
      },
      { label: 'Gerando texturas', run: () => this.world!.build('textures', level()) },
      {
        label: 'Carregando cenário',
        run: async () => {
          await this.world!.build('scene', level());
          await this.world!.build('vegetation', level());
        },
      },
      {
        label: 'Criando chuva e neblina',
        run: () =>
          this.world!.build('atmosphere', level(), {
            onThunder: (i, d) => this.audio.thunder(i, d),
            onHazardRelay: (on) => this.audio.hazardTick(on),
          }),
      },
      {
        label: 'Compilando shaders',
        run: async () => {
          const r = this.render!;
          r.setWorld(this.world!);
          this.applyGraphics();
          this.applyAccessibility(this.settings.value);
          this.world!.setEventsEnabled(false);
          this.rig!.cut('intro');
          await r.precompile();
          r.renderOnce();
        },
      },
      {
        label: 'Inicializando áudio',
        run: async () => {
          if (document.fonts?.ready) await Promise.race([document.fonts.ready, wait(2500)]);
          if (this.audio.state === 'on') this.audio.setScene('loading');
        },
      },
    ];
  }

  private async runLoading(): Promise<void> {
    this.mode = 'loading';
    this.loading.resetError();
    this.flow = new LoadingFlow(this.stages(), this.loading);
    try {
      await this.flow.run();
      if (this.mode !== 'loading') return;
      this.loading.markAllDone('Pronto');
      await wait(450);
      this.revealScene();
    } catch (error) {
      if (this.mode !== 'loading') return;
      const e = toAppError(error, 'scene_build_failed');
      console.error('[loading] failed', error);
      const title = e.code === 'webgl_unavailable' ? 'Gráficos 3D indisponíveis' : 'Falha ao carregar';
      this.loading.showError(title, `${e.userMessage} Você pode tentar novamente ou abrir a versão simplificada do menu.`, true);
    }
  }

  private async retryLoading(): Promise<void> {
    this.flow?.cancel();
    this.webgl = this.device.gpu.webgl2 || detectDevice().gpu.webgl2;
    await nextFrame();
    void this.runLoading();
  }

  private revealScene(): void {
    const r = this.render!;
    this.mode = 'menu';
    document.documentElement.dataset.state = 'menu';
    r.start();
    this.canvas.classList.add('is-visible');
    this.rig!.cut('intro');
    this.loading.finish();
    window.setTimeout(() => {
      this.screens.setBase(this.menu);
      this.rig!.go('menu', 0.32);
    }, 700);
    this.world!.setEventsEnabled(true);
    this.audio.setScene('menu');
  }

  /** Simplified mode: menus without the WebGL scene (or when the player chose to skip it). */
  private enterFallback(): void {
    this.flow?.cancel();
    this.mode = 'fallback';
    document.documentElement.dataset.state = 'fallback';
    this.render?.stop();
    this.canvas.classList.remove('is-visible');
    const fallback = document.getElementById('fallback-scene');
    if (fallback) fallback.hidden = false;
    document.documentElement.classList.add('no-webgl');
    this.loading.finish();
    this.menu.setNotice(
      this.webgl
        ? 'Modo simplificado: o cenário 3D foi desativado nesta sessão. Recarregue a página para tentar de novo.'
        : 'Modo simplificado: este navegador não oferece WebGL 2, então o cenário 3D foi substituído por uma versão leve. Menus, doação, ideias e configurações funcionam normalmente.',
    );
    this.screens.setBase(this.menu);
    this.audio.setScene('menu');
    const poll = (): void => {
      this.screens.pollGamepad(performance.now());
      this.padLoop = requestAnimationFrame(poll);
    };
    cancelAnimationFrame(this.padLoop);
    this.padLoop = requestAnimationFrame(poll);
  }

  private async rebuildWorld(): Promise<void> {
    if (!this.render) return;
    try {
      const level = this.settings.value.graphics.preset === 'auto' ? this.autoLevel : this.levelForPreset();
      const world = new World(this.render.renderer);
      await world.build('textures', level);
      await world.build('scene', level);
      await world.build('vegetation', level);
      await world.build('atmosphere', level, { onThunder: (i, d) => this.audio.thunder(i, d), onHazardRelay: (on) => this.audio.hazardTick(on) });
      this.world?.dispose();
      this.world = world;
      this.render.setWorld(world);
      this.applyGraphics();
      this.applyAccessibility(this.settings.value);
      this.toasts.show('Cenário restaurado.');
      if (this.game) {
        // The prologue holds references to the old world: save, return to the menu and recreate it later.
        await this.exitGame(true);
        this.game.hud.root.remove();
        this.game = null;
        this.gameScreen = null;
      }
    } catch (error) {
      console.error('[render] failed to rebuild after context loss', error);
      this.toasts.show('Não foi possível restaurar o cenário 3D. Recarregue a página.', { label: 'Recarregar', onClick: () => location.reload() }, 0);
    }
  }

  // ------------------------------------------------------------------------------------------
  // Settings
  // ------------------------------------------------------------------------------------------

  private levelForPreset(): QualityLevel {
    const p = this.settings.value.graphics.preset;
    return p === 'low' || p === 'medium' || p === 'high' || p === 'ultra' ? p : p === 'auto' ? this.autoLevel : 'high';
  }

  private applyGraphics(): void {
    if (!this.render || !this.world) return;
    const preset = this.settings.value.graphics.preset;
    this.render.autoQuality = preset === 'auto';
    this.render.autoLevel = this.autoLevel;
    this.render.applyGraphics(this.settings.graphics, this.levelForPreset());
  }

  private applyAccessibility(s: Settings): void {
    const reduced = resolveReducedMotion(s.accessibility.reducedMotion, this.device.prefersReducedMotion);
    const root = document.documentElement;
    root.classList.toggle('reduced-motion', reduced);
    root.classList.toggle('high-contrast', s.accessibility.highContrast);
    root.style.setProperty('--text-scale', String(s.accessibility.textScale));
    if (this.rig) this.rig.reducedMotion = reduced;
    if (this.world?.lighting) this.world.setAccessibility(s.accessibility.reduceFlashes || reduced, reduced);
    this.fpsEl.hidden = !s.display.showFps;
  }

  private lastGraphicsKey = '';

  private onSettings(s: Settings): void {
    const key = JSON.stringify(this.settings.graphics) + this.autoLevel;
    if (key !== this.lastGraphicsKey) {
      this.lastGraphicsKey = key;
      this.applyGraphics();
    }
    this.audio.updateSettings(s.audio);
    this.applyAccessibility(s);
  }

  // ------------------------------------------------------------------------------------------
  // Audio
  // ------------------------------------------------------------------------------------------

  /** Audio can only start after a user gesture; the first interaction anywhere unlocks it. */
  private setupAudioUnlock(): void {
    const unlock = (event: Event): void => {
      if (this.audio.state !== 'locked') return;
      // The sound toggle handles its own click; unlocking here too would immediately mute it again.
      if ((event.target as HTMLElement | null)?.closest?.('[data-sound-toggle]')) return;
      void this.audio.unlock().then((ok) => {
        if (ok) this.audio.setScene(this.mode === 'loading' ? 'loading' : this.mode === 'game' ? 'game' : 'menu');
      });
    };
    for (const type of ['pointerdown', 'keydown', 'touchend'] as const) document.addEventListener(type, unlock, { passive: true });
  }

  private setupUiSounds(): void {
    document.addEventListener('click', (event) => {
      const el = (event.target as HTMLElement | null)?.closest('button, a.btn');
      if (el && !el.hasAttribute('disabled')) this.audio.ui('click');
    });
    document.addEventListener('mouseover', (event) => {
      const el = (event.target as HTMLElement | null)?.closest('.menu__item');
      if (el && !el.hasAttribute('disabled') && !el.contains(event.relatedTarget as Node | null)) this.audio.ui('hover');
    });
  }

  private toggleSound(): void {
    if (this.audio.state === 'locked') {
      void this.audio.unlock().then((ok) => ok && this.audio.setScene(this.mode === 'game' ? 'game' : 'menu'));
      return;
    }
    this.settings.update((s) => {
      s.audio.enabled = !s.audio.enabled;
      return s;
    });
  }

  // ------------------------------------------------------------------------------------------
  // Display / install
  // ------------------------------------------------------------------------------------------

  private async toggleFullscreen(): Promise<boolean> {
    const doc = document as DocumentFullscreen;
    try {
      if (document.fullscreenElement ?? doc.webkitFullscreenElement) {
        if (document.exitFullscreen) await document.exitFullscreen();
        else await doc.webkitExitFullscreen?.();
        return true;
      }
      const el = document.documentElement as ElementFullscreen;
      if (el.requestFullscreen) await el.requestFullscreen({ navigationUI: 'hide' });
      else if (el.webkitRequestFullscreen) await el.webkitRequestFullscreen();
      else return false;
      return true;
    } catch {
      return false;
    }
  }

  private async onInstall(): Promise<void> {
    if (this.install.canPrompt) {
      const outcome = await this.install.prompt();
      if (outcome === 'accepted') this.toasts.show('Instalação aceita. O navegador vai concluir a instalação.');
      else if (outcome === 'dismissed') this.toasts.show('Instalação cancelada.');
      else this.screens.open(this.installScreen);
      return;
    }
    this.screens.open(this.installScreen);
  }

  // ------------------------------------------------------------------------------------------
  // Game flow
  // ------------------------------------------------------------------------------------------

  private fade(to: 'black' | 'white' | 'clear', ms: number): Promise<void> {
    const reduced = document.documentElement.classList.contains('reduced-motion');
    const duration = reduced ? Math.min(ms, 200) : ms;
    this.fadeEl.style.setProperty('--fade-ms', `${duration}ms`);
    if (to === 'clear') this.fadeEl.classList.remove('is-on');
    else {
      this.fadeEl.style.background = to === 'white' ? '#f4f1ea' : '#000';
      this.fadeEl.classList.add('is-on');
    }
    return wait(duration + 30);
  }

  private onNewGame(): void {
    const begin = (): void => void this.showChapter(null);
    if (this.saves.hasValidSave()) {
      this.confirm.ask('Novo jogo', 'Começar um novo jogo vai substituir o progresso salvo do prólogo quando você iniciar. Deseja continuar?', 'Novo jogo', begin);
    } else begin();
  }

  private onContinue(): void {
    const save = this.saves.load();
    if (!save || !this.saves.hasValidSave()) {
      this.refreshContinue();
      this.toasts.show('Não há um jogo salvo para continuar.');
      return;
    }
    void this.showChapter(describeSave(save));
  }

  private async showChapter(resume: string | null): Promise<void> {
    this.audio.whoosh(1.6, 0.14);
    this.rig?.go('newgame', 0.9);
    this.audio.setScene('chapter');
    this.chapter.configure({
      canPlay: this.webgl && this.mode === 'menu',
      touch: this.useTouchControls(),
      resume,
      onStart: () => void this.beginGame(resume !== null),
      onBack: () => {
        this.screens.close(this.chapter);
        this.audio.setScene('menu');
      },
    });
    await wait(document.documentElement.classList.contains('reduced-motion') ? 0 : 450);
    this.screens.open(this.chapter);
  }

  private async beginGame(resume: boolean): Promise<void> {
    if (!this.world || !this.render || !this.rig) return;
    const save = resume ? this.saves.load() : null;
    if (!resume) this.saves.clear();
    await this.fade('black', 900);
    this.screens.close(this.chapter);
    // Hold the black for a moment (only rain is heard) while the title card finishes fading out.
    await wait(document.documentElement.classList.contains('reduced-motion') ? 0 : 1250);
    this.mode = 'game';
    this.rig.active = false;
    if (!this.game) {
      this.game = new Prologue(
        this.world,
        this.render,
        this.audio,
        this.settings,
        this.saves,
        {
          onPauseRequest: () => this.openPause(),
          onExitToMenu: () => void this.exitGame(false),
          onOpenIdeas: () => this.screens.open(this.ideas),
          onOpenDonate: () => this.screens.open(this.donate),
          fade: (to, ms) => this.fade(to, ms),
        },
        this.useTouchControls(),
      );
      this.ui.append(this.game.hud.root);
      this.gameScreen = new GameScreen(this.game.hud.root, () => this.openPause());
      this.screens.register(this.gameScreen);
    }
    this.screens.setBase(this.gameScreen!);
    this.game.start(save);
    this.screens.setGamepadEnabled(false);
    await wait(300);
    await this.fade('clear', 1400);
  }

  /** Touch controls for phones and tablets (coarse pointer), keyboard/mouse otherwise. */
  private useTouchControls(): boolean {
    const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false;
    return this.device.touch && (this.device.mobile || coarse);
  }

  private openPause(): void {
    if (!this.game?.isActive || this.screens.top === this.pause) return;
    this.game.pause();
    this.pause.setInfo(this.game.progressLabel);
    this.screens.setGamepadEnabled(true);
    this.screens.open(this.pause);
  }

  private closePause(): void {
    this.screens.close(this.pause);
    this.screens.setGamepadEnabled(false);
    this.game?.resume();
  }

  private async exitGame(saveProgress: boolean): Promise<void> {
    if (!this.game) return;
    if (saveProgress) this.game.saveProgress();
    await this.fade('black', 800);
    this.game.stop();
    this.screens.close(this.pause);
    this.mode = 'menu';
    this.screens.setGamepadEnabled(true);
    if (this.rig) {
      this.rig.active = true;
      this.rig.cut('menu');
    }
    this.refreshContinue();
    this.screens.setBase(this.menu);
    this.audio.setScene('menu');
    await wait(200);
    await this.fade('clear', 1200);
  }
}
