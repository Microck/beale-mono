import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fleetBrowserExecutable } from './fleetBrowsers.js';
import { DEFAULT_BROWSER_HOME_PAGE } from '@beale/app-server-runtime/protocol';

interface BrowserSession { process: ChildProcess; profilePath: string; endpoint: string }
const activeBrowsers = new Set<ChildProcess>();
process.once('exit', () => { for (const browser of activeBrowsers) browser.kill(); });

export class FleetBrowserSessionManager {
  private readonly sessions = new Map<string, BrowserSession>();

  public endpoint(sessionId: string): string | null { return this.sessions.get(sessionId)?.endpoint ?? null; }

  public constructor(
    private readonly resolveExecutable: (browserId: string) => string | null = fleetBrowserExecutable,
    private readonly spawnBrowser: (executable: string, args: readonly string[]) => ChildProcess =
      (executable, args) => spawn(executable, [...args], { stdio: 'ignore', windowsHide: true }),
  ) {}

  public async launch(sessionId: string, browserId: string, homePage = DEFAULT_BROWSER_HOME_PAGE): Promise<string> {
    const existing = this.sessions.get(sessionId);
    if (existing) return existing.endpoint;
    const executable = this.resolveExecutable(browserId);
    if (!executable) throw new Error('The selected Fleet browser is no longer installed.');
    const profilePath = await mkdtemp(join(tmpdir(), 'beale-cdp-'));
    const child = this.spawnBrowser(executable, [
      `--user-data-dir=${profilePath}`, '--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1',
      '--no-first-run', '--no-default-browser-check', homePage,
    ]);
    let launchError: Error | null = null;
    child.once('error', (error) => { launchError = error; });
    try {
      const activePortPath = join(profilePath, 'DevToolsActivePort');
      for (let attempt = 0; attempt < 100; attempt += 1) {
        if (launchError) throw launchError;
        if (child.exitCode !== null) throw new Error('The selected Fleet browser exited before CDP became ready.');
        try {
          const activePort = (await readFile(activePortPath, 'utf8')).split(/\r?\n/u)[0]?.trim();
          const port = Number(activePort);
          if (Number.isInteger(port) && port > 0 && port < 65536) {
            const endpoint = `http://127.0.0.1:${port}`;
            this.sessions.set(sessionId, { process: child, profilePath, endpoint });
            activeBrowsers.add(child);
            return endpoint;
          }
        } catch { /* Browser profile may still be starting. */ }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      throw new Error('The selected Fleet browser did not expose a CDP endpoint.');
    } catch (error) {
      child.kill();
      await waitForExit(child);
      await removeProfile(profilePath);
      throw error;
    }
  }

  public async close(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    this.sessions.delete(sessionId);
    activeBrowsers.delete(session.process);
    session.process.kill();
    await waitForExit(session.process);
    await removeProfile(session.profilePath);
  }

  public async closeAll(): Promise<void> {
    await Promise.allSettled([...this.sessions.keys()].map((sessionId) => this.close(sessionId)));
  }
}

function waitForExit(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    const timeout = setTimeout(resolve, 2_000);
    child.once('exit', () => { clearTimeout(timeout); resolve(); });
  });
}

async function removeProfile(profilePath: string): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try { await rm(profilePath, { recursive: true, force: true }); return; }
    catch (error) {
      if (attempt === 2) throw error;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
}
