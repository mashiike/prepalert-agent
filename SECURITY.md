# Security Policy

## Supported Versions

prepalert-agent is currently in early (`0.0.x`) development. Only the latest
released version is supported with security fixes.

## Reporting a Vulnerability

Please report security vulnerabilities privately through
[GitHub's Private Vulnerability Reporting](https://github.com/mashiike/prepalert-agent/security/advisories/new)
rather than filing a public issue.

This is a personally maintained open source project without a dedicated
security team, so responses are best-effort — there is no guaranteed
response time, but reports will be triaged as soon as possible.

When reporting, please include:

- A description of the vulnerability and its potential impact
- Steps to reproduce the issue, or a proof of concept if available
- The affected version and environment (e.g. `serve` mode, deployment target)

## Scope

In scope:

- The prepalert-agent CLI and `serve` HTTP server (authentication, webhook
  handling, session/artifact storage, export tokens)
- The official container image published to `ghcr.io/mashiike/prepalert-agent`

Out of scope:

- Vulnerabilities in third-party dependencies — please report those to the
  upstream project directly. If you're unsure whether an issue is upstream,
  reporting here is still fine.

## Disclosure Policy

We aim to fix confirmed vulnerabilities and publish a patched release before
any public disclosure. Credit will be given to reporters who wish to be
acknowledged, once a fix is released.
