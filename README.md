# lazycreep

A lightweight third-party [Screeps](https://screeps.com) client for desktop and mobile.

## Pros

- Installable PWA; light and power-saving on phones and tablets
- World Map, Room View (live and replay), console, battle overview
- Attack alerts via system notifications
- Season, MMO and private servers
- Self-hosted stateless gateway: your token stays in the browser

## Limitations

- Mostly read-only: the gateway blocks every write except console commands, so no code uploads, market orders or room actions
- Needs a full-access token (season servers reject scoped tokens)
- Attack alerts only fire while the app is open, and only detect room-level events
- Needs your own server to host the gateway
- Built for personal use

## Usage

Container:

```sh
podman build -t lazycreep .
podman run -d -p 8080:8080 lazycreep
```

Nix:

```sh
nix run .#gateway
```

NixOS: import `nixosModules.default` and set `services.lazycreep.enable = true;`.

Open <http://localhost:8080> and enter your Screeps token.

Development: `pnpm install && pnpm dev`.
