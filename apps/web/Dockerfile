FROM node:22-alpine AS build

ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
ARG VITE_API_BASE_URL=/backend
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL

WORKDIR /app
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY apps/ai-service/package.json apps/ai-service/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/api/package.json apps/api/package.json
COPY packages/database/package.json packages/database/package.json
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm --filter @lunaperception/web build

FROM nginx:1.27-alpine

COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html

EXPOSE 3001
