# Architecture

RepoPilot has one renderer and two local hosts.

## Hosts

- `src/server.js` serves the browser preview and local JSON API on `127.0.0.1`.
- `src/main.js` hosts the same renderer in Electron and exposes a narrow IPC bridge through `src/preload.js`.
- `src/renderer/` contains the shared two-page interface.

## Analysis pipeline

1. `repository.js` validates a public HTTPS GitHub URL and creates a shallow clone.
2. `repositoryProfiler.js` inventories languages and manifests without running repository code.
3. Adapter analyzers detect supported commands, notebooks, flags, and library capabilities.
4. `analyzer.js` merges, prioritizes, and presents the generated tasks.
5. `agenticInterfaceBuilder.js` optionally sends bounded excerpts to a connected planning provider.
6. A deterministic validator accepts, repairs, or rejects the plan before it reaches the UI.

## Execution pipeline

The renderer gathers typed inputs and explicit execution consent. `executor.js` checks entry paths, builds arguments without a shell, uses a restricted child environment, and collects recent output artifacts. `environmentManager.js` creates one Python virtual environment per applet when required.

## Storage

`workspacePaths.js` creates a stable, sanitized applet identifier. Each applet directory contains its clone and all related local state. `applets.js` persists only relative paths, validates containment before loading, and deletes only the exact managed applet directory.

## Provider credentials

`connections.js` validates pasted keys and stores them in an in-memory map. Provider values are not serialized. CLI planning runs in a temporary directory, and repository processes receive a separately constructed safe environment.
