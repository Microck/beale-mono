import { memo, useMemo } from 'react';
import type { JSX } from 'react';
import { ArrowLeft, ArrowRight, Lightbulb, RefreshCw } from 'lucide-react';
import type { ResearchGoalPhase } from '@shared/types';

const NEXT_STEP_COUNT = 3;

export interface ResearchGoalSeed {
  sentence: string;
  phase: ResearchGoalPhase;
  promptMarkdown?: string;
}

export const SessionNextStepsWidget = memo(function SessionNextStepsWidget({
  loading,
  suggestions,
  error,
  title = 'Suggestions',
  suggestionLimit = NEXT_STEP_COUNT,
  onBack,
  onRegenerate,
  onSelect
}: {
  loading: boolean;
  suggestions: readonly string[];
  error: string | null;
  title?: string | null;
  suggestionLimit?: number;
  onBack?: () => void;
  onRegenerate?: () => void;
  onSelect: (sentence: string) => void;
}): JSX.Element {
  const visibleSuggestions = useMemo(
    () => suggestions.slice(0, suggestionLimit),
    [suggestionLimit, suggestions]
  );
  return (
    <section className="session-next-steps" aria-label="Suggestions" aria-busy={loading}>
      <header className="session-next-steps-header">
        {title ? <h3>{title}</h3> : null}
        {onBack ? (
          <button type="button" className="session-next-steps-back" onClick={onBack}>
            <ArrowLeft size={14} aria-hidden="true" />
            Categories
          </button>
        ) : null}
        {onRegenerate ? (
          <button type="button" className="session-next-steps-regenerate" onClick={onRegenerate} disabled={loading}>
            <RefreshCw size={14} aria-hidden="true" />
            {error ? 'Retry' : 'Regenerate'}
          </button>
        ) : null}
      </header>
      <div className="session-next-steps-list">
        {visibleSuggestions.map((suggestion) => (
          <button type="button" className="session-next-step-button" key={suggestion} onClick={() => onSelect(suggestion)}>
            <Lightbulb className="session-next-step-icon" size={14} aria-hidden="true" />
            <span>{suggestion}</span>
            <ArrowRight size={14} aria-hidden="true" />
          </button>
        ))}
        {loading ? Array.from({ length: Math.max(0, suggestionLimit - visibleSuggestions.length) }, (_, index) => (
          <div className="session-next-step-skeleton" key={`loading-${index}`} aria-hidden="true"><span /></div>
        )) : null}
        {error ? <div className="session-next-steps-error" role="alert">{error}</div> : null}
        {!loading && !error && visibleSuggestions.length === 0
          ? <div className="session-next-steps-empty">No suggestions to show.</div> : null}
      </div>
    </section>
  );
});
