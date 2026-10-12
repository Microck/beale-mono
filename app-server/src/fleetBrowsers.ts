import { existsSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { join } from 'node:path';
import type { FleetBrowser } from '@beale/app-server-runtime/protocol';

interface BrowserInstall {
  id: string;
  name: string;
  windowsPaths: readonly string[];
  macApp: string;
  macExecutable: string;
}

const BROWSER_INSTALLS: readonly BrowserInstall[] = [
  { id: 'chrome', name: 'Google Chrome', windowsPaths: ['Google/Chrome/Application/chrome.exe'], macApp: 'Google Chrome.app', macExecutable: 'Google Chrome' },
  { id: 'edge', name: 'Microsoft Edge', windowsPaths: ['Microsoft/Edge/Application/msedge.exe'], macApp: 'Microsoft Edge.app', macExecutable: 'Microsoft Edge' },
  { id: 'brave', name: 'Brave', windowsPaths: ['BraveSoftware/Brave-Browser/Application/brave.exe'], macApp: 'Brave Browser.app', macExecutable: 'Brave Browser' },
  { id: 'chromium', name: 'Chromium', windowsPaths: ['Chromium/Application/chrome.exe'], macApp: 'Chromium.app', macExecutable: 'Chromium' },
  { id: 'vivaldi', name: 'Vivaldi', windowsPaths: ['Vivaldi/Application/vivaldi.exe'], macApp: 'Vivaldi.app', macExecutable: 'Vivaldi' },
  { id: 'opera', name: 'Opera', windowsPaths: ['Programs/Opera/launcher.exe', 'Opera/launcher.exe'], macApp: 'Opera.app', macExecutable: 'Opera' },
];

export function detectFleetBrowsers(
  hostPlatform = platform(),
  home = homedir(),
  environment: NodeJS.ProcessEnv = process.env,
  pathExists: (path: string) => boolean = existsSync,
): FleetBrowser[] {
  const browsers: FleetBrowser[] = [{ id: 'in-agent', name: 'In-Agent Browser', kind: 'embedded', enabled: true }];
  for (const install of BROWSER_INSTALLS) {
    if (browserExecutableCandidates(install, hostPlatform, home, environment).some(pathExists)) {
      browsers.push({ id: install.id, name: install.name, kind: 'external', enabled: true });
    }
  }
  return browsers;
}

export function fleetBrowserExecutable(
  browserId: string,
  hostPlatform = platform(),
  home = homedir(),
  environment: NodeJS.ProcessEnv = process.env,
  pathExists: (path: string) => boolean = existsSync,
): string | null {
  const install = BROWSER_INSTALLS.find((candidate) => candidate.id === browserId);
  return install?.id ? browserExecutableCandidates(install, hostPlatform, home, environment).find(pathExists) ?? null : null;
}

function browserExecutableCandidates(install: BrowserInstall, hostPlatform: string, home: string, environment: NodeJS.ProcessEnv): string[] {
  if (hostPlatform === 'darwin') {
    return ['/Applications', join(home, 'Applications')].map((root) => join(root, install.macApp, 'Contents', 'MacOS', install.macExecutable));
  }
  if (hostPlatform === 'win32') {
    const roots = [environment.PROGRAMFILES, environment['PROGRAMFILES(X86)'], environment.LOCALAPPDATA].filter((root): root is string => Boolean(root));
    return roots.flatMap((root) => install.windowsPaths.map((relative) => join(root, ...relative.split('/'))));
  }
  return [];
}
