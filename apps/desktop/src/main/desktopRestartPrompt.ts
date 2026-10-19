export type DesktopRestartDecision = 'restart' | 'later';

export interface DesktopRestartPromptDependencies {
  showDialog(restartAvailable: boolean): Promise<DesktopRestartDecision>;
  wasRestartAttempted(): boolean;
  markRestartAttempt(): void;
  clearRestartAttempt(): void;
  relaunch(): void;
  exit(): void;
  reportFailure(error: unknown): void;
}

export class DesktopRestartPromptController {
  private dialog: Promise<boolean> | null = null;
  private dismissedServerContract: string | null = null;
  private restartRequested = false;

  public constructor(private readonly dependencies: DesktopRestartPromptDependencies) {}

  public prompt(serverContractTimestamp: string): Promise<boolean> {
    if (this.restartRequested) return Promise.resolve(false);
    if (this.dismissedServerContract === serverContractTimestamp) return Promise.resolve(true);
    if (this.dialog) return this.dialog;

    const restartAvailable = !this.dependencies.wasRestartAttempted();
    let markedAttempt = false;
    const pending = Promise.resolve()
      .then(() => this.dependencies.showDialog(restartAvailable))
      .then((decision) => {
        if (decision !== 'restart' || !restartAvailable) {
          this.dismissedServerContract = serverContractTimestamp;
          return true;
        }
        this.dependencies.markRestartAttempt();
        markedAttempt = true;
        this.dependencies.relaunch();
        this.restartRequested = true;
        this.dependencies.exit();
        return false;
      })
      .catch((error: unknown) => {
        if (markedAttempt) this.dependencies.clearRestartAttempt();
        this.dismissedServerContract = serverContractTimestamp;
        this.dependencies.reportFailure(error);
        return true;
      })
      .finally(() => {
        if (this.dialog === pending) this.dialog = null;
      });
    this.dialog = pending;
    return pending;
  }

  public compatible(): void {
    this.dependencies.clearRestartAttempt();
    this.dismissedServerContract = null;
  }
}
