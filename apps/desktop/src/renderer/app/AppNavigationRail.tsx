import { memo, useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';
import { CalendarClock, House, Plug, Server, Settings } from 'lucide-react';
import type { BealeProviderUsageLimits, ResearchModelProviderId } from '@shared/types';
import { ProviderIcon } from './ProviderIcon';

export type AppNavigationDestination = 'home' | 'automations' | 'plugins' | 'settings' | 'fleet';

const outlineIcons = {
  home: House,
  automations: CalendarClock,
  plugins: Plug,
  settings: Settings,
  fleet: Server
};

const limitProviderNames: Record<ResearchModelProviderId, string> = {
  'openai-codex': 'OpenAI',
  xai: 'xAI',
  anthropic: 'Anthropic',
  zai: 'Z.ai',
  openrouter: 'OpenRouter'
};

const limitProviderOrder: readonly ResearchModelProviderId[] = ['openai-codex', 'xai', 'anthropic', 'zai', 'openrouter'];
const LIMIT_REFRESH_INTERVAL_MS = 20 * 60_000;

function shortLimitLabel(label: string): string {
  return label.endsWith(' Limit') ? label.slice(0, -' Limit'.length) : label;
}

function resetLabel(resetsAt: string | null, remainingPercent: number): string {
  if (!resetsAt) return `${remainingPercent}% left`;
  const date = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(resetsAt));
  return `${remainingPercent}% left | ${date}`;
}

export function ProviderLimitTooltip({ limit }: { limit: BealeProviderUsageLimits }): JSX.Element {
  const providerName = limitProviderNames[limit.providerId];
  return (
    <div className="app-navigation-limits-menu" id={`app-navigation-limit-${limit.providerId}`} role="tooltip">
      <div className="app-navigation-limits-provider-name">{providerName}</div>
      {limit.windows.map((window) => {
        const remainingPercent = Math.round(100 - window.usedPercent);
        return (
          <div className="app-navigation-limits-row" key={window.id}>
            <span className="app-navigation-limits-label">{shortLimitLabel(window.label)}</span>
            <span className="app-navigation-limits-reset">{resetLabel(window.resetsAt, remainingPercent)}</span>
          </div>
        );
      })}
      <div className="app-navigation-limits-updated">Last Update {new Date(limit.checkedAt).toLocaleString()}</div>
    </div>
  );
}

export function ProviderLimitIndicator({ limit }: { limit: BealeProviderUsageLimits }): JSX.Element {
  const session = limit.windows.find((window) => window.label === 'Session Limit');
  const weekly = limit.windows.find((window) => window.label === 'Weekly Limit');
  const outer = weekly ?? limit.windows.find((window) => window !== session) ?? session ?? limit.windows[0];
  const inner = session && session !== outer ? session : null;
  const providerName = limitProviderNames[limit.providerId];
  const description = limit.windows.map((window) => `${shortLimitLabel(window.label)} ${Math.round(100 - window.usedPercent)}% left`).join(', ');

  return (
    <div className={`app-navigation-limit-icon${inner ? ' has-inner' : ''}`} role="group" tabIndex={0} aria-label={`${providerName} limits: ${description}`} aria-describedby={`app-navigation-limit-${limit.providerId}`}>
      <svg className="app-navigation-limit-rings" viewBox="0 0 36 36" aria-hidden="true">
        <circle className="app-navigation-limit-ring-track" cx="18" cy="18" r="16" />
        <circle className="app-navigation-limit-ring-outer-value" cx="18" cy="18" r="16" pathLength="100" strokeDasharray={`${Math.round(100 - outer.usedPercent)} 100`} data-limit={shortLimitLabel(outer.label)} />
        {inner ? (
          <>
            <circle className="app-navigation-limit-ring-track" cx="18" cy="18" r="10.5" />
            <circle className="app-navigation-limit-ring-inner-value" cx="18" cy="18" r="10.5" pathLength="100" strokeDasharray={`${Math.round(100 - inner.usedPercent)} 100`} data-limit={shortLimitLabel(inner.label)} />
          </>
        ) : null}
      </svg>
      <ProviderIcon className="app-navigation-limit-provider-icon" provider={limit.providerId} size={15} aria-hidden="true" />
      <ProviderLimitTooltip limit={limit} />
    </div>
  );
}

function NavigationIcon({ destination, active }: { destination: AppNavigationDestination; active: boolean }): JSX.Element {
  if (!active) {
    const Icon = outlineIcons[destination];
    return <Icon size={18} aria-hidden="true" />;
  }

  return (
    <svg aria-hidden="true" className="app-navigation-rail-filled-icon" fill="currentColor" height="18" viewBox="0 0 24 24" width="18" xmlns="http://www.w3.org/2000/svg">
      {destination === 'home' && (
        <path d="M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM10 21h4v-7a2 2 0 0 0-4 0z" fillRule="evenodd" />
      )}
      {destination === 'automations' && (
        <>
          <path d="M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM16 9a7 7 0 1 0 0 14 7 7 0 0 0 0-14z" fillRule="evenodd" />
          <path d="M8 2v4m8-4v4" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="2.5" />
          <circle cx="16" cy="16" fill="none" r="6" stroke="currentColor" strokeWidth="2" />
          <path d="M16 13v3l2 1.5" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
        </>
      )}
      {destination === 'plugins' && (
        <>
          <path d="M6 8h12v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4z" />
          <path d="M9 2v6m6-6v6m-3 9v5" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="2.5" />
        </>
      )}
      {destination === 'settings' && (
        <path d="M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.321-1.915zM15 12a3 3 0 1 0-6 0 3 3 0 0 0 6 0z" fillRule="evenodd" />
      )}
      {destination === 'fleet' && (
        <>
          <rect x="2" y="2" width="20" height="8" rx="2" />
          <rect x="2" y="14" width="20" height="8" rx="2" />
          <circle cx="6" cy="6" fill="var(--panel)" r="1.2" />
          <circle cx="6" cy="18" fill="var(--panel)" r="1.2" />
        </>
      )}
    </svg>
  );
}

export function resolveAppNavigationDestination({
  settingsOpen,
  fleetOpen,
  automationsOpen,
  pluginsOpen
}: {
  settingsOpen: boolean;
  fleetOpen: boolean;
  automationsOpen: boolean;
  pluginsOpen: boolean;
}): AppNavigationDestination {
  if (settingsOpen) return 'settings';
  if (fleetOpen) return 'fleet';
  if (automationsOpen) return 'automations';
  if (pluginsOpen) return 'plugins';
  return 'home';
}

export const AppNavigationRail = memo(function AppNavigationRail({
  active,
  selectedServerId = 'local',
  providerAuthRevision = '',
  onOpenHome,
  onOpenAutomations,
  onOpenPlugins,
  onOpenSettings,
  onOpenFleet
}: {
  active: AppNavigationDestination;
  selectedServerId?: string;
  providerAuthRevision?: string;
  onOpenHome: () => void;
  onOpenAutomations: () => void;
  onOpenPlugins: () => void;
  onOpenSettings: () => void;
  onOpenFleet: () => void;
}): JSX.Element {
  const [limits, setLimits] = useState<{
    serverId: string;
    byProvider: Partial<Record<ResearchModelProviderId, BealeProviderUsageLimits>>;
  }>({ serverId: '', byProvider: {} });
  const limitsRequestId = useRef(0);

  useEffect(() => {
    const refreshLimits = (): void => {
      const requestId = ++limitsRequestId.current;
      void (async () => {
        const results = await Promise.allSettled(limitProviderOrder.map((providerId) =>
          window.beale.getProviderUsageLimits(providerId, true, selectedServerId)));
        if (limitsRequestId.current !== requestId) return;
        setLimits((current) => {
          const next = current.serverId === selectedServerId ? { ...current.byProvider } : {};
          results.forEach((result, index) => {
            if (result.status !== 'fulfilled') return;
            const providerId = limitProviderOrder[index];
            if (result.value.providerId !== providerId) return;
            if (result.value.status === 'available') {
              if (result.value.windows.length) next[providerId] = result.value;
              else delete next[providerId];
            } else if (result.value.status === 'unsupported' || result.value.status === 'not_configured') {
              delete next[providerId];
            }
          });
          return { serverId: selectedServerId, byProvider: next };
        });
      })().catch(() => undefined);
    };
    refreshLimits();
    const timer = window.setInterval(refreshLimits, LIMIT_REFRESH_INTERVAL_MS);
    return () => { window.clearInterval(timer); limitsRequestId.current += 1; };
  }, [providerAuthRevision, selectedServerId]);

  const visibleLimits = limits.serverId === selectedServerId ? limits.byProvider : {};

  return (
    <nav className="app-navigation-rail" aria-label="Main navigation">
      <div className="app-navigation-rail-top">
        <button type="button" className={`app-navigation-rail-button${active === 'home' ? ' active' : ''}`} data-tooltip="Home" aria-label="Home" aria-current={active === 'home' ? 'page' : undefined} onClick={onOpenHome}>
          <NavigationIcon destination="home" active={active === 'home'} />
        </button>
        <div className="app-navigation-rail-sections">
          <button type="button" className={`app-navigation-rail-button${active === 'automations' ? ' active' : ''}`} data-tooltip="Automations" aria-label="Automations" aria-current={active === 'automations' ? 'page' : undefined} onClick={onOpenAutomations}>
            <NavigationIcon destination="automations" active={active === 'automations'} />
          </button>
          <button type="button" className={`app-navigation-rail-button${active === 'fleet' ? ' active' : ''}`} data-tooltip="Fleet" aria-label="Fleet" aria-current={active === 'fleet' ? 'page' : undefined} onClick={onOpenFleet}>
            <NavigationIcon destination="fleet" active={active === 'fleet'} />
          </button>
          <button type="button" className={`app-navigation-rail-button${active === 'plugins' ? ' active' : ''}`} data-tooltip="Plugins" aria-label="Plugins" aria-current={active === 'plugins' ? 'page' : undefined} onClick={onOpenPlugins}>
            <NavigationIcon destination="plugins" active={active === 'plugins'} />
          </button>
          <button type="button" className={`app-navigation-rail-button${active === 'settings' ? ' active' : ''}`} data-tooltip="Agent Settings" aria-label="Agent Settings" aria-current={active === 'settings' ? 'page' : undefined} onClick={onOpenSettings}>
            <NavigationIcon destination="settings" active={active === 'settings'} />
          </button>
        </div>
      </div>
      <div className="app-navigation-rail-bottom">
        {limitProviderOrder.map((providerId) => visibleLimits[providerId]?.windows.length
          ? <ProviderLimitIndicator key={providerId} limit={visibleLimits[providerId]} /> : null)}
      </div>
    </nav>
  );
});
