/**
 * Screen management: one base screen (menu, game…) plus a stack of overlays (settings, dialogs).
 * Handles focus restoration, Escape/back, focus trapping for dialogs and gamepad navigation.
 */
import type { ShotName } from '../world/cameraRig';
import { focusableWithin, trapFocus } from './components/controls';

export abstract class Screen {
  abstract readonly id: string;
  abstract readonly root: HTMLElement;
  /** Camera shot to use while this screen is on top (null keeps the current one). */
  shot: ShotName | null = null;
  /** Overlays trap focus and close with Escape. */
  overlay = false;
  protected manager!: ScreenManager;

  attach(manager: ScreenManager): void {
    this.manager = manager;
  }

  /** Element focused when the screen opens. */
  initialFocus(): HTMLElement | null {
    return focusableWithin(this.root)[0] ?? null;
  }

  show(): void {
    this.root.hidden = false;
    // Allow the element to be laid out before transitioning.
    requestAnimationFrame(() => this.root.classList.add('is-visible'));
    this.onShow();
  }

  hide(): void {
    this.root.classList.remove('is-visible');
    this.onHide();
  }

  protected onShow(): void {}
  protected onHide(): void {}

  /** Return true if the back action was handled (e.g. closing a sub-state). */
  onBack(): boolean {
    return false;
  }
}

export interface ScreenManagerHooks {
  onShotChange?: (shot: ShotName) => void;
  onOpen?: (screen: Screen) => void;
  onClose?: (screen: Screen) => void;
}

export class ScreenManager {
  private base: Screen | null = null;
  private readonly stack: Screen[] = [];
  private readonly focusMemory = new Map<Screen, HTMLElement | null>();
  private gamepadEnabled = true;
  private lastPad = { up: false, down: false, left: false, right: false, a: false, b: false };
  private padRepeatAt = 0;

  constructor(private readonly container: HTMLElement, private readonly hooks: ScreenManagerHooks = {}) {
    document.addEventListener('keydown', this.onKeyDown);
  }

  get top(): Screen | null {
    return this.stack[this.stack.length - 1] ?? this.base;
  }

  get hasOverlay(): boolean {
    return this.stack.length > 0;
  }

  register(screen: Screen): void {
    screen.attach(this);
    if (!screen.root.isConnected) {
      screen.root.hidden = true;
      this.container.append(screen.root);
    }
  }

  setBase(screen: Screen): void {
    while (this.stack.length) this.closeTop(false);
    if (this.base && this.base !== screen) {
      this.base.root.classList.remove('is-covered');
      this.base.hide();
    }
    this.base = screen;
    screen.show();
    this.applyShot();
    this.focus(screen);
    this.hooks.onOpen?.(screen);
  }

  open(screen: Screen): void {
    if (this.stack.includes(screen)) return;
    const current = this.top;
    if (current) this.focusMemory.set(current, document.activeElement as HTMLElement | null);
    this.stack.push(screen);
    this.updateCovered();
    screen.show();
    this.applyShot();
    this.focus(screen);
    this.hooks.onOpen?.(screen);
  }

  close(screen: Screen): void {
    const index = this.stack.indexOf(screen);
    if (index === -1) return;
    while (this.stack.length > index) this.closeTop(true);
  }

  back(): void {
    const top = this.top;
    if (!top) return;
    if (top.onBack()) return;
    if (this.stack.length > 0) this.closeTop(true);
  }

  private closeTop(restore: boolean): void {
    const screen = this.stack.pop();
    if (!screen) return;
    screen.hide();
    this.updateCovered();
    this.hooks.onClose?.(screen);
    this.applyShot();
    const next = this.top;
    if (restore && next) {
      const remembered = this.focusMemory.get(next);
      window.setTimeout(() => {
        if (remembered && remembered.isConnected && !remembered.hasAttribute('disabled')) remembered.focus({ preventScroll: true });
        else this.focus(next);
      }, 30);
    }
  }

  /** The base screen fades out while an overlay is on top, so panels stay readable. */
  private updateCovered(): void {
    this.base?.root.classList.toggle('is-covered', this.stack.length > 0);
    this.stack.forEach((s, i) => s.root.classList.toggle('is-covered', i < this.stack.length - 1));
  }

  private applyShot(): void {
    for (let i = this.stack.length - 1; i >= 0; i--) {
      const shot = this.stack[i]!.shot;
      if (shot) return this.hooks.onShotChange?.(shot);
    }
    if (this.base?.shot) this.hooks.onShotChange?.(this.base.shot);
  }

  private focus(screen: Screen): void {
    window.setTimeout(() => {
      const target = screen.initialFocus();
      target?.focus({ preventScroll: true });
    }, 60);
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    const top = this.top;
    if (!top) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      this.back();
      return;
    }
    if (top.overlay) trapFocus(top.root, event);
    // Arrow-key navigation through vertical lists (menu, pause menu).
    if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && top.root.dataset.arrowNav === 'true') {
      const target = event.target as HTMLElement;
      if (target.closest('input, textarea, select, [role="radiogroup"]')) return;
      event.preventDefault();
      this.moveFocus(event.key === 'ArrowDown' ? 1 : -1);
    }
  };

  setGamepadEnabled(enabled: boolean): void {
    this.gamepadEnabled = enabled;
  }

  /** Moves focus to the next/previous focusable element of the top screen. */
  moveFocus(direction: 1 | -1): void {
    const top = this.top;
    if (!top) return;
    const items = focusableWithin(top.root);
    if (items.length === 0) return;
    const index = items.indexOf(document.activeElement as HTMLElement);
    const next = items[(index + direction + items.length) % items.length]!;
    next.focus();
  }

  /** Polls gamepads for menu navigation; call once per frame while menus are active. */
  pollGamepad(now: number): void {
    if (!this.gamepadEnabled || typeof navigator.getGamepads !== 'function') return;
    const pad = [...navigator.getGamepads()].find((p) => p && p.connected);
    if (!pad) return;
    const axisY = pad.axes[1] ?? 0;
    const axisX = pad.axes[0] ?? 0;
    const state = {
      up: Boolean(pad.buttons[12]?.pressed) || axisY < -0.6,
      down: Boolean(pad.buttons[13]?.pressed) || axisY > 0.6,
      left: Boolean(pad.buttons[14]?.pressed) || axisX < -0.6,
      right: Boolean(pad.buttons[15]?.pressed) || axisX > 0.6,
      a: Boolean(pad.buttons[0]?.pressed),
      b: Boolean(pad.buttons[1]?.pressed),
    };
    const repeat = now > this.padRepeatAt;
    if ((state.down && (!this.lastPad.down || repeat)) || (state.right && !this.lastPad.right && this.isList())) {
      this.moveFocus(1);
      this.padRepeatAt = now + 220;
    } else if ((state.up && (!this.lastPad.up || repeat)) || (state.left && !this.lastPad.left && this.isList())) {
      this.moveFocus(-1);
      this.padRepeatAt = now + 220;
    } else if (state.left && !this.lastPad.left) {
      this.nudgeActive(-1);
    } else if (state.right && !this.lastPad.right) {
      this.nudgeActive(1);
    }
    if (state.a && !this.lastPad.a) {
      const el = document.activeElement as HTMLElement | null;
      if (el && el !== document.body) el.click();
      else if (this.top) this.focus(this.top);
    }
    if (state.b && !this.lastPad.b) this.back();
    if (!state.up && !state.down) this.padRepeatAt = 0;
    this.lastPad = state;
  }

  private isList(): boolean {
    return this.top?.root.dataset.arrowNav === 'true';
  }

  /** Left/right on sliders and segmented controls. */
  private nudgeActive(direction: 1 | -1): void {
    const el = document.activeElement as HTMLElement | null;
    if (!el) return;
    if (el instanceof HTMLInputElement && el.type === 'range') {
      const step = Number(el.step) || 1;
      el.value = String(Math.min(Number(el.max), Math.max(Number(el.min), Number(el.value) + step * direction)));
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }
    if (el.getAttribute('role') === 'radio') {
      el.dispatchEvent(new KeyboardEvent('keydown', { key: direction > 0 ? 'ArrowRight' : 'ArrowLeft', bubbles: true }));
    }
  }

  dispose(): void {
    document.removeEventListener('keydown', this.onKeyDown);
  }
}
