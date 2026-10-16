import type { ScopeAssetInput } from '../shared/types';

interface BugcrowdTarget {
  uri?: unknown;
  name?: unknown;
  category?: unknown;
  description?: unknown;
  ipAddress?: unknown;
}

interface BugcrowdScopeGroup {
  name?: unknown;
  inScope?: unknown;
  description?: unknown;
  targets?: unknown;
}

export interface BugcrowdBrief {
  slug: string;
  sourceUrl: string;
  name: string;
  state: string;
  endsAt: string | null;
  description: string;
  targetsOverview: string;
  additionalInformation: string;
  scopeGroups: BugcrowdScopeGroup[];
  assets: ScopeAssetInput[];
}

export function normalizeBugcrowdIdentifier(identifier: string): string {
  const input = identifier.trim();
  if (/^https?:\/\//iu.test(input)) {
    let url: URL;
    try { url = new URL(input); } catch { return ''; }
    if (url.protocol !== 'https:' || !['bugcrowd.com', 'www.bugcrowd.com'].includes(url.hostname)
      || url.username || url.password || url.port) return '';
    const match = /^\/engagements\/([a-z0-9][a-z0-9-]*)(?:\/)?$/u.exec(url.pathname);
    return match?.[1] ?? '';
  }
  return /^[a-z0-9][a-z0-9-]*$/u.test(input) ? input : '';
}

export async function fetchBugcrowdBrief(identifier: string, fetcher: typeof fetch = fetch): Promise<BugcrowdBrief> {
  const slug = normalizeBugcrowdIdentifier(identifier);
  if (!slug) throw new Error('Enter a Bugcrowd engagement URL or slug.');
  const sourceUrl = `https://bugcrowd.com/engagements/${slug}`;
  const page = await fetcher(sourceUrl, { headers: { accept: 'text/html', 'user-agent': 'Beale/0.1 local workspace onboarding' } });
  if (!page.ok) throw new Error(`Bugcrowd engagement lookup failed with HTTP ${page.status}.`);
  const html = await page.text();
  // The public page embeds the exact versioned JSON route used by its own brief client.
  const route = new RegExp(`getBriefVersionDocument.{0,48}(/engagements/${slug}/changelog/[0-9a-f-]{36})`, 'iu').exec(html)?.[1];
  if (!route) throw new Error('Bugcrowd did not expose a public brief for this engagement.');
  const response = await fetcher(`https://bugcrowd.com${route}.json`, { headers: { accept: 'application/json', 'user-agent': 'Beale/0.1 local workspace onboarding' } });
  if (!response.ok) throw new Error(`Bugcrowd brief lookup failed with HTTP ${response.status}.`);
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error('Bugcrowd returned an unreadable public brief.');
  }
  const root = record(payload);
  const data = record(root?.data);
  const brief = record(data?.brief);
  const engagement = record(data?.engagement);
  const scopeGroups = Array.isArray(data?.scope) ? data.scope.filter((group): group is BugcrowdScopeGroup => Boolean(record(group))) : [];
  const name = text(brief?.name);
  if (!name || !scopeGroups.length || text(engagement?.code) !== slug) {
    throw new Error('Bugcrowd returned an incomplete public brief; no scope was imported.');
  }
  const assets = scopeGroups.flatMap((group) => {
    if (typeof group.inScope !== 'boolean' || !Array.isArray(group.targets)) return [];
    return group.targets.flatMap((candidate) => {
      const target = record(candidate);
      if (!target) return [];
      const asset = bugcrowdTargetToAsset(target, group, slug, sourceUrl);
      return asset ? [asset] : [];
    });
  });
  if (!assets.some((asset) => asset.direction === 'in_scope')) {
    throw new Error('Bugcrowd did not provide an importable in-scope target for this engagement.');
  }
  return {
    slug,
    sourceUrl,
    name,
    state: text(engagement?.state),
    endsAt: text(engagement?.endsAt) || null,
    description: text(brief?.description),
    targetsOverview: text(brief?.targetsOverview),
    additionalInformation: text(brief?.additionalInformation),
    scopeGroups,
    assets
  };
}

function bugcrowdTargetToAsset(target: BugcrowdTarget, group: BugcrowdScopeGroup, slug: string, sourceUrl: string): ScopeAssetInput | null {
  const uri = text(target.uri);
  const name = text(target.name);
  const value = uri || name;
  if (!value) return null;
  const category = text(target.category);
  const repository = /^https:\/\/(?:www\.)?(?:github\.com|gitlab\.com|bitbucket\.org)\/[\w.-]+\/[\w.-]+(?:\.git)?\/?$/iu.test(uri);
  const kind: ScopeAssetInput['kind'] = repository ? 'repo'
    : ['website', 'api'].includes(category) && (uri || /^[*\w.-]+\.[a-z]{2,}$/iu.test(name)) ? 'domain'
      : 'other';
  return {
    direction: group.inScope ? 'in_scope' : 'out_of_scope',
    kind,
    value,
    sensitivity: 'public',
    attributes: {
      source: 'bugcrowd',
      researchKitId: 'bugcrowd',
      researchKitSourceUrl: sourceUrl,
      bugcrowdSlug: slug,
      displayName: name || undefined,
      category,
      scopeGroup: text(group.name),
      scopeGroupDescription: text(group.description),
      description: text(target.description),
      ipAddress: text(target.ipAddress),
      ...(repository ? { repositoryUrl: uri } : {})
    }
  };
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
