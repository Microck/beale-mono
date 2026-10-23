import type {
  HostEnvironment,
  ResearchSessionSummary,
  RunDetail,
  RunStatus,
  WindowChromeState,
  WorkspaceSnapshot
} from '@shared/types';
import type { SessionHeat } from './sessionHeat';

export function selectedRunStatus(
  snapshot: WorkspaceSnapshot | null,
  selectedRunId: string | null,
  registrySessions: readonly Pick<ResearchSessionSummary, 'runId' | 'workspaceId' | 'status'>[] = []
): RunStatus | null {
  if (!snapshot || !selectedRunId) return null;
  // Track epochs reuse a session ID. Its registry row is refreshed while a
  // workspace snapshot can still describe the previous, terminal attempt.
  if (registrySessions.some((session) => session.runId === selectedRunId
    && session.workspaceId === snapshot.workspace.workspaceId && session.status === 'active')) return 'active';
  return snapshot.runs.find((row) => row.run.id === selectedRunId)?.run.status ?? null;
}

export function activeRunDetailForSelection(runDetail: RunDetail | null, selectedRunId: string | null): RunDetail | null {
  if (!runDetail || runDetail.run.id !== selectedRunId) return null;
  return runDetail;
}

export function shouldShowHeaderResearchControls(input: {
  researchDetailsAvailable: boolean;
  newResearchOpen: boolean;
  workspaceOpen: boolean;
  settingsOpen: boolean;
  fleetOpen: boolean;
  reportsOpen: boolean;
  automationsOpen: boolean;
  pluginsOpen: boolean;
}): boolean {
  return (input.researchDetailsAvailable || (input.newResearchOpen && input.workspaceOpen))
    && !input.settingsOpen
    && !input.fleetOpen
    && !input.reportsOpen
    && !input.automationsOpen
    && !input.pluginsOpen;
}

export function appShellClassName(input: {
  sessionHeat: SessionHeat;
  platform: HostEnvironment['platform'];
  windowChromeState: WindowChromeState;
  sidebarCollapsed: boolean;
}): string {
  return [
    'app-shell',
    `session-heat-${input.sessionHeat}`,
    `platform-${input.platform}`,
    input.windowChromeState.isMaximized || input.windowChromeState.isFullScreen ? 'window-edge-flush' : '',
    input.windowChromeState.isFullScreen ? 'window-full-screen' : '',
    input.sidebarCollapsed ? 'sidebar-collapsed' : ''
  ]
    .filter(Boolean)
    .join(' ');
}

export function windowControlPlatformForState(
  snapshot: WorkspaceSnapshot | null,
  hostEnvironment: HostEnvironment | null
): HostEnvironment['platform'] {
  return (snapshot?.workspace.hostEnvironment ?? hostEnvironment)?.platform ?? 'linux';
}
