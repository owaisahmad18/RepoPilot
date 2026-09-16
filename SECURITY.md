# Security policy

## Supported versions

RepoPilot is currently pre-1.0. Security fixes are applied to the latest version on the default branch.

## Reporting a vulnerability

Please use GitHub's private vulnerability reporting or a private security advisory for the RepoPilot repository. Do not include API keys, access tokens, private repositories, personal files, or exploit details in a public issue.

Include the affected version, operating system, reproduction steps, impact, and any suggested mitigation. Maintainers should acknowledge a report within seven days and coordinate disclosure after a fix is available.

## Scope reminders

RepoPilot removes provider credentials from child-process environments and validates generated commands and paths. It does not provide OS-level sandboxing. Running a repository task grants that code the filesystem and network permissions of the current user.
