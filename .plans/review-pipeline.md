# Bot Strategy Review Pipeline — Handoff Plan

**Audience:** Claude Code / Claude.ai in a fresh session, implementing this
via Claude routines. Assume you have not seen the prior conversation.

**Repo:** `github.com/TotallyKyle/red-10` (6-player multiplayer Red 10 card
game). See `CLAUDE.md` at the repo root for general orientation — this doc
focuses on the review-pipeline feature only.

---

## Goal

After every finished game, an agent reviews the game log, flags bot mistakes
and anomalies, and surfaces them for human approval. Approved items can then
be turned into actual bot-strategy patches and regression-tested with the
existing simulator — but that second step is manual, not part of the
overnight loop.

Target UX: Kyle wakes up, opens a list of review reports generated overnight,
skims them, and decides which (if any) are worth turning into code changes.

---

## Decisions already locked in

- **Trigger shape:** polling, roughly hourly. Implemented as a **Claude
  routine** (Anthropic-hosted scheduled task), *not* a local cron or GitHub
  Action. This means the routine runs on Anthropic's side and cannot read
  Kyle's laptop filesystem directly — logs must be accessible via a network
  source (see "Log transport" below).
- **Human-in-the-loop gate:** the overnight run produces **review reports
  only**. It does not auto-edit bot code, does not open PRs with strategy
  patches, does not run the simulator. The "propose diff + simulate +
  approve" step is a separate, manually-triggered command that Kyle runs
  after picking which reviews to action. Rationale: avoids accumulating
  speculative diffs whose win-rate delta is within simulator noise.
- **Scope v1:** both local dev games *and* real multiplayer games on the
  Fly deployment. Real games are the main source of strategic signal —
  bot-vs-bot games can't teach the agent patterns that only humans
  exhibit. The server code path is identical in both environments; what
  differs is the `GITHUB_TOKEN` being set as a Fly secret vs a local env
  var.
- **Privacy:** because real players' hands would otherwise be visible in
  a public repo, logs go to a **separate private repo** (e.g.
  `TotallyKyle/red-10-logs`), not the main `red-10` repo. The routine
  reads that private repo via the GitHub MCP with a token scoped to it.

## Decisions still open

1. **Log transport (locked to separate private repo):** logs live in
   `TotallyKyle/red-10-logs` (create as private). Server commits each
   finished game via the GitHub API (`PUT /repos/.../contents/<path>`)
   to `main` of that repo on `game:scored`. Reviews go to a `reviews/`
   subdirectory in the same repo. The routine reads and writes via
   GitHub MCP with a fine-grained token scoped to that single repo.
   We chose separate-private over same-repo-branch because hands are
   visible in the logs and the main repo is public.
2. **How does Kyle see the reports in the morning? (locked: just write the
   report.)** No Slack DM, no issue, no PR. The routine's only output is
   markdown files under `reviews/` in the logs repo. Kyle reads them by
   visiting the repo (or `gh repo view`). Rationale: simplest possible
   surface — one place to look, no notifications to tune out, no extra
   integrations to maintain.
3. **Anomaly feedback loop (locked: in-report only).** When the agent sees
   a play it can't explain, it asks the question inline in the report's
   ## Anomalies section. Kyle answers later by editing the file or in a
   PR comment. The routine never blocks waiting for a response.

---

## Existing code this reuses

You do not need to build game-log generation or a simulator — both exist.

### Game log generation

- `packages/server/src/bot/GameLogger.ts` — `GameLogger` class. One
  instance per room. The server already wires this up in
  `packages/server/src/index.ts` (grep for `gameLoggers`).
- `logger.getFormattedLog()` returns a human-readable multi-line string.
  That's the current "log format."
- `logger.logGameEnd(engine)` is called when a game finishes. This is the
  natural hook point for log capture.
- There's also a `game:get_log` socket event (client-side download button) —
  reuses the same formatted string.

### Simulator (for the optional manual patch-and-test step)

- `packages/server/__tests__/simulator/` — already runs 500-game
  simulations comparing strategy mixes, prints win-rate / scoring-team-fail
  / bombs / cha-gos / etc. Invoked via
  `vitest run __tests__/simulator/simulator.test.ts`.
- `packages/server/__tests__/BotStrategy.test.ts` — unit tests for specific
  bot decisions, good for targeted regression tests when the agent proposes
  a concrete behavior change.

### Bot strategy (what gets edited if a review is actioned)

- `packages/server/src/bot/BotManager.ts` — picks bot actions each turn.
  This is the file a strategy patch would modify.

---

## Implementation phases

### Phase 1 — Log capture (server-side, local only)

**Goal:** On every `game:scored`, persist the formatted game log so
something can pick it up.

In `packages/server/src/index.ts`, inside the existing `game:scored`
emission (grep for `'game:scored'`), add a write step. The logger is
already available in `gameLoggers.get(room.id)`.

Two flavors — pick based on transport decision above:

- **If using local-only + manual transport:** write to
  `.context/game-logs/<ISO-timestamp>-<roomId>.txt`. This dir is
  gitignored by convention but the user can add it separately; ok for
  local-only v1.
- **If using GitHub branch transport (preferred):** POST the log directly
  to the GitHub API to create a commit on a dedicated `game-logs` branch.
  Pattern: `Octokit.repos.createOrUpdateFileContents({ branch: 'game-logs',
  path: \`${timestamp}-${roomId}.txt\`, content, message })`. Requires
  a `GITHUB_TOKEN` env var with repo write access. Don't block the
  response on the write (fire-and-forget, catch + log errors).

Also persist a **structured** sidecar file (`.json`) with:
- Each player's **starting hand** (critical — without this the reviewer
  can't evaluate human decisions; the formatted log only shows public
  plays, not what the player was holding when they chose to pass). The
  engine has this information at `game:scored` time because hands are
  only cleared on the next `startGame()`. Capture hands from
  `engine.getState().players[*]` before the play-again reset.
- Each player's `type: 'human' | 'bot'` (derive from `botManager.isBot`).
  The reviewer behaves differently for bot-vs-bot vs human-inclusive
  games — see Phase 2.
- Final state: teams, finish order, stake multiplier, game result (from
  `engine.getGameResult()`).
- Room metadata: roomId, start time, end time, server environment
  (`local` vs `fly` — read from a new env var, e.g. `ENV_LABEL`, set
  in `fly.toml` to `fly`).

The formatted text (`.txt`) stays human-readable for Kyle; the JSON is
the reviewer's programmatic ground truth.

### Phase 2 — Review routine (Claude routine, hourly)

**Goal:** Claude routine that wakes every hour, finds unreviewed logs,
generates a review report per log.

Routine prompt sketch:

```
You are reviewing red-10 games. Every hour, do this:

1. In TotallyKyle/red-10-logs, find files in the repo root that don't
   yet have a matching file under reviews/. Those are unreviewed games.
2. For each unreviewed log:
   a. Read the .txt (formatted) and .json (structured) files.
   b. Read the current bot strategy at
      TotallyKyle/red-10:packages/server/src/bot/BotManager.ts (main).
   c. Decide review mode based on the .json's player types:
      - **Bot-grading mode** (all players are bots, or the game is
        ≥ 5/6 bots): grade the bots. Call out plays that were clearly
        suboptimal given public info + what the bot's own hand
        allowed. Identify strategy gaps in BotManager.ts.
      - **Human-learning mode** (2+ humans played): your job is NOT
        to grade humans. Your job is to *learn from them*. Look for
        patterns in human play that the bots failed to anticipate
        ("every human passed on this turn when they could have played;
        the bot played. Why did humans read this differently?"). The
        starting-hand JSON tells you exactly what each human held, so
        you can reason about whether a pass was correct or a fake-out.
        Surface strategy ideas the bots should adopt.
   d. Write a markdown report to reviews/<same-basename>.md with:
        ## Summary (game environment, teams, final result, review mode)
        ## Bot mistakes (bot-grading mode only)
        ## Human patterns worth copying (human-learning mode only)
        ## Anomalies (questions for Kyle — he answers inline in the
           file on a follow-up commit, or via a PR comment if we open
           one later)
        ## Suggested strategy changes (high-level, NOT code diffs)
3. If no new logs, silently exit. Otherwise the review files themselves
   are the only output — no Slack, no email, no issue. Kyle reads the
   reviews/ directory in the morning.

Never edit BotManager.ts. Never open PRs on the main repo. Your only
writes are to TotallyKyle/red-10-logs under reviews/.
```

**Routine setup checklist for Kyle:**
- GitHub MCP: connected, with repo access to TotallyKyle/red-10 (read
  BotManager.ts) and TotallyKyle/red-10-logs (read logs, write reviews).
- Routine cadence: every 1 hour (or every 30 min — cheap, since "no new
  logs" is a no-op).
- Routine name: something like `red-10-game-review`.

### Phase 3 — Manual patch + simulate command (not part of the routine)

**Goal:** Once Kyle has approved a review's suggestions, turn them into
an actual strategy change and regression-test.

Implemented as a local npm script, e.g. `npm run improve-strategy
<review-file>`:

1. Read the review file + the original game log + BotManager.ts.
2. Call Claude with a prompt: "Here is a reviewed game and suggested
   strategy changes. Produce a minimal patch to BotManager.ts that
   implements the suggestion. Do not touch unrelated code."
3. Apply the patch to a new git branch.
4. Run the simulator suite before and after the patch. Compare:
   - Red 10 win rate
   - Scoring-team failure rate
   - Cha-go count (if relevant to the change)
   - Bomb count (if relevant)
5. If deltas are outside simulator noise (run N=5 seeds per side and
   check variance), print a PASS summary. Otherwise FAIL with the
   numbers. Optionally open a draft PR with the diff + sim results in
   the description.

This stays manual so Kyle is always the one triggering code changes.

---

## File layout summary

```
# TotallyKyle/red-10-logs (private, written by both local and Fly servers)
/2026-04-24T18-42-00-ABC123.txt    ← formatted (same file either env)
/2026-04-24T18-42-00-ABC123.json   ← structured: hands, player types,
                                     result, env=local|fly
/reviews/2026-04-24T18-42-00-ABC123.md   ← written by the routine
```

---

## Fly deployment setup

Real-player games are in-scope for v1, so the Fly server also pushes
logs. The code path is identical; only config differs.

One-time setup:

```bash
# 1. Create the private logs repo (via web UI or `gh repo create`).
gh repo create TotallyKyle/red-10-logs --private

# 2. Make a fine-grained PAT scoped to that one repo, with contents
#    read/write. Copy the token.

# 3. Set it as a Fly secret.
fly secrets set -a red-10 GITHUB_TOKEN=ghp_... LOGS_REPO=TotallyKyle/red-10-logs ENV_LABEL=fly

# 4. Also set it locally for dev games:
echo 'GITHUB_TOKEN=ghp_...' >> .env
echo 'LOGS_REPO=TotallyKyle/red-10-logs' >> .env
echo 'ENV_LABEL=local' >> .env
```

If `GITHUB_TOKEN` is unset, the log-push step is a no-op (don't crash
the server). This lets local dev continue to work without a token for
anyone who doesn't need the review pipeline.

---

## What NOT to do

- Don't auto-apply strategy patches. The whole point of the review/approve
  gate is that small "improvements" that win a simulation by 0.3% often
  regress real play in ways the simulator doesn't model.
- Don't put the review agent on the turn-by-turn path. It runs
  asynchronously after the game is over — it is never in the user's
  gameplay latency.
- Don't put the logs repo in public mode. Hands and player names are in
  the structured JSON; the logs repo stays private.
- Don't add Slack/email/issue notifications. The reports themselves are
  the only output. Questions for Kyle go inline in the review markdown;
  Kyle reads and answers them whenever he visits the repo.
