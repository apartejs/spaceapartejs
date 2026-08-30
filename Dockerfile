# space.apartejs.dev — built here, served by nginx.
#
# Same shape as the Dockerfile that serves apartejs.dev on the same Coolify: a build
# stage that has the toolchain, and a runtime stage that has none of it. The image that
# ends up running holds a few hundred kilobytes of static files and nothing else — no
# Node, no pnpm, no sources, nothing with a CVE feed to follow.
#
# The configurator is a static bundle: `vite build` writes dist/ and that is the whole
# site. There is no server side to this product, by design — the Spaces it generates
# have none either.

# ── Build ──────────────────────────────────────────────────────────────────
FROM node:22-alpine AS build

WORKDIR /app

# corepack ships with Node and pins pnpm from the lockfile's own major version, so the
# build here resolves the same tree as the lockfile committed next to it.
RUN corepack enable && corepack prepare pnpm@10.32.1 --activate

# The manifest and the lockfile first: these two change far less often than src/, so
# Docker reuses the install layer across every commit that only touches code.
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm build

# ── Serve ──────────────────────────────────────────────────────────────────
FROM nginx:alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80
