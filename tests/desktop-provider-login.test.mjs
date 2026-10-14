import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const cli = fileURLToPath(new URL('../packages/app-server-runtime/dist/cli.js', import.meta.url));
const fakeDevice = new URL('./fixtures/xai-device-response.mjs', import.meta.url).href;

test('desktop-authorized xAI login shows the device challenge and stores credentials locally', () => {
  const directory = mkdtempSync(join(tmpdir(), 'beale-xai-login-'));
  const authFile = join(directory, 'auth.json');
  try {
    const result = spawnSync(process.execPath, ['--import', fakeDevice, cli, 'auth', 'login', 'xai'], {
      encoding: 'utf8',
      timeout: 15_000,
      env: {
        ...process.env,
        BEALE_DESKTOP_INTERACTIVE_AUTH: '1',
        APP_SERVER_AUTH_FILE: authFile
      }
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /https:\/\/example\.test\/device/);
    assert.match(result.stdout, /EXAMPLE-1234/);
    assert.match(result.stdout, /xAI sign-in completed/);
    assert.doesNotMatch(result.stdout, /synthetic-access|synthetic-refresh|auth\.json/);
    const stored = JSON.parse(readFileSync(authFile, 'utf8'));
    assert.equal(stored.xai.type, 'oauth');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('ordinary app-server clients cannot invoke interactive xAI login', () => {
  const env = { ...process.env };
  delete env.BEALE_DESKTOP_INTERACTIVE_AUTH;
  const result = spawnSync(process.execPath, [cli, 'auth', 'login', 'xai'], {
    encoding: 'utf8',
    timeout: 10_000,
    env
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Interactive provider login is owned by the Beale desktop app/);
});
