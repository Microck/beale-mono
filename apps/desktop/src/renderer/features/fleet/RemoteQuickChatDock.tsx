import { useEffect, useMemo, useState } from 'react';
import type { JSX } from 'react';
import { ChevronDown, ChevronUp, MessageSquare, X } from 'lucide-react';
import type { BealeAppServerQuickChatSummary } from '@beale/app-server-runtime/protocol';
import { CommentaryView } from '../commentary/CommentaryView';
import { BealeWelcomeIcon } from '../../app/BealeWelcomeIcon';
import { buildTraceDisplayEventsForAgentPath } from '../../view-models/traceDisplay';
import { mergeRemoteSessionHistory, remoteRunDetail, remoteSessionHistoryPage } from './remoteFleetProjection';
import type { RemoteSessionHistoryPage } from './remoteFleetProjection';

export interface RemoteQuickChatDescriptor {
  id: string;
  serverId: string;
  workspaceId?: string;
  sessionId?: string;
}

export function RemoteQuickChatDock({ serverId, chats, onClose, onStarted }: {
  serverId: string;
  chats: RemoteQuickChatDescriptor[];
  onClose: (id: string) => void;
  onStarted: (id: string, workspaceId: string, sessionId: string) => void;
}): JSX.Element | null {
  const [history, setHistory] = useState<BealeAppServerQuickChatSummary[]>([]);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyRevision, setHistoryRevision] = useState(0);
  useEffect(() => {
    if (chats.length === 0) return;
    let active = true;
    void window.beale.getFleetRemoteQuickChats(serverId)
      .then((list) => { if (active) { setHistory(list.chats); setHistoryError(null); } })
      .catch((error: unknown) => { if (active) setHistoryError(message(error)); });
    return () => { active = false; };
  }, [serverId, chats.length, historyRevision]);
  if (chats.length === 0) return null;
  return <aside className="quick-chat-dock" aria-label="Remote quick chats">
    {chats.map((chat) => <RemoteQuickChatCard
      key={chat.id}
      chat={chat}
      history={history.filter((item) => !chats.some((open) => open.sessionId === item.sessionId))}
      historyError={historyError}
      onClose={onClose}
      onStarted={(id, workspaceId, sessionId) => { onStarted(id, workspaceId, sessionId); setHistoryRevision((revision) => revision + 1); }}
    />)}
  </aside>;
}

function RemoteQuickChatCard({ chat, history, historyError, onClose, onStarted }: {
  chat: RemoteQuickChatDescriptor;
  history: BealeAppServerQuickChatSummary[];
  historyError: string | null;
  onClose: (id: string) => void;
  onStarted: (id: string, workspaceId: string, sessionId: string) => void;
}): JSX.Element {
  const [collapsed, setCollapsed] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<unknown>(null);
  const [olderPages, setOlderPages] = useState<RemoteSessionHistoryPage[]>([]);
  useEffect(() => {
    setDetail(null);
    setOlderPages([]);
    if (!chat.workspaceId || !chat.sessionId) return;
    let active = true;
    const refresh = (): void => {
      void window.beale.getFleetRemoteSession(chat.serverId, chat.workspaceId!, chat.sessionId!)
        .then((value) => { if (active) { setDetail(value); setError(null); } })
        .catch((caught: unknown) => { if (active) setError(message(caught)); });
    };
    refresh();
    const interval = window.setInterval(refresh, 3_000);
    return () => { active = false; window.clearInterval(interval); };
  }, [chat.serverId, chat.workspaceId, chat.sessionId]);
  const runDetail = useMemo(() => remoteRunDetail(mergeRemoteSessionHistory(detail, olderPages)), [detail, olderPages]);
  const events = useMemo(() => runDetail ? buildTraceDisplayEventsForAgentPath(runDetail, null) : [], [runDetail]);
  const start = async (): Promise<void> => {
    if (!prompt.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await window.beale.startFleetRemoteQuickChat(chat.serverId, { promptMarkdown: prompt.trim() });
      onStarted(chat.id, result.workspaceId, result.sessionId);
      setPrompt('');
    } catch (caught) { setError(message(caught)); }
    finally { setBusy(false); }
  };
  const control = async (type: 'pause' | 'resume' | 'stop' | 'steer', instruction?: string): Promise<void> => {
    if (!chat.sessionId || busy) return;
    setBusy(true);
    setError(null);
    try {
      if (type === 'steer' && instruction?.trim() && chat.workspaceId
        && runDetail?.run.status && ['blocked', 'completed', 'failed', 'stopped'].includes(runDetail.run.status)) {
        await window.beale.continueFleetRemoteQuickChat(chat.serverId, chat.workspaceId, chat.sessionId, instruction);
        setDetail(null);
        setOlderPages([]);
      } else {
        await window.beale.controlFleetRemoteSession(chat.serverId, chat.sessionId, type, instruction);
        if (type === 'steer' && runDetail?.run.status === 'paused') {
          await window.beale.controlFleetRemoteSession(chat.serverId, chat.sessionId, 'resume');
        }
      }
    }
    catch (caught) { setError(message(caught)); }
    finally { setBusy(false); }
  };
  const close = (): void => {
    if (chat.sessionId && (!runDetail || ['queued', 'active', 'paused'].includes(runDetail.run.status))) {
      void window.beale.controlFleetRemoteSession(chat.serverId, chat.sessionId, 'stop').catch(() => undefined);
    }
    onClose(chat.id);
  };
  const title = runDetail?.run.title || 'Quick Chat';
  return <section className={`quick-chat-card${collapsed ? ' is-collapsed' : ''}`} aria-label={title}>
    <header className="quick-chat-header">
      <MessageSquare size={14} aria-hidden="true" /><span title={title}>{title}</span>
      <button type="button" title={collapsed ? 'Expand quick chat' : 'Collapse quick chat'} aria-label={collapsed ? 'Expand quick chat' : 'Collapse quick chat'} onClick={() => setCollapsed((value) => !value)}>
        {collapsed ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </button>
      <button type="button" title="Close quick chat" aria-label="Close quick chat" onClick={close}><X size={14} /></button>
    </header>
    {!collapsed ? <div className="quick-chat-body">
      {error ? <div className="quick-chat-error" role="alert">{error}</div> : null}
      {chat.sessionId ? <CommentaryView
        busy={busy}
        detail={runDetail}
        events={events}
        providerModelCatalog={[]}
        selectedRunId={chat.sessionId}
        showBackToMain={false}
        searchHighlightQuery=""
        onBackToMain={() => undefined}
        onLoadOlderHistory={async () => {
          const beforeEventId = runDetail?.historyCursor?.beforeEventId;
          if (!beforeEventId || !chat.workspaceId || !chat.sessionId) return false;
          try {
            const page = remoteSessionHistoryPage(await window.beale.getFleetRemoteSession(chat.serverId, chat.workspaceId, chat.sessionId, beforeEventId));
            if (!page || page.events.length === 0) return false;
            setOlderPages((current) => [page, ...current]);
            return true;
          } catch (caught) { setError(message(caught)); return false; }
        }}
        onSessionAction={(action) => {
          if (action.type === 'pause' || action.type === 'resume' || action.type === 'stop' || action.type === 'steer') {
            void control(action.type, action.type === 'resume' || action.type === 'steer' ? action.instruction : undefined);
          }
        }}
        onSteerInstruction={(_sessionId, instruction) => void control('steer', instruction)}
      /> : <div className="remote-quick-chat-start">
        <div className="quick-chat-empty-state"><BealeWelcomeIcon /><p>This chat will be saved on this app server.</p></div>
        <label><span>Message</span><textarea aria-label="Send a quick chat message" value={prompt} onChange={(event) => setPrompt(event.currentTarget.value)} placeholder="Any topic" rows={4} /></label>
        <button type="button" className="primary-button" disabled={busy || !prompt.trim()} onClick={() => void start()}>{busy ? 'Starting…' : 'Send'}</button>
        {historyError ? <p className="quick-chat-error" role="alert">{historyError}</p> : null}
        {history.length > 0 ? <div className="remote-quick-chat-history"><strong>Recent Quick Chats</strong>{history.slice(0, 8).map((item) =>
          <button type="button" key={item.sessionId} onClick={() => onStarted(chat.id, item.workspaceId, item.sessionId)}>{item.title}</button>
        )}</div> : null}
      </div>}
    </div> : null}
  </section>;
}

function message(error: unknown): string { return error instanceof Error ? error.message : String(error); }
