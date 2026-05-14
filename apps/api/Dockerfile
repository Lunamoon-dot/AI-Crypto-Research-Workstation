FROM node:22-bookworm-slim AS build

ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"

WORKDIR /app
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY apps/ai-service/package.json apps/ai-service/package.json
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/database/package.json packages/database/package.json
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm --filter @lunaperception/api build

FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production \
    PNPM_HOME=/pnpm \
    PATH="/opt/lunacrypto-venv/bin:/pnpm:$PATH"

WORKDIR /app
RUN corepack enable \
  && apt-get update \
  && apt-get install -y --no-install-recommends python3 python3-venv \
  && rm -rf /var/lib/apt/lists/*

COPY --from=build /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml ./
COPY --from=build /app/apps/api/package.json apps/api/package.json
COPY --from=build /app/packages/database packages/database
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/apps/api/node_modules apps/api/node_modules
COPY --from=build /app/packages/database/node_modules packages/database/node_modules
COPY --from=build /app/dist dist
COPY --from=build /app/apps/api/scripts apps/api/scripts
COPY apps/ai-service apps/ai-service

RUN python3 -m venv /opt/lunacrypto-venv \
  && /opt/lunacrypto-venv/bin/pip install --no-cache-dir ./apps/ai-service

EXPOSE 3000
CMD ["pnpm", "--filter", "@lunaperception/api", "start"]
