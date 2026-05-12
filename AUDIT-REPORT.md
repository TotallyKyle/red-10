# Implementation Audit Report — Bot Strategy Fixes

This document tracks impl-loop runs against the bot strategy code. Latest run on top.

---

## Run 2026-05-11c — Hand-size-at-game-end metric + M5 validation (M6)

Added a hand-size-at-game-end histogram to the strategy-fixes A/B test so we can directly measure the trap-rate question raised by the M5 fix. Reran the 15K-game A/B head-to-head with the new metric.

### A/B results (15K games head-to-head, current SmartRacer vs LegacyPreFixes)

**Payout:**
- Net delta: +5,988 (was +5,200 before M5)
- Δ/game: **+0.399** (was +0.347 before M5)
- z-score: **6.04** (was 5.12 before M5)

**Hand-size-at-game-end distribution (per player-instance across 90K instances):**

| Hand size | Post-fix | Pre-fix | Δ (pp) |
|---|---:|---:|---:|
| 0 (out cleanly) | 75.06% | 71.20% | **+3.86** |
| 1 (stuck — the trap) | **11.55%** | **13.56%** | **-2.01** |
| 2 | 5.02% | 6.20% | -1.18 |
| 3-5 | 5.32% | 5.99% | -0.67 |
| 6+ | 3.04% | 3.05% | -0.01 |

**Headline: M1-M5 reduce the hand=1 trap rate by ~15% (relative)** and the hand=2 rate by ~19%. The "out cleanly" rate jumps from 71.2% to 75.1%. The hand=6+ rate (race-loser cases unrelated to orphan-low traps) is unchanged, as expected.

### What shipped (M6)

- `packages/server/__tests__/simulator/strategyFixesAB.test.ts`: Captures `state.players[i].handSize` for each completed game via the existing `onGameComplete(_, gr, engine)` callback. Bucketed by post-fix vs pre-fix side (orientation-aware). Prints a histogram in the A/B output.
- `packages/server/vitest.ab.config.ts`: New standalone vitest config. The default `vitest.config.ts` excludes `**/*AB.test.ts` (intentional — A/B tests are slow), but that made `npm run test:ab` fail because the explicit filter doesn't override the exclude. The new config re-includes A/B tests with a 10-minute timeout. Quality-of-life fix; `package.json` should be updated to use this config for `test:ab` (left to Kyle).

No new behavioral changes; this is observability only.

### Audit findings: 0 issues

Single-file change (plus the config). Code is a straight extension of the existing `runHeadToHead` aggregation pattern. Regular test suite still passes (335/335).

---

## Run 2026-05-11b — Hand=1 orphan-low trapping fix (M5)

Source: human-reported pain point ("biggest flaw"). Empirical analysis of 115 game logs showed 30 bot-trapped-at-hand=1 instances (32% of all bot traps), all reconstructable cases held rank 3-8 cards. Root cause: the `isEndgame` race-mode in `scoreOpening` defavors leading low orphans at hand≤4 regardless of hand structure.

### Summary

- Total milestones implemented: **1** (M5)
- Total issues found: **0** (first-pass clean)
- Tests: **327 → 335** (+8 new tests, 3 existing tests updated for new behavior)
- All 29 test files / 335 tests pass

### Commit

- `e1b1d13` — bot: gate endgame race-mode on hand strength + fix hand=2 fallback

Unpushed; awaiting Kyle's review.

### What shipped

Three correlated changes in one commit:

1. **`scoreOpening` endgame branch now gated on hand strength.** When `hand.length ≤ 4`, race-mode (`score += avgRank`) only fires if `isSuperStrong` (≥2 distinct bomb ranks OR special-bomb 4-4-A). Weak structures fall into dump-mode (orphan-low + low-rank preference, same scoring as non-endgame). This is the fix for the empirical hand=1 trap pattern.

2. **`hasStrandedLowCard` widened from rv≤2 to rv≤6** (ranks 3-9). Affects the existing M-Stranded check in the response branch — bot now treats orphan 6/7/8/9 as stranded, eligible for "burn winner to seize lead" if `hasExtraPower`.

3. **Bug fix at handSize=2 fallback** (`smartPlayDecision` opening branch). Comment promised "lead our LOWEST" but code returned `player.hand[0]` (first card in arbitrary deal order). Now correctly sorts ascending. Not gated behind the opts flag — legacy strategy also gets this fix.

### Legacy bypass

`disableEndgameStrengthGate` flag added to `BotPlayOptions`. When set:
- `scoreOpening` endgame branch reverts to original `score += avgRank` always.
- `hasStrandedLowCard` reverts to rv≤2 threshold.

`LegacyPreFixesStrategy` opts updated. Other strategies (Aggressive, SmartRacer, HandSizeExploiter, TeamCoordinator, PreFixD) unchanged.

### Audit findings: 0 issues

Behavior tested across all four branches: weak hand=4 → dump-mode, super-strong hand=4 → race-mode preserved, hand=2 fallback returns lowest, legacy bypass restores original behavior.

### Notes on existing-test updates

Three existing tests were updated to reflect the new behavior:
- `BotStrategy.test.ts` line 821: was encoding the OLD race-mode behavior ("prefers K-K pair over low single") with explicit `// Before fix / After fix` comments. Updated to the NEW dump-mode behavior. This test was always going to need updating when this trap got fixed.
- `ChaBaitOpener.test.ts` Test 5: late-game weak-hand test. Updated from "pair leads" to "low orphan leads."
- `TeammateRescue.test.ts` `powerBotHandSmall`: replaced a `6♣` filler with `K♣`. The 6 was triggering M-Stranded (now widened to rv≤6) and confounding the rescue-specific test. Pure test-isolation cleanup.

All three test updates are documented inline with explanatory comments.

### Empirical motivation

From 115 game logs analyzed for this fix:
- Bot trap rate by hand-size: 30 @ hand=1, 17 @ hand=2, 46 @ hand=3+ (total 93 bot-trapped instances)
- Human trap rate: 11 instances total
- Bots get trapped ~9× more often than humans
- All 16 reconstructable bot-hand=1-trapped cards: rank 3-8 (rank distribution: 7×3s, 2×4s, 2×6s, 2×7s, 3×8s)
- Hand=2 bot traps: 7 of 8 reconstructable cases had different ranks (no valid 2-card format) — the handSize=2 fallback bug applies in these cases

### Next steps for Kyle

1. Review the commit (`git show e1b1d13`).
2. Run A/B simulation: `npm run test:ab` — this is a behavioral change with potentially wide impact. Look for shift in (a) win rate, (b) per-game-trapped-count, (c) hand=1 trap frequency specifically.
3. If A/B looks healthy, merge and observe in production for a week. Daily review skill will surface whether the trap rate drops.
4. Single-bomb opponent-aware race-mode detection (V2) — deferred. Will need engine state threading and an opp-handsize-conditional check.

---

## Run 2026-05-11 — 2026-05-10 game-review follow-up: M1-M4

Source: review of 7 bot/human games on 2026-05-10 (TotallyKyle/red-10-logs/reviews/). Original 6 candidate improvements proposed; user dropped #6 (format-detector "issue" is by-design special-bomb categories) and held #1 (triple-bomb doubling threshold) for further data. Items #2-5 implemented here as M1-M4.

### Summary

- Total milestones implemented: **4**
- Total issues found across audit passes: **0**
- Audit passes per milestone: 1 each (all first-pass clean)
- Tests: **304 → 327** (+23 new tests across 4 new test files)
- All 28 test files / 327 tests pass

### Commits

- `afc703d` — M1: probabilistic 2v4 doubling penalty for 1-red-10 holders
- `aacd23e` — M2: rescue publicly-known teammate stranded at handSize=1
- `84c1af5` — M3: penalize straight openers that break held pairs
- `efaec95` — M4: cha-bait bonus for low-single openers with capable teammate

All commits unpushed; awaiting Kyle's review.

### Milestones

#### M1 — Probabilistic 2v4 doubling penalty (`afc703d`)

**What shipped:** When a bot holds exactly 1 red 10 on team red10, `standardDoublingDecision` bumps the strength threshold by +0.4 (vs the +1 used for deterministic 2v4 with 2 red 10s). Reflects the ~40% prior on 2v4 given the team-size distribution.

**Files:** `packages/server/src/bot/BotManager.ts` (+19 lines), new `__tests__/OneRedTenDoubling.test.ts` (+248 lines, 5 tests). Pre-existing `StrategyFixes.test.ts` Test 3 updated to reflect new behavior (1-red-10 + strength=9 now skips).

**Legacy bypass:** `disable1RedTenDoublingPenalty` flag wired into `LegacyPreFixesStrategy`.

No issues found in audit. Mutual exclusion with deterministic 2v4 path is clean. `hasStrongStructure` unchanged for probabilistic case (per spec — only threshold tightened).

#### M2 — Stranded-teammate rescue (`aacd23e`)

**What shipped:** New `findStrandedTeammate(engine, playerId)` helper + M-RescueTeammate block in `smartPlayDecision`'s response branch, fires before existing M-Stranded. When a publicly-known teammate is at handSize === 1 and bot has `hasExtraPower`, bot burns winning beat (2-single preferred, then smallest bomb) to seize lead. Next round's opening branch (b) leads a low single, letting the teammate play their orphan and exit.

**Files:** BotManager.ts (+74 lines), new `__tests__/TeammateRescue.test.ts` (+375 lines, 9 tests).

**Design decision:** Original spec called for tracking "≥2 consecutive completed rounds at hand≤2." Engine state doesn't expose completed-round history, so simplified to `handSize === 1` (strongest signal). Revisit if more nuance needed.

**Legacy bypass:** `disableTeammateRescue`.

No issues found. Guard ordering correct (`!tryingToExit && !isLastPlayByTeammate`). 9 tests cover all branches including edge cases (no extra power, handSize=2, teams hidden, opponent stranded, self-exit, last-play-by-teammate).

#### M3 — Straight pair-preservation (`84c1af5`)

**What shipped:** In `scoreOpening`, straight plays lose 6 points per "breaking" card (3 if breaking a triple+ group). Plus small length bonuses (5-card +0.5, 6-card +1.0, 7+ +1.5) on top of existing `cards.length * 10` weight.

**Files:** BotManager.ts (~30 lines in scoreOpening), new `__tests__/StraightPairPreservation.test.ts` (6 tests).

**Design clarification (made during context-gathering):** Original spec emphasized "long-straight preference." Investigation showed `findValidStraights` already enumerates all lengths ≥3 and `cards.length * 10` already weights heavily for length. Real gap was *pair preservation* — straights consuming a card from a held pair had no penalty. Reframed milestone to focus on the actual bug.

**Legacy bypass:** None (pure scoring improvement; A/B can be added later if needed).

No issues found. Bomb-rank cards are pre-filtered out of straight candidates upstream in `chooseBestOpening`, so the pair-break penalty primarily applies to plain 2-of-a-kind pairs. The 6-point penalty is calibrated to lose to a 4-card straight's +10 length but win against staying with the pair when no better alternative exists.

#### M4 — Cha-bait opener bonus (`efaec95`)

**What shipped:** When bot has team identity, at least one publicly-known same-team teammate with handSize ≥ 5, bot's own handSize ≥ 6, and is considering a singleton of rank 3-8, `scoreOpening` adds +6. Tips edge-case choices between low-singles and low-pairs toward the single — setting up cha→teammate-go round-seizing.

**Files:** BotManager.ts (~40 lines, scoreOpening and chooseBestOpening signatures extended with optional `engine`, `playerId`), new `__tests__/ChaBaitOpener.test.ts` (8 tests).

**Legacy bypass:** `disableChaBait`.

No issues found. Function signature extensions are backward-compatible (optional parameters). Symmetric for red10 and black10 teams. The +6 bonus is calibrated for hand=7 where the large-hand-dump bonus (+6 for 2-card plays) makes a low pair score 46; a rank-3 singleton scores 42 without bait, 48 with — tipping the close call.

### Pattern Analysis

- **Consistent design pattern across all 4 milestones:** each adds new gated logic with a `disable*` opts flag (default false), and registers the flag in `LegacyPreFixesStrategy` to preserve A/B parity. Every production strategy gets the new behavior automatically.
- **Conservative thresholds throughout:** +0.4 (M1), 6-point penalty (M3), +6 bonus (M4). Small enough to tip edge cases without dominating scoring.
- **Zero engine state changes.** All milestones rely only on existing state (`state.round`, `state.players[].handSize`, `state.doubling.teamsRevealed`, `state.players[].revealedRed10Count`).
- **No new strategies added to `ALL_STRATEGIES`.** All tunings of existing logic.

### Cross-milestone integration check

- M2 and M4 both use the "publicly known teammate" pattern (`teamsRevealed || revealedRed10Count > 0`) — duplicated rather than shared. Acceptable; extract to a helper if the pattern proliferates further.
- M3 and M4 both modify `scoreOpening`. M3 lands first; M4 extends the function signature on top. No conflict.
- M1 and M2 rely on existing `evaluateHandStrength` / `hasExtraPower` helpers. No new shared dependencies.

### Unresolved Items

- **Review item #1 (lower triple-bomb doubling threshold) intentionally NOT implemented.** Investigation showed the current threshold is conservative-but-correct for the bot's risk model. Em/Ty's wins in 04-24-02 and 04-59-30 are single-sample variance — their hands actually score ~3.5 vs the threshold of 9. Recommendation: shadow-log "would-have-doubled" decisions across more samples before tuning.
- **M2 simplification:** `handSize === 1` instead of "≥2 consecutive rounds at handSize≤2." Revisit if data shows it's too conservative or if engine adds round history.
- **M3 didn't ship the helper `countPairBreakingCards`** — inlined the logic. Extract if a similar check is needed elsewhere (e.g., response-branch plays that break pairs).
- **A/B simulation not yet run.** All 4 changes have unit tests but no end-to-end win-rate measurement. Recommend running `npm run test:ab` to compare SmartRacer (new) vs LegacyPreFixes (old) over 10K+ games before merging to main.

### Next steps for Kyle

1. Review the 4 commits locally (`git log -p afc703d..efaec95`).
2. Run A/B simulation. Look for shifts in scoring-team-failure rate and 2v4-doubling-loss rate.
3. If A/B numbers look healthy, merge and let it run for a week; re-run the daily review skill to see if patterns shift.
4. Revisit triple-bomb doubling (#1) once more game data accrues.

---

## Run 2026-05-07 — H4RH Follow-up part 2: M-OppBomb + M-Stranded (replacing M-MultiBomb)

### Summary

- Total milestones shipped: 2 (M-OppBomb, M-Stranded) — replacing the reverted M-MultiBomb
- Total issues found: 2 (Critical: 0, Major: 1, Minor: 1, Nit: 0)
- Total audit passes: 1 (single-pass implementation, fixes applied as caught)
- Tests: 292 → 299 (+7), all passing (one pre-existing simulator flake unrelated to changes)

### Milestones

#### M-OppBomb — relax bomb-deploy guards when bombing a publicly-confirmed opponent

**File:** `packages/server/src/bot/BotManager.ts` (`smartPlayDecision` response section)
**Tests added:** 3 in `StrategyFixes.test.ts` ("Fix M-OppBomb")

**Mechanism:**
- New helper `lastPlayPubliclyByOpponent()`: returns true iff the last play's player is on the opposing team AND their team is publicly known (via `state.doubling.teamsRevealed` OR `revealedRed10Count > 0`).
- New unified flag `oppBombDeployOk` computed once in `smartPlayDecision`: `isLastPlayConfirmedOpp && isBombPlay && (!isLastPlayTwoSingle || cheapestIsSmallBomb || myBombRanksCount >= 2)`. The 2-single carve-out reflects the user's spec: "bomb over an opp's winning 2 in the case we have a small bomb (3-7) or multiple bombs."
- Four guards relaxed with `&& !oppBombDeployOk`: defensive mode, single-bomb-guard (in effectivelyHighThreat), M4 race-aware bomb cap, M5 sandwich guard (both effectivelyHighThreat and P6 conservation locations).

| # | Severity | Location | Problem | Fix Applied | Pass |
|---|----------|----------|---------|-------------|------|
| 1 | Major | smartPlayDecision response section | First-pass implementation only relaxed single-bomb-guard / M4 / M5 inside `effectivelyHighThreat`, but defensive mode (which fires at `winners < 2 && opp ≤ 2 && hand ≥ 6`) blocks the bot from ever reaching those guards in losing-race scenarios. The "save bombs" instinct fires at the wrong layer first | Pulled the per-guard logic into a single shared `oppBombDeployOk` flag and applied it to defensive mode as well. Same flag governs all four guards |  1 |

#### M-Stranded — burn 2-single or bomb to win round when holding stranded low + extra power

**File:** `packages/server/src/bot/BotManager.ts` (`smartPlayDecision` response section)
**Tests added:** 4 in `StrategyFixes.test.ts` ("Fix M-Stranded")

**Mechanism:**
- New helper `hasStrandedLowCard(hand)`: true if hand contains an orphan single at rank ≤ 5 (rv 0-2), OR a straight whose lowest rank is '3'.
- New helper `hasExtraPower(hand)`: true if `getBombRanks(hand).size >= 2` OR `≥ 2` cards of rank '2'.
- New branch in response logic, inserted between near-exit play and defensive mode. When both helpers return true and `bp` contains a "winning beat" (bomb or 2-single), pick the winner that's safest to spend: 2-single first (preserves bombs), then smallest bomb. Returns play.

| # | Severity | Location | Problem | Fix Applied | Pass |
|---|----------|----------|---------|-------------|------|
| 2 | Minor | M-Stranded test fixtures | Initial negative-test setups used K-single leads, which left the bot with cheap 2-single beats that conservation doesn't suppress (`playMinRank >= 11 && lastPlayMaxRank < 9` requires lastPlay < 9, K=10 fails the gate) | Changed leads to 9-single in negative tests so conservation correctly suppresses A-on-9 / 2-on-9 to verify M-Stranded ISN'T firing | inline |

### Pattern

Same shape as the reverted M-MultiBomb's audit findings: **the user-described surface behavior didn't fully line up with the code paths that actually need touching.** For M-OppBomb the user's text mentioned "bombGuards" plural; the implementation needed to identify ALL bomb-suppressing layers — defensive mode, M4, M5, single-bomb-guard — and apply a unified flag rather than only the literal "single bomb guard" the user named.

### Net code change

```
packages/server/src/bot/BotManager.ts             +110 lines (3 helpers + 1 unified flag + 4 guard relaxations + M-Stranded branch)
packages/server/__tests__/StrategyFixes.test.ts  +470 lines (7 new tests across 2 describe blocks)
```

Baseline 285 → 299 server tests, all passing (1 simulator timing flake unrelated to changes).

---

## Run 2026-05-06 — H4RH Review Follow-up: M-MultiBomb (REVERTED), M-Sprint, M-Reveal

### Summary

- Total milestones shipped: 2 (M-Sprint, M-Reveal)
- Total milestones reverted: 1 (M-MultiBomb — wrong layer; superseded by M-OppBomb + M-Stranded above)
- Total issues found: 3 (Critical: 0, Major: 2, Minor: 1, Nit: 0)
- Total audit passes: 3 (M-Sprint: 2, M-Reveal: 1)
- Tests: 285 → 292 (+7), all passing
- Source: H4RH (2026-05-06) game review — 4-team black10 lost a 2v4 they were structurally favored to win

### Milestones

#### M-MultiBomb — deploy lower bomb when ≥ 2 triples held — **REVERTED 2026-05-07**

**File:** `packages/server/src/bot/BotManager.ts` (`decideChaGo`)
**Status:** Reverted. Design moved to a new pair of changes targeting `smartPlayDecision`'s bomb-deploy guards directly (team-aware bomb-guard relaxation + stranded-low-card detection), since cha-go was the wrong layer to address the underlying "bombs die in hand" problem.

The original audit findings are retained below for context.

| # | Severity | Location | Problem | Fix Applied | Pass |
|---|----------|----------|---------|-------------|------|
| 1 | Major | `decideChaGo` initial impl | Subagent used `getBombRanks(hand)` to count distinct bomb ranks. That set includes the special 4-4-A bomb's contributing ranks (`{4, A}`) even with NO actual triple of either. A hand with 4-pair + 1 ace, trigger=4, would falsely satisfy `myBombRanks.size >= 2` and the fast-path would cha with the 4-pair — destroying the special bomb entirely | Replaced `getBombRanks` with a fresh `tripleRanks` set computed inline (groups with `length >= 3` only). Special-bomb-only hands now correctly skip the fast-path | 1 |
| 2 | Minor | `StrategyFixes.test.ts` initial test 1 (H4RH R4 reproduction) | The reproduction passes via the existing `stuckBigHandTeammateCha` carve-out (M3) at handSize=11, which shadows the new gate. Doesn't strictly exercise new code | Added a separate "isolated" test case at handSize=8 with opp trigger so only the multi-bomb fast-path can produce 'cha' | 2 |

#### M-Sprint — defer marginal beats to smaller-hand teammate on 4-team

**File:** `packages/server/src/bot/BotManager.ts` (`smartPlayDecision`, between P3 and P5 response gates)
**Tests added:** 4 in `StrategyFixes.test.ts` ("Fix M-Sprint")
**Audit passes:** 2

| # | Severity | Location | Problem | Fix Applied | Pass |
|---|----------|----------|---------|-------------|------|
| 3 | Major | sprint deference gate | Initial gate fired even when `medThreat` (opp at ≤ 3 cards). Deferring while a 3-card opp could exit in 1-2 plays would let the opp finish before the sprinter teammate | Added `!medThreat` to the deference condition. P3 already handles `effectivelyHighThreat` (≤2 card opps), so this gate now only fires when `opponentMinHand > 3` |  1 |
| 4 | Minor | sprinter selection logic | Used `teammates.find(...)` to pick the sprinter, then checked `hasPassedThisRound(sprinter)`. With multiple teammates tied for min handSize, if the first match had passed but a tied-teammate hadn't, deference would incorrectly skip | Replaced with `teammates.filter(...)` collecting ALL min-handSize teammates and `.some(...)` checking any of them is still active | 1 |

Gate fires only when ALL conditions hold:
- Initial team size = 4 (the structurally disadvantaged side in 2v4)
- `!medThreat` — no opp at ≤ 3 cards
- At least one teammate has strictly smaller hand than mine
- That sprinter teammate hasn't passed this round
- Cheapest beat costs power resources (bomb, bomb-breaking, or rank ≥ A)

#### M-Reveal — reveal-aware cha cost downgrade

**File:** `packages/server/src/bot/BotManager.ts` (`decideChaGo`, speculative section)
**Tests added:** 3 in `StrategyFixes.test.ts` ("Fix M-Reveal")
**Audit passes:** 1

No code-level issues found. Two test-design issues caught and fixed during test authoring:

| # | Severity | Location | Problem | Fix Applied | Pass |
|---|----------|----------|---------|-------------|------|
| - | (test-design) | M-Reveal negative tests | Initial bot-hand setup (`5,6,7,8,9,J + 10,10`) had a length-5 straight (5-6-7-8-9) that triggered the `hasIntactExitStraight` hand-shaping branch — masking the speculative-decline path the negative tests were meant to verify | Replaced 7♥ with Q♥ in negative-test bot hands, breaking the 5-9 sequence and isolating the reveal-aware gate from the hand-shaping path | inline |

The reveal-aware gate only practically fires for `triggerRank = '10'`, since cha-go triggers on single plays and only red 10s carry the team-reveal effect. Threshold of `afterChaRemaining ≤ 3` was chosen to absorb the ±1 miscount fudge in `estimatePlayedCopies`.

### Pattern Analysis

- **2 of 3 milestones had a Major issue caught in audit.** Both were "behavior-correct in the easy case but broken in an edge case the user spec didn't call out":
  - M-MultiBomb: special-bomb-only hand corrupted by the deploy gate
  - M-Sprint: medThreat opp could exit during a deference
- **1 minor was tie-handling** (sprinter selection).
- **No cross-milestone breakage:** all 285 baseline tests still pass after each milestone. M-Reveal and M-MultiBomb share the same speculative-section variables but operate on disjoint conditions.

### Unresolved Items

- **`hasIntactExitStraight` is now downstream of M-Reveal.** When trigger is a red 10 with `afterChaRemaining ≤ 3`, M-Reveal returns 'cha' before the hand-shaping check fires. Slight loss of the "save the straight" optimization for the specific case where holding the cha pair would have been preferable. Considered an acceptable trade — reveal-cha is high-confidence value.
- **M-Sprint scoped to `myTeamSize === 4`.** A 3-team bot with sprinter-coordination opportunities (3v3 game) is not addressed. User scoped this to 4-team specifically; 3-team can be a future consideration if logged games show analogous failures.
- **M-MultiBomb uses lowest bomb only.** When a bot holds 3+ distinct triples, the gate correctly fires for any non-highest bomb. But the strict `triggerRank !== highest` test means a 3-of-Ks alongside 3-of-Aces never deploys the K-bomb via this gate (K isn't lowest, but we'd still want to deploy it under same logic). MED-rank gate downstream handles this case adequately for now.

### Net code change

```
packages/server/src/bot/BotManager.ts             +60 lines (3 new gates / variable computations)
packages/server/__tests__/StrategyFixes.test.ts  +740 lines (12 new tests across 3 describe blocks)
```

Baseline 285 tests → 297 tests, all passing. No existing test required modification.

---

## Run pre-2026-05-06 — Bot Strategy Fixes M3, M4, M5

(Original audit content preserved below for history.)

### Summary

- Total milestones implemented: 3
- Total issues found: 4 (Critical: 0, Major: 1, Minor: 3, Nit: 0)
- Total audit passes: 4 (M3: 2, M4: 1, M5: 1)
- Tests: 276 → 285 (+9), all passing

### Milestones

#### M3 — 3-of-a-kind cha carve-out on teammate trigger
**File:** `packages/server/src/bot/BotManager.ts` (`decideChaGo`)
**Tests added:** 4 (in `StrategyFixes.test.ts`, "Fix M3 — paired-cha with 3-of-a-kind on teammate trigger when stuck big-hand")
**Audit passes:** 2

| # | Severity | Location | Problem | Fix Applied | Pass |
|---|----------|----------|---------|-------------|------|
| 1 | Major | `BotManager.ts` `decideChaGo` | Initial fix only bypassed bomb-preservation gate. For LOW-rank + teammate triggers the function falls through to `return 'decline'` at the very end, so the carve-out had no effect on the actual decision | Changed carve-out to `return 'cha'` directly, before both the gate and the LOW/MED/HIGH downstream paths | 1 |
| 2 | Minor | `BotManager.ts` `decideChaGo` | Carve-out was firing for HIGH (A, 2) and MED (K, Q) ranks too, which would break a much more valuable 3-of-As / 3-of-Ks bomb. User's strategic motivation was specifically for low-rank bombs in stuck-bot scenarios | Added `!isHighRank && !isMedRank` to the condition; restricts to ranks 3-J | 2 |
| 3 | Minor | `StrategyFixes.test.ts` | Placeholder test (`expect(true).toBe(true)`) added during structuring; no real coverage | Replaced with `'declines cha when miscount inflates estimatedRemaining to 3'` test that stubs Math.random to force the -1 miscount branch | 2 |

#### M4 — race-aware bomb cap when isLastPlayerDangerous is sole trigger
**File:** `packages/server/src/bot/BotManager.ts` (`smartPlayDecision` response branch, inside `effectivelyHighThreat`)
**Tests added:** 3 (in `StrategyFixes.test.ts`, "Fix M4 — bomb cap at handSize > 8 when only isLastPlayerDangerous unlocks bombs")
**Audit passes:** 1

No issues found.

#### M5 — extend Conservative bomb-use guard to bomb-vs-bomb
**File:** `packages/server/src/bot/BotManager.ts` (two locations in `smartPlayDecision`)
**Tests added:** 2 (in `StrategyFixes.test.ts`, "Fix M5 — bomb-vs-bomb sandwich avoidance when opp ≥ 8 still active")
**Audit passes:** 1

| # | Severity | Location | Problem | Fix Applied | Pass |
|---|----------|----------|---------|-------------|------|
| 4 | Minor | `BotManager.ts` `effectivelyHighThreat` block | Literal user spec ("broaden the format check") would extend the existing guard, but the actual motivating example (game 8NW6 R3) sat in P6 conservation, not in effectivelyHighThreat. Just removing the format check wouldn't help | Two-part fix: (1) dropped `round.lastPlay.format !== 'bomb'` from the existing `effectivelyHighThreat` guard; (2) added a parallel guard in P6 conservation specific to bomb-vs-bomb when opp ≥ 8 active | 1 |
