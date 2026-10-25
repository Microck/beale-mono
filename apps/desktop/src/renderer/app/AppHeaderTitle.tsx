import { memo } from 'react';
import type { JSX } from 'react';
import { Archive, CalendarClock, FileText, Folder, Palette, Plug, Server, ServerCog, Settings, SlidersHorizontal, Ticket, UserRoundCog } from 'lucide-react';
import type { RunRecord } from '@shared/types';
import { displaySessionTitle } from '../../shared/sessionTitle';
import { useDevRenderProbe } from '../devInstrumentation';
import { displayWorkspaceHeaderName } from '../view-models/appHeader';
import type { SurfaceFocusSummary } from '../view-models/surfaceFocus';

export type AppHeaderViewIcon =
  | 'automations'
  | 'plugins'
  | 'fleet'
  | 'reporting'
  | 'settings'
  | 'settings-archive'
  | 'settings-appearance'
  | 'settings-optional-features'
  | 'settings-profiles'
  | 'settings-providers'
  | 'settings-ticketing';

export interface AppHeaderRun {
  run: Pick<RunRecord, 'id' | 'title' | 'promptMarkdown'>;
}

export const AppHeaderTitle = memo(function AppHeaderTitle({
  workspaceName,
  workspaceViewTitle,
  detail,
  surfaceFocus
}: {
  workspaceName: string;
  workspaceViewTitle?: string | null;
  detail: AppHeaderRun | null;
  surfaceFocus?: SurfaceFocusSummary | null;
}): JSX.Element {
  const workspaceLabel = displayWorkspaceHeaderName(workspaceName);
  const workspaceViewLabel = workspaceViewTitle?.trim() || null;
  const sessionTitle = !workspaceViewLabel && detail
    ? displaySessionTitle(detail.run.title, detail.run.promptMarkdown)
    : null;
  const surfaceLabel = sessionTitle && surfaceFocus
    ? `${surfaceFocus.name}${surfaceFocus.additionalCount > 0 ? ` +${surfaceFocus.additionalCount}` : ''}`
    : null;
  const headerSegments = [
    workspaceLabel,
    ...(workspaceViewLabel ? [workspaceViewLabel] : []),
    ...(sessionTitle ? [sessionTitle] : []),
    ...(surfaceLabel ? [surfaceLabel] : [])
  ];
  useDevRenderProbe('appHeaderTitle', () => ({
    workspace: workspaceLabel,
    run: detail?.run.id ?? 'none'
  }));

  return (
    <div className="app-header-title" aria-label={headerSegments.join(', ')}>
      <div className="app-header-identity">
        <span className="app-header-divider" aria-hidden="true" />
        <span className="app-header-workspace-title app-header-static-title" title={workspaceLabel}>
          <Folder className="app-header-view-icon" size={15} aria-hidden="true" />
          <span>{workspaceLabel}</span>
        </span>
        {workspaceViewLabel ? (
          <span className="app-header-session-title app-header-static-title" title={workspaceViewLabel}>
            <span>{workspaceViewLabel}</span>
          </span>
        ) : null}
        {detail && sessionTitle ? (
          <>
            <span className="app-header-session-title app-header-static-title" title={sessionTitle}>
              <span>{sessionTitle}</span>
            </span>
            {surfaceLabel ? (
              <span className="app-header-surface-title" title={surfaceLabel}>
                <span className="app-header-surface-name">{surfaceFocus!.name}</span>
                {surfaceFocus!.additionalCount > 0 ? <span className="app-header-surface-count">+{surfaceFocus!.additionalCount}</span> : null}
              </span>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  );
});

export const StaticAppHeaderTitle = memo(function StaticAppHeaderTitle({
  primaryTitle,
  secondaryTitle,
  icon
}: {
  primaryTitle: string;
  secondaryTitle: string;
  icon: AppHeaderViewIcon;
}): JSX.Element {
  const HeaderIcon = {
    automations: CalendarClock,
    plugins: Plug,
    fleet: Server,
    reporting: FileText,
    settings: Settings,
    'settings-archive': Archive,
    'settings-appearance': Palette,
    'settings-optional-features': SlidersHorizontal,
    'settings-profiles': UserRoundCog,
    'settings-providers': ServerCog,
    'settings-ticketing': Ticket
  }[icon];

  return (
    <div className="app-header-title" aria-label={`${primaryTitle}, ${secondaryTitle}`}>
      <div className="app-header-identity">
        <span className="app-header-divider" aria-hidden="true" />
        <span className="app-header-workspace-title app-header-static-title">
          <HeaderIcon className="app-header-view-icon" size={15} aria-hidden="true" />
          <span>{primaryTitle}</span>
        </span>
        <span className="app-header-session-title app-header-static-title">
          <span>{secondaryTitle}</span>
        </span>
      </div>
    </div>
  );
});
