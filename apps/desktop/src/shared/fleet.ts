import type { FleetState } from '@beale/app-server-runtime/protocol';

export interface FleetTargetChoice {
  id: string;
  name: string;
  ready: boolean;
  detail: string;
}

export function configuredWorkspaceTargets(state: FleetState, workspaceId: string): string[] {
  return state.workspaceTargets[workspaceId] ?? ['local', 'browser:in-agent'];
}

export function availableFleetTargets(state: FleetState): FleetTargetChoice[] {
  const targets: FleetTargetChoice[] = [
    { id: 'local', name: 'Local', ready: true, detail: 'Run on this machine' },
  ];
  if (state.enabled) {
    targets.push(...state.browsers.filter((browser) => browser.enabled).map((browser) => ({
      id: `browser:${browser.id}`, name: browser.name, ready: true,
      detail: browser.kind === 'embedded' ? 'In-Agent Browser' : 'Separate CDP profile',
    })));
    if (state.role === 'primary') {
      for (const machine of state.machines) {
        if (machine.canRun) targets.push({
          id: `vm:run:${machine.id}`, name: `${machine.name} · Run`,
          ready: machine.sshConfigured && machine.state !== 'unknown', detail: 'Run commands in this VM',
        });
        if (machine.canClone) targets.push({
          id: `vm:clone:${machine.id}`, name: `${machine.name} · Clone`,
          ready: machine.sshConfigured && machine.state === 'stopped', detail: 'Clone for this session',
        });
      }
    }
  }
  return targets;
}

export function allowedFleetTargets(state: FleetState, workspaceId: string): FleetTargetChoice[] {
  const allowed = new Set(configuredWorkspaceTargets(state, workspaceId));
  return availableFleetTargets(state).filter((target) => allowed.has(target.id));
}

export function defaultFleetMachineId(state: FleetState, workspaceId: string): string | null {
  const targets = allowedFleetTargets(state, workspaceId);
  const previous = state.lastMachineByWorkspace[workspaceId];
  return targets.find((target) => target.id === previous)?.id ?? targets.find((target) => target.ready)?.id ?? targets[0]?.id ?? null;
}

export function isAllowedFleetMachine(state: FleetState, workspaceId: string, targetId: string): boolean {
  return allowedFleetTargets(state, workspaceId).some((target) => target.id === targetId);
}
