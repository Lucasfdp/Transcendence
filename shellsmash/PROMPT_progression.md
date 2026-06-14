# Shell Smash — XP, Levels, Currency & Game Results Implementation

> **Context for the implementer:** This is a NestJS 10 + TypeORM + PostgreSQL backend
> with a Phaser 3 frontend (TypeScript, Vite). Auth is cookie-based JWT; CSRF is
> protected via `X-CSRF-Token`. No `localStorage` — all state server-side. The
> frontend hub (`HubScene.ts`) fetches `/api/users/me` on load; the result is typed
> as `hub/api.ts → User`. All new endpoints must sit behind `JwtAuthGuard`.

---

## 0. Bug fix first — "Lvl undefined" in the HUD

**Root cause:** `GET /api/users/me` returns `req.user`, which is the JWT payload
object (`JwtAuthGuard` attaches it). That payload was built at login time and almost
certainly does not include `level` or `xp`. The `User` entity has those columns
(default 1 / default 0) but they are never serialised into the JWT nor fetched fresh
on `/me`.

**Fix `UsersController.getMe`** — return a fresh DB fetch, not the JWT payload:

```typescript
// srcs/requirements/backend/src/src/users/users.controller.ts
@Get('me')
async getMe(@Request() req): Promise<User> {
  const user = await this.usersService.findById((req.user as { id: number }).id);
  if (!user) throw new UnauthorizedException();
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { passwordHash: _pw, ...safe } = user as User & { passwordHash?: unknown };
  return safe as User;
}
```

Inject `UsersService` into `UsersController` if it isn't already. This is the
single highest-priority change — nothing else is visible in the UI until this is
fixed.

---

## 1. Schema changes

### 1a. Add `coins` column to `User` entity

```typescript
// srcs/requirements/backend/src/src/users/entities/user.entity.ts
@Column({ default: 0 })
coins: number;
```

No migration file needed yet if you are running with `synchronize: true` in dev.
If `synchronize` is disabled (production), generate a TypeORM migration:

```bash
npx typeorm migration:generate src/migrations/AddUserCoins -d src/data-source.ts
```

The migration must be a pure `ALTER TABLE "users" ADD COLUMN "coins" integer NOT NULL DEFAULT 0` — never drop/recreate the table.

### 1b. Add `gameId` column to `Profile` entity (optional but recommended)

No schema change is strictly required for now. `totalWins`, `totalLosses`, and
`gamesPlayed` on `Profile` are already game-agnostic. Keep them that way.

---

## 2. New `GameResultsModule`

Create `srcs/requirements/backend/src/src/game-results/` with:

```
game-results/
  game-results.module.ts
  game-results.controller.ts
  game-results.service.ts
  dto/submit-result.dto.ts
```

### 2a. DTO

```typescript
// dto/submit-result.dto.ts
import { IsString, IsIn } from 'class-validator';

export class SubmitResultDto {
  @IsString()
  gameId: string; // e.g. 'kame-knock'

  @IsIn(['win', 'loss'])
  outcome: 'win' | 'loss';
}
```

### 2b. Progression constants (extract as named constants — no magic numbers)

```typescript
// game-results/progression.constants.ts
export const XP_PER_WIN   = 150;
export const XP_PER_LOSS  = 40;
export const COINS_PER_WIN = 50;
export const COINS_PER_LOSS = 0;

/**
 * XP required to reach `level + 1`.
 * Formula: level * 1000 (matches the frontend ProfilePanel calculation).
 * Level 1 → needs 1000 XP to become level 2.
 * Level 2 → needs 2000 XP to become level 3.
 * ...and so on.
 *
 * IMPORTANT: The frontend ProfilePanel.ts already uses `(user.level ?? 1) * 1000`
 * as the XP bar max. Keep these in sync — if you change the formula here, update
 * ProfilePanel.ts too.
 */
export function xpForNextLevel(currentLevel: number): number {
  return currentLevel * 1_000;
}
```

### 2c. Service

```typescript
// game-results/game-results.service.ts
import { Injectable } from '@nestjs/common';
import { UsersService } from '../users/users.service';
import { User } from '../users/entities/user.entity';
import { SubmitResultDto } from './dto/submit-result.dto';
import {
  XP_PER_WIN, XP_PER_LOSS, COINS_PER_WIN, COINS_PER_LOSS, xpForNextLevel,
} from './progression.constants';

export interface ProgressionResult {
  xpGained:    number;
  coinsGained: number;
  newXp:       number;
  newLevel:    number;
  newCoins:    number;
  leveledUp:   boolean;
}

@Injectable()
export class GameResultsService {
  constructor(private readonly usersService: UsersService) {}

  async submitResult(user: User, dto: SubmitResultDto): Promise<ProgressionResult> {
    const isWin     = dto.outcome === 'win';
    const xpGained  = isWin ? XP_PER_WIN  : XP_PER_LOSS;
    const coinsGained = isWin ? COINS_PER_WIN : COINS_PER_LOSS;

    // ── XP + level-up (loop to handle multiple level-ups in one call)
    let xp    = user.xp    + xpGained;
    let level = user.level;
    let leveledUp = false;

    while (xp >= xpForNextLevel(level)) {
      xp -= xpForNextLevel(level);
      level += 1;
      leveledUp = true;
    }

    // ── Coins
    const coins = user.coins + coinsGained;

    // ── Profile stats (totalWins, totalLosses, gamesPlayed)
    const profile = user.profile;
    if (isWin)  profile.totalWins   += 1;
    else        profile.totalLosses += 1;
    profile.gamesPlayed += 1;

    // ── Persist both entities atomically
    // UsersService.save() calls usersRepo.save() which cascades to profile
    // because User has cascade: true on the profile relation.
    user.xp    = xp;
    user.level = level;
    user.coins = coins;
    user.profile = profile;

    await this.usersService.save(user);

    return { xpGained, coinsGained, newXp: xp, newLevel: level, newCoins: coins, leveledUp };
  }
}
```

> **Atomicity note:** `usersRepo.save(user)` with `cascade: true` on the `profile`
> OneToOne will UPDATE both rows in a single transaction via TypeORM. If you need
> hard ACID guarantees across both tables (e.g., for production), wrap in a
> `DataSource.transaction()` call. For this project, the cascade save is sufficient.

### 2d. Controller

```typescript
// game-results/game-results.controller.ts
import { Controller, Post, Body, UseGuards, Request, HttpCode } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { GameResultsService } from './game-results.service';
import { SubmitResultDto } from './dto/submit-result.dto';
import { UsersService } from '../users/users.service';
import { UnauthorizedException } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

@ApiTags('game-results')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('game-results')
export class GameResultsController {
  constructor(
    private readonly gameResultsService: GameResultsService,
    private readonly usersService: UsersService,
  ) {}

  /**
   * POST /api/game-results
   * Records the outcome of a completed game session for the authenticated user.
   * Returns the progression delta so the frontend can animate XP gain.
   */
  @Post()
  @HttpCode(200)
  async submitResult(
    @Request() req,
    @Body() dto: SubmitResultDto,
  ) {
    const user = await this.usersService.findById((req.user as { id: number }).id);
    if (!user) throw new UnauthorizedException();
    return this.gameResultsService.submitResult(user, dto);
  }
}
```

### 2e. Module

```typescript
// game-results/game-results.module.ts
import { Module } from '@nestjs/common';
import { GameResultsController } from './game-results.controller';
import { GameResultsService }    from './game-results.service';
import { UsersModule }           from '../users/users.module';

@Module({
  imports:     [UsersModule],
  controllers: [GameResultsController],
  providers:   [GameResultsService],
})
export class GameResultsModule {}
```

Register in `app.module.ts` imports array.

**Also export `UsersService` from `UsersModule`** if it isn't already (add
`exports: [UsersService]` to `UsersModule`).

---

## 3. Frontend changes

### 3a. Add `coins` to the `User` type

```typescript
// srcs/requirements/frontend/src/src/hub/api.ts
export interface User {
  // ...existing fields...
  coins: number;  // add this
}
```

### 3b. Add `submitGameResult` to the api object

```typescript
// hub/api.ts — inside the `api` object
async submitGameResult(gameId: string, outcome: 'win' | 'loss'): Promise<{
  xpGained: number;
  coinsGained: number;
  newXp: number;
  newLevel: number;
  newCoins: number;
  leveledUp: boolean;
}> {
  return apiFetch('/game-results', {
    method: 'POST',
    body: JSON.stringify({ gameId, outcome }),
  });
},
```

### 3c. Call `submitGameResult` at game-over in each game scene

Each game scene (e.g., `KameKnockScene.ts`) must call
the API when the game ends. The game scenes currently have no API calls. Add at the
point where a winner is determined — typically inside a `phase === 'gameover'`
handler or equivalent:

```typescript
// Example — adapt to each scene's actual game-over logic
import { api } from '../../hub/api'; // adjust relative path

private async onGameOver(localPlayerWon: boolean): Promise<void> {
  try {
    const result = await api.submitGameResult(
      'kame-knock',                    // match the id in MINIGAMES array
      localPlayerWon ? 'win' : 'loss',
    );
    // Optionally show an XP-gain banner: `+${result.xpGained} XP`
    // and a level-up animation if result.leveledUp === true.
    console.info('[GameOver] progression:', result);
  } catch (err) {
    // Non-fatal — log and continue; don't block the user from returning to hub
    console.warn('[GameOver] failed to submit result:', err);
  }
}
```

**Important:** Only submit for authenticated (non-guest) users. Guest users have
`user.isGuest === true` — check this before calling the API, or the backend will
record stats against their ephemeral account (harmless but wasteful):

```typescript
if (!currentUser.isGuest) {
  await this.onGameOver(localPlayerWon);
}
```

### 3d. Display coins in the HUD (`HubScene.ts`)

The HUD is drawn in `HubScene.drawHUD()` (around line 860). After the XP bar, add
a coins display. The `User` object will now have `coins` after the `/me` fix:

```typescript
// After XP bar section, add:
const coinsLabel = this.add.text(xpBarX + xpBarW + 12, yForCoins, `⬡ ${this.user.coins}`, {
  fontSize: '12px',
  color: THEME.textGold,
  fontFamily: THEME.font,
  fontStyle: 'bold',
}).setDepth(HUD_DEPTH);
this.hudLayer.push(coinsLabel);
```

Use the hex icon `⬡` to match the existing shell-skin hex icon in `ProfilePanel`.

### 3e. Display coins in `ProfilePanel.ts`

Add a coins row between the XP bar divider and the stats row. The `user` object
passed to `ProfilePanel` constructor already flows from `HubScene.user` which comes
from `/api/users/me`.

```typescript
// After the XP divider section, before the stats row:
children.push(this.scene.add.text(PAD, coinsY, `⬡  ${user.coins ?? 0} coins`, {
  fontSize: '13px',
  color: THEME.textGold,
  fontFamily: THEME.font,
  fontStyle: 'bold',
}));
```

Increase `PH` (panel height constant at top of file) by ~24px to accommodate the
extra row, or shift the stats row down.

---

## 4. Guest user handling

Guest users (`isGuest: true`) should NOT accumulate XP, coins, or stats — their
accounts are ephemeral and deleted by the cron job after 24 h.

Add a guard in `GameResultsController`:

```typescript
@Post()
@HttpCode(200)
async submitResult(@Request() req, @Body() dto: SubmitResultDto) {
  const user = await this.usersService.findById((req.user as { id: number }).id);
  if (!user) throw new UnauthorizedException();
  if (user.isGuest) {
    // Return a zero-delta response — guests get no persistent progression
    return { xpGained: 0, coinsGained: 0, newXp: 0, newLevel: 1, newCoins: 0, leveledUp: false };
  }
  return this.gameResultsService.submitResult(user, dto);
}
```

---

## 5. Leaderboard endpoint (bonus — needed for future hub UI)

Add to `UsersController`:

```typescript
@Get('leaderboard')
async getLeaderboard(): Promise<Pick<User, 'id' | 'username' | 'turtleName' | 'level' | 'coins' | 'shellSkin'>[]> {
  const users = await this.usersService.findAll();
  return [...users]
    .sort((a, b) => b.level - a.level || b.xp - a.xp)
    .slice(0, 50)
    .map(({ id, username, turtleName, level, coins, shellSkin }) => ({
      id, username, turtleName, level, coins, shellSkin,
    }));
}
```

Note: use `[...users].sort()` not `users.sort()` to avoid mutating the array
returned by the repository.

---

## 6. Security checklist

- `POST /api/game-results` is behind `JwtAuthGuard` — no unauthenticated access.
- The `outcome` field is validated with `@IsIn(['win', 'loss'])` — clients cannot
  inject arbitrary strings.
- `gameId` is validated with `@IsString()` — add `@IsIn([...validGameIds])` once
  the list is stable, to prevent phantom game IDs being submitted.
- Guest users receive a zero-delta response and nothing is written to the DB.
- `coins` and `xp` are incremented server-side only — clients cannot send a
  desired final value, only an outcome.

---

## 7. Reliability checklist

- `GameResultsService.submitResult` must be wrapped in try/catch and throw
  `InternalServerErrorException` on DB failure (consistent with `UsersService`
  pattern in this codebase).
- The XP while-loop handles level-up correctly for large XP awards (e.g., if
  `XP_PER_WIN` is later raised such that a single win crosses multiple level
  thresholds).
- Frontend `submitGameResult` errors are caught and logged but non-fatal — the
  player can still return to the hub.

---

## 8. Tests to write

```typescript
// game-results/game-results.service.spec.ts

describe('GameResultsService', () => {
  it('should award XP and coins on win, increment totalWins and gamesPlayed')
  it('should award XP (reduced) on loss, increment totalLosses and gamesPlayed')
  it('should level up when XP crosses threshold')
  it('should handle multiple level-ups in a single call (XP award > one threshold)')
  it('should carry over excess XP after level-up (e.g. 50 XP left after leveling)')
  it('should not modify user when isGuest is true')
  it('should throw InternalServerErrorException when usersService.save fails')
})
```

Jest + `@nestjs/testing` with a mock `UsersService`. Aim for ≥ 90% branch coverage
on `submitResult`.

---

## 9. Implementation order

1. **Fix `/api/users/me`** (Section 0) — unblocks the frontend immediately.
2. **Add `coins` column** (Section 1a) — required before service logic.
3. **Create `GameResultsModule`** (Section 2) — backend complete.
4. **Register module in `app.module.ts`** and export `UsersService` from `UsersModule`.
5. **Frontend: update `User` type + add `submitGameResult`** (Section 3a–3b).
6. **Wire game-over hooks** in each game scene (Section 3c).
7. **Display coins in HUD and ProfilePanel** (Sections 3d–3e).
8. **Write tests** (Section 8).

---

## 10. Files to create / modify (summary)

| Action | Path |
|--------|------|
| **Modify** | `srcs/requirements/backend/src/src/users/users.controller.ts` |
| **Modify** | `srcs/requirements/backend/src/src/users/users.module.ts` |
| **Modify** | `srcs/requirements/backend/src/src/users/entities/user.entity.ts` |
| **Modify** | `srcs/requirements/backend/src/src/app.module.ts` |
| **Create** | `srcs/requirements/backend/src/src/game-results/game-results.module.ts` |
| **Create** | `srcs/requirements/backend/src/src/game-results/game-results.controller.ts` |
| **Create** | `srcs/requirements/backend/src/src/game-results/game-results.service.ts` |
| **Create** | `srcs/requirements/backend/src/src/game-results/progression.constants.ts` |
| **Create** | `srcs/requirements/backend/src/src/game-results/dto/submit-result.dto.ts` |
| **Create** | `srcs/requirements/backend/src/src/game-results/game-results.service.spec.ts` |
| **Modify** | `srcs/requirements/frontend/src/src/hub/api.ts` |
| **Modify** | `srcs/requirements/frontend/src/src/hub/HubScene.ts` |
| **Modify** | `srcs/requirements/frontend/src/src/hub/ProfilePanel.ts` |
| **Modify** | Each game scene that has a game-over state |
