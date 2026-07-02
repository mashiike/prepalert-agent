# Contributing to prepalert-agent

Thank you for your interest in contributing!

## Development Setup

Requirements:

- [Bun](https://bun.sh/) (see `.tool-versions` for the Node.js version used alongside)

```bash
bun install
bun test          # run tests
bun run lint      # eslint
bun run build     # type check (tsc)
bun run compile   # build the single binary
```

## Pull Requests

- Open an issue first for large changes so the direction can be discussed before you invest time
- Keep PRs focused on a single change
- Make sure `bun test`, `bun run lint`, and `bun run build` pass
- Add or update tests for behavior changes

## Documentation

Specification documents live in `docs/spec/`. The Japanese version
(`docs/spec/ja/`) is the source of truth and the English version
(`docs/spec/en/`) is its translation — **update both** when changing
specifications. The same applies to `README.ja.md` (master) and `README.md`.

## Reporting Bugs

Please use [GitHub Issues](https://github.com/mashiike/prepalert-agent/issues).
For security vulnerabilities, see [SECURITY.md](SECURITY.md) instead of filing
a public issue.

## Release Process

Releases are automated with [tagpr](https://github.com/Songmu/tagpr).
Merging the release PR tags a new version and publishes binaries and container
images. Contributors do not need to do anything release-related.
