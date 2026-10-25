/**
 * Playable prologue: "A ESTRADA". A short first-person sequence on the abandoned highway that
 * establishes the controls, the tone and the save system. Progress is saved at real checkpoints.
 *
 * Beats: wake up → find the flashlight in the car → turn on the radio (emergency broadcast) →
 * read the note at the bus shelter → follow the yellow line to km 112 → the lights.
 */
import { Vector2, Vector3 } from 'three';
import type { AudioManager } from '../audio/AudioManager';
import { clamp, damp } from '../core/math';
import { resolveReducedMotion } from '../features/settings/settings';
import type { SettingsStore } from '../features/settings/SettingsStore';
import type { CheckpointId, SaveData, SaveStore } from '../features/save/save';
import type { RenderManager } from '../render/RenderManager';
import { roadCenterX } from '../world/layout';
import type { World } from '../world/World';
import { GameInput } from './input';
import { Hud, type SubtitleLine } from './Hud';
import { Player, type BoxCollider, type CircleCollider } from './Player';

interface Interactable {
  id: string;
  position: Vector3;
  radius: number;
  /** Optional closest point on a larger object (e.g. the car body), so it can be used from any side. */
  closest?: (from: Vector3, out: Vector3) => Vector3;
  label: () => string | null;
  use: () => void;
}

export interface PrologueCallbacks {
  onPauseRequest: () => void;
  onExitToMenu: () => void;
  onOpenIdeas: () => void;
  onOpenDonate: () => void;
  /** Fades the screen: color and duration; resolves when finished. */
  fade: (to: 'black' | 'white' | 'clear', ms: number) => Promise<void>;
}

// Wake up beside the road, facing the car and its blinking hazard lights.
const START = { x: -0.6, z: 4.2, yaw: -0.22 };

const RADIO_BROADCAST: SubtitleLine[] = [
  { text: '(Estática. Um chiado longo.)', duration: 2.6 },
  { speaker: 'Rádio', text: '…aqui é a rádio comunitária… se alguém estiver ouvindo…', duration: 4.2 },
  { speaker: 'Rádio', text: '…a energia caiu em toda a região às vinte e três e quarenta. Ninguém sabe dizer por quê…', duration: 5 },
  { speaker: 'Rádio', text: '…celulares, carros, geradores… tudo parou ao mesmo tempo…', duration: 4.4 },
  { speaker: 'Rádio', text: '…não sigam as luzes na estrada. Repito: não sigam as luzes…', duration: 4.8 },
  { speaker: 'Rádio', text: '…o mundo não esquece… (o sinal desaparece)', duration: 4 },
];

export class Prologue {
  readonly input: GameInput;
  readonly hud: Hud;
  private readonly player = new Player();
  private readonly interactables: Interactable[] = [];
  private readonly circles: CircleCollider[] = [];
  private readonly treeColliders: CircleCollider[] = [];
  private readonly boxes: BoxCollider[] = [];
  private readonly tmpV = new Vector3();
  private readonly tmpF = new Vector3();
  private readonly tmpTarget = new Vector3();
  private readonly flashPos = new Vector3();
  private readonly flashDir = new Vector3(0, 0, -1);
  private readonly lookScaled = new Vector2();
  private checkpoint: CheckpointId = 'start';
  private inventory = new Set<string>();
  private discovered = new Set<string>();
  private flashlightOn = false;
  private radioOn = false;
  private radioTime = 0;
  private playTime = 0;
  private active = false;
  private paused = false;
  private ending = false;
  private endingTime = 0;
  private lightsTriggered = false;
  private forestHintCooldown = 0;
  private treeRefreshAt = new Vector3(1e9, 0, 0);
  private removeUpdater: (() => void) | null = null;

  constructor(
    private readonly world: World,
    private readonly render: RenderManager,
    private readonly audio: AudioManager,
    private readonly settings: SettingsStore,
    private readonly saves: SaveStore,
    private readonly callbacks: PrologueCallbacks,
    touch: boolean,
  ) {
    this.input = new GameInput(render.renderer.domElement, touch);
    this.hud = new Hud(this.input.touchRoot, () => callbacks.onPauseRequest(), () => this.input.requestPointerLock());
    this.input.onPointerLockLost = () => {
      if (this.active && !this.paused && !this.ending && !this.hud.noteOpen) callbacks.onPauseRequest();
    };
    this.buildInteractables();
    this.buildColliders();
  }

  get isActive(): boolean {
    return this.active;
  }

  private buildColliders(): void {
    const car = this.world.car;
    this.boxes.push({ x: car.group.position.x, z: car.group.position.z, yaw: car.group.rotation.y, halfX: 2.15, halfZ: 0.88 });
    this.circles.push(...this.world.props.colliders);
  }

  private buildInteractables(): void {
    const car = this.world.car.group;
    const local = new Vector3();
    this.interactables.push({
      id: 'car',
      position: car.position.clone(),
      radius: 1.6,
      // Doors on both sides: measure from the closest point of the body, in the car's frame.
      closest: (from, out) => {
        car.worldToLocal(local.copy(from));
        local.set(Math.min(1.9, Math.max(-2.0, local.x)), 0.8, Math.min(0.82, Math.max(-0.82, local.z)));
        return out.copy(local).applyMatrix4(car.matrixWorld);
      },
      label: () => {
        if (!this.inventory.has('flashlight')) return 'Abrir o porta-luvas';
        if (!this.radioOn && this.checkpoint === 'flashlight') return 'Ligar o rádio';
        if (this.radioOn) return 'Desligar o rádio';
        return 'Ligar o rádio';
      },
      use: () => this.useCar(),
    });
    this.interactables.push({
      id: 'note',
      position: this.world.props.busNote.clone(),
      radius: 2.2,
      label: () => (this.discovered.has('note-bus') ? 'Ler o bilhete de novo' : 'Ler o bilhete'),
      use: () => this.readNote(),
    });
  }

  start(save: SaveData | null): void {
    this.active = true;
    this.paused = false;
    this.ending = false;
    this.lightsTriggered = false;
    this.world.lighting.scriptedDistant = null;
    this.world.setEventsEnabled(true);
    this.inventory = new Set(save?.inventory ?? []);
    this.discovered = new Set(save?.discovered ?? []);
    this.checkpoint = save?.checkpoint ?? 'start';
    this.playTime = save?.playTimeSec ?? 0;
    this.radioOn = false;
    this.flashlightOn = false;
    if (save) this.player.place(save.position[0], save.position[2], save.yaw);
    else this.player.place(START.x, START.z, START.yaw);
    this.world.props.setNoteVisible(true);

    this.render.camera.clearViewOffset();
    this.render.camera.near = 0.05;
    this.input.attach();
    this.input.reset();
    this.hud.show();
    this.hud.subtitlesEnabled = this.settings.value.accessibility.subtitles;
    this.hud.setCrosshair(!this.input.touch);
    this.refreshObjective();
    this.removeUpdater = this.render.addUpdater((dt) => this.update(dt));
    this.audio.setScene('game');
    this.audio.setHazardLevel(0.6);

    if (!save) {
      this.hud.say([
        { text: '(Um zumbido no ouvido. A chuva não para.)', duration: 3.6 },
        { speaker: 'Você', text: 'Onde… onde eu estou? O carro…', duration: 3.4 },
        { speaker: 'Você', text: 'Está tudo apagado. Preciso de uma luz.', duration: 3.4 },
      ]);
      this.save('start');
    } else {
      this.hud.say([{ text: '(Você retoma o caminho de onde parou.)', duration: 3 }]);
    }
    if (!this.input.touch) this.hud.setClickToPlay(true);
  }

  private refreshObjective(): void {
    switch (this.checkpoint) {
      case 'start':
        this.hud.setObjective('OBJETIVO', 'Procure algo para iluminar o caminho. Talvez no carro.');
        break;
      case 'flashlight':
        this.hud.setObjective('OBJETIVO', 'Ligue o rádio do carro.');
        break;
      case 'radio':
        this.hud.setObjective('OBJETIVO', 'Siga pela estrada até o ponto de ônibus.');
        break;
      case 'road':
        this.hud.setObjective('OBJETIVO', 'Siga a linha amarela até o km 112.');
        break;
      case 'ending':
        this.hud.setObjective(null);
        break;
    }
  }

  private save(checkpoint: CheckpointId): void {
    this.checkpoint = checkpoint;
    this.saves.write({
      chapter: 'prologue',
      checkpoint,
      inventory: [...this.inventory],
      discovered: [...this.discovered],
      position: [this.player.position.x, 0, this.player.position.z],
      yaw: this.player.yaw,
      playTimeSec: Math.round(this.playTime),
    });
  }

  /** Saves the current position (used when quitting from the pause menu). */
  saveProgress(): void {
    if (this.active && !this.ending) this.save(this.checkpoint);
  }

  get progressLabel(): string {
    const minutes = Math.floor(this.playTime / 60);
    return `Tempo de jogo: ${minutes} min · Progresso salvo no último ponto de controle.`;
  }

  private useCar(): void {
    this.audio.thunk('door');
    if (!this.inventory.has('flashlight')) {
      this.inventory.add('flashlight');
      this.flashlightOn = true;
      this.audio.thunk('pickup');
      this.hud.say([
        { speaker: 'Você', text: 'Uma lanterna. Ainda funciona.', duration: 3 },
        { text: this.input.touch ? '(Toque em LUZ para ligar ou desligar a lanterna.)' : '(Pressione F para ligar ou desligar a lanterna.)', duration: 3.6 },
      ]);
      this.save('flashlight');
      this.refreshObjective();
      return;
    }
    this.radioOn = !this.radioOn;
    this.audio.thunk('switch');
    if (this.radioOn) {
      this.radioTime = 0;
      this.hud.clearSubtitles();
      this.hud.say(RADIO_BROADCAST);
      if (this.checkpoint === 'flashlight') {
        this.discovered.add('radio-broadcast');
        this.save('radio');
        this.refreshObjective();
      }
    } else {
      this.hud.clearSubtitles();
    }
  }

  private readNote(): void {
    this.audio.thunk('pickup');
    this.input.exitPointerLock();
    this.input.enabled = false;
    this.hud.showNote(
      [
        'Se você está lendo isso, o seu carro também parou.',
        'Não espere o ônibus. Ele não vem. Ninguém vem.',
        'Siga a linha amarela até o km 112. Não saia do asfalto.',
        'E se aparecerem luzes na estrada, não olhe para elas.',
      ],
      '— R.',
      () => {
        this.input.enabled = true;
        if (!this.input.touch) this.hud.setClickToPlay(true);
        if (!this.discovered.has('note-bus')) {
          this.discovered.add('note-bus');
          if (this.checkpoint === 'radio' || this.checkpoint === 'flashlight' || this.checkpoint === 'start') {
            this.save('road');
            this.refreshObjective();
          }
        }
      },
    );
  }

  pause(): void {
    if (!this.active) return;
    this.paused = true;
    this.input.enabled = false;
    this.input.exitPointerLock();
    this.input.reset();
    this.hud.setClickToPlay(false);
  }

  resume(): void {
    if (!this.active) return;
    this.paused = false;
    this.input.enabled = !this.hud.noteOpen;
    this.hud.subtitlesEnabled = this.settings.value.accessibility.subtitles;
    if (!this.input.touch) {
      this.input.requestPointerLock();
      this.hud.setClickToPlay(!this.input.pointerLocked);
    }
  }

  stop(): void {
    this.active = false;
    this.removeUpdater?.();
    this.removeUpdater = null;
    this.input.detach();
    this.hud.hide();
    this.world.lighting.setFlashlight(false, this.flashPos, this.flashDir);
    this.world.lighting.scriptedDistant = null;
    this.audio.setRadioObject(0);
    this.audio.setHazardLevel(0.2);
    this.render.camera.near = 0.1;
    this.render.camera.updateProjectionMatrix();
  }

  private update(dt: number): void {
    if (!this.active) return;
    const s = this.settings.value;
    const reduced = resolveReducedMotion(s.accessibility.reducedMotion, window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);
    this.hud.update(this.paused ? 0 : dt);
    if (this.paused) return;
    this.playTime += dt;

    this.input.poll(dt, s.controls.mouseSensitivity);
    if (this.input.pause && !this.ending) {
      this.input.endFrame();
      this.callbacks.onPauseRequest();
      return;
    }
    if (!this.input.touch) this.hud.setClickToPlay(!this.input.pointerLocked && !this.ending && !this.hud.noteOpen);

    if (!this.ending) {
      this.lookScaled.copy(this.input.look);
      const step = this.player.update(
        dt,
        this.input.move,
        this.input.run,
        this.lookScaled,
        s.controls.mouseSensitivity,
        s.controls.invertY,
        this.collectCircles(),
        this.boxes,
      );
      if (step) this.audio.footstep(this.player.surface, this.input.run ? 1.2 : 0.9);
      if (this.player.blockedByForest && this.forestHintCooldown <= 0) {
        this.hud.say([{ speaker: 'Você', text: 'A mata é fechada demais. Melhor não sair da estrada.', duration: 3 }]);
        this.forestHintCooldown = 12;
      }
      this.forestHintCooldown -= dt;
    }

    const cam = this.render.camera;
    const fov = s.display.fov;
    if (Math.abs(cam.fov - fov) > 0.01) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }
    this.player.applyCamera(cam, !reduced);

    // Flashlight follows the view with a little lag.
    if (this.input.flashlight && this.inventory.has('flashlight')) {
      this.flashlightOn = !this.flashlightOn;
      this.audio.thunk('switch');
    }
    this.player.forward(this.tmpF);
    this.flashDir.x = damp(this.flashDir.x, this.tmpF.x, 14, dt);
    this.flashDir.y = damp(this.flashDir.y, this.tmpF.y - 0.08, 14, dt);
    this.flashDir.z = damp(this.flashDir.z, this.tmpF.z, 14, dt);
    this.flashDir.normalize();
    this.flashPos.copy(cam.position).addScaledVector(this.tmpF, 0.2);
    this.flashPos.y -= 0.25;
    this.world.lighting.setFlashlight(this.flashlightOn && this.inventory.has('flashlight'), this.flashPos, this.flashDir);

    // Car sounds fade with distance.
    const carDist = this.player.position.distanceTo(this.world.car.group.position);
    this.audio.setHazardLevel(clamp(1.2 - carDist / 14, 0.05, 1));
    if (this.radioOn) {
      this.radioTime += dt;
      this.audio.setRadioObject(clamp(1.3 - carDist / 10, 0, 1) * (this.radioTime > 26 ? 0.4 : 1));
    } else this.audio.setRadioObject(0);

    if (!this.ending) this.updateInteractions();
    this.updateStory(dt);
    this.input.endFrame();
  }

  private collectCircles(): CircleCollider[] {
    const p = this.player.position;
    if (this.treeRefreshAt.distanceToSquared(p) > 9) {
      this.treeRefreshAt.copy(p);
      this.world.forest.collidersNear(p.x, p.z, 14, this.treeColliders);
    }
    return this.circles.length + this.treeColliders.length === this.circles.length ? this.circles : [...this.circles, ...this.treeColliders];
  }

  private updateInteractions(): void {
    if (this.hud.noteOpen) {
      this.hud.setPrompt(null);
      return;
    }
    const eye = this.render.camera.position;
    this.player.forward(this.tmpF);
    let best: Interactable | null = null;
    let bestScore = Infinity;
    for (const item of this.interactables) {
      const target = item.closest ? item.closest(eye, this.tmpTarget) : item.position;
      this.tmpV.subVectors(target, eye);
      const flat = Math.hypot(this.tmpV.x, this.tmpV.z);
      if (flat > item.radius) continue;
      this.tmpV.y = 0;
      this.tmpV.normalize();
      const facing = this.tmpV.x * this.tmpF.x + this.tmpV.z * this.tmpF.z;
      if (facing < (item.closest ? 0.15 : 0.35)) continue;
      const score = flat * (1.6 - facing);
      if (score < bestScore) {
        bestScore = score;
        best = item;
      }
    }
    const label = best?.label() ?? null;
    if (best && label) {
      this.hud.setPrompt(this.input.touch ? 'USAR' : 'E', label);
      if (this.input.interact) best.use();
    } else this.hud.setPrompt(null);
  }

  private updateStory(dt: number): void {
    const p = this.player.position;
    // The lights appear once the player commits to the road toward km 112.
    if (!this.ending && this.checkpoint === 'road' && p.z < -78 && !this.lightsTriggered) {
      this.lightsTriggered = true;
      this.world.setEventsEnabled(false);
      this.hud.say([
        { speaker: 'Você', text: 'Luzes… lá na frente. Vindo na minha direção.', duration: 3.4 },
        { speaker: 'Você', text: '"Não olhe para elas."', duration: 2.6 },
      ]);
    }
    if (this.lightsTriggered && !this.ending) {
      // Lights advance toward the player, faster when they look at them.
      const lightsZ = this.world.lighting.scriptedDistant?.z ?? -230;
      this.player.forward(this.tmpF);
      const toward = this.tmpF.z < -0.6 ? 1.8 : 1;
      const z = Math.min(lightsZ + dt * 11 * toward, p.z - 3);
      this.world.lighting.scriptedDistant = { z, level: clamp((z + 230) / 60, 0.15, 1) * (1 + Math.max(0, 1 - (p.z - z) / 25) * 2) };
      if (p.z - z < 9 || p.z < -118) void this.startEnding();
    }
    if (this.ending) this.endingTime += dt;
  }

  private async startEnding(): Promise<void> {
    if (this.ending) return;
    this.ending = true;
    this.endingTime = 0;
    this.input.enabled = false;
    this.input.exitPointerLock();
    this.hud.setPrompt(null);
    this.hud.setClickToPlay(false);
    this.save('ending');
    this.audio.whoosh(3, 0.25);
    const reduceFlashes = this.settings.value.accessibility.reduceFlashes;
    await this.callbacks.fade(reduceFlashes ? 'black' : 'white', reduceFlashes ? 2200 : 1600);
    this.world.lighting.scriptedDistant = null;
    this.hud.showEnding(
      () => this.callbacks.onExitToMenu(),
      () => this.callbacks.onOpenIdeas(),
      () => this.callbacks.onOpenDonate(),
    );
    await this.callbacks.fade('clear', 800);
  }

  /** Debug helper used by automated checks: current player state. */
  debugState(): { x: number; z: number; checkpoint: CheckpointId; road: number } {
    return { x: this.player.position.x, z: this.player.position.z, checkpoint: this.checkpoint, road: roadCenterX(this.player.position.z) };
  }
}
