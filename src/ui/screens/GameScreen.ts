/** Base screen while the prologue is running; Escape/back opens the pause menu. */
import { Screen } from '../ScreenManager';

export class GameScreen extends Screen {
  readonly id = 'game';

  constructor(readonly root: HTMLElement, private readonly onPause: () => void) {
    super();
  }

  override show(): void {
    this.root.hidden = false;
  }

  override hide(): void {
    /* the HUD visibility is controlled by the prologue */
  }

  override initialFocus(): HTMLElement | null {
    return null;
  }

  override onBack(): boolean {
    this.onPause();
    return true;
  }
}
