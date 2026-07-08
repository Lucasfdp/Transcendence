# Graph Report - frontend  (2026-07-08)

## Corpus Check
- 168 files · ~125,564 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1717 nodes · 4728 edges · 76 communities (67 shown, 9 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS · INFERRED: 22 edges (avg confidence: 0.79)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- Bamboo Bash Scene
- Bell Clash Scene
- Kame Knock Scene
- Chat Operations
- Shell Inventory Boot
- Launch Runtime
- Card Binder
- Game Descriptors
- Hub API Client
- Shell Curl Setup
- Power Picker
- Power System
- App Legal Flow
- Local Replay
- Rule Hooks HUD
- Casino Fairness
- Shell Curl Replay
- Frontend Package
- Common Scene Host
- Board Canvas
- Replay Data Normalisation
- Bamboo Obstacles
- Route And Auth
- Replay Controller
- Replay Scene Drawing
- Plinko Drop Path
- Auth Components
- Slots Rendering
- Collectible Descriptor
- Shell Picker Socket
- Casino Tests
- Dice Utilities
- Curl Bumper Flow
- TypeScript Config
- Fairness Crypto
- Bell Clash Types
- Power Pickups
- Arena Power Runtime
- Replay Projectiles
- World Descriptors
- Player Assets
- World Entity Store
- Curl Scene Rendering
- Curl Online Flow
- Replay Physics
- Replay Visuals
- Rect Arena
- Side Panels
- Launchable Remap
- Curl Stone Drawing
- Sweep Controller
- Power Ball Runtime
- Card Drop Popup
- Oval Arena
- End Modals
- Friend Filtering
- Profile Cache
- Preload Assets
- Notification Dedup
- Player Labels
- Responsive Scene
- Work In Progress UI
- Presence Grouping
- Friends Operations
- Profile Card
- Index Bootstrap
- Nine Slice Button
- Procedural Background
- Game Effect Hook
- Entrypoint Script

## God Nodes (most connected - your core abstractions)
1. `BambooBashScene` - 120 edges
2. `BellClashScene` - 119 edges
3. `KameKnockScene` - 118 edges
4. `ShellCurlScene` - 108 edges
5. `PowerType` - 66 edges
6. `BallState` - 48 edges
7. `ReplayScene` - 46 edges
8. `getGameSocket()` - 41 edges
9. `ShellPickerScene` - 39 edges
10. `HomeMenu()` - 38 edges

## Surprising Connections (you probably didn't know these)
- `createShellSmashGame()` --indirect_call--> `BambooBashScene`  [INFERRED]
  src/lib/createShellSmashGame.ts → src/games/bamboo-bash/BambooBashScene.ts
- `createShellSmashGame()` --indirect_call--> `BellClashScene`  [INFERRED]
  src/lib/createShellSmashGame.ts → src/games/bell-clash/BellClashScene.ts
- `createShellSmashGame()` --indirect_call--> `KameKnockScene`  [INFERRED]
  src/lib/createShellSmashGame.ts → src/games/kame-knock/KameKnockScene.ts
- `createShellSmashGame()` --indirect_call--> `ShellCurlScene`  [INFERRED]
  src/lib/createShellSmashGame.ts → src/games/shell-curl/ShellCurlScene.ts
- `MatchStatusPayload` --references--> `GameSnapshot`  [EXTRACTED]
  src/routes/GamePage.tsx → src/services/network/gameSocket.ts

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Application Shell Bootstrap** — frontend_index_document, frontend_index_root, frontend_index_src_main_tsx [INFERRED 0.85]

## Communities (76 total, 9 thin omitted)

### Community 0 - "Bamboo Bash Scene"
Cohesion: 0.05
Nodes (10): Bamboo, bambooPos(), BambooBashScene, isBambooBashSnapshot(), OnlineBallState, OnlineBallState, OnlineBallState, BambooBashSnapshot (+2 more)

### Community 1 - "Bell Clash Scene"
Cohesion: 0.05
Nodes (9): BellClashScene, isBellClashSnapshot(), BellClashSnapshot, BellClashThrowEvent, updateArenaPowerBalls(), isBallMoving(), stepBall(), applyBallCurl() (+1 more)

### Community 2 - "Kame Knock Scene"
Cohesion: 0.05
Nodes (9): isKameKnockSnapshot(), KAME_AVAILABLE_POWERS, KameKnockScene, KameKnockSnapshot, KameKnockThrowEvent, targetHitAccuracy(), TimedTarget, timedTargetPosition() (+1 more)

### Community 3 - "Chat Operations"
Cohesion: 0.06
Nodes (58): addUnread(), ConversationPreviewUpdate, conversationTitle(), GifMetadata, parseGifMetadata(), removeUnread(), sortConversationsByRecency(), unreadIdsFromInbox() (+50 more)

### Community 4 - "Shell Inventory Boot"
Cohesion: 0.06
Nodes (26): ShellInventory, User, PhaserBootScene, ReturnToHubScene, ShellPickerScene, createShellSmashGame(), buildEmptyShellSelection(), GAME_SCENES (+18 more)

### Community 5 - "Launch Runtime"
Cohesion: 0.06
Nodes (18): LocalParticipant, BallLaunchableState, LaunchableRelayoutOptions, LaunchableState, LaunchStepOptions, remapLaunchableToArena(), stepLaunchable(), SlingshotLaunchRuntime (+10 more)

### Community 6 - "Card Binder"
Cohesion: 0.08
Nodes (30): BinderFilterOptions, BinderSortOrder, filterAndSortCards(), RARITY_ORDER, CardTilt, clamp01(), computeCardTilt(), FOIL_SHINE_INTENSITY (+22 more)

### Community 7 - "Game Descriptors"
Cohesion: 0.09
Nodes (35): BALL_TRAIL_OPTIONS, BAMBOO_ASSETS, BAMBOO_BASH_DESCRIPTOR, BAMBOO_TEXTURES, GameDescriptor, BALL_ROUNDS, BALL_TRAIL_OPTIONS, BallRoundConfig (+27 more)

### Community 8 - "Hub API Client"
Cohesion: 0.07
Nodes (38): Achievement, apiFetch(), ApiFetchOptions, apiUploadFile(), CardSetProgress, CasinoGame, ChatMessageType, ChatMessageView (+30 more)

### Community 9 - "Shell Curl Setup"
Cohesion: 0.09
Nodes (28): Bumper, BumperDef, BumperObstacleDescriptor, FALLBACK_POWERS, SHELL_CURL_DESCRIPTOR, showAchievementPopup(), showAchievementUnlocks(), COMPLETION_REWARDS (+20 more)

### Community 10 - "Power Picker"
Cohesion: 0.11
Nodes (7): CardState, POWER_DESC, PowerPicker, TokenRecord, PowerRegistry, PowerType, GameInfoSidePanel

### Community 11 - "Power System"
Cohesion: 0.06
Nodes (35): BOMB_DEF, BOOMERANG_DEF, BoomerangStone, BoomerangStoneState, BOUNCER_DEF, FREEZE_DEF, FrozenStone, GHOST_DEF (+27 more)

### Community 12 - "App Legal Flow"
Cohesion: 0.09
Nodes (23): App(), ConsentState, DOCUMENTS, INITIAL_READ_STATE, LegalDocument, LegalDocumentId, LegalHub(), ReadState (+15 more)

### Community 13 - "Local Replay"
Cohesion: 0.09
Nodes (19): ReplayImportRequest, buildLocalReplayImportRequest(), buildLocalReplayPlayers(), buildLocalReplayPlayerUserIds(), createLocalReplayId(), LocalReplayFrameDraft, LocalReplayImportOptions, LocalReplayPlayerVisuals (+11 more)

### Community 14 - "Rule Hooks HUD"
Cohesion: 0.12
Nodes (9): GameRuleHooks, buildHudStateFromRoundFlow(), clamp(), RoundFlowState, ScoreHud, ScoreHudOptions, TurnManager, TurnPhase (+1 more)

### Community 15 - "Casino Fairness"
Cohesion: 0.15
Nodes (25): FairnessCheck, flipSideColor(), flipSideLabel(), isBackFacing(), sideAtAngle(), FortuneWheelModal(), FortuneWheelModalProps, isBigWinSegment() (+17 more)

### Community 17 - "Frontend Package"
Cohesion: 0.07
Nodes (29): dependencies, phaser, react, react-dom, react-router-dom, socket.io-client, description, devDependencies (+21 more)

### Community 18 - "Common Scene Host"
Cohesion: 0.10
Nodes (7): CommonGameSceneHost, CommonGameSceneHostOptions, CommonGameSceneLifecycle, CommonSceneRuntime, SceneSocketChannel, SocketLike, SocketListenerRegistration

### Community 19 - "Board Canvas"
Cohesion: 0.16
Nodes (24): BoardStep, clamp01(), easeInOutCubic(), easeInQuad(), easeOutBack(), easeOutBounce(), easeOutQuad(), runBoardAnimation() (+16 more)

### Community 20 - "Replay Data Normalisation"
Cohesion: 0.11
Nodes (20): BAMBOO_ASSETS, BAMBOO_TEXTURES, interpolateNormalizedTrail(), interpolatePoints(), normalizeReplayStones(), parsePowerType(), PLAYER_COLOURS, ProjectileRenderState (+12 more)

### Community 21 - "Bamboo Obstacles"
Cohesion: 0.13
Nodes (20): bambooObstacleDescriptor, BambooObstacleRendering, bambooRadius(), drawBamboo(), drawCane(), hitsBamboo(), randomSpot(), STAGE_POINTS (+12 more)

### Community 22 - "Route And Auth"
Cohesion: 0.14
Nodes (14): RouteLoading(), TempleBackdrop(), TempleBackdropProps, api, AuthError, NetworkError, SessionStatus, useSessionGate() (+6 more)

### Community 23 - "Replay Controller"
Cohesion: 0.17
Nodes (14): ReplayDetail, ReplayEvent, ReplayFrame, ReplaySummary, clamp01(), frameWindow(), getFrameDurationMs(), playbackTime() (+6 more)

### Community 25 - "Plinko Drop Path"
Cohesion: 0.16
Nodes (19): computeDropPath(), DropStep, pegLattice(), PegPosition, verifyPlinko(), bucketFromOutcome(), bucketIndexFromRolls(), bucketView() (+11 more)

### Community 26 - "Auth Components"
Cohesion: 0.10
Nodes (6): AuthCard(), AuthCardProps, OAuthButtons(), OAuthButtonsProps, OAuthProviderButton(), OAuthProviderButtonProps

### Community 27 - "Slots Rendering"
Cohesion: 0.19
Nodes (20): verifySlots(), drawReelIdle(), drawReelStrip(), drawSymbolImage(), loadImage(), preloadSymbolImages(), ReelPlan, ShrineSlotsModal() (+12 more)

### Community 28 - "Collectible Descriptor"
Cohesion: 0.18
Nodes (18): buildCircularCollectibleDescriptor(), collectibleToBlocker(), hitsCircularCollectible(), remapCollectibleDescriptors(), resolveCollectiblePosition(), resolveCollectibleRadius(), arena, createEllipsePowerPickupArea() (+10 more)

### Community 29 - "Shell Picker Socket"
Cohesion: 0.15
Nodes (15): MatchStatusPayload, ONLINE_SCENES, ShellPickerData, ShellSmashStartData, CurlingThrowEvent, GameMap, GameSnapshot, MatchMode (+7 more)

### Community 30 - "Casino Tests"
Cohesion: 0.13
Nodes (11): FakeImage, PendingReveal, DiceConfig, FlipConfig, MonteConfig, PlinkoView, SlotsView, SpinFairness (+3 more)

### Community 31 - "Dice Utilities"
Cohesion: 0.19
Nodes (17): easeOutCubic(), lerp(), buildOdometerStrip(), diceMultiplier(), diceOutcomeId(), diceValue(), diceWinChance(), diceWinningOutcomes() (+9 more)

### Community 32 - "Curl Bumper Flow"
Cohesion: 0.21
Nodes (5): resolveStoneCollision(), stepStone(), obstacleToBlocker(), resolveObstaclePosition(), isStoneOutOfBounds()

### Community 33 - "TypeScript Config"
Cohesion: 0.10
Nodes (19): compilerOptions, allowJs, allowSyntheticDefaultImports, esModuleInterop, forceConsistentCasingInFileNames, ignoreDeprecations, isolatedModules, jsx (+11 more)

### Community 34 - "Fairness Crypto"
Cohesion: 0.24
Nodes (16): computeRollBrowser(), computeRollsBrowser(), encoder, importHmacKey(), rollFromMessage(), sha256Hex(), toHex(), verifyFlip() (+8 more)

### Community 35 - "Bell Clash Types"
Cohesion: 0.16
Nodes (14): BALL_TRAIL_OPTIONS, BELL_CLASH_DESCRIPTOR, BellObstacleDescriptor, FALLBACK_POWERS, OverlayState, ScoreZone, ZONE_DEFS, ZoneKind (+6 more)

### Community 36 - "Power Pickups"
Cohesion: 0.18
Nodes (4): pickRandom(), powerPickupDescriptor(), PowerPickupManager, PowerPickupSpawnArea

### Community 37 - "Arena Power Runtime"
Cohesion: 0.26
Nodes (9): ArenaPixels, applyArenaBallPowerCycle(), resolveArenaPowerBallCollisions(), resolveBallCollision(), applyBallPower(), BallExtState, cloneBall(), createMirrorBall() (+1 more)

### Community 38 - "Replay Projectiles"
Cohesion: 0.18
Nodes (6): interpolateArenaTrail(), isLegacyReplayFrame(), normalizeReplayBalls(), resolveTargetColour(), toArenaX(), toArenaY()

### Community 39 - "World Descriptors"
Cohesion: 0.18
Nodes (14): CollectibleBlocker, CollectibleDescriptor, CollectibleHooks, ObstacleArenaFrame, ObstacleBlocker, ObstacleBoundsGeometry, ObstacleCircleGeometry, ObstacleCollisionDescriptor (+6 more)

### Community 41 - "Player Assets"
Cohesion: 0.26
Nodes (13): INGAME_PLAYER_ASSET, resolveShellSkinAsset(), SHELL_SKIN_ASSETS, ShellSkinId, drawIngamePlayerTexture(), drawIngameShellTexture(), getOrCreatePlayerImage(), hideIngamePlayerTexture() (+5 more)

### Community 42 - "World Entity Store"
Cohesion: 0.19
Nodes (3): WorldEntity, WorldEntityStore, TestEntity

### Community 45 - "Replay Physics"
Cohesion: 0.22
Nodes (11): applyReplayProjectilePower(), createReplayProjectileState(), pushReplayTrailPoint(), ReplayProjectileState, ReplayStoneState, runFixedStepSimulation(), SimulatedReplayObject, simulateReplayProjectile() (+3 more)

### Community 46 - "Replay Visuals"
Cohesion: 0.26
Nodes (11): ReplayFrameSnapshot, ReplaySnapshotEntity, ReplayVisualPlayer, normalizeReplayBackgroundId(), REPLAY_BACKGROUND_TEXTURES, resolveActiveReplayBackground(), resolveActiveReplaySide(), resolveReplayPlayer() (+3 more)

### Community 47 - "Rect Arena"
Cohesion: 0.24
Nodes (11): CURL_SHEET, distanceToHouseButton(), drawHorizontalSheet(), drawHouseRings(), drawIceSheet(), drawVerticalSheet(), HOUSE_COLORS, RectArenaDef (+3 more)

### Community 49 - "Launchable Remap"
Cohesion: 0.29
Nodes (10): assertValidFrame(), frameFromOvalArena(), frameFromRectArena(), OvalArenaLike, RectArenaLike, remapLaunchable(), remapLaunchables(), RemappedLaunchable (+2 more)

### Community 50 - "Curl Stone Drawing"
Cohesion: 0.29
Nodes (3): StoneState, PowerDef, RectArenaPixels

### Community 51 - "Sweep Controller"
Cohesion: 0.20
Nodes (3): NOTE: stone param is accepted but not used internally — the controller only, SweepController, TrailPoint

### Community 53 - "Card Drop Popup"
Cohesion: 0.33
Nodes (5): PackPull, dropTagLabel(), RARITY_ACCENT, RARITY_GLYPH, showCardDropPopup()

### Community 54 - "Oval Arena"
Cohesion: 0.25
Nodes (4): ArenaDef, arenaToScreen(), arenaToScreenInRect(), arena

### Community 55 - "End Modals"
Cohesion: 0.39
Nodes (7): addModalButton(), GameEndModalAction, GameEndModalOptions, GameEndModalPlayer, showGameEndModal(), OnlineRematchOptions, showOnlineRematchEndModal()

### Community 56 - "Friend Filtering"
Cohesion: 0.29
Nodes (6): filterFriends(), HasSearchableName, alice, bob, carol, Friend

### Community 57 - "Profile Cache"
Cohesion: 0.32
Nodes (3): CacheEntry, createProfileCardCache(), ProfileCardCache

### Community 58 - "Preload Assets"
Cohesion: 0.46
Nodes (3): preloadOvalArenaSkin(), preloadPowerUpAssets(), preloadIngamePlayerTexture()

### Community 59 - "Notification Dedup"
Cohesion: 0.43
Nodes (5): HasNotificationShape, notificationIdsFrom(), prependNotificationDeduped(), removeNotificationsFrom(), Notif

### Community 60 - "Player Labels"
Cohesion: 0.48
Nodes (6): SnapshotPlayer, compactHudName(), hudPlayerLabel(), localPlayerDisplayName(), playerDisplayName(), PlayerLabelUser

### Community 62 - "Work In Progress UI"
Cohesion: 0.47
Nodes (4): WorkInProgressModal(), WorkInProgressModalProps, WorkInProgressNotice(), WorkInProgressNoticeProps

### Community 63 - "Presence Grouping"
Cohesion: 0.53
Nodes (4): PresenceStatus, formatRelativeTime(), groupFriendsByPresence(), PresenceGroups

### Community 64 - "Friends Operations"
Cohesion: 0.53
Nodes (4): friendCounts, HasUserId, removeById(), upsertById()

### Community 65 - "Profile Card"
Cohesion: 0.47
Nodes (4): ProfileCard(), ProfileCardProps, ProfileCardUser, baseUser

### Community 66 - "Index Bootstrap"
Cohesion: 0.50
Nodes (5): Frontend Index HTML Document, Application Favicon PNG, Root Mount Element, Shell Smash Page Title, Frontend Main TypeScript Module

### Community 67 - "Nine Slice Button"
Cohesion: 0.40
Nodes (4): NineSliceButton(), NineSliceButtonProps, NineSliceStyle, UI_9SLICE_BUTTON_PANEL

### Community 68 - "Procedural Background"
Cohesion: 0.67
Nodes (3): drawBackground(), drawBlossomTree(), PETAL_COLOURS

## Knowledge Gaps
- **275 isolated node(s):** `name`, `version`, `description`, `dev`, `build` (+270 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **9 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `ShellCurlScene` connect `Shell Curl Replay` to `Curl Bumper Flow`, `Power Pickups`, `Launch Runtime`, `Shell Inventory Boot`, `Game Descriptors`, `Curl Turn Flow`, `Shell Curl Setup`, `Power Picker`, `Curl Scene Rendering`, `Curl Online Flow`, `Rule Hooks HUD`, `Side Panels`, `Common Scene Host`, `Curl Stone Drawing`, `Sweep Controller`, `Responsive Scene`, `Preload Assets`, `Shell Picker Socket`?**
  _High betweenness centrality (0.065) - this node is a cross-community bridge._
- **Why does `api` connect `Route And Auth` to `Bell Clash Types`, `Chat Operations`, `Shell Inventory Boot`, `Card Binder`, `Game Descriptors`, `Hub API Client`, `Shell Curl Setup`, `Casino Fairness`, `Board Canvas`, `Plinko Drop Path`, `Auth Components`, `Slots Rendering`, `Shell Picker Socket`, `Casino Tests`, `Dice Utilities`?**
  _High betweenness centrality (0.063) - this node is a cross-community bridge._
- **Why does `KameKnockScene` connect `Kame Knock Scene` to `Bamboo Bash Scene`, `Power Pickups`, `Arena Power Runtime`, `Launch Runtime`, `Game Descriptors`, `Shell Inventory Boot`, `Power Picker`, `Rule Hooks HUD`, `Side Panels`, `Common Scene Host`, `Responsive Scene`, `Preload Assets`, `Shell Picker Socket`?**
  _High betweenness centrality (0.063) - this node is a cross-community bridge._
- **Are the 8 inferred relationships involving `PowerType` (e.g. with `.buildFullInventory()` and `.create()`) actually correct?**
  _`PowerType` has 8 INFERRED edges - model-reasoned connections that need verification._
- **What connects `name`, `version`, `description` to the rest of the system?**
  _276 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Bamboo Bash Scene` be split into smaller, more focused modules?**
  _Cohesion score 0.05214917825537294 - nodes in this community are weakly interconnected._
- **Should `Bell Clash Scene` be split into smaller, more focused modules?**
  _Cohesion score 0.051962676962676965 - nodes in this community are weakly interconnected._