/**
 * Runs the real loading stages in order, reporting each one to the loading screen. There is no
 * fake percentage: progress is "completed stages / total stages", and a watchdog offers a way out
 * if a device takes too long.
 */
import { nextFrame } from '../core/dom';
import { AppError, toAppError } from '../core/errors';

export interface LoadingStage {
  label: string;
  run: () => Promise<void> | void;
}

export interface LoadingReporter {
  setStages(count: number): void;
  setStage(index: number, label: string): void;
  showSlowNotice(): void;
}

export class LoadingFlow {
  private cancelled = false;

  constructor(private readonly stages: LoadingStage[], private readonly reporter: LoadingReporter, private readonly slowAfterMs = 22000) {}

  cancel(): void {
    this.cancelled = true;
  }

  /** Resolves when all stages finished; rejects with an AppError on failure. */
  async run(): Promise<void> {
    this.reporter.setStages(this.stages.length);
    const watchdog = window.setTimeout(() => {
      if (!this.cancelled) this.reporter.showSlowNotice();
    }, this.slowAfterMs);
    try {
      for (let i = 0; i < this.stages.length; i++) {
        if (this.cancelled) throw new AppError('loading_timeout', 'Carregamento cancelado.');
        const stage = this.stages[i]!;
        this.reporter.setStage(i, stage.label);
        // Let the browser paint the new stage label before doing heavy work.
        await nextFrame();
        await nextFrame();
        try {
          await stage.run();
        } catch (error) {
          throw toAppError(error, 'scene_build_failed');
        }
      }
    } finally {
      window.clearTimeout(watchdog);
    }
  }
}
