#!/usr/bin/env node
import { usage } from "./cli-usage.js";
import { APP_SERVER_RUNTIME_VERSION, parseAppServerProtocolArguments } from "./protocol.js";
import { installPreBealeEnvironmentAliases } from "@beale/research-agent/legacy-compatibility";

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
  installPreBealeEnvironmentAliases();
  try {
    const protocolArguments = isProtocolCommand(argv[0])
      ? parseAppServerProtocolArguments(argv)
      : { args: argv };
    argv = protocolArguments.args;
    if (isProtocolCommand(argv[0])) {
      const { runAppServerClient } = await import('./app-server-client.js');
      await runAppServerClient(argv, protocolArguments.requestId);
      return;
    }
    if (argv[0] === "-h" || argv[0] === "--help") {
      console.log(usage());
      return;
    }    if (argv[0] === "-v" || argv[0] === "--version") {
      console.log(APP_SERVER_RUNTIME_VERSION);
      return;
    }
    if (isUtilityCommand(argv)) {
      if (argv[0] === 'auth' && argv[1] === 'login') {
        if (argv[2] === 'xai' && argv.length === 3 && process.env.BEALE_DESKTOP_INTERACTIVE_AUTH === '1') {
          const { runDesktopProviderLogin } = await import('./desktop-provider-login.js');
          await runDesktopProviderLogin('xai');
          return;
        }
        throw new Error('Interactive provider login is owned by the Beale desktop app; this app-server client cannot prompt for credentials.');
      }
      const { runAppServerUtilityClient } = await import('./app-server-client.js');
      await runAppServerUtilityClient(argv);
      return;
    }
    throw new Error('app-server execution is hosted by the Beale app-server. Start sessions through its control API.');
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

function isUtilityCommand(argv: readonly string[]): boolean {
  return argv[0] === 'profile'
    || argv[0] === 'auth'
    || argv[0] === 'models'
    || argv[0] === 'tools'
    || argv[0] === 'config';
}

function isProtocolCommand(command: string | undefined): boolean {
  return command === "complete"
    || command === "protocol"
    || command === "session"
    || command === "knowledge"
    || command === "harness"
    || command === "workspace"
    || command === "registry";
}

await main();
