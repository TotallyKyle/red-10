# Red 10

Real-time multiplayer Red 10 (a 6-player Chinese trick-taking card game)
played in the browser. Socket.IO carries all gameplay events; the server is
authoritative and the client only renders state it receives back.

## Repo layout

npm workspaces monorepo (root `package.json` lists the three packages).

- `packages/shared` — pure types, constants, and validation. Imported by both
  server and client. Has its own vitest suite.
- `packages/server` — Express + Socket.IO. The `GameEngine` (in `src/game/`)
  holds all rules/state; `src/lobby.ts` handles room membership; `src/index.ts`
  wires socket events to the engine and broadcasts views. Bots live in
  `src/bot/` and run inside the same process — they don't connect via sockets.
- `packages/client` — React 19 + Vite + Tailwind v4 + Zustand. Talks to the
  server via `socket.io-client` (see `src/hooks/useSocket.ts`).

## Commands

Run from repo root unless noted:

```bash
npm run dev            # server (3001) + client (5173) concurrently
npm run build          # builds shared, then server, then client (order matters)
npm test               # shared + server vitest suites
npm run test:server    # just server tests
npm run test:shared    # just shared tests
```

Single-package dev/test: `npm run dev -w packages/server`,
`npm run test -w packages/server`, etc.

## Conventions worth knowing

- All three packages are **ESM** (`"type": "module"`). Relative imports inside
  TS source must use the `.js` extension (e.g. `from './lobby.js'`) — that's
  the compiled-output path, and TS resolves it correctly. Don't strip it.
- Cross-package imports use the workspace name: `from '@red10/shared'`. The
  shared package re-exports everything from `src/index.ts`.
- The server is **the source of truth** for game state. Never compute or mutate
  game state on the client — emit an event and re-render from the next
  `game:state` broadcast. `GameEngine.getClientView(socketId)` produces the
  per-player view (other players' hands are hidden).
- Reconnect uses a rotating token: `room:rejoin` accepts the previous token
  and returns a new one. Auth failures collapse into one generic error
  (`packages/server/src/index.ts:554`) — keep it that way; don't leak which
  field was wrong.
- Socket payloads are untrusted. Validate shape defensively before use (see
  the `room:rejoin` handler for the pattern).
- Bots run server-side via `BotManager` and `scheduleBotAction` —
  they don't have sockets, so any code that broadcasts to "all human players"
  must skip `botManager.isBot(socketId)` (see `broadcastState`).
- Turn timer auto-passes after 30s for humans only; bots are skipped (they
  schedule themselves with `BOT_ACTION_DELAY` / `BOT_CHA_DELAY`).

## Deployment

See `DEPLOY.md`. Default path is single-host on Fly.io with `SERVE_CLIENT=true`
so the server serves the built client at the same origin (no CORS). CI in
`.github/workflows/` runs tests on every push and auto-deploys on push to
`main` (requires `FLY_API_TOKEN` secret).

For local prod-mode verification:

```bash
npm run build
SERVE_CLIENT=true PORT=3099 node packages/server/dist/index.js
# open http://localhost:3099
```

## Game-specific vocabulary

If a request mentions any of these, they're domain terms (not bugs to "fix"):

- **Red 10s** — the four red 10 cards. Holding one puts you on the doubling
  team; revealing them via play emits `team:revealed`.
- **Doubling / quadrupling** — pre-round phase where players can declare a
  bomb to multiply the stakes. State lives in `engine.getState().doubling`.
- **Cha / Go / Cha-Go** — a mid-round side mechanic with its own state machine
  (`ChaGoState`). Multiple players may be eligible simultaneously; bots
  respond on a stagger (`BOT_CHA_DELAY`).
- **Bomb / defuse** — overriding plays. `play:defuse` is a separate socket
  event from `play:cards`.
- **Format** — `single | pair | straight | paired_straight | bomb` (see
  `PlayFormat` in shared/types). Determines what can beat what.
