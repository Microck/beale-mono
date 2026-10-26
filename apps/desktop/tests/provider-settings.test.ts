import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { ProviderCredentialStore } from '../src/main/providerCredentialStore';
import { WorkspaceRegistry } from '../src/main/workspaceRegistry';
import { WorkspaceService } from '../src/main/workspaceService';
import { appServerProcessEnvironment } from '../src/main/appServerRunEngine';

describe('provider settings', () => {
  it('discovers and persists a custom provider while encrypting its API key', async () => {
    const root = mkdtempSync(join(tmpdir(), 'beale-custom-provider-settings-'));
    const path = join(root, 'credentials.json');
    const stateFile = join(root, 'app-server.json');
    const priorEnvironment = {
      stateFile: process.env.BEALE_APP_SERVER_STATE_FILE,
      parentPid: process.env.BEALE_APP_SERVER_PARENT_PID,
      port: process.env.BEALE_APP_SERVER_PORT
    };
    process.env.BEALE_APP_SERVER_STATE_FILE = stateFile;
    process.env.BEALE_APP_SERVER_PARENT_PID = String(process.pid);
    process.env.BEALE_APP_SERVER_PORT = '0';
    let variable: string | undefined;
    const fetcher = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({ data: [{ id: 'model-example', name: 'Example Model' }] }), { status: 200 }));
    vi.stubGlobal('fetch', fetcher);
    const credentials = new ProviderCredentialStore(path, {
      available: () => true,
      encrypt: (value) => Buffer.from(`encrypted:${value}`, 'utf8'),
      decrypt: (value) => value.toString('utf8').replace(/^encrypted:/u, '')
    });
    const providerEnvironmentChanged = vi.fn();
    const service = new WorkspaceService(() => undefined, {
      workspaceRegistryDirectory: join(root, 'registry'),
      providerCredentialStore: credentials,
      providerEnvironmentChanged
    });
    try {
      const settings = await service.saveCustomProvider({ name: 'Example API', baseUrl: 'https://api.example.test/v1', apiKey: 'example-secret' });
      const provider = settings.customProviders?.[0];
      expect(provider?.id).toMatch(/^custom-/u);
      variable = `BEALE_CUSTOM_PROVIDER_KEY_${provider!.id.slice(7).replaceAll('-', '_').toUpperCase()}`;
      expect(provider?.models).toEqual([{ id: 'model-example', name: 'Example Model' }]);
      expect(settings.modelDefaults[provider!.id]).toEqual({ largeModel: 'model-example', smallModel: 'model-example', reasoningEffort: 'off' });
      expect(fetcher.mock.calls[0]?.[0]).toBe('https://api.example.test/v1/models');
      expect(readFileSync(path, 'utf8')).not.toContain('example-secret');
      expect(providerEnvironmentChanged).toHaveBeenCalledOnce();
      expect((await service.getResearchProviderModelCatalog()).find((catalog) => catalog.providerId === provider!.id)?.models[0]?.id).toBe('model-example');
    } finally {
      service.close();
      vi.unstubAllGlobals();
      if (variable) delete process.env[variable];
      if (existsSync(stateFile)) {
        const record = JSON.parse(readFileSync(stateFile, 'utf8')) as { pid?: unknown };
        if (typeof record.pid === 'number' && record.pid > 0 && record.pid !== process.pid) {
          try { process.kill(record.pid); } catch { /* already stopped */ }
        }
      }
      for (const [key, value] of Object.entries({
        BEALE_APP_SERVER_STATE_FILE: priorEnvironment.stateFile,
        BEALE_APP_SERVER_PARENT_PID: priorEnvironment.parentPid,
        BEALE_APP_SERVER_PORT: priorEnvironment.port
      })) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      rmSync(root, { recursive: true, force: true });
    }
  });
  it('passes custom provider metadata to direct app-server completions without embedding keys', () => {
    const definition = { id: 'custom-example' as const, name: 'Example API', baseUrl: 'https://api.example.test/v1',
      contextWindow: 128_000, maxTokens: 16_000, models: [{ id: 'model-example', name: 'Example Model' }] };
    const env = appServerProcessEnvironment(null, {}, [definition]);
    expect(JSON.parse(env.APP_SERVER_CUSTOM_PROVIDERS ?? 'null')).toEqual([definition]);
    expect(env.APP_SERVER_CUSTOM_PROVIDERS).not.toContain('example-secret');
  });
  it('unlocks only selected session providers after an explicit access request', async () => {
    const root = mkdtempSync(join(tmpdir(), 'beale-provider-access-'));
    const path = join(root, 'credentials.json');
    const originalXaiApiKey = process.env.XAI_API_KEY;
    const decrypt = vi.fn((value: Buffer) => value.toString('utf8'));
    const encryption = {
      available: () => true,
      encrypt: (value: string) => Buffer.from(value, 'utf8'),
      decrypt
    };
    const saved = new ProviderCredentialStore(path, encryption);
    saved.setApiKey('xai', 'saved-xai-key');
    delete process.env.XAI_API_KEY;
    const credentialStore = new ProviderCredentialStore(path, encryption, { deferLoad: true });
    const providerEnvironmentChanged = vi.fn();
    const service = new WorkspaceService(() => undefined, {
      workspaceRegistryDirectory: join(root, 'registry'),
      providerCredentialStore: credentialStore,
      providerEnvironmentChanged
    });

    try {
      expect(service.getProviderCredentialAccessRequest(['anthropic'])).toEqual({ providerIds: [] });
      expect(service.getProviderCredentialAccessRequest(['xai', 'anthropic'])).toEqual({ providerIds: ['xai'] });
      expect(decrypt).not.toHaveBeenCalled();

      await service.unlockProviderApiKeys(['xai']);

      expect(decrypt).toHaveBeenCalledOnce();
      expect(process.env.XAI_API_KEY).toBe('saved-xai-key');
      expect(providerEnvironmentChanged).toHaveBeenCalledOnce();
      expect(service.getProviderCredentialAccessRequest(['xai'])).toEqual({ providerIds: [] });
    } finally {
      service.close();
      if (originalXaiApiKey === undefined) delete process.env.XAI_API_KEY;
      else process.env.XAI_API_KEY = originalXaiApiKey;
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('returns and persists OpenRouter API-key authentication and refreshes the run host', async () => {
    const root = mkdtempSync(join(tmpdir(), 'beale-provider-settings-'));
    const setApiKey = vi.fn();
    const providerEnvironmentChanged = vi.fn();
    const credentialStore = { setApiKey } as unknown as ProviderCredentialStore;
    const service = new WorkspaceService(() => undefined, {
      workspaceRegistryDirectory: join(root, 'registry'),
      providerCredentialStore: credentialStore,
      providerEnvironmentChanged
    });

    try {
      const settings = await service.configureProviderApiKey('openrouter', 'test-openrouter-key');

      expect(setApiKey).toHaveBeenCalledWith('openrouter', 'test-openrouter-key');
      expect(providerEnvironmentChanged).toHaveBeenCalledOnce();
      expect(settings.preferredAuthenticationMethods?.openrouter).toBe('api_key');
      service.close();

      const registry = new WorkspaceRegistry(join(root, 'registry'));
      try {
        expect(registry.getProviderSettings().preferredAuthenticationMethods?.openrouter).toBe('api_key');
      } finally {
        registry.close();
      }
    } finally {
      service.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
});
