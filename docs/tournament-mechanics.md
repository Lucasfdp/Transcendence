# Tournament Mode — The Parrot's Shell: Game Rules

A player-facing description of the tournament board game. No technical detail —
only rules, content, and behaviour. A final section lists mechanics that exist
in the codebase but are not yet reachable in a real game.

All numbers below are the current v1 values and are provisional balance
figures; names and icons are placeholders pending the final content pass.

---

## Overview

The Parrot's Shell is a five-player digital board game. Players move around a
board, earn points, play the platform's minigames between rounds, and gamble
their points to unlock four **Shell Fragments** (Key Items). When all four
fragments are unlocked, **The Parrot King** appears and the table enters the
**Final Challenge** — a sudden-death minigame duel. The winner claims the one
and only **Parrot's Shell** and becomes champion.

- **Victory** — one player wins the Shell in the Final Challenge.
- **Collective defeat** — if round 15 ends without all four fragments
  unlocked, everybody loses. Nobody wins the Shell.

Matches are casual: no ELO or ranking is affected.

## Setting up a match

- A player creates a tournament and receives a **PIN** (prefixed `T`); others
  join by invitation or by entering the PIN.
- The table always seats **5 players**. The creator may fill empty seats with
  **CPU players** (🤖). A solo human with four CPUs is a valid game.
- Turn order is drawn fairly at start and stays fixed for the whole game.
- Each player starts with **100 points**.

## The board

A closed ring of **28 tiles**. Movement is always forward; passing the last
tile loops back to the start.

| Tile type | Count | Effect on landing |
| --- | --- | --- |
| Start | 1 (tile 0) | Nothing — the shared starting tile. |
| Path | 22 | Nothing. |
| Bonus | 4 (tiles 5, 12, 19, 25) | **+25 points**. |
| Shop | 1 (tile 18, the pagoda) | Opens the **Pagoda Shop** for that player. |

Players can share a tile; there is no capture or collision.

## A round, step by step

1. **Player turns.** In turn order, each player rolls the die (normal die,
   faces 1–6), their token walks the rolled number of tiles, and the landing
   tile resolves. Each turn has a **30-second** limit — an idle or
   disconnected player's roll is made automatically. A short handoff pause
   paces the game to the token animation.
2. **Pagoda Shop stop** (if someone landed on it). The visitor gets a
   **30-second** window to browse; everyone else watches. Buying an offer or
   pressing "Done shopping" ends the visit; one purchase per visit.
3. **Minigame.** "MINIGAME TIME!" — one of the platform's arena games is
   drawn at random: **Temple Curling**, **Bamboo Bash**, **Kame Knock** or
   **Bell Clash** (all support 2–5 players). Everyone confirms readiness
   ("Let's go!", 20-second limit), plays the match, then returns to the
   board. Rewards: **winner +50 points, every other participant +15**.
   A drawn result never stands: a **tie-break roulette** spins among the tied
   players and picks the round's winner.
4. **The Gamble.** Only the minigame winner may bet, and only while fragments
   remain locked. A bet costs **120 points** and, if won, unlocks the next
   Shell Fragment. Win chance starts at **40%** and rises **+5% per round**
   (capped at 100%), so late-game bets are near-certain. The winner has
   **30 seconds** to Gamble or Pass; everyone watches the outcome. The draw
   is provably fair.
5. **Fragment check.** Four fragments unlocked → the endgame begins. Fewer →
   next round, unless round 15 just ended, in which case the table falls to
   collective **defeat**.

## Objects and currencies

- **Points** — the only in-game currency. Earned from bonus tiles, minigames
  and shop packs; spent on bets and shop purchases. Points are per-tournament
  and vanish when it ends.
- **Shell Fragments (Key Items)** — the four ordered progression objects
  (Shell Fragment I–IV, 🐚). Unlocked one at a time, only through winning
  gambles. Shared by the whole table — they belong to the game, not to a
  player.
- **The Parrot's Shell** — the unique trophy. Exactly one exists and it is
  granted exactly once, to the Final Challenge winner.
- **Items** — personal objects held in an 8-slot inventory. Defined items:

  | Item | Icon | Type | Effect |
  | --- | --- | --- | --- |
  | Shell Shield | 🛡️ | Consumable | Blocks the next steal attempt against you. |
  | Loaded Die | 🎯 | Consumable | Forces your next roll to a 6. |
  | Lucky Dice | 🎲 | Consumable | +2 to your next roll, small point bonus. |
  | Golden Parrot Badge | 🦜 | Permanent | Passive reward bonus. |

  *(See "Not yet playable" below — items cannot currently be used in a live
  game.)*

- **Dice** — every die is simply a list of faces:

  | Die | Faces | How it is obtained |
  | --- | --- | --- |
  | Normal | 1–6 | Everyone's default die. |
  | Chiquito | 1–3 | Shop item, 20 points *(not yet on sale)*. |
  | Grande | 4–6 | Shop item, 60 points *(not yet on sale)*. |
  | OP | 6, 7, 8, 9, 10 | Shop item, 150 points *(not yet on sale)*. |

## The Pagoda Shop

Current catalogue (placeholder offers):

| Offer | Price | Stock | What you get |
| --- | --- | --- | --- |
| Points Pack 💰 | 40 | Unlimited | +100 points. |
| Lucky Dice 🎲 | 60 | 2 per player | The Lucky Dice item. |
| Golden Parrot Badge 🦜 | 120 | 4 per game, from round 2 | The permanent badge item. |

Prices can be modified by active rules (e.g. a "free shop" rule exists in the
catalogue). Offers you cannot afford or that are out of stock are shown but
not purchasable.

## The final round

1. **The Parrot King appears** (🦜) the moment the fourth fragment unlocks.
   While he presides over the endgame, his table rules are active:
   **stealing is impossible** and **all dice rolls are doubled**.
2. **Final Challenge — Sudden Death.** All players are thrown into a
   minigame. A unique winner ends it; a tie relaunches (or is settled by the
   tie-break roulette). There is no round limit — sudden death repeats until
   someone wins.
3. **Victory.** The winner receives the Parrot's Shell, the final ranking is
   frozen with the champion first, and the tournament ends.

**Champion rewards** (the only things that outlive the tournament):
**500 coins** to the platform wallet and the **"The Parrot's Shell"**
achievement.

## Leaving, disconnecting and CPUs

- **Disconnecting** is soft: a 3-second grace protects against page reloads,
  and the game auto-resolves the turns of anyone still absent. Reconnecting
  resumes normally. The first round waits up to 10 seconds for everyone to
  arrive before the first turn.
- **Quitting** ("Leave match", also available inside a tournament minigame)
  is permanent: it counts as a **loss** on the player's profile, a **CPU
  takes over the seat** for the rest of the game, and the quitter may
  immediately join another tournament.
- If every human leaves, the tournament is cancelled — CPUs never play on
  alone.
- CPU players roll, gamble, shop and play the minigames by themselves, with
  deliberately human-like pacing.
- Collective defeat at round 15 grants nothing to anyone.

---

## Implementation status — built but not yet playable

The engine work is broadly complete and tested; what follows is content or
wiring that exists in the codebase but cannot be reached in a real match.

- **Items and the inventory are unreachable.** The inventory engine, item
  effects and consumption pipeline all work end-to-end in tests, but there is
  no "use item" message wired up (the intent is named in the contracts yet has
  no payload or handler) and the inventory is never sent to the client. So:
  the shop can sell Lucky Dice and the Badge into an inventory nobody can see
  or use. Worse, those two items' effects reference placeholder action names
  that are not registered, so consuming them would do nothing anyway — while
  the two genuinely functional items (**Shell Shield**, **Loaded Die**) are
  not sold anywhere. Net effect: no item does anything in a live game today.
- **Alternate dice are dormant.** Chiquito/Grande/OP are defined and priced
  in the settings, but no shop offer sells them, and swapping which die a
  player rolls is blocked on a pending design decision. Only the Normal die
  is ever rolled.
- **Stealing is unreachable.** The steal mechanic is fully built (25 points
  taken from a random richer victim, shield/boss protection, seeded victim
  choice) but no tile on the v1 board triggers it.
- **Random events are unreachable.** Three weighted events exist — Windfall
  (+20 points), Misfortune (−15), Gust (pushed one tile forward) — with a
  working trigger action, but the v1 board has no event tile.
- **The Key Item shop offer is missing.** The settings reserve a 500-point
  price for buying a fragment directly, but no such offer exists in the
  catalogue — gambling is currently the only way to unlock fragments.
- **The leaderboard is invisible.** A live ranking (with tie handling and a
  frozen final standing) is maintained and finalised, but it is never shown;
  the HUD reads points straight from the player list.
- **Several rule hooks have no content.** The rule engine supports price
  modifiers, reward multipliers and named flags (seed rules exist: free shop,
  half points, fog), but nothing in live play ever activates them — only the
  boss's dice and steal rules are used.
- **The boss has no staging.** The Parrot King supports an intro sequence,
  and presentation actions (animations, sounds, messages) are planned, but
  his intro is empty and those actions are deferred — he currently appears
  without ceremony.
- **Content is placeholder throughout.** Fragment names, item names, shop
  offers, event names and all balance values await the dedicated content and
  balancing sessions.
