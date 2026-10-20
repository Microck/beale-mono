import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { WorkspaceRegistry } from '../../../app-server/src/workspaceRegistryStore';
import { AppServerHostRegistry } from '../../../app-server/src/hostRegistry';
import { appServerSessionArgs } from '../../../app-server/src/sessionLaunch';
import { invokeAppServerProtocol } from '../../../app-server/src/appServerProtocolClient';

describe('prompt template settings', () => {
  it('saves feature catalog descriptions and prompt extensions in the app-server registry', () => {
    const directory = mkdtempSync(join(tmpdir(), 'beale-feature-prompt-'));
    try {
      const registry = new WorkspaceRegistry(directory);
      const defaults = registry.getFeaturePromptSettings();
      expect(defaults['beale-claims']?.promptExtension).toContain('Use one canonical, evidence-gated research claim ledger');
      expect(defaults['beale-goals-builtin']?.promptExtension).toContain('Persistent Goal mode:');
      expect(defaults['beale-source']?.promptExtension).toBe('');
      registry.setFeaturePromptSettings('beale-claims', 'Synthetic claim catalog guidance.', 'Use the synthetic claim workflow.');
      const catalog = [{ id: 'beale-claims', name: 'Claims', description: 'Original description.', skills: [], mcpServers: [] }];
      const preview = registry.previewPromptTemplate('security-research', '{{boundary}}\n{{features}}\n{{prompt_extensions}}', undefined, catalog);
      expect(preview).toContain('Synthetic claim catalog guidance.');
      expect(preview).toContain('Claims (beale-claims):\nUse the synthetic claim workflow.');
      expect(preview).not.toContain('Use one canonical, evidence-gated research claim ledger');
      expect(registry.previewPromptTemplate('security-research', '{{boundary}}\n{{claims}}', undefined, catalog))
        .toContain('Use the synthetic claim workflow.');
      const host = new AppServerHostRegistry({ registryDirectory: directory });
      expect(host.featurePromptOverrides()['beale-claims']).toEqual({
        description: 'Synthetic claim catalog guidance.', promptExtension: 'Use the synthetic claim workflow.'
      });
      registry.setFeaturePromptSettings('beale-knowledge', 'Synthetic knowledge catalog.', defaults['beale-knowledge'].promptExtension);
      expect(host.featurePromptOverrides()['beale-knowledge']).toEqual({ description: 'Synthetic knowledge catalog.' });
      registry.resetFeaturePromptSettings('beale-knowledge');
      registry.setFeaturePromptSettings('beale-goals-builtin', 'Synthetic Goals guidance.', 'Synthetic Goal Mode instructions.');
      const goalsPreview = registry.previewPromptTemplate('security-research', '{{boundary}}\n{{features}}\n{{goal}}', undefined,
        [{ id: 'beale-goals-builtin', name: 'Goals', description: 'Original Goals description.', skills: [], mcpServers: [] }]);
      expect(goalsPreview).not.toContain('Synthetic Goals guidance.');
      expect(goalsPreview).not.toContain('Synthetic Goal Mode instructions.');
      registry.resetFeaturePromptSettings('beale-goals-builtin');
      expect(() => registry.setFeaturePromptSettings('unknown-feature', 'Example', '')).toThrow(/Unknown harness feature/);
      registry.close();
      const reopened = new WorkspaceRegistry(directory);
      expect(reopened.getFeaturePromptSettings()['beale-claims']?.overridden).toBe(true);
      reopened.resetFeaturePromptSettings('beale-claims');
      expect(reopened.getFeaturePromptSettings()['beale-claims']?.promptExtension).toBe(defaults['beale-claims']?.promptExtension);
      expect(host.featurePromptOverrides()).toEqual({});
      reopened.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('persists a profile override, previews it, and restores the default', () => {
    const directory = mkdtempSync(join(tmpdir(), 'beale-prompt-template-'));
    try {
      const registry = new WorkspaceRegistry(directory);
      const initial = registry.getPromptTemplateSettings('security-research');
      expect(initial.overridden).toBe(false);
      expect(initial.defaultTemplate).toContain('{{prompt_extensions}}');
      expect(initial.defaultTemplate).not.toContain('{{goal}}');
      const template = '{{boundary}}\nExample prompt for {{profile.name}}.\n{{identity}}';
      registry.setPromptTemplate('security-research', template);
      expect(() => registry.getPromptTemplateSettings('mathematics')).toThrow(/Unsupported active research profile/);
      expect(registry.previewPromptTemplate('security-research', template)).toContain('Example prompt for Security.');
      const pluginPreview = registry.previewPromptTemplate('security-research', '{{boundary}}\n{{plugins}}', undefined, [{
        id: 'example-plugin', name: 'Example Plugin', mcpServers: [],
        skills: [{ id: 'example-skill', name: 'Example Skill', useWhen: 'Inspect synthetic records.', path: '',
          resourceCounts: { scripts: 1, references: 2, assets: 0 } }]
      }]);
      expect(pluginPreview).toContain('example-plugin (plugin; 0 tools, 1 skill):');
      expect(pluginPreview).not.toContain('example-skill');
      expect(pluginPreview).not.toContain('Inspect synthetic records.');
      expect(pluginPreview).not.toContain('Example Plugin');
      expect(pluginPreview).not.toContain('Example Skill');
      const conditionalTemplate = '{{boundary}}\n{{memory}}\n{{claims}}\n{{runbooks}}\n{{reports}}';
      const knowledgeOnly = registry.previewPromptTemplate('security-research', conditionalTemplate, undefined, [{
        id: 'beale-knowledge', name: 'Knowledge', mcpServers: [], skills: []
      }]);
      expect(knowledgeOnly).toContain('Use durable memory as a concise research graph');
      expect(knowledgeOnly).not.toContain('Use one canonical, evidence-gated research claim ledger');
      expect(knowledgeOnly).not.toContain('Use runbooks as durable executable research artifacts');
      expect(knowledgeOnly).not.toContain('Use reports as durable Markdown artifacts');
      registry.close();

      const host = new AppServerHostRegistry({ registryDirectory: directory });
      expect(host.promptTemplateOverride('security-research')).toBe(template);
      const args = appServerSessionArgs({
        workspaceRoot: directory,
        workspaceDirectories: [directory],
        capturePath: join(directory, 'capture.json'),
        attemptId: 'attempt-example',
        promptMarkdown: 'Example request',
        provider: { id: 'openai-codex', riskAcknowledgements: [], authenticationPreferences: {} },
        shellSafetyMode: 'auto_review',
        promptTemplatePath: join(directory, 'prompt-template.txt'),
        pluginRuntime: { managedPluginIds: ['beale-knowledge'], pluginCatalogPath: join(directory, 'plugin-catalog.json') },
        profileAware: true,
        memoryBackend: 'disabled',
        storage: { databasePath: join(directory, 'memory.sqlite'), artifactDirectoryPath: directory }
      }, {});
      expect(args.slice(args.indexOf('--prompt-template-file'), args.indexOf('--prompt-template-file') + 2)).toEqual([
        '--prompt-template-file', join(directory, 'prompt-template.txt')
      ]);
      expect(args.slice(args.indexOf('--plugin-catalog'), args.indexOf('--plugin-catalog') + 2)).toEqual([
        '--plugin-catalog', join(directory, 'plugin-catalog.json')
      ]);

      const reopened = new WorkspaceRegistry(directory);
      expect(reopened.getPromptTemplateSettings('security-research')).toMatchObject({ template, overridden: true });
      expect(() => reopened.setPromptTemplate('security-research', '{{identity}}')).toThrow(/boundary/);
      reopened.resetPromptTemplate('security-research');
      expect(reopened.getPromptTemplateSettings('security-research')).toEqual(initial);
      expect(reopened.getPromptTemplateSettings('security-research').template).not.toContain('{{goal}}');
      expect(host.promptTemplateOverride('security-research')).toBeNull();
      reopened.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('exposes preview and save through the app-server registry operation', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'beale-prompt-operation-'));
    try {
      const template = '{{boundary}}\nExample {{profile.id}}';
      await invokeAppServerProtocol('registry.state', {
        args: [], input: { registryDirectory: directory, action: 'setPromptTemplate', args: ['security-research', template] }
      });
      const preview = await invokeAppServerProtocol<string>('registry.state', {
        args: [], input: { registryDirectory: directory, action: 'previewPromptTemplate', args: ['security-research', template] }
      });
      expect(preview).toContain('Example security-research');
      await invokeAppServerProtocol('registry.state', {
        args: [], input: { registryDirectory: directory, action: 'resetPromptTemplate', args: ['security-research'] }
      });
      const settings = await invokeAppServerProtocol<{ overridden: boolean }>('registry.state', {
        args: [], input: { registryDirectory: directory, action: 'getPromptTemplateSettings', args: ['security-research'] }
      });
      expect(settings.overridden).toBe(false);
      await invokeAppServerProtocol('registry.state', {
        args: [], input: { registryDirectory: directory, action: 'setFeaturePromptSettings',
          args: ['beale-source', 'Synthetic source guidance.', 'Use a focused source review.'] }
      });
      const featureSettings = await invokeAppServerProtocol<Record<string, { description: string; promptExtension: string }>>('registry.state', {
        args: [], input: { registryDirectory: directory, action: 'getFeaturePromptSettings' }
      });
      expect(featureSettings['beale-source']).toMatchObject({
        description: 'Synthetic source guidance.', promptExtension: 'Use a focused source review.'
      });
      await invokeAppServerProtocol('registry.state', {
        args: [], input: { registryDirectory: directory, action: 'resetFeaturePromptSettings', args: ['beale-source'] }
      });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

});
