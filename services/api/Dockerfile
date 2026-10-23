# syntax=docker/dockerfile:1

FROM node:24-bookworm-slim AS build
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# Workspace manifests + Prisma schema are needed before npm ci so the
# @prisma/client postinstall can generate the client.
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/package.json
COPY services/api/package.json services/api/package.json
COPY services/api/prisma services/api/prisma

RUN npm ci --workspace @tranergy/api --include-workspace-root
RUN cd services/api && npx prisma generate

COPY services/api/tsconfig.json services/api/tsconfig.json
COPY services/api/src services/api/src
COPY services/api/scripts services/api/scripts
COPY contracts/deployments contracts/deployments

RUN npm run build -w services/api

FROM node:24-bookworm-slim AS runtime
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app /app

WORKDIR /app/services/api
EXPOSE 4000
CMD ["node", "dist/server.js"]
