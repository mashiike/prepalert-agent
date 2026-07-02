FROM oven/bun:1.3.14-slim AS builder

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

FROM node:26-slim

COPY --from=ghcr.io/astral-sh/uv:0.11.25 /uv /uvx /usr/local/bin/

COPY --from=builder /build/prepalert-agent /usr/local/bin/prepalert-agent
COPY LICENSE RELINKING.md /usr/share/licenses/prepalert-agent/
COPY --from=builder /build/THIRD_PARTY_LICENSES.md /usr/share/licenses/prepalert-agent/

WORKDIR /app

ENTRYPOINT ["prepalert-agent"]
