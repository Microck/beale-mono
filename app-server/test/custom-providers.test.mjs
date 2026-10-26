import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { WorkspaceRegistry } from '../dist/workspaceRegistryStore.js';
import { AppServerHostRegistry } from '../dist/hostRegistry.js';
import { AppServerHostService } from '../dist/hostService.js';
import { appServerSessionEnvironment } from '../dist/sessionLaunch.js';

test('custom provider metadata persists in the registry and reaches the host catalog', async () => {
  const root = mkdtempSync(join(tmpdir(), 'beale-custom-provider-'));
  const previous = process.env.APP_SERVER_CUSTOM_PROVIDERS;
  const definition = { id: 'custom-example', name: 'Example API', baseUrl: 'https://api.example.test/v1', contextWindow: 128_000, maxTokens: 16_000,
    models: [{ id: 'model-example', name: 'Example Model' }] };
  try {
    const registry = new WorkspaceRegistry(root);
    registry.saveCustomProvider(definition);
    registry.setProviderModelDefaults(definition.id, { largeModel: 'model-example', smallModel: 'model-example', reasoningEffort: 'off' });
    registry.setDefaultProviderId(definition.id);
    assert.deepEqual(registry.getProviderSettings().customProviders, [definition]);
    registry.close();

    const host = new AppServerHostRegistry({ registryDirectory: root });
    assert.deepEqual(host.providerSettings().customProviders, [definition]);
    assert.equal(host.providerSettings().defaultProviderId, definition.id);
    assert.deepEqual(JSON.parse(process.env.APP_SERVER_CUSTOM_PROVIDERS), [definition]);
    const catalog = await new AppServerHostService({ registry: host }).providerCatalog();
    assert.equal(catalog.defaultProviderId, definition.id);
    assert.deepEqual(catalog.providers.find((provider) => provider.providerId === definition.id)?.models.map((model) => model.id), ['model-example']);
    const env = appServerSessionEnvironment({
      provider: { contextSize: 'default', authenticationPreferences: {}, riskAcknowledgements: [] },
      storage: { databasePath: join(root, 'memory.sqlite'), artifactDirectoryPath: join(root, 'artifacts') },
    }, { APP_SERVER_CUSTOM_PROVIDERS: JSON.stringify([definition]), BEALE_CUSTOM_PROVIDER_KEY_EXAMPLE: 'example-secret' });
    assert.deepEqual(JSON.parse(env.APP_SERVER_CUSTOM_PROVIDERS), [definition]);
    assert.equal(env.BEALE_CUSTOM_PROVIDER_KEY_EXAMPLE, 'example-secret');

    const reopened = new WorkspaceRegistry(root);
    assert.equal(reopened.getProviderSettings().modelDefaults[definition.id].largeModel, 'model-example');
    reopened.removeCustomProvider(definition.id);
    assert.equal(reopened.getProviderSettings().defaultProviderId, null);
    assert.deepEqual(reopened.getProviderSettings().customProviders, []);
    reopened.close();
  } finally {
    if (previous === undefined) delete process.env.APP_SERVER_CUSTOM_PROVIDERS;
    else process.env.APP_SERVER_CUSTOM_PROVIDERS = previous;
    rmSync(root, { recursive: true, force: true });
  }
});
