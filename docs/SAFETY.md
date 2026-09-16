# Safety and trust boundaries

RepoPilot treats repository content, generated plans, and task output as untrusted.

## Analysis

- Repository URLs are restricted to public HTTPS GitHub owner/repository URLs.
- Clones use argument arrays with `shell: false`.
- Static analysis reads bounded files and never imports or executes repository modules.
- Agent plans must reference existing repository-relative entries and supported runtimes.
- Shell metacharacters, traversal, and unsupported command structures are rejected.

## Execution

- The user must explicitly allow each task run.
- Entry paths must remain inside the cloned repository.
- Child processes receive an allowlisted environment without AI or GitHub credentials.
- Inputs and outputs stay inside the selected local workspace unless the user explicitly selects another file.

## Remaining risk

RepoPilot is not a VM, container, or OS sandbox. Allowed repository code inherits the current user's filesystem and network permissions. A malicious repository may read accessible files, contact remote services, consume resources, or modify local data. Use a disposable account, VM, or container for untrusted code.

## Publishing hygiene

`.repopilot/`, `.repo-gui/`, build outputs, environment files, and common private-key formats are ignored. Run `npm run check:release` before every public push.
