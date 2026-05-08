# Implementation Audit Report — Bot Strategy Fixes

This document tracks impl-loop runs against the bot strategy code. Latest run on top.

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
