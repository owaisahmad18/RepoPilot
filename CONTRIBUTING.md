# Contributing to RepoPilot

Thank you for helping make repository tools accessible to non-programmers.

## Development setup

1. Install Node.js 20 or newer and Git.
2. Run `npm ci`.
3. Run `npm run web` for the browser preview or `npm start` for Electron.
4. Before submitting changes, run `npm run verify`.

## Pull requests

- Keep each change focused and explain its user-facing effect.
- Add or update tests for analyzers, execution preparation, storage, and security boundaries.
- Use fixtures or temporary directories; never commit cloned repositories, generated outputs, credentials, or personal paths.
- Preserve the rule that repository code is not executed during analysis.
- Preserve explicit user confirmation before task execution or permanent deletion.
- Include screenshots for visible interface changes when practical.

## Adding an analyzer

An analyzer should return the shared interface schema, use repository-relative entry paths, avoid executing repository content, and assign conservative confidence. Add representative tests for supported and unsupported repository shapes.

## Reporting security issues

Do not open a public issue for a vulnerability. Follow [SECURITY.md](SECURITY.md).
