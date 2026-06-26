FROM oven/bun:1.3.14-slim AS builder

WORKDIR /build
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY src/ src/
COPY scripts/ scripts/
COPY tsconfig.json ./
RUN bun run scripts/generate-licenses.ts && \
    bun build --compile --minify src/index.ts --outfile prepalert-agent

FROM node:26-slim

COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /usr/local/bin/

COPY --from=builder /build/prepalert-agent /usr/local/bin/prepalert-agent
COPY docs/spec/ /usr/local/share/prepalert-agent/docs/spec/
COPY skills/ /usr/local/share/prepalert-agent/skills/
COPY LICENSE RELINKING.md /usr/share/licenses/prepalert-agent/
COPY --from=builder /build/THIRD_PARTY_LICENSES.md /usr/share/licenses/prepalert-agent/

ENV PREPALERT_DOCS_DIR=/usr/local/share/prepalert-agent/docs/spec
ENV PREPALERT_SKILLS_DIR=/usr/local/share/prepalert-agent/skills

WORKDIR /app

ENTRYPOINT ["prepalert-agent"]
