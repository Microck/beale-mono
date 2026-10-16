# Managed Agent Plugins

This directory contains independent Agent Plugin packages maintained with Beale. Each immediate child follows [Agent Plugins 1.0.0](https://agent-plugins.org/specification).

Beale discovers each plugin package in this directory and lists it under Available in Plugins. Install one with its + button, or use its dependent research kit to install it automatically. Installed plugins can be enabled, disabled, or removed; removal returns a bundled plugin to Available. A registered workspace using a dependent research kit blocks removal. Introspection is a harness feature under `app-server/resources/harness-features`.

- **Meta Skills** (`meta-skills`): Researcher-tool guidance for Meta Bug Bounty Research Kit workspaces.
- [Apple Security Devices](apple-security-devices/README.md): Select and inspect Apple research environments, including Tart, physical iPhones, and Darwin VM.
- [Apple Target Flags](apple-target-flags/README.md): Interpret Apple Target Flag evidence and its limits.
- [Microsoft Security Devices](microsoft-security-devices/README.md): Prefer a Canary Hyper-V guest for Windows validation and check guest build freshness on the first VM touch in each session.

Every managed plugin must:

- keep its portable manifest at `plugin.json` and, when it provides MCP servers, configuration at `mcp.json`;
- keep each Agent Skill in an immediate child of `skills/`;
- resolve package-supplied files within its own plugin root;
- avoid credentials, device identifiers, machine-specific paths, and research-target data;
- treat host mutation and target execution as explicit, confirmable operations.
