import { useEffect, useState } from 'react';
import type { JSX } from 'react';
import type { BealeAppServerQuickChatSummary, FleetRemoteCatalog } from '@beale/app-server-runtime/protocol';
import type {
  ResearchModelEffortLevel, ResearchModelProviderId, ResearchModelSelection, ResearchProviderModelCatalog
} from '../../../shared/types';
import { QuickChatDock } from '../quick-chat/QuickChatDock';

export interface RemoteQuickChatDescriptor {
  id: string;
  serverId: string;
  workspaceId?: string;
  sessionId?: string;
}

function researchProviderId(value: string): value is ResearchModelProviderId {
  return value === 'openai-codex' || value === 'anthropic' || value === 'xai'
    || value === 'zai' || value === 'openrouter';
}

function researchEffort(value: string): value is ResearchModelEffortLevel {
  return value === 'off' || value === 'minimal' || value === 'low' || value === 'medium'
    || value === 'high' || value === 'xhigh' || value === 'max';
}

export function remoteQuickChatModels(catalog: FleetRemoteCatalog | null): {
  models: ResearchProviderModelCatalog[];
  initialSelection?: ResearchModelSelection;
} {
  const providers = catalog?.providerCatalog.providers.filter((provider) => researchProviderId(provider.providerId)) ?? [];
  const models: ResearchProviderModelCatalog[] = providers.map((provider) => ({
    providerId: provider.providerId as ResearchModelProviderId,
    providerName: provider.providerName,
    models: provider.models.map((model) => ({
      id: model.id, name: model.name, reasoning: model.reasoning,
      effortLevels: model.effortLevels.filter(researchEffort), contextWindow: 0, maxTokens: 0
    }))
  }));
  const preferred = providers.find((provider) => provider.providerId === catalog?.providerCatalog.defaultProviderId && provider.models.length > 0)
    ?? providers.find((provider) => provider.models.length > 0);
  const model = preferred?.models.find((candidate) => candidate.id === preferred.defaultLeadModel)
    ?? preferred?.models[0];
  const initialSelection = preferred && model ? {
    provider: preferred.providerId as ResearchModelProviderId,
    model: model.id,
    reasoningEffort: researchEffort(preferred.defaultReasoningEffort ?? '')
      ? preferred.defaultReasoningEffort as ResearchModelEffortLevel : 'high'
  } : undefined;
  return { models, initialSelection };
}

export function RemoteQuickChatDock({ serverId, catalog, chats, onClose, onStarted }: {
  serverId: string;
  catalog: FleetRemoteCatalog | null;
  chats: RemoteQuickChatDescriptor[];
  onClose: (id: string) => void;
  onStarted: (id: string, workspaceId: string, sessionId: string) => void;
}): JSX.Element | null {
  const [history, setHistory] = useState<BealeAppServerQuickChatSummary[]>([]);
  const [historyRevision, setHistoryRevision] = useState(0);
  useEffect(() => {
    if (chats.length === 0) return undefined;
    let active = true;
    void window.beale.getFleetRemoteQuickChats(serverId)
      .then((list) => { if (active) setHistory(list.chats); })
      .catch(() => { if (active) setHistory([]); });
    return () => { active = false; };
  }, [serverId, chats.length, historyRevision]);
  const { models, initialSelection } = remoteQuickChatModels(catalog);
  return <QuickChatDock
    chats={chats.map((chat) => ({ id: chat.id,
      remote: { serverId: chat.serverId, workspaceId: chat.workspaceId, sessionId: chat.sessionId } }))}
    providerModelCatalog={models}
    initialModelSelection={initialSelection}
    remoteHistory={history.filter((item) => !chats.some((chat) => chat.sessionId === item.sessionId))}
    onClose={onClose}
    onRunStarted={() => undefined}
    onRemoteStarted={(id, workspaceId, sessionId) => {
      onStarted(id, workspaceId, sessionId);
      setHistoryRevision((revision) => revision + 1);
    }}
  />;
}
