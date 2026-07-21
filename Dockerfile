FROM oven/bun:1.3.14-slim AS builder
ARG TARGETARCH

WORKDIR /build
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY src/ src/
COPY scripts/ scripts/
COPY docs/spec/ docs/spec/
COPY skills/ skills/
COPY tsconfig.json ./
RUN bun run scripts/generate-licenses.ts && \
    bun run scripts/embed-assets.ts && \
    bun build --compile --minify src/index.ts --outfile prepalert-agent
# bun install fetches both glibc and musl variants regardless of the
# container's actual libc (unlike npm, it doesn't filter optionalDependencies
# by the `libc` field), so pick the glibc one explicitly by exact name rather
# than globbing — node:26-slim (the final stage) is Debian-based glibc.
RUN SDK_ARCH="$(if [ "$TARGETARCH" = "amd64" ]; then echo x64; else echo "$TARGETARCH"; fi)" && \
    cp "node_modules/@anthropic-ai/claude-agent-sdk-linux-${SDK_ARCH}/claude" ./claude && \
    chmod +x ./claude

FROM node:26-slim

COPY --from=ghcr.io/astral-sh/uv:0.11.25 /uv /uvx /usr/local/bin/

COPY --from=builder /build/prepalert-agent /usr/local/bin/prepalert-agent
COPY --from=builder /build/claude /usr/local/bin/claude
COPY LICENSE RELINKING.md /usr/share/licenses/prepalert-agent/
COPY --from=builder /build/THIRD_PARTY_LICENSES.md /usr/share/licenses/prepalert-agent/

WORKDIR /app

ENTRYPOINT ["prepalert-agent"]
