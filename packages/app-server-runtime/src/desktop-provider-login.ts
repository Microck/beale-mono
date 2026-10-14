import { loginAuthProvider, type AuthLoginCallbacks } from '@beale/research-agent/auth';

/** Runs only in the local child process launched by Beale Provider Settings. */
export async function runDesktopProviderLogin(providerId: 'xai'): Promise<void> {
  const controller = new AbortController();
  const abort = (): void => controller.abort();
  process.once('SIGTERM', abort);
  process.once('SIGINT', abort);
  const callbacks: AuthLoginCallbacks = {
    signal: controller.signal,
    prompt: async () => { throw new Error('xAI device sign-in unexpectedly requested an interactive prompt.'); },
    notify: (event) => {
      if (event.type !== 'device_code') return;
      process.stdout.write(`Open this URL in your browser:\n${event.verificationUri}\nEnter code: ${event.userCode}\n`);
    }
  };
  try {
    await loginAuthProvider(providerId, callbacks);
    process.stdout.write('xAI sign-in completed.\n');
  } finally {
    process.off('SIGTERM', abort);
    process.off('SIGINT', abort);
  }
}
