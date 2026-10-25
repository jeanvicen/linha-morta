/**
 * First-person input: keyboard + mouse (pointer lock), gamepad and touch (virtual stick, look
 * area and action buttons). Produces a movement vector, look deltas and one-shot actions.
 */
import { Vector2 } from 'three';
import { h } from '../core/dom';

export class GameInput {
  readonly move = new Vector2();
  /** Accumulated look delta in "pixels" since the last frame. */
  readonly look = new Vector2();
  run = false;
  interact = false;
  flashlight = false;
  pause = false;
  readonly touchRoot: HTMLElement | null;
  private readonly keys = new Set<string>();
  private stickId: number | null = null;
  private lookId: number | null = null;
  private lookLast = new Vector2();
  private readonly stickVec = new Vector2();
  private padPrev = { a: false, y: false, start: false };
  private attached = false;
  private knob: HTMLElement | null = null;
  private stick: HTMLElement | null = null;
  enabled = true;
  /** Called when pointer lock is lost without the game asking for it (Esc on desktop). */
  onPointerLockLost: (() => void) | null = null;
  private releasingLock = false;

  constructor(private readonly canvas: HTMLCanvasElement, readonly touch: boolean) {
    this.touchRoot = touch ? this.buildTouch() : null;
  }

  get pointerLocked(): boolean {
    return document.pointerLockElement === this.canvas;
  }

  attach(): void {
    if (this.attached) return;
    this.attached = true;
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    document.addEventListener('mousemove', this.onMouseMove);
    document.addEventListener('mousedown', this.onMouseDown);
    document.addEventListener('pointerlockchange', this.onLockChange);
  }

  detach(): void {
    if (!this.attached) return;
    this.attached = false;
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    document.removeEventListener('mousemove', this.onMouseMove);
    document.removeEventListener('mousedown', this.onMouseDown);
    document.removeEventListener('pointerlockchange', this.onLockChange);
    this.exitPointerLock();
    this.reset();
  }

  requestPointerLock(): void {
    if (this.touch || this.pointerLocked) return;
    try {
      const result = this.canvas.requestPointerLock() as unknown;
      if (result instanceof Promise) result.catch(() => undefined);
    } catch {
      /* pointer lock unavailable: mouse look works only while locked */
    }
  }

  exitPointerLock(): void {
    if (this.pointerLocked) {
      this.releasingLock = true;
      document.exitPointerLock();
    }
  }

  reset(): void {
    this.keys.clear();
    this.move.set(0, 0);
    this.look.set(0, 0);
    this.stickVec.set(0, 0);
    this.run = this.interact = this.flashlight = this.pause = false;
    // Buttons still held (e.g. the A press that closed the pause menu) must be released first.
    this.padPrev = { a: true, y: true, start: true };
    if (this.knob) this.knob.style.transform = '';
  }

  /** Reads keyboard/gamepad/touch state into `move`/`run`; call once per frame. */
  poll(dt: number, lookSpeed: number): void {
    let x = 0;
    let y = 0;
    if (this.enabled) {
      if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) y += 1;
      if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) y -= 1;
      if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) x += 1;
      if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) x -= 1;
      this.run = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
      x += this.stickVec.x;
      y += this.stickVec.y;
      if (this.stickVec.length() > 0.92) this.run = true;
      const pad = typeof navigator.getGamepads === 'function' ? [...navigator.getGamepads()].find((p) => p && p.connected) : null;
      if (pad) {
        const dz = (v: number): number => (Math.abs(v) < 0.15 ? 0 : (v - Math.sign(v) * 0.15) / 0.85);
        x += dz(pad.axes[0] ?? 0);
        y -= dz(pad.axes[1] ?? 0);
        this.look.x += dz(pad.axes[2] ?? 0) * dt * 900 * lookSpeed;
        this.look.y += dz(pad.axes[3] ?? 0) * dt * 650 * lookSpeed;
        if (pad.buttons[10]?.pressed || pad.buttons[6]?.pressed) this.run = true;
        const a = Boolean(pad.buttons[0]?.pressed);
        const yb = Boolean(pad.buttons[3]?.pressed);
        const start = Boolean(pad.buttons[9]?.pressed);
        if (a && !this.padPrev.a) this.interact = true;
        if (yb && !this.padPrev.y) this.flashlight = true;
        if (start && !this.padPrev.start) this.pause = true;
        this.padPrev = { a, y: yb, start };
      }
    }
    this.move.set(x, y);
    if (this.move.lengthSq() > 1) this.move.normalize();
  }

  /** Clears one-shot actions and look deltas after the frame consumed them. */
  endFrame(): void {
    this.look.set(0, 0);
    this.interact = this.flashlight = this.pause = false;
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    if (!this.enabled || event.repeat) {
      if (event.repeat && this.enabled) this.keys.add(event.code);
      return;
    }
    const target = event.target as HTMLElement | null;
    if (target && target.closest('input, textarea, select')) return;
    this.keys.add(event.code);
    if (event.code === 'KeyE' || event.code === 'Enter') this.interact = true;
    if (event.code === 'KeyF') this.flashlight = true;
    if (event.code === 'KeyP') this.pause = true;
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(event.code)) event.preventDefault();
  };

  private onKeyUp = (event: KeyboardEvent): void => {
    this.keys.delete(event.code);
  };

  private onBlur = (): void => {
    this.keys.clear();
  };

  private onMouseMove = (event: MouseEvent): void => {
    if (!this.enabled || !this.pointerLocked) return;
    // Guard against occasional huge jumps reported by some browsers.
    if (Math.abs(event.movementX) > 400 || Math.abs(event.movementY) > 400) return;
    this.look.x += event.movementX;
    this.look.y += event.movementY;
  };

  private onMouseDown = (event: MouseEvent): void => {
    if (!this.enabled || !this.pointerLocked) return;
    if (event.button === 0) this.interact = true;
  };

  private onLockChange = (): void => {
    if (!this.pointerLocked && !this.releasingLock && this.attached) this.onPointerLockLost?.();
    this.releasingLock = false;
  };

  private buildTouch(): HTMLElement {
    this.knob = h('div', { class: 'touch-stick__knob' });
    this.stick = h('div', { class: 'touch-stick', 'aria-label': 'Andar' }, this.knob);
    const lookArea = h('div', { class: 'touch-look', 'aria-hidden': 'true' });
    const useBtn = h('button', { type: 'button', class: 'touch-btn', 'aria-label': 'Interagir' }, 'Usar');
    const lightBtn = h('button', { type: 'button', class: 'touch-btn', 'aria-label': 'Lanterna' }, 'Luz');
    useBtn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.interact = true;
    });
    lightBtn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.flashlight = true;
    });
    const stick = this.stick;
    stick.addEventListener('pointerdown', (e) => {
      this.stickId = e.pointerId;
      stick.setPointerCapture(e.pointerId);
      this.updateStick(e);
    });
    stick.addEventListener('pointermove', (e) => {
      if (e.pointerId === this.stickId) this.updateStick(e);
    });
    const endStick = (e: PointerEvent): void => {
      if (e.pointerId !== this.stickId) return;
      this.stickId = null;
      this.stickVec.set(0, 0);
      if (this.knob) this.knob.style.transform = '';
    };
    stick.addEventListener('pointerup', endStick);
    stick.addEventListener('pointercancel', endStick);
    lookArea.addEventListener('pointerdown', (e) => {
      this.lookId = e.pointerId;
      this.lookLast.set(e.clientX, e.clientY);
      lookArea.setPointerCapture(e.pointerId);
    });
    lookArea.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.lookId || !this.enabled) return;
      this.look.x += (e.clientX - this.lookLast.x) * 1.6;
      this.look.y += (e.clientY - this.lookLast.y) * 1.6;
      this.lookLast.set(e.clientX, e.clientY);
    });
    const endLook = (e: PointerEvent): void => {
      if (e.pointerId === this.lookId) this.lookId = null;
    };
    lookArea.addEventListener('pointerup', endLook);
    lookArea.addEventListener('pointercancel', endLook);
    return h('div', { class: 'touch-controls' }, lookArea, stick, h('div', { class: 'touch-buttons' }, useBtn, lightBtn));
  }

  private updateStick(e: PointerEvent): void {
    if (!this.stick || !this.knob) return;
    const rect = this.stick.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const max = rect.width / 2;
    let dx = e.clientX - cx;
    let dy = e.clientY - cy;
    const len = Math.hypot(dx, dy);
    if (len > max) {
      dx = (dx / len) * max;
      dy = (dy / len) * max;
    }
    this.stickVec.set(dx / max, -dy / max);
    this.knob.style.transform = `translate(${dx}px, ${dy}px)`;
  }
}
