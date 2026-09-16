# RepoPilot

**RepoPilot is an agentic desktop app builder that turns public GitHub repositories into guided, reusable applications.**

[![CI](https://github.com/owaisahmad18/RepoPilot/actions/workflows/ci.yml/badge.svg)](https://github.com/owaisahmad18/RepoPilot/actions/workflows/ci.yml)
[![Desktop builds](https://github.com/owaisahmad18/RepoPilot/actions/workflows/desktop-build.yml/badge.svg)](https://github.com/owaisahmad18/RepoPilot/actions/workflows/desktop-build.yml)
[![Latest release](https://img.shields.io/github/v/release/owaisahmad18/RepoPilot?label=download)](https://github.com/owaisahmad18/RepoPilot/releases/latest)

RepoPilot combines deterministic repository analysis with an optional OpenAI, Claude, or Gemini agent. The agent discovers useful capabilities, proposes workflows and human-friendly controls, validates its plan, attempts one repair when needed, and falls back safely. Repository code runs only after explicit user confirmation.

The same renderer powers a lightweight browser preview and the Electron desktop application.

## Download

Download the latest desktop build from [GitHub Releases](https://github.com/owaisahmad18/RepoPilot/releases/latest).

| Operating system | Direct download | Platform folder |
| --- | --- | --- |
| Windows x64 | [Download `.exe`](https://github.com/owaisahmad18/RepoPilot/releases/download/v0.1.2/RepoPilot.Setup.0.1.2.exe) | [Windows](Windows/) |
| macOS Apple Silicon | [Download `.dmg`](https://github.com/owaisahmad18/RepoPilot/releases/download/v0.1.2/RepoPilot-0.1.2-arm64.dmg) | [macOS](macOS/) |
| Linux x64 | [Download `.AppImage`](https://github.com/owaisahmad18/RepoPilot/releases/download/v0.1.2/RepoPilot-0.1.2.AppImage) | [Linux](Linux/) |

These early builds are unsigned. Windows and macOS may show an unrecognized-developer warning; review the source and release notes before allowing the app to run.

## Highlights

- Search for repositories by describing the result you want, with explainable ranking.
- Analyze Python, Jupyter notebook, Rust, PHP-library, and common scientific workflows.
- Improve generated interfaces with an optional OpenAI, Claude, or Gemini planning agent.
- Switch between a conversational assistant and compact manual controls.
- Adapt compatible image, table, JSON, text, and directory inputs.
- Create a private Python environment for each applet when setup is required.
- Preview generated images, tables, text, notebooks, and other result files.
- Save and reopen multiple applets from a local library.
- Keep each applet in its own folder with its repository, metadata, setup, inputs, and results.

## Quick start

Requirements: Node.js 20 or newer and Git.

```bash
npm ci
npm run web
```

Open `http://127.0.0.1:3211` for the browser preview. To run the desktop shell instead:

```bash
npm start
```

The browser preview defaults to the ignored `.repopilot/` directory. Use **Choose folder** to select another working folder. The choice is retained only for the current session.

## How it works

1. Search GitHub by goal or paste a public repository URL.
2. Choose a working folder.
3. RepoPilot clones the repository without executing it.
4. Deterministic analyzers inspect bounded files and build a safe interface schema.
5. If an AI provider is connected, a read-only planning pass can improve labels, grouping, and workflow selection.
6. The generated plan is validated; invalid plans receive one repair attempt and then fall back safely.
7. Review setup and inputs, explicitly allow execution, and run the task.
8. Inspect outputs in the Results panel or reopen the applet later.

## Accounts and API keys

Public repository analysis does not require an account. The Accounts sidebar supports OpenAI/Codex, Anthropic/Claude, Google Gemini, and GitHub.

Pasted keys are validated and kept only in process memory for the current session. They are not written to disk and are removed from repository child-process environments. Supported CLI logins can also be detected without copying subscription credentials into RepoPilot.

## Local workspace

Each generated applet uses an isolated directory:

```text
working-folder/
└── applets/
    └── owner--repository-id/
        ├── applet.json
        ├── repository/
        ├── environment/
        ├── uploads/
        └── outputs/
```

Saved metadata uses paths relative to the working folder. Deleting an applet removes this complete applet directory after confirmation.

## Safety model

Repository inspection does not execute repository code. Execution requires a generated supported task and explicit user confirmation. Child processes receive a restricted environment without provider credentials.

RepoPilot is not an operating-system sandbox. Once allowed to run, third-party code can still access files and network resources available to the current operating-system user. Review unfamiliar repositories before execution. See [docs/SAFETY.md](docs/SAFETY.md) for the trust model.

## Verification

```bash
npm run verify
```

This runs the release-safety scan and complete automated test suite. The safety scan checks releasable files for common credential formats and personal absolute paths.

## Desktop builds

Build on the matching operating system:

```bash
npm run package:windows  # NSIS .exe
npm run package:mac      # .dmg
npm run package:linux    # AppImage
```

The included GitHub Actions workflow builds all three platforms on version tags and publishes the artifacts to a GitHub Release. Public production distribution should add Windows code signing and Apple signing/notarization.

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Safety and trust boundaries](docs/SAFETY.md)
- [Contributing](CONTRIBUTING.md)
- [Security policy](SECURITY.md)

## Status

RepoPilot is an early-stage project. Repository ecosystems are diverse, so generated tasks should always be reviewed before running. Contributions that add analyzers, fixtures, and cross-platform testing are welcome.

## License

[MIT](LICENSE)
