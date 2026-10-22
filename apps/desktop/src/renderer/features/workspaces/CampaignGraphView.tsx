import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, DragEvent, JSX } from 'react';
import { ChevronLeft, ChevronRight, OctagonMinus, Search } from 'lucide-react';
import type {
  AppServerFindingSummary,
  AppServerMemorySummary,
  ClaimBoardMaturity,
  ResearchProfileMemoryType,
  ResearchProviderModelCatalog,
  ResearchClaimRating
} from '@shared/types';
import { formatWorkspaceTimelineDuration } from '../../view-models/workspaceTimeline';
import type { SessionTimelineProjection } from '../../view-models/workspaceTimeline';
import type { SessionHeatPreferences } from '../../view-models/sessionHeat';
import { campaignClaimRatingPresentation } from '../../view-models/campaignClaims';
import type { CampaignClaimRatingValue } from '../../view-models/campaignClaims';
import { researchModelDisplayName, traceLabel } from '../../lib/formatting';
import { ProviderIcon } from '../../app/ProviderIcon';
import { FloatingTextPicker } from '../../app/FloatingTextPicker';
import { Modal } from '../../app/Modal';
import { MainSideScrollRegion } from '../../app/MainSideScrollRegion';
import { memoryTypeClassName, memoryTypeLabel, memoryTypeStyle } from '../research/MemoryTypeLabel';

const CAMPAIGN_BOARD_MATURITIES: readonly ClaimBoardMaturity[] = ['observed', 'reproduced', 'verified', 'reported'];
type CampaignBoardMaturity = ClaimBoardMaturity;
export function adjacentCampaignBoardMaturity(maturity: ClaimBoardMaturity, direction: -1 | 1): ClaimBoardMaturity | null {
  const index = CAMPAIGN_BOARD_MATURITIES.indexOf(maturity);
  return index < 0 ? null : CAMPAIGN_BOARD_MATURITIES[index + direction] ?? null;
}
type CampaignBoardRatingFilter = CampaignClaimRatingValue | 'all';
const CAMPAIGN_BOARD_RATING_OPTIONS: Array<{ value: CampaignBoardRatingFilter; label: string }> = [
  { value: 'all', label: 'All Ratings' },
  { value: 'none', label: 'None' },
  { value: 'informational', label: 'Informational' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'critical', label: 'Critical' }
];
export function CampaignBoardView({
  compact = false,
  focusedMaturity,
  memory,
  openClaimId = null,
  onFocusedMaturityChange,
  providerModelCatalog,
  workspaceName,
  onOpenClaim,
  onTransitionClaim
}: {
  compact?: boolean;
  focusedMaturity?: ClaimBoardMaturity;
  memory: AppServerMemorySummary | null;
  openClaimId?: string | null;
  onFocusedMaturityChange?: (maturity: ClaimBoardMaturity) => void;
  providerModelCatalog: readonly ResearchProviderModelCatalog[];
  workspaceName: string;
  onOpenClaim: (claimId: string) => void;
  onTransitionClaim?: (claim: AppServerFindingSummary, targetMaturity: ClaimBoardMaturity) => Promise<void>;
}): JSX.Element {
  const loading = memory === null || memory.loading === true;
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const searchButtonRef = useRef<HTMLButtonElement>(null);
  const [ratingFilter, setRatingFilter] = useState<CampaignBoardRatingFilter>('all');
  const [authorFilter, setAuthorFilter] = useState('all');
  const [draggedClaimId, setDraggedClaimId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<ClaimBoardMaturity | null>(null);
  const [pendingClaimId, setPendingClaimId] = useState<string | null>(null);
  const [transitionError, setTransitionError] = useState<string | null>(null);
  const [refutedOpen, setRefutedOpen] = useState(false);
  const [localFocusedMaturity, setLocalFocusedMaturity] = useState<ClaimBoardMaturity>('observed');
  const selectedMaturity = focusedMaturity && CAMPAIGN_BOARD_MATURITIES.includes(focusedMaturity)
    ? focusedMaturity : localFocusedMaturity;
  const focusMaturity = (maturity: ClaimBoardMaturity): void => {
    setLocalFocusedMaturity(maturity);
    onFocusedMaturityChange?.(maturity);
  };
  const visibleMaturities = compact ? [selectedMaturity] : CAMPAIGN_BOARD_MATURITIES;
  const refutedFindings = campaignBoardFindings(memory, 'refuted');
  const authorOptions = useMemo(() => campaignBoardAuthorOptions(memory, providerModelCatalog), [memory, providerModelCatalog]);

  const dragClaim = (event: DragEvent<HTMLButtonElement>, claim: AppServerFindingSummary): void => {
    if (pendingClaimId || !onTransitionClaim) {
      event.preventDefault();
      return;
    }
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('application/x-beale-claim-board', 'claim');
    setDraggedClaimId(claim.id);
    setDropTarget(null);
    setTransitionError(null);
  };

  const clearDrag = (): void => {
    setDraggedClaimId(null);
    setDropTarget(null);
  };

  const draggedClaim = memory?.findings.find((claim) => claim.id === draggedClaimId) ?? null;

  useEffect(() => {
    if (authorOptions.some((option) => option.value === authorFilter)) return;
    setAuthorFilter('all');
  }, [authorFilter, authorOptions]);

  return (
    <section aria-labelledby="workspace-campaign-board-heading" className={`workspace-dashboard-panel campaign-panel campaign-board-panel${compact ? ' is-compact' : ''}`} id="workspace-dashboard-campaign-board-panel" role="tabpanel">
      <header className="campaign-header campaign-board-header">
        <div className="settings-form-heading campaign-view-heading">
          <h2 className="campaign-view-title" id="workspace-campaign-board-heading">{workspaceName.trim() || 'Workspace'} Findings</h2>
          {!compact ? <div className={`campaign-board-title-search${searchOpen ? ' is-open' : ''}`} role="search">
            <button
              aria-label={searchOpen ? 'Close finding search' : 'Search findings'}
              aria-expanded={searchOpen}
              onClick={() => {
                if (searchOpen) {
                  setQuery('');
                  setSearchOpen(false);
                } else setSearchOpen(true);
              }}
              ref={searchButtonRef}
              title={searchOpen ? 'Close finding search' : 'Search findings'}
              type="button"
            ><Search aria-hidden="true" size={16} /></button>
            {searchOpen ? <input
              aria-label="Filter findings"
              autoFocus
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== 'Escape') return;
                setQuery('');
                setSearchOpen(false);
                searchButtonRef.current?.focus();
              }}
              placeholder="Filter findings"
              type="search"
              value={query}
            /> : null}
          </div> : null}
        </div>
        <div className="campaign-board-controls-row">
          <div className="campaign-board-filters" aria-label="Findings filters">
            <FloatingTextPicker
              ariaLabel="Finding rating filter"
              className="campaign-board-filter campaign-board-rating-filter"
              onChange={(value) => setRatingFilter(value as CampaignBoardRatingFilter)}
              options={CAMPAIGN_BOARD_RATING_OPTIONS}
              title="Filter findings by preferred CVSS or fallback rating"
              value={ratingFilter}
            />
            <FloatingTextPicker
              ariaLabel="Finding author filter"
              className="campaign-board-filter campaign-board-author-filter"
              onChange={setAuthorFilter}
              options={authorOptions}
              title="Filter findings by model author"
              value={authorFilter}
            />
          </div>
          {!compact ? <button className="campaign-board-refuted-toggle" onClick={() => setRefutedOpen(true)} type="button">
            {refutedFindings.length.toLocaleString()} refuted hidden
          </button> : null}
        </div>
        {pendingClaimId ? <p className="campaign-board-transition-pending" role="status">Updating finding status…</p> : null}
        {transitionError ? <p className="campaign-board-transition-error" role="alert">{transitionError}</p> : null}
      </header>

      <div className={`campaign-board-lanes${compact ? ' is-compact' : ''}`} aria-busy={pendingClaimId !== null}>
        {visibleMaturities.map((maturity) => {
          const findings = campaignBoardFindings(memory, maturity, { rating: ratingFilter, author: authorFilter, query });
          const previousMaturity = compact ? adjacentCampaignBoardMaturity(maturity, -1) : null;
          const nextMaturity = compact ? adjacentCampaignBoardMaturity(maturity, 1) : null;
          return (
            <section
              className={`campaign-board-lane maturity-${maturity}${dropTarget === maturity ? ' is-drop-target' : ''}`}
              key={compact ? 'compact' : maturity}
              aria-labelledby={`campaign-board-${maturity}-heading`}
              onClickCapture={() => focusMaturity(maturity)}
              onFocusCapture={() => focusMaturity(maturity)}
              onDragOver={(event) => {
                if (!draggedClaim || draggedClaim.maturity === maturity || pendingClaimId) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = 'move';
                if (dropTarget !== maturity) setDropTarget(maturity);
              }}
              onDrop={(event) => {
                event.preventDefault();
                clearDrag();
                if (!draggedClaim || draggedClaim.maturity === maturity || !onTransitionClaim || pendingClaimId) return;
                focusMaturity(maturity);
                setPendingClaimId(draggedClaim.id);
                setTransitionError(null);
                void onTransitionClaim(draggedClaim, maturity)
                  .catch((error: unknown) => setTransitionError(error instanceof Error ? error.message : String(error)))
                  .finally(() => setPendingClaimId(null));
              }}
            >
              {compact ? <div className="campaign-board-lane-navigation">
                <button
                  aria-label="Previous findings lane"
                  className="campaign-board-lane-direction"
                  disabled={!previousMaturity}
                  onClick={() => { if (previousMaturity) focusMaturity(previousMaturity); }}
                  onDragEnter={() => { if (draggedClaim && previousMaturity) focusMaturity(previousMaturity); }}
                  title={previousMaturity ? `Show ${traceLabel(previousMaturity)} findings` : 'First findings lane'}
                  type="button"
                ><ChevronLeft aria-hidden="true" size={17} /></button>
                <h3 className="workspace-campaign-list-heading campaign-board-lane-heading" id={`campaign-board-${maturity}-heading`}>{traceLabel(maturity)} ({findings.length.toLocaleString()})</h3>
                <button
                  aria-label="Next findings lane"
                  className="campaign-board-lane-direction"
                  disabled={!nextMaturity}
                  onClick={() => { if (nextMaturity) focusMaturity(nextMaturity); }}
                  onDragEnter={() => { if (draggedClaim && nextMaturity) focusMaturity(nextMaturity); }}
                  title={nextMaturity ? `Show ${traceLabel(nextMaturity)} findings` : 'Last findings lane'}
                  type="button"
                ><ChevronRight aria-hidden="true" size={17} /></button>
              </div> : <h3 className="workspace-campaign-list-heading campaign-board-lane-heading" id={`campaign-board-${maturity}-heading`}>{traceLabel(maturity)} ({findings.length.toLocaleString()})</h3>}
              <MainSideScrollRegion
                className="campaign-board-lane-scroll"
                listClassName="campaign-board-lane-list"
                updateKey={`${loading}:${ratingFilter}:${authorFilter}:${query}:${findings.map(({ id, revision }) => `${id}:${revision}`).join('|')}`}
              >
                {loading ? <p className="campaign-board-empty">Loading findings.</p> : findings.length === 0 ? (
                  <p className="campaign-board-empty">No {maturity} findings.</p>
                ) : findings.map((claim) => (
                  <CampaignClaimCard
                    claim={claim}
                    className="campaign-board-card"
                    key={claim.id}
                    metadata={campaignBoardClaimMetadata(claim)}
                    active={openClaimId === claim.id}
                    onOpenClaim={onOpenClaim}
                    onDragStart={onTransitionClaim ? (event) => dragClaim(event, claim) : undefined}
                    onDragEnd={clearDrag}
                    dragging={draggedClaimId === claim.id}
                    dragDisabled={pendingClaimId !== null}
                    providerModelCatalog={providerModelCatalog}
                  />
                ))}
              </MainSideScrollRegion>
            </section>
          );
        })}
      </div>
      {refutedOpen ? <Modal onClose={() => setRefutedOpen(false)} title="Refuted findings">
        <div className="campaign-board-refuted-list">
          {refutedFindings.length ? refutedFindings.map((claim) => <CampaignClaimCard
            claim={claim}
            key={claim.id}
            metadata={campaignBoardClaimMetadata(claim)}
            active={openClaimId === claim.id}
            onOpenClaim={(id) => { setRefutedOpen(false); onOpenClaim(id); }}
            providerModelCatalog={providerModelCatalog}
          />) : <p>No refuted findings.</p>}
        </div>
      </Modal> : null}
    </section>
  );
}

function CampaignClaimAuthors({
  authors,
  providerModelCatalog
}: {
  authors: AppServerFindingSummary['authors'];
  providerModelCatalog: readonly ResearchProviderModelCatalog[];
}): JSX.Element | null {
  const containerRef = useRef<HTMLSpanElement | null>(null);
  const [hasOverflow, setHasOverflow] = useState(false);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;
    const update = (): void => setHasOverflow(campaignClaimAuthorsHaveOverflow(container.scrollWidth, container.clientWidth));
    update();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(update);
    observer.observe(container);
    return () => observer.disconnect();
  }, [authors, providerModelCatalog]);

  if (authors.length === 0) return null;
  return (
    <span
      aria-label="Model authors"
      className={`campaign-claim-card-authors${hasOverflow ? ' has-overflow' : ''}`}
      ref={containerRef}
    >
      <span className="campaign-claim-card-author-list">
        {authors.map((author) => {
          const modelName = researchModelDisplayName(author.provider, author.model, providerModelCatalog);
          return (
            <span className="campaign-claim-card-author" key={`${author.provider}\0${author.model}`} title={`${author.provider}/${modelName}`}>
              <ProviderIcon provider={author.provider || author.model} size={13} aria-hidden="true" />
              <span>{modelName}</span>
            </span>
          );
        })}
      </span>
    </span>
  );
}

export function campaignClaimAuthorsHaveOverflow(scrollWidth: number, clientWidth: number): boolean {
  return scrollWidth > clientWidth;
}

export function campaignBoardClaimMetadata(claim: AppServerFindingSummary): string {
  return campaignClaimRatingPresentation(claim).label;
}

export function campaignBoardFindings(
  memory: AppServerMemorySummary | null,
  maturity: CampaignBoardMaturity,
  filters: { rating: CampaignBoardRatingFilter; author?: string; query?: string } = { rating: 'all' }
): AppServerFindingSummary[] {
  const query = filters.query?.trim().toLocaleLowerCase() ?? '';
  return (memory?.findings ?? []).filter((claim) => claim.maturity === maturity
    && (filters.rating === 'all' || campaignClaimRatingPresentation(claim).value === filters.rating)
    && (!filters.author || filters.author === 'all' || claim.authors.some((author) => campaignBoardAuthorKey(author) === filters.author))
    && (!query || [claim.id, claim.title, claim.summary, claim.impact, claim.classification, claim.status,
      claim.maturity, claim.rating, ...claim.evidence.map((evidence) => evidence.summary)]
      .join('\n').toLocaleLowerCase().includes(query)));
}

function campaignBoardAuthorKey(author: AppServerFindingSummary['authors'][number]): string {
  return JSON.stringify([author.provider, author.model]);
}

export function campaignBoardAuthorOptions(
  memory: AppServerMemorySummary | null,
  providerModelCatalog: readonly ResearchProviderModelCatalog[]
): Array<{ value: string; label: string }> {
  const authors = new Map<string, AppServerFindingSummary['authors'][number]>();
  for (const finding of memory?.findings ?? []) {
    if (!CAMPAIGN_BOARD_MATURITIES.some((maturity) => maturity === finding.maturity)) continue;
    for (const author of finding.authors) if (author.model.trim()) authors.set(campaignBoardAuthorKey(author), author);
  }
  const models = [...authors].map(([value, author]) => ({
    value,
    name: researchModelDisplayName(author.provider, author.model, providerModelCatalog),
    provider: author.provider
  }));
  const nameCounts = new Map<string, number>();
  for (const model of models) nameCounts.set(model.name, (nameCounts.get(model.name) ?? 0) + 1);
  return [
    { value: 'all', label: 'All Authors' },
    ...models.map((model) => ({
      value: model.value,
      label: nameCounts.get(model.name)! > 1 ? `${model.name} (${model.provider || 'Unknown provider'})` : model.name
    })).sort((left, right) => left.label.localeCompare(right.label))
  ];
}

function CampaignClaimCard({
  active = false,
  claim,
  className = '',
  metadata,
  onOpenClaim,
  onDragStart,
  onDragEnd,
  dragging = false,
  dragDisabled = false,
  providerModelCatalog
}: {
  active?: boolean;
  claim: AppServerFindingSummary;
  className?: string;
  metadata: string;
  onOpenClaim: (claimId: string) => void;
  onDragStart?: (event: DragEvent<HTMLButtonElement>) => void;
  onDragEnd?: () => void;
  dragging?: boolean;
  dragDisabled?: boolean;
  providerModelCatalog: readonly ResearchProviderModelCatalog[];
}): JSX.Element {
  return (
    <button
      aria-current={active ? 'true' : undefined}
      className={`campaign-claim-card${className ? ` ${className}` : ''}${active ? ' is-active' : ''}${dragging ? ' is-dragging' : ''}`}
      draggable={Boolean(onDragStart) && !dragDisabled}
      onClick={() => onOpenClaim(claim.id)}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      type="button"
    >
      <strong className="campaign-claim-card-title">
        {claim.securityTracking?.progressBlocker ? <span
          className="campaign-board-blocked-marker"
          title={`Blocked: ${claim.securityTracking.progressBlocker.reason}`}
        >
          <OctagonMinus aria-label="Blocked" className="campaign-board-blocked-icon" role="img" size={16} />
        </span> : null}
        <span>{claim.title}</span>
      </strong>
      <span className="campaign-claim-card-footer">
        <span className="campaign-claim-card-meta">{metadata}</span>
        <CampaignClaimAuthors authors={claim.authors} providerModelCatalog={providerModelCatalog} />
      </span>
    </button>
  );
}

export function CampaignSessionProjection({
  memoryTypes,
  profileId,
  projection,
  sessionHeatPreferences,
  sessionTitle
}: {
  memoryTypes: readonly ResearchProfileMemoryType[];
  profileId?: string;
  projection: SessionTimelineProjection | null;
  sessionHeatPreferences: SessionHeatPreferences;
  sessionTitle: string;
}): JSX.Element {
  const durationLabel = projection && projection.totalDurationMs > 0
    ? formatWorkspaceTimelineDuration(projection.totalDurationMs)
    : 'No activity recorded';
  return (
    <span
      aria-label={`${sessionTitle} complete session activity: ${durationLabel}`}
      className={`campaign-session-projection${projection?.segments.length ? '' : ' is-empty'}`}
      role="img"
      title={durationLabel}
    >
      {projection?.segments.map((segment) => (
        <span
          aria-hidden="true"
          className="workspace-timeline-segment"
          key={segment.id}
          style={{ left: `${segment.leftPercent}%`, width: `${segment.widthPercent}%` }}
          title={`${formatCampaignTimelineDateTime(segment.startedAt)} – ${segment.endedAt ? formatCampaignTimelineDateTime(segment.endedAt) : 'Now'}`}
        />
      ))}
      {projection?.memoryMarkers.map((marker) => (
        <span
          aria-hidden="true"
          className={`workspace-timeline-memory-marker ${memoryTypeClassName(marker.type, memoryTypes)}`}
          key={marker.id}
          style={{
            left: `${marker.leftPercent}%`,
            ...memoryTypeStyle(marker.type, memoryTypes, marker.status, profileId, sessionHeatPreferences)
          } as CSSProperties}
          title={`${memoryTypeLabel(marker.type, memoryTypes)} · ${marker.title} · ${formatCampaignTimelineDateTime(marker.createdAt)}`}
        />
      ))}
      {projection?.runbookRevisionMarkers.map((marker) => (
        <span
          aria-hidden="true"
          className="workspace-timeline-runbook-marker"
          key={marker.id}
          style={{ left: `${marker.leftPercent}%` }}
          title={`Runbook · ${marker.title} · Update ${marker.revision} · ${formatCampaignTimelineDateTime(marker.createdAt)}`}
        />
      ))}
      {projection?.reportRevisionMarkers.map((marker) => (
        <span
          aria-hidden="true"
          className="workspace-timeline-report-marker"
          key={marker.id}
          style={{ left: `${marker.leftPercent}%` }}
          title={`Report · ${marker.title} · Update ${marker.revision} · ${formatCampaignTimelineDateTime(marker.createdAt)}`}
        />
      ))}
    </span>
  );
}

function formatCampaignTimelineDateTime(value: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return value;
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  }).format(timestamp);
}
