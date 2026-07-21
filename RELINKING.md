# Relinking Instructions (LGPL-2 Compliance)

prepalert-agent distributes pre-compiled single-file executables built with
[Bun](https://bun.sh/) (`bun build --compile`). Bun statically links
JavaScriptCore and other LGPL-2 licensed libraries (WebKit, tinycc).

Per LGPL-2 Section 6, you have the right to modify these libraries and relink.
Since this project is open source, you can rebuild the binary from source with
any compatible version of Bun.

## Rebuilding from source

```bash
git clone https://github.com/mashiike/prepalert-agent.git
cd prepalert-agent
bun install
bun run compile
```

The `compile` script embeds documentation and skill assets into the binary
(via `scripts/embed-assets.ts`) before compiling, and also fetches the native
`claude` CLI binary that the Agent SDK requires as a sibling `claude` file
next to the compiled executable (via `scripts/fetch-claude-binary.ts`) —
`prepalert-agent` and `claude` must stay in the same directory.

To use a different Bun version (and thus a different JavaScriptCore):

1. Install the desired Bun version (see https://bun.sh/docs/installation)
2. Check out the tag matching your binary's version
3. Run the build command above

## Rebuilding Bun itself

To modify JavaScriptCore or other LGPL components within Bun:

```bash
git clone https://github.com/oven-sh/bun.git
cd bun
git submodule update --init --recursive
make jsc
zig build
```

See https://github.com/oven-sh/bun/blob/main/LICENSE.md for the full list of
statically linked libraries and their licenses.

## Container images

The container images (`ghcr.io/mashiike/prepalert-agent`) also contain a
Bun-compiled binary. To rebuild with a modified Bun, update the
`FROM oven/bun:...` line in the Dockerfile and rebuild the image.
