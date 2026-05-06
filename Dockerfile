# syntax=docker/dockerfile:1.7

# ----- deps stage -----
# Install all deps (incl. dev) and generate the Prisma client.
# Prisma client artifacts land in node_modules/.prisma and are reused by builder
# and copied verbatim into the runner image.
FROM node:20-slim AS deps
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@10.33.2 --activate

WORKDIR /app

COPY package.json pnpm-lock.yaml ./
COPY prisma ./prisma

RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile

RUN pnpm exec prisma generate

# ----- builder stage -----
# Compile TypeScript to dist/. Reuses node_modules from deps so we don't pay for
# install twice.
FROM node:20-slim AS builder
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@10.33.2 --activate

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/prisma ./prisma
COPY package.json pnpm-lock.yaml tsconfig.json ./
COPY src ./src

RUN pnpm build

# ----- runner stage -----
# Production image. Skips pnpm prune in MVP — Phase 9 keeps the Dockerfile
# simple and the generated Prisma client safe. Image runs as the non-root
# `node` user that ships with node:20-slim.
FROM node:20-slim AS runner
ENV NODE_ENV=production
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@10.33.2 --activate

WORKDIR /app

COPY --from=deps   /app/node_modules ./node_modules
COPY --from=deps   /app/prisma       ./prisma
COPY --from=builder /app/dist        ./dist
COPY package.json pnpm-lock.yaml ./

RUN chown -R node:node /app
USER node

EXPOSE 3001

# Apply pending migrations on every boot, then start the server.
# Per CLAUDE.md: container is the source of truth for migration application.
CMD ["sh", "-c", "pnpm exec prisma migrate deploy && node dist/index.js"]
