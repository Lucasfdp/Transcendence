# Handoff: Gambling-den UI/UX pass — start with Shell Drop (Plinko) animation

You are improving the **look and feel** of the Shell Smash gambling den
("Shell's Gambit"): six games — **Fortune Wheel, Shell Flip, Three-Shell
Monte, Shrine Slots, Koi Dice, Shell Drop** — all server-authoritative,
provably fair, sharing one wager engine. The economy, math and backend are
done and are **not in scope**. This handoff is about the client-side
presentation layer only: how a resolved spin is *shown* to the player.

The immediate target is **Shell Drop (Plinko)**. Its current animation is a
placeholder: the shell token just falls straight down the centre of the board
for a fixed duration, then snaps sideways to whatever bucket the server
already resolved. There is no peg lattice, no bounce, no sense of a path. The
goal is to replace this with something that actually looks like a shell
dropping through pegs into its bucket. Once Plinko lands and is approved, the
same visual-quality bar should be considered for the other five games, but
**do not touch the other games until Plinko is signed off.**

---

## 0. The one rule that matters most: brainstorm before you build

**Do not jump into implementation.** The person you're working with wants to
think through the animation approach together before any code is written.
Treat this like a design collaboration, not a ticket to close solo.

Concretely, before writing or editing a single line of animation code:

1. Read this handoff fully and skim the files in §2 so you understand what
   already exists and what data you have to work with.
2. Use the `AskUserQuestion` tool (you're running in Cowork mode) to open a
   real brainstorming conversation. Don't ask one giant multi-part question —
   have a back-and-forth. Cover at least:
   - **Visual direction / fidelity**: what does "a full Plinko animation"
     mean to them? A stepped zigzag through visible pegs? Realistic bouncy
     physics? Something closer to a mobile-casino-app look (e.g. Stake.com
     style boards) vs. something in the dojo/shell-smash art style already
     used elsewhere in the hub? Ask if they have a reference in mind.
   - **Technical approach** (see §3 for the real options and their
     tradeoffs — present these as options, don't silently pick one).
   - **Scope**: Plinko only for now, or should the work also lay reusable
     groundwork (e.g. a shared "casino board" animation helper) for the other
     games later?
   - **Pacing**: how long should a drop take? Should the player be able to
     skip/speed it up? Should there be sound (check whether the hub has any
     existing sound system to hook into before assuming there is or isn't
     one)?
   - **Effort/fidelity tradeoff**: make sure they understand cheaper options
     ship faster and are easier to keep accessible (`prefers-reduced-motion`,
     performance on low-end machines) while higher-fidelity options
     (real physics) cost more build time and complexity.
3. Once you have a direction, write back a short concrete plan (a few
   sentences, not a huge spec) and get explicit confirmation before touching
   code. If anything in the brainstorm implies new backend data or new
   dependencies, flag that explicitly and get a yes — don't assume it's fine.
4. Only after that confirmation do you start implementing.

This same brainstorm-first process should repeat for each subsequent game if
the person wants the treatment extended later — don't assume the Plinko
answer automatically applies to Shell Flip's coin toss or Shrine Slots' reels.

---

## 1. Non-negotiables — true for every game, don't redesign these away

- **The animation is purely cosmetic.** By the time any animation starts, the
  server has already fully resolved the spin — `POST /casino/plinko` (and the
  equivalent endpoint for every other game) returns the complete
  `SpinResolution` synchronously: outcome, payout, new balance, and the
  provably-fair reveal. The frontend is just choosing *how long* and *how* to
  visually delay showing that already-known result. Nothing you build should
  make the outcome depend on the animation, or vice versa.
- **Provably fair must keep working.** Every game's modal has a "Verify this
  spin/roll/drop" button that recomputes the roll(s) client-side from the
  revealed seeds (`frontend/src/components/casino/fairness.ts`) and checks
  them against the server. Whatever you change, that button must still work
  and the fairness panel (server seed, hash, client seed, nonce, rolls) must
  still be shown.
- **`prefers-reduced-motion` must be respected.** Every existing animation has
  a `@media (prefers-reduced-motion: reduce)` block that kills the animation
  and shows the result instantly. Any new animation needs the same escape
  hatch.
- **No backend changes without a explicit go-ahead.** The backend already
  exposes everything an animation needs (see §4's key insight below). If the
  brainstorm surfaces a reason to change backend responses, that's new scope —
  confirm it with the person first, same as any other scope change per this
  repo's `CLAUDE.md` rules.
- **Don't regress the other five games.** `global.css` is a single shared
  file; each game has its own `.hub-<game>__*` prefix block. Don't rename or
  restructure shared CSS variables (`--accent`, `--muted`, `--line`, `--panel`,
  etc.) — they're used dojo-wide, not just in the casino.
- **House style still applies**: tabs, `private readonly` for injected deps
  (backend, if you ever touch it), explicit return types, no dead/commented-out
  code, no magic numbers without a named constant, run ESLint/tsc before
  calling anything done.

---

## 2. Where everything lives

Frontend (all the animation work happens here):

| File | Relevance |
|---|---|
| `frontend/src/components/casino/ShellDropModal.tsx` | The Plinko modal. Currently: a `.hub-drop__shell` div with a CSS `top` animation (`hub-drop-fall`) that just falls straight down for `DROP_DURATION_MS`, then reveals the final bucket via a `left` position jump. This is what needs replacing. |
| `frontend/src/components/casino/plinko.ts` | Pure logic mirror: `bucketIndexFromRolls`, `plinkoOutcomeId`, `bucketFromOutcome`, `bucketView`. No React/DOM — reuse this, don't duplicate its logic. |
| `frontend/src/components/casino/fairness.ts` | `verifyPlinko` — recomputes the drop from revealed seeds. Don't break this contract. |
| `frontend/src/features/hub/api.ts` | `PlinkoView`, `PlinkoTierView`, `PlinkoBucketView`, `api.getPlinko()`, `api.dropPlinko()`. The full per-tier paytable (multiplier + probability per bucket) is already sent to the client. |
| `frontend/src/styles/global.css` | Search `/* ── Shell Drop (Plinko) ── */` for the current `.hub-drop__*` block (board, shell token, bucket row, fall keyframe). |

Backend (reference only — read for context, don't modify without sign-off):

| File | Relevance |
|---|---|
| `backend/src/modules/casino/plinko.constants.ts` | `bucketIndexFromRolls`, `bucketMultiplier`, `evaluateDrop`. The authoritative version of the logic mirrored in `plinko.ts`. |
| `backend/src/modules/casino/plinko.service.ts` | Calls `engine.resolveSpin(..., { rolls: rowCount }, ...)` — draws one independent roll per peg row. |
| `backend/src/modules/casino/casino.engine.ts` | Shared engine. `fairness.rolls` is the full array of per-row rolls, revealed to the client in the response. |

The equivalent files for the other five games (for later, once Plinko is
approved): `ShellFlipModal.tsx`/`flip.ts`, `ThreeShellMonteModal.tsx`/`monte.ts`,
`ShrineSlotsModal.tsx`/`slots.ts`, `KoiDiceModal.tsx`/`dice.ts`,
`FortuneWheelModal.tsx`/`wheel.ts` — same pairing pattern (modal + pure logic
mirror + CSS block) for every game.

There's also a prior handoff at `docs/handoff-casino-dice-plinko.md` covering
how Koi Dice and Shell Drop were originally built — useful background on the
existing conventions, but it's about adding new games, not animating them, so
don't follow its "don't re-architect" framing too literally here: **the
animation layer is explicitly what's being re-architected this time.**

---

## 3. The key domain fact that should drive the brainstorm

This is the most important thing to bring into the conversation with the
person, because it changes what's actually hard about this problem:

**The full left/right path through the pegs is already known before the
animation starts.** `result.fairness.rolls` is an array of one roll per row
(`rolls.length === rows`), and the bucket index is simply
`rolls.filter(roll => roll >= 0.5).length` (see `bucketIndexFromRolls` in both
`plinko.ts` and the backend's `plinko.constants.ts` — they're byte-identical
by design). That means a "real" peg-drop animation does **not** need physics
simulation, rejection sampling, or any trick to land on the right bucket — you
can just animate the shell moving left (`rolls[i] < 0.5`) or right
(`rolls[i] >= 0.5`) at each of the `rows` pegs it already fell past, in order,
and it will deterministically arrive at the exact bucket the server already
picked. The "hard part" of Plinko (landing on a pre-determined outcome) is
already solved by the data you have — what's left is purely making that known
path look good.

This should shape the technical options you bring to the brainstorm:

- **A. Lightweight, no new dependency** — draw a peg lattice in CSS/SVG (or a
  plain `<canvas>` 2D context) and step the shell token through the known
  left/right sequence, row by row, with easing/gravity-flavoured timing
  (e.g. a slight bounce at each peg). No physics engine needed since the path
  is already determined. Fits the current architecture exactly (same as every
  other game's animation), cheapest to build and keep accessible, but it's a
  "scripted" bounce rather than an emergent one.
- **B. Phaser-driven scene with real physics** — the frontend already depends
  on `phaser` (`^3.60.0`, see `frontend/package.json`) and mounts one global
  `Phaser.Game` instance with Arcade Physics for the actual mini-games (see
  `frontend/src/lib/createShellSmashGame.ts` and e.g.
  `frontend/src/games/bamboo-bash/BambooBashScene.ts` for the existing scene
  pattern). A dedicated Plinko scene could use Arcade or Matter physics for
  gravity + peg collisions, which would look and feel more "real". The known
  left/right sequence would need to be threaded in as a constraint (e.g. as
  invisible guide forces nudging the ball at each row so it still lands
  exactly right, since true unconstrained physics can't be told in advance
  which bucket to land in without cheating the sim slightly). This is a
  meaningfully bigger lift: it means either standing up a second, modal-scoped
  Phaser instance, or integrating with the existing global one and reconciling
  that with a game running inside a `<HubModal>` rather than full-page — worth
  discussing explicitly since it's a real architecture decision, not just a
  style choice.
- **C. Middle ground** — hand-rolled canvas animation with simple manual
  "physics-flavoured" easing (gravity acceleration + a bounce curve at each
  peg) without pulling in Phaser or a physics engine. More visual polish than
  option A, much less complexity than option B.

Present these three (or others you think of) to the person with honest
tradeoffs — effort, visual payoff, consistency with the rest of the app,
maintainability — and let them choose, or mix ideas together. Don't
default to the "cheapest" one just because it's easiest; the person has
explicitly said they want to consider a fuller animation.

---

## 4. Suggested working process once a direction is chosen

1. Restate the agreed direction back in a short plan and get a nod before
   coding (or use plan mode if that's available to you).
2. Build behind the same modal contract `ShellDropModal.tsx` already has —
   props are just `{ coins, onCoinsChange }`, the API call already returns
   the full resolved outcome up front. Whatever animation component you build
   should accept the resolved `SpinResolution` (or its `fairness.rolls`) and
   animate up to it; it shouldn't need to talk to the network itself.
3. Keep `prefers-reduced-motion` handling from day one, not as an afterthought.
4. If you introduce any new pure logic (e.g. path/easing math), mirror the
   pattern already used across this module: pure, framework-free functions in
   a `.ts` file (not `.tsx`) so they can be sanity-checked with a throwaway
   Node script the way `dice.ts`/`plinko.ts` were checked against the backend
   during the last casino handoff.
5. There is no frontend test runner in this repo. Verify visually — take
   screenshots or use the browser tools available to you, and/or ask the
   person to check `npm run build` and click through it locally. Don't declare
   this "done" without having actually seen it render.
6. Confirm before wrapping up: the Verify button still passes, the bucket
   landed on after the animation matches `result.outcomeId` exactly, reduced
   motion still short-circuits correctly, and the other five games' CSS/modals
   are untouched.
7. After Plinko ships and is approved, ask whether to repeat the same
   brainstorm-first process for the remaining games, and if so, which one
   next — don't assume Fortune Wheel/Flip/Monte/Slots/Dice want the same
   treatment without asking.

---

## 5. House reminders (from this repo's `CLAUDE.md`)

- Reply to the person in whatever language they're using.
- Any new project document goes in `docs/`.
- Use the `Makefile` as the entrypoint — after frontend changes, the person
  needs `make restart-front` or `make rebuild-front` (not a raw restart) to
  see them; mention this rather than assuming it's automatic.
- Keep commits short and concrete, one idea per commit.
- Don't expand functional scope beyond what's discussed — this handoff is
  about presentation only; if the brainstorm drifts into new game mechanics,
  new backend fields, or new dependencies, that's a scope change worth naming
  out loud before proceeding.
