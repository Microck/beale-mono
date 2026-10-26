import type { CommentaryMessage } from '../../view-models/commentary';

interface MessageSnapshot {
  id: string;
  text: string;
}

interface PendingMessage {
  id: string;
  characters: string[];
  shown: number;
}

export interface CommentaryStreamingState {
  scopeKey: string | null;
  source: MessageSnapshot[];
  pending: PendingMessage[];
  animatedIds: ReadonlySet<string>;
}

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
const charactersOf = (text: string): string[] => Array.from(segmenter.segment(text), ({ segment }) => segment);
const messageText = (message: CommentaryMessage): string => message.kind === 'progress'
  ? (message.reasoningTraceLines ?? [message.contentMarkdown]).join('\n')
  : message.contentMarkdown;

export function initialCommentaryStreamingState(
  scopeKey: string | null,
  messages: readonly CommentaryMessage[]
): CommentaryStreamingState {
  return {
    scopeKey,
    source: messages.map((message) => ({ id: message.id, text: messageText(message) })),
    pending: [],
    animatedIds: new Set()
  };
}

export function reconcileCommentaryStreaming(
  state: CommentaryStreamingState,
  scopeKey: string | null,
  messages: readonly CommentaryMessage[],
  animate: boolean,
  terminal = false
): CommentaryStreamingState {
  if (state.scopeKey !== scopeKey) return initialCommentaryStreamingState(scopeKey, messages);
  const source = messages.map((message) => ({ id: message.id, text: messageText(message) }));
  const unchanged = source.length === state.source.length && source.every((entry, index) =>
    entry.id === state.source[index]?.id && entry.text === state.source[index]?.text
  );
  const kindById = new Map(messages.map((message) => [message.id, message.kind]));
  const hasHiddenTerminalActivity = terminal && state.pending.some((entry) => {
    const kind = kindById.get(entry.id);
    return kind !== 'final_answer' && kind !== 'error';
  });
  if (!animate) return unchanged && state.pending.length === 0 ? state : initialCommentaryStreamingState(scopeKey, messages);
  if (unchanged && !hasHiddenTerminalActivity) return state;

  const previousById = new Map(state.source.map((entry) => [entry.id, entry.text]));
  const currentById = new Map(source.map((entry) => [entry.id, entry.text]));
  const pending = state.pending.flatMap((entry) => {
    const text = currentById.get(entry.id);
    if (text === undefined) return [];
    const kind = kindById.get(entry.id);
    if (terminal && kind !== 'final_answer' && kind !== 'error') return [];
    const previousText = previousById.get(entry.id) ?? '';
    if (!text.startsWith(previousText)) return [];
    return [{ ...entry, characters: charactersOf(text) }];
  });
  const queuedIds = new Set(pending.map((entry) => entry.id));
  const lastPrevious = state.source.at(-1);
  if (lastPrevious && !queuedIds.has(lastPrevious.id)
    && (!terminal || kindById.get(lastPrevious.id) === 'final_answer' || kindById.get(lastPrevious.id) === 'error')) {
    const updatedText = currentById.get(lastPrevious.id);
    if (updatedText?.startsWith(lastPrevious.text) && updatedText.length > lastPrevious.text.length) {
      pending.push({ id: lastPrevious.id, characters: charactersOf(updatedText), shown: charactersOf(lastPrevious.text).length });
      queuedIds.add(lastPrevious.id);
    }
  }

  let lastKnownIndex = -1;
  source.forEach((entry, index) => {
    if (previousById.has(entry.id)) lastKnownIndex = index;
  });
  const animatedIds = new Set(state.animatedIds);
  for (const message of messages.slice(lastKnownIndex + 1)) {
    if (previousById.has(message.id) || queuedIds.has(message.id)) continue;
    if (terminal && message.kind !== 'final_answer' && message.kind !== 'error') continue;
    const characters = charactersOf(messageText(message));
    pending.push({
      id: message.id,
      characters,
      shown: message.kind === 'user' || message.kind === 'marker' ? characters.length : 0
    });
    animatedIds.add(message.id);
  }
  return { scopeKey, source, pending, animatedIds };
}

export function advanceCommentaryStreaming(state: CommentaryStreamingState): CommentaryStreamingState {
  const first = state.pending[0];
  if (!first) return state;
  if (first.shown >= first.characters.length) return { ...state, pending: state.pending.slice(1) };
  return {
    ...state,
    pending: [{ ...first, shown: first.shown + 1 }, ...state.pending.slice(1)]
  };
}

export function visibleCommentaryMessages(
  state: CommentaryStreamingState,
  messages: readonly CommentaryMessage[]
): readonly CommentaryMessage[] {
  const first = state.pending[0];
  if (!first) return messages;
  const activeIndex = messages.findIndex((message) => message.id === first.id);
  if (activeIndex < 0) return messages;
  const visible = messages.slice(0, activeIndex + 1);
  const message = visible[activeIndex];
  const text = first.characters.slice(0, first.shown).join('');
  visible[activeIndex] = message.kind === 'progress'
    ? { ...message, contentMarkdown: text, reasoningTraceLines: text ? text.split('\n').filter((line, index, lines) => line || index < lines.length - 1) : [] }
    : { ...message, contentMarkdown: text };
  return visible;
}
