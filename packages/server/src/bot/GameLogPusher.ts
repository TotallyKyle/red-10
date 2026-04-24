import type { GameEngine } from '../game/GameEngine.js';
import type { BotManager } from './BotManager.js';
import type { GameLogger } from './GameLogger.js';

export interface GameLogSidecar {
  roomId: string;
  env: string;
  startTime: string;
  endTime: string;
  stakeMultiplier: number;
  scoringTeam: 'red10' | 'black10' | null;
  finishOrder: string[];
  teams: { red10: string[]; black10: string[] };
  players: Array<{
    id: string;
    name: string;
    seatIndex: number;
    type: 'human' | 'bot';
    team: 'red10' | 'black10' | null;
    finishOrder: number | null;
    isOut: boolean;
    startingHand: Array<{ rank: string; suit: string; isRed: boolean; id: string }>;
  }>;
  gameResult: ReturnType<GameEngine['getGameResult']>;
}

/**
 * Build the structured sidecar JSON for a finished game.
 * Exported for testability; not a hot path so inline object construction is fine.
 */
export function buildSidecar(args: {
  roomId: string;
  engine: GameEngine;
  botManager: BotManager;
  env: string;
  endTime: number;
}): GameLogSidecar {
  const { roomId, engine, botManager, env, endTime } = args;
  const state = engine.getState();
  const startingHands = engine.getStartingHands();

  const teams: { red10: string[]; black10: string[] } = { red10: [], black10: [] };
  for (const p of state.players) {
    if (p.team === 'red10') teams.red10.push(p.name);
    else if (p.team === 'black10') teams.black10.push(p.name);
  }

  return {
    roomId,
    env,
    startTime: new Date(engine.getGameStartTime()).toISOString(),
    endTime: new Date(endTime).toISOString(),
    stakeMultiplier: state.stakeMultiplier,
    scoringTeam: state.scoringTeam,
    finishOrder: [...state.finishOrder],
    teams,
    players: [...state.players]
      .sort((a, b) => a.seatIndex - b.seatIndex)
      .map((p) => ({
        id: p.id,
        name: p.name,
        seatIndex: p.seatIndex,
        type: botManager.isBot(p.id) ? ('bot' as const) : ('human' as const),
        team: p.team,
        finishOrder: p.finishOrder,
        isOut: p.isOut,
        startingHand: (startingHands[p.id] ?? []).map((c) => ({
          rank: c.rank,
          suit: c.suit,
          isRed: c.isRed,
          id: c.id,
        })),
      })),
    gameResult: engine.getGameResult(),
  };
}

/**
 * Build the file basename used for both .txt and .json.
 * Format: 2026-04-24T18-42-00-<roomId>
 */
export function buildBasename(endTime: number, roomId: string): string {
  // toISOString() → "2026-04-24T18:42:00.123Z"; trim ms + Z, replace colons.
  const iso = new Date(endTime).toISOString().replace(/\.\d{3}Z$/, '').replace(/:/g, '-');
  return `${iso}-${roomId}`;
}

interface PushOptions {
  token: string;
  repo: string; // "owner/repo"
  path: string;
  content: string;
  message: string;
}

/**
 * PUT a file to a GitHub repo via the Contents API.
 * Throws on non-2xx. Retries once on 409 — GitHub's branch ref has
 * optimistic concurrency, so two writes landing close together will
 * 409 the loser; a quick retry uses the now-current ref.
 */
async function putFile(opts: PushOptions): Promise<void> {
  const url = `https://api.github.com/repos/${opts.repo}/contents/${encodeURIComponent(opts.path)}`;
  const body = JSON.stringify({
    message: opts.message,
    content: Buffer.from(opts.content, 'utf8').toString('base64'),
  });
  const headers = {
    Authorization: `Bearer ${opts.token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json',
  };

  for (let attempt = 1; attempt <= 2; attempt++) {
    const res = await fetch(url, { method: 'PUT', headers, body });
    if (res.ok) return;
    if (res.status === 409 && attempt < 2) {
      await new Promise((r) => setTimeout(r, 250 + Math.random() * 250));
      continue;
    }
    const text = await res.text().catch(() => '');
    throw new Error(`GitHub PUT ${opts.path} → ${res.status}: ${text.slice(0, 300)}`);
  }
}

/**
 * Push the finished game's formatted log + structured sidecar to the logs repo.
 *
 * Fire-and-forget: never throws; errors are logged. No-op if GITHUB_TOKEN or
 * LOGS_REPO is unset, so local dev without a token still works.
 */
export async function pushGameLog(args: {
  roomId: string;
  engine: GameEngine;
  logger: GameLogger;
  botManager: BotManager;
}): Promise<void> {
  console.log(`[GameLogPusher] entered for room=${args.roomId}`);

  try {
    const token = process.env.GITHUB_TOKEN;
    const repo = process.env.LOGS_REPO;
    const env = process.env.ENV_LABEL ?? 'local';

    if (!token || !repo) {
      console.log(
        `[GameLogPusher] skip room=${args.roomId}: ${
          !token ? 'GITHUB_TOKEN' : 'LOGS_REPO'
        } not set`,
      );
      return;
    }

    const endTime = Date.now();
    const basename = buildBasename(endTime, args.roomId);
    const formatted = args.logger.getFormattedLog();
    const sidecar = buildSidecar({
      roomId: args.roomId,
      engine: args.engine,
      botManager: args.botManager,
      env,
      endTime,
    });

    const message = `game ${basename} (${env})`;

    // Sequence the writes — running in parallel on the same branch races
    // GitHub's optimistic ref concurrency and 409s the loser, leaving the
    // winner as an orphan. Write .json first because the reviewer needs
    // it (player types, teams, starting hands); skip .txt entirely if
    // .json fails so the repo never accumulates orphan transcripts.
    try {
      await putFile({
        token,
        repo,
        path: `${basename}.json`,
        content: JSON.stringify(sidecar, null, 2),
        message,
      });
      console.log(`[GameLogPusher] pushed ${basename}.json to ${repo} (${env})`);
    } catch (err) {
      console.error(
        `[GameLogPusher] json push failed for room=${args.roomId}: ${
          err instanceof Error ? err.stack ?? err.message : String(err)
        }`,
      );
      return;
    }

    try {
      await putFile({ token, repo, path: `${basename}.txt`, content: formatted, message });
      console.log(`[GameLogPusher] pushed ${basename}.txt to ${repo} (${env})`);
    } catch (err) {
      // .json already landed, so the game is reviewable. Log + move on.
      console.error(
        `[GameLogPusher] txt push failed for room=${args.roomId} (json already written): ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  } catch (err) {
    console.error(
      `[GameLogPusher] unexpected failure for room=${args.roomId}: ${
        err instanceof Error ? err.stack ?? err.message : String(err)
      }`,
    );
  }
}
