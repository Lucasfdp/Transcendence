# Shell Smash — Customization, Rewards & Achievement Progress Implementation Prompt

## Context

You are a senior full-stack engineer implementing the first real customization/reward loop for **Shell Smash**, a Japanese-themed Phaser 3 hub minigame system built as a 42-school `ft_transcendence` project.

Read the current code before writing changes. Do not assume old prompt details are still accurate.

### Current stack

| Layer | Tech |
|---|---|
| Frontend | Phaser 3, TypeScript, Vite |
| Backend | NestJS, TypeORM, PostgreSQL |
| Auth | Cookie-based JWT, httpOnly cookies, CSRF via `X-CSRF-Token` |
| Data | TypeORM entities, `synchronize: true` outside production |
| UI style | Procedural Phaser `Graphics`, Japanese dojo theme |

### Files you must inspect first

Backend:

- `srcs/requirements/backend/src/src/users/entities/user.entity.ts`
- `srcs/requirements/backend/src/src/users/users.controller.ts`
- `srcs/requirements/backend/src/src/users/users.service.ts`
- `srcs/requirements/backend/src/src/achievements/achievements.constants.ts`
- `srcs/requirements/backend/src/src/achievements/achievements.service.ts`
- `srcs/requirements/backend/src/src/achievements/entities/user-achievement.entity.ts`
- `srcs/requirements/backend/src/src/game-results/game-results.service.ts`
- `srcs/requirements/backend/src/src/app.module.ts`

Frontend:

- `srcs/requirements/frontend/src/src/hub/HubScene.ts`
- `srcs/requirements/frontend/src/src/hub/ProfilePanel.ts`
- `srcs/requirements/frontend/src/src/hub/api.ts`
- `srcs/requirements/frontend/src/src/shared/theme.ts`
- `srcs/requirements/frontend/src/src/shared/achievement-popup.ts`

---

## Goal

Implement the foundation for **Customization** so achievements and coins can unlock/equip cosmetic rewards.

This is not a cards feature yet. Shell Cards should remain a placeholder until the reward/customization loop is stable.

The final result should support:

1. A backend cosmetic catalog.
2. User-owned cosmetic unlocks.
3. Equipping an unlocked shell skin.
4. Buying purchasable cosmetics with coins.
5. Achievement definitions that can declare cosmetic rewards.
6. Achievement progress returned from the backend instead of hardcoded in the frontend.
7. A hub customization modal that lets the user view, buy, and equip shell skins.

---

## Product decisions

### Prioritize customization before cards

Customization is the next correct step because the project already has:

- `coins`
- `level`
- `xp`
- `shellSkin`
- achievements
- `rewardLabel`
- profile UI showing shell skin

But it does not yet have:

- cosmetic catalog
- inventory/unlocks
- equip endpoint
- purchase endpoint
- real reward linkage from achievements

Cards should not be implemented in this pass. Keep `shell-cards` as Coming Soon.

### Fix naming before public API expands

The hub currently uses `costumization` / `Costumization`.

Rename the user-facing label and internal id to:

- `customization`
- `Customization`

Do this before adding backend routes so the typo does not become part of the product/API vocabulary.

---

## Architecture Rules

- Keep the implementation minimal and pragmatic.
- Do not introduce migrations unless production mode requires them. In dev, TypeORM `synchronize` is currently enabled.
- Do not add external image assets. Cosmetic previews can be procedural Phaser `Graphics`.
- All state that matters must live server-side. Do not persist inventory/equipped state in `localStorage`.
- All state-mutating endpoints must require cookie auth and CSRF.
- All new backend endpoints must sit behind `JwtAuthGuard`.
- Keep TypeScript types explicit. Avoid `any`.
- Do not loosen auth, dev-login, CSRF, or guest-account behavior.
- Do not build the cards feature in this prompt.

---

## Backend Implementation

### 1. Add cosmetic catalog

Create a new backend feature module:

```text
srcs/requirements/backend/src/src/customization/
  customization.constants.ts
  customization.module.ts
  customization.controller.ts
  customization.service.ts
  entities/user-cosmetic.entity.ts
  dto/equip-cosmetic.dto.ts
  dto/buy-cosmetic.dto.ts
1a. Cosmetic definition
In customization.constants.ts, define a static catalog.
Minimum shape:
export type CosmeticType = 'shell_skin';

export interface CosmeticDefinition {
  id: string;
  type: CosmeticType;
  name: string;
  description: string;
  price: number;
  unlockAchievementId?: string;
  defaultUnlocked?: boolean;
  accentColor: number;
}
Minimum catalog:
export const COSMETICS: CosmeticDefinition[] = [
  {
    id: 'kanagawa',
    type: 'shell_skin',
    name: 'Kanagawa Shell',
    description: 'Classic blue shell pattern. The default dojo style.',
    price: 0,
    defaultUnlocked: true,
    accentColor: 0x1a3a5c,
  },
  {
    id: 'dragon',
    type: 'shell_skin',
    name: 'Dragon Shell',
    description: 'A fierce red shell for proven winners.',
    price: 150,
    unlockAchievementId: 'first-win',
    accentColor: 0x8b0000,
  },
  {
    id: 'bamboo',
    type: 'shell_skin',
    name: 'Bamboo Shell',
    description: 'A calm green shell awarded to regular dojo players.',
    price: 250,
    unlockAchievementId: 'dojo-regular',
    accentColor: 0x2d5a1b,
  },
];
Rules:
- kanagawa must always be available.
- User.shellSkin should remain the equipped skin field.
- Do not remove shellSkin from User.
2. Add user cosmetic unlock entity
Create UserCosmetic.
@Entity('user_cosmetics')
@Index(['user', 'cosmeticId'], { unique: true })
export class UserCosmetic {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  user: User;

  @Column()
  cosmeticId: string;

  @Column({ type: 'timestamptz', default: () => 'CURRENT_TIMESTAMP' })
  unlockedAt: Date;
}
This table stores unlocked cosmetics only. Equipped skin remains users.shellSkin.
3. Customization API
Add these routes:
Method	Path
GET	/api/customization
POST	/api/customization/equip
POST	/api/customization/buy
3a. Response type
The frontend should receive:
export interface CosmeticView {
  id: string;
  type: 'shell_skin';
  name: string;
  description: string;
  price: number;
  accentColor: number;
  owned: boolean;
  equipped: boolean;
  unlockAchievementId?: string;
  lockedReason?: string;
}
3b. GET /customization
Rules:
- kanagawa is always owned.
- A cosmetic is owned if:
- defaultUnlocked === true, or
- there is a UserCosmetic row for it.
- equipped is true when user.shellSkin === cosmetic.id.
- Include locked reason when useful:
- achievement-locked
- not enough coins
- purchasable
3c. POST /customization/equip
Body:
export class EquipCosmeticDto {
  @IsString()
  cosmeticId: string;
}
Rules:
- Cosmetic must exist.
- Cosmetic must be type shell_skin.
- User must own it, unless it is default unlocked.
- Update user.shellSkin.
- Return updated customization list or updated user. Prefer returning the customization list to make frontend refresh simple.
Errors:
- 404 if cosmetic does not exist.
- 403 if not owned.
- 400 if cosmetic is not equippable.
3d. POST /customization/buy
Body:
export class BuyCosmeticDto {
  @IsString()
  cosmeticId: string;
}
Rules:
- Cosmetic must exist.
- Default cosmetics cannot be bought.
- If already owned, return current customization list without charging again.
- If unlockAchievementId is present and the user has not unlocked that achievement, reject with 403.
- If user lacks coins, reject with 400.
- Deduct coins and create UserCosmetic.
- Save atomically enough for this project. Prefer a TypeORM transaction if simple.
- Return updated customization list.
4. Achievement rewards integration
Update achievements so definitions can declare unlockable cosmetics.
Extend AchievementDefinition:
rewardCosmeticId?: string;
Extend AchievementView:
rewardCosmeticId?: string;
progressCurrent: number;
progressTarget: number;
Update achievement definitions:
- first-win should reward or unlock dragon.
- dojo-regular should reward or unlock bamboo.
- Keep rewardLabel for UI text, but do not rely on it as structured data.
Important:
- Achievement evaluation should continue to persist UserAchievement.
- When an achievement unlocks and has rewardCosmeticId, create a UserCosmetic row if it does not already exist.
- Avoid duplicate unlock rows. Handle unique constraint races safely.
- Do not fail the game-result flow if the cosmetic reward is already owned.
4a. Move achievement progress to backend
Do not calculate achievement progress in HubScene.ts using hardcoded IDs.
Add progress functions to achievement definitions, for example:
progress: (user: User) => { current: number; target: number };
Each achievement must return:
- progressCurrent
- progressTarget
Examples:
- first-match: gamesPlayed / 1
- first-win: totalWins / 1
- dojo-regular: gamesPlayed / 10
- rising-shell: level / 2
- first-bounty: coins / 1
Clamp only in the view layer if desired. The backend can return actual current values.
Frontend Implementation
5. Update hub/api.ts
Add types:
export interface Cosmetic {
  id: string;
  type: 'shell_skin';
  name: string;
  description: string;
  price: number;
  accentColor: number;
  owned: boolean;
  equipped: boolean;
  unlockAchievementId?: string;
  lockedReason?: string;
}
Update Achievement:
export interface Achievement {
  id: string;
  title: string;
  description: string;
  unlockDescription: string;
  rewardLabel?: string;
  rewardCosmeticId?: string;
  progressCurrent: number;
  progressTarget: number;
  unlocked: boolean;
  unlockedAt: string | null;
}
Add API methods:
getCustomization: (): Promise<Cosmetic[]>
equipCosmetic: (cosmeticId: string): Promise<Cosmetic[]>
buyCosmetic: (cosmeticId: string): Promise<Cosmetic[]>
All non-GET calls must use existing CSRF handling.
6. Update achievements modal
Remove frontend hardcoded progress mapping from HubScene.ts.
Achievement progress should use:
achievement.progressCurrent
achievement.progressTarget
Rules:
- If unlocked, show complete.
- If locked, show ${current}/${target}.
- Clamp visual bar ratio between 0 and 1.
- If rewardCosmeticId exists, show a small reward label or “Reward: skin”.
Do not overbuild this UI. Keep the current modal style.
7. Implement customization modal in HubScene.ts
Change the extras button:
- id: customization
- label: Customization
- description: Shell and turtle customization.
When clicked, open a real customization modal instead of Coming Soon.
Minimum modal behavior:
- Fetch api.getCustomization().
- Show loading state.
- Show error state.
- Show cosmetics as cards.
- Each card shows:
- name
- description
- price
- owned/locked/equipped state
- accent preview
- If owned and not equipped, clicking the card or button equips it.
- If not owned and purchasable, clicking buys it.
- If locked by achievement, show locked state and do not allow click.
- After equip/buy, refresh modal using returned cosmetic list.
- Update local this.user.shellSkin after equip so HUD/profile reflect the new skin.
- If buy deducts coins, refresh current user from api.getMe() or update local coins from the backend response if returned.
Keep layout responsive:
- Desktop: 2 columns if space allows.
- Mobile/narrow: 1 column.
- Use existing modal/backdrop patterns.
- Prevent clicks inside the modal from closing it accidentally, as achievements modal already does.
8. Profile/HUD cosmetic preview
Keep this pass minimal.
Update ProfilePanel.ts and HubScene.ts only as needed so cosmetic colors come from a shared mapping or from backend response if available.
Do not add sprite/image assets.
Procedural preview is enough:
- kanagawa: blue accent
- dragon: red accent
- bamboo: green accent
If a shared frontend cosmetic color helper is introduced, keep it small and avoid duplicating backend catalog complexity unless needed.
Testing Requirements
Backend tests
Add or update tests for:
Achievements:
- achievement views include progressCurrent and progressTarget
- first-win unlock can grant dragon
- duplicate evaluation does not duplicate achievements or cosmetics
- dojo-regular can grant bamboo
Customization:
- default kanagawa is owned
- cannot equip locked cosmetic
- can equip owned cosmetic
- cannot buy unknown cosmetic
- cannot buy achievement-locked cosmetic before achievement
- can buy eligible cosmetic when enough coins
- buying already owned cosmetic does not charge twice
- insufficient coins returns an error
Game results:
- existing progression behavior still works
- unlockedAchievements still returned
- cosmetic reward unlock does not break result submission
Frontend verification
Run:
npm run build
from:
srcs/requirements/frontend/src
Backend verification
Run the backend test command used by this project. If unsure, inspect package.json first.
Common likely command:
npm test
from:
srcs/requirements/backend/src
Do not invent scripts if they do not exist.
Non-Goals
Do not implement:
- Shell Cards
- card inventory
- card battles
- turtle body customization beyond shell skin
- image/sprite asset loading
- production migrations unless required by the current environment
- admin cosmetic management UI
- trading
- loot boxes/random rewards
Acceptance Criteria
The implementation is complete when:
- Customization button opens a real modal.
- The typo Costumization is gone.
- User can see owned, locked, purchasable, and equipped shell skins.
- User can equip kanagawa.
- User can unlock dragon through first-win.
- User can unlock bamboo through dojo-regular.
- Achievement progress comes from backend fields, not frontend hardcoded IDs.
- Achievement modal still works.
- Game result submission still returns progression and achievement unlocks.
- HUD/profile reflect equipped shell skin.
- Backend tests pass or documented failures are explained.
- Frontend build passes.
