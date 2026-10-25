import { describe, expect, it, vi } from 'vitest';
import type { BealeWorkspaceResearchTrack } from '@beale/app-server-runtime/protocol';
import type { BealeApi } from '../src/shared/types';
import { ensureDefaultResearchCollaborator, normalizeResearchCollaboration } from '../src/shared/collaboration';
import {
  collaborationRequiresCyberPolicyAcknowledgement,
  selectedSessionProviderIds,
  selectNextAvailableCollaborator
} from '../src/renderer/features/sessions/StartRunForm';
import { researchTrackProviderIds, resumeResearchTrack } from '../src/renderer/features/workspaces/WorkspaceResearchTrack';

describe('research collaboration normalization', () => {
  it('normalizes legacy room protocol controls to lax channel semantics', () => {
    expect(normalizeResearchCollaboration({ independentFirstPass: false, peerChallengeRounds: 3 })).toMatchObject({
      independentFirstPass: false,
      peerChallengeRounds: 0
    });
    expect(normalizeResearchCollaboration({ independentFirstPass: true, peerChallengeRounds: 1 })).toMatchObject({
      independentFirstPass: false,
      peerChallengeRounds: 0
    });
    expect(normalizeResearchCollaboration(undefined).independentFirstPass).toBe(false);
    expect(normalizeResearchCollaboration(undefined)).toMatchObject({ mode: 'always', intensity: 'balanced' });
    expect(normalizeResearchCollaboration({ mode: 'solo', intensity: 'deep' })).toMatchObject({
      mode: 'always',
      intensity: 'balanced'
    });
    expect(normalizeResearchCollaboration(undefined).subagentMode).toBe('simple');
    expect(normalizeResearchCollaboration({ subagentMode: 'advanced' }).subagentMode).toBe('advanced');
  });

  it('drops legacy invocation budgets and uses balanced room limits', () => {
    const collaboration = normalizeResearchCollaboration({
      intensity: 'deep',
      maxActiveInvocations: 7,
      maxTotalInvocations: 6
    });
    expect(collaboration).not.toHaveProperty('maxActiveInvocations');
    expect(collaboration).not.toHaveProperty('maxTotalInvocations');
    expect(collaboration).toMatchObject({ maxConcurrentRooms: 4, maxMembersPerRoom: 3 });
  });

  it('requires cybersecurity acknowledgement only for the security profile', () => {
    expect(collaborationRequiresCyberPolicyAcknowledgement('security-research')).toBe(true);
    expect(collaborationRequiresCyberPolicyAcknowledgement('mathematics')).toBe(false);
    expect(collaborationRequiresCyberPolicyAcknowledgement('custom-domain')).toBe(false);
  });

  it('requests credentials only for providers selected for the session', () => {
    const input = {
      provider: 'openai-codex',
      collaboration: {
        mode: 'adaptive',
        intensity: 'balanced',
        providers: [
          { provider: 'anthropic', model: 'claude-opus-5', reasoningEffort: 'high', enabled: true },
          { provider: 'xai', model: 'grok-4.6', reasoningEffort: 'high', enabled: false }
        ]
      }
    } as Parameters<typeof selectedSessionProviderIds>[0];

    expect(selectedSessionProviderIds(input)).toEqual(['openai-codex', 'anthropic']);
    expect(selectedSessionProviderIds({
      ...input,
      collaboration: { ...normalizeResearchCollaboration(input.collaboration), mode: 'solo' }
    })).toEqual(['openai-codex', 'anthropic']);
  });

  it('requests credentials for a resumed track lead and enabled collaborators', () => {
    expect(researchTrackProviderIds({
      provider: { id: 'openai-codex' },
      collaboration: { providers: [
        { provider: 'openrouter', model: 'auto', reasoningEffort: 'medium', enabled: true },
        { provider: 'zai', model: 'glm-5.3', reasoningEffort: 'off', enabled: true },
        { provider: 'xai', model: 'grok-4.3', reasoningEffort: 'medium', enabled: false }
      ] }
    })).toEqual(['openai-codex', 'openrouter', 'zai']);
  });

  it('unlocks a saved collaborator key before resuming a local track', async () => {
    const track = { id: 'track-example', workspaceId: 'workspace-example', status: 'paused', pass: 1,
      scopeId: 'scope-example', provider: { id: 'openai-codex' }, targetIds: ['local'],
      collaboration: { providers: [
        { provider: 'openrouter', model: 'auto', reasoningEffort: 'medium', enabled: true }
      ] }, activeSessionId: null, activeSurfaceId: null, epochCount: 0, lastError: null,
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', surfaces: []
    } satisfies BealeWorkspaceResearchTrack;
    const calls: string[] = [];
    const api = {
      getProviderCredentialAccessRequest: vi.fn(async () => {
        calls.push('check');
        return { providerIds: ['openrouter'] as const };
      }),
      unlockProviderApiKeys: vi.fn(async () => { calls.push('unlock'); }),
      controlResearchTrack: vi.fn(async () => { calls.push('resume'); return track; })
    } as unknown as Pick<BealeApi, 'getProviderCredentialAccessRequest' | 'unlockProviderApiKeys' | 'controlResearchTrack'>;

    await resumeResearchTrack(track, undefined, api);

    expect(api.getProviderCredentialAccessRequest).toHaveBeenCalledWith(['openai-codex', 'openrouter']);
    expect(api.unlockProviderApiKeys).toHaveBeenCalledWith(['openrouter']);
    expect(api.controlResearchTrack).toHaveBeenCalledWith('workspace-example', 'resume', undefined);
    expect(calls).toEqual(['check', 'unlock', 'resume']);
  });

  it('leaves remote track credentials on the selected app-server', async () => {
    const track = { workspaceId: 'workspace-example', provider: { id: 'openrouter' } } as unknown as BealeWorkspaceResearchTrack;
    const api = {
      getProviderCredentialAccessRequest: vi.fn(), unlockProviderApiKeys: vi.fn(),
      controlResearchTrack: vi.fn(async () => track)
    } as unknown as Pick<BealeApi, 'getProviderCredentialAccessRequest' | 'unlockProviderApiKeys' | 'controlResearchTrack'>;

    await resumeResearchTrack(track, 'server-example', api);

    expect(api.getProviderCredentialAccessRequest).not.toHaveBeenCalled();
    expect(api.unlockProviderApiKeys).not.toHaveBeenCalled();
    expect(api.controlResearchTrack).toHaveBeenCalledWith('workspace-example', 'resume', 'server-example');
  });

  it('allows distinct models from one provider while preventing exact duplicates', () => {
    const collaboration = normalizeResearchCollaboration({
      mode: 'adaptive',
      intensity: 'balanced',
      providers: [
        { provider: 'anthropic', model: 'claude-opus-5', reasoningEffort: 'high', enabled: true },
        { provider: 'anthropic', model: 'claude-sonnet-5', reasoningEffort: 'high', enabled: true },
        { provider: 'anthropic', model: 'claude-opus-5', reasoningEffort: 'medium', enabled: false }
      ]
    });

    expect(collaboration.providers).toEqual([
      { provider: 'anthropic', model: 'claude-opus-5', reasoningEffort: 'high', enabled: true, roles: ['discoverer', 'prover', 'reviewer', 'reporter'] },
      { provider: 'anthropic', model: 'claude-sonnet-5', reasoningEffort: 'high', enabled: true, roles: ['discoverer', 'prover', 'reviewer', 'reporter'] }
    ]);
  });

  it('normalizes Advanced compatible roles, including legacy single-role preferences', () => {
    const collaboration = normalizeResearchCollaboration({
      subagentMode: 'advanced',
      providers: [
        { provider: 'anthropic', model: 'claude-opus-5', reasoningEffort: 'high', enabled: true, role: 'reviewer' },
        { provider: 'xai', model: 'grok-4.6', reasoningEffort: 'high', enabled: true, roles: ['discoverer', 'reporter', 'unknown'] },
        { provider: 'openai-codex', model: 'gpt-5.6-sol', reasoningEffort: 'high', enabled: true, roles: [] }
      ]
    });

    expect(collaboration.providers[0]).toMatchObject({ roles: ['reviewer'] });
    expect(collaboration.providers[1]).toMatchObject({ roles: ['discoverer', 'reporter'] });
    expect(collaboration.providers[2]).toMatchObject({ roles: ['discoverer', 'prover', 'reviewer', 'reporter'] });
  });

  it('fills unused providers before stacking another model from a represented provider', () => {
    const anthropicOpus = { provider: 'anthropic' as const, model: 'claude-opus-5' };
    const anthropicSonnet = { provider: 'anthropic' as const, model: 'claude-sonnet-5' };
    const xaiGrok = { provider: 'xai' as const, model: 'grok-4.6' };
    const openAiLuna = { provider: 'openai-codex' as const, model: 'gpt-5.6-luna' };

    expect(selectNextAvailableCollaborator(
      [anthropicOpus, anthropicSonnet, xaiGrok, openAiLuna],
      [],
      'openai-codex'
    )).toBe(anthropicOpus);
    expect(selectNextAvailableCollaborator(
      [anthropicSonnet, xaiGrok, openAiLuna],
      [anthropicOpus],
      'openai-codex'
    )).toBe(xaiGrok);
    expect(selectNextAvailableCollaborator(
      [anthropicSonnet, openAiLuna],
      [anthropicOpus, xaiGrok],
      'openai-codex'
    )).toBe(anthropicSonnet);
  });

  it('enables the lead model only when no collaborator has been selected', () => {
    const collaboration = normalizeResearchCollaboration({
      mode: 'adaptive',
      intensity: 'balanced',
      providers: [
        { provider: 'openai-codex', model: 'gpt-5.6-sol', reasoningEffort: 'high', enabled: false },
        { provider: 'anthropic', model: 'claude-opus-5', reasoningEffort: 'high', enabled: false }
      ]
    });
    const withDefault = ensureDefaultResearchCollaborator(collaboration, {
      provider: 'openai-codex',
      model: 'gpt-5.6-sol',
      reasoningEffort: 'xhigh',
      enabled: true
    });

    expect(withDefault.providers).toEqual([
      { provider: 'openai-codex', model: 'gpt-5.6-sol', reasoningEffort: 'xhigh', enabled: true, roles: ['discoverer', 'prover', 'reviewer', 'reporter'] },
      { provider: 'anthropic', model: 'claude-opus-5', reasoningEffort: 'high', enabled: false, roles: ['discoverer', 'prover', 'reviewer', 'reporter'] }
    ]);
    expect(ensureDefaultResearchCollaborator({
      ...withDefault,
      providers: withDefault.providers.map((preference) => ({
        ...preference,
        enabled: preference.provider === 'anthropic'
      }))
    }, {
      provider: 'openai-codex',
      model: 'gpt-5.6-sol',
      reasoningEffort: 'high',
      enabled: true
    }).providers).toEqual([
      { provider: 'openai-codex', model: 'gpt-5.6-sol', reasoningEffort: 'xhigh', enabled: false, roles: ['discoverer', 'prover', 'reviewer', 'reporter'] },
      { provider: 'anthropic', model: 'claude-opus-5', reasoningEffort: 'high', enabled: true, roles: ['discoverer', 'prover', 'reviewer', 'reporter'] }
    ]);
  });
});
