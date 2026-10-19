import { describe, expect, it, vi } from 'vitest';
import { DesktopRestartPromptController, type DesktopRestartDecision } from '../src/main/desktopRestartPrompt';

function fixture() {
  let attempted = false;
  const decisions: DesktopRestartDecision[] = [];
  const showDialog = vi.fn(async (_restartAvailable: boolean): Promise<DesktopRestartDecision> => decisions.shift() ?? 'later');
  const relaunch = vi.fn();
  const exit = vi.fn();
  const reportFailure = vi.fn();
  const dependencies = {
    showDialog,
    wasRestartAttempted: () => attempted,
    markRestartAttempt: () => { attempted = true; },
    clearRestartAttempt: () => { attempted = false; },
    relaunch,
    exit,
    reportFailure
  };
  return { decisions, showDialog, relaunch, exit, reportFailure, dependencies,
    attempted: () => attempted };
}

describe('Desktop restart prompt', () => {
  it('shares one dialog across duplicate startup notifications and honors Not Now', async () => {
    const state = fixture();
    state.decisions.push('later');
    const controller = new DesktopRestartPromptController(state.dependencies);
    const first = controller.prompt('server-version-example');
    const second = controller.prompt('server-version-example');
    expect(second).toBe(first);
    await expect(first).resolves.toBe(true);
    await expect(controller.prompt('server-version-example')).resolves.toBe(true);
    expect(state.showDialog).toHaveBeenCalledTimes(1);
    expect(state.relaunch).not.toHaveBeenCalled();
  });

  it('restarts once and explains when the same Desktop build starts again', async () => {
    const state = fixture();
    state.decisions.push('restart');
    const firstProcess = new DesktopRestartPromptController(state.dependencies);
    await expect(firstProcess.prompt('server-version-example')).resolves.toBe(false);
    await expect(firstProcess.prompt('server-version-example')).resolves.toBe(false);
    expect(state.relaunch).toHaveBeenCalledTimes(1);
    expect(state.exit).toHaveBeenCalledTimes(1);
    expect(state.attempted()).toBe(true);

    const relaunchedProcess = new DesktopRestartPromptController(state.dependencies);
    await expect(relaunchedProcess.prompt('server-version-example')).resolves.toBe(true);
    expect(state.showDialog).toHaveBeenLastCalledWith(false);
    expect(state.relaunch).toHaveBeenCalledTimes(1);
    await expect(relaunchedProcess.prompt('server-version-example')).resolves.toBe(true);
    expect(state.showDialog).toHaveBeenCalledTimes(2);

    relaunchedProcess.compatible();
    expect(state.attempted()).toBe(false);
  });

  it('clears the restart attempt when relaunch fails', async () => {
    const state = fixture();
    state.decisions.push('restart');
    state.relaunch.mockImplementation(() => { throw new Error('Synthetic relaunch failure.'); });
    const controller = new DesktopRestartPromptController(state.dependencies);
    await expect(controller.prompt('server-version-example')).resolves.toBe(true);
    expect(state.attempted()).toBe(false);
    expect(state.exit).not.toHaveBeenCalled();
    expect(state.reportFailure).toHaveBeenCalledWith(expect.objectContaining({ message: 'Synthetic relaunch failure.' }));
  });
});
