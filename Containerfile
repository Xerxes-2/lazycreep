# lazycreep Gateway image: builds the web app and serves it with Caddy, proxying to the official servers (equivalent to nix/gateway.nix).
#   podman build -t lazycreep .
#   podman run --rm -p 8080:8080 lazycreep
# Runtime env overrides are documented at the top of gateway/Caddyfile; the container listens on 0.0.0.0:8080 by default.

FROM docker.io/library/node:22-alpine AS build
RUN npm install -g pnpm@11.25.0
WORKDIR /src
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY web/package.json web/
RUN pnpm install --frozen-lockfile
COPY gateway gateway
COPY web web
RUN pnpm --filter web build
# Upstream defaults and the POST allowlist come only from gateway/routes.json; expand them for the entrypoint here
RUN node -e ' \
  const r = require("./gateway/routes.json"); \
  const allow = r.apiPrefixes.flatMap(p => r.postAllowlist.map(e => `${p}/${e}`)).join(" "); \
  console.log([ \
    `: "\${MSC_API_UPSTREAM:=${r.apiOrigin}}"`, \
    `: "\${MSC_TILES_UPSTREAM:=${r.tilesOrigin}}"`, \
    `: "\${MSC_SEASON_STATIC_UPSTREAM:=${r.seasonStaticOrigin}}"`, \
    `MSC_POST_ALLOWLIST="${allow}"`, \
  ].join("\n")); \
  ' > gateway/defaults.sh

FROM docker.io/library/caddy:2-alpine
COPY --from=build /src/web/dist /srv/lazycreep
COPY --from=build /src/gateway/defaults.sh /etc/lazycreep/defaults.sh
COPY gateway/Caddyfile /etc/lazycreep/Caddyfile
ENV MSC_ADDRESS=0.0.0.0 \
    MSC_PORT=8080 \
    MSC_WEB_ROOT=/srv/lazycreep \
    XDG_DATA_HOME=/tmp \
    XDG_CONFIG_HOME=/tmp
USER nobody
EXPOSE 8080
ENTRYPOINT ["/bin/sh", "-c", ". /etc/lazycreep/defaults.sh && export MSC_API_UPSTREAM MSC_TILES_UPSTREAM MSC_SEASON_STATIC_UPSTREAM MSC_POST_ALLOWLIST && exec caddy run --adapter caddyfile --config /etc/lazycreep/Caddyfile \"$@\"", "--"]
