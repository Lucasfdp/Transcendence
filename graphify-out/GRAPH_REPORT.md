# Graph Report - frontend  (2026-07-09)

## Corpus Check
- 184 files · ~128,720 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1823 nodes · 5004 edges · 81 communities (66 shown, 15 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS · INFERRED: 25 edges (avg confidence: 0.79)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- Bamboo Bash Scene
- Kame Knock Scene
- Bell Clash Scene
- Replay Trail Runtime
- Collectible Descriptors
- Work In Progress UI
- Card Binder Filters
- Hub API Client
- Phaser Hub Scenes
- Bell Clash Config
- Shell Picker UI
- Power System
- Shell Curl Config
- App Legal Shell
- Bamboo UI Assets
- Casino Fairness Games
- Social Chat Ops
- Replay Snapshot Builders
- Frontend Package Metadata
- Common Scene Host
- Board Animation Canvas
- Bamboo Mechanics
- Curling Power Runtime
- Replay Persistence
- Replay Scene Assets
- Replay Bell Visuals
- Auth Route UI
- Replay Controller
- Plinko Drop Path
- Auth OAuth UI
- Shrine Slots UI
- Shell Curl Scene
- Replay Capture Runtime
- Casino Animation Tests
- Dice Game Mechanics
- TypeScript Config
- Common Runtime Exports
- Fairness Crypto
- Slingshot Runtime
- Game Rule Hooks
- Score HUD
- Power Picker UI
- Replay Projectile Visuals
- Curling Bumpers
- Local Replay Runtime
- Game Info Panel
- World Entity Store
- Curling Online Flow
- Replay Physics
- Replay Visual State
- Curl Sheet Rendering
- Side Panel UI
- Launchable Remap
- World Runtime
- Curling Stone Rendering
- Sweep Controller
- Card Reveal Overlay
- World Map Runtime
- End Modal UI
- Friend Filtering
- Profile Card Cache
- Preload Hooks
- Replay Entities
- Curling Runtime Tests
- Turn Manager
- Notification Dedup
- Replay Player Metadata
- Curling Scoring
- Responsive Scene
- Profile Card UI
- Player Labels
- Frontend HTML Entry
- Hub Backgrounds
- Background Drawing
- Entrypoint Script

## God Nodes (most connected - your core abstractions)
1. `BambooBashScene` - 115 edges
2. `BellClashScene` - 114 edges
3. `KameKnockScene` - 113 edges
4. `ShellCurlScene` - 103 edges
5. `PowerType` - 71 edges
6. `BallState` - 59 edges
7. `ReplayScene` - 46 edges
8. `StoneState` - 45 edges
9. `getGameSocket()` - 41 edges
10. `ShellPickerScene` - 39 edges

## Surprising Connections (you probably didn't know these)
- `createShellSmashGame()` --indirect_call--> `ShellPickerScene`  [INFERRED]
  src/lib/createShellSmashGame.ts → src/features/hub/ShellPickerScene.ts
- `createShellSmashGame()` --indirect_call--> `BambooBashScene`  [INFERRED]
  src/lib/createShellSmashGame.ts → src/games/bamboo-bash/BambooBashScene.ts
- `createShellSmashGame()` --indirect_call--> `BellClashScene`  [INFERRED]
  src/lib/createShellSmashGame.ts → src/games/bell-clash/BellClashScene.ts
- `BambooReplayParticipant` --references--> `BallState`  [EXTRACTED]
  src/games/common/replay/LocalReplaySnapshots.ts → src/shared/mechanics/ball-core.ts
- `BellClashReplayBall` --references--> `BallState`  [EXTRACTED]
  src/games/common/replay/LocalReplaySnapshots.ts → src/shared/mechanics/ball-core.ts

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Application Shell Bootstrap** — frontend_index_document, frontend_index_root, frontend_index_src_main_tsx [INFERRED 0.85]

## Communities (81 total, 15 thin omitted)

### Community 0 - "Bamboo Bash Scene"
Cohesion: 0.05
Nodes (10): Bamboo, bambooObstacleDescriptor, bambooPos(), BambooBashScene, isBambooBashSnapshot(), BambooBashSnapshot, BambooBashThrowEvent, isBallMoving() (+2 more)

### Community 1 - "Kame Knock Scene"
Cohesion: 0.05
Nodes (13): OnlineBallState, OnlineBallState, isKameKnockSnapshot(), KAME_AVAILABLE_POWERS, KameKnockScene, OnlineBallState, KameKnockSnapshot, KameKnockThrowEvent (+5 more)

### Community 2 - "Bell Clash Scene"
Cohesion: 0.06
Nodes (4): BellClashScene, isBellClashSnapshot(), BellClashSnapshot, BellClashThrowEvent

### Community 3 - "Replay Trail Runtime"
Cohesion: 0.06
Nodes (32): ArenaReplayProjectileOptions, ArenaBallMovingResolver, ArenaBallTrailId, ArenaBallTrailObject, ArenaBallTrailRuntime, ArenaBallTrailSetOptions, buildArenaBallTrailObjects(), buildArenaPowerBallTrailObjects() (+24 more)

### Community 4 - "Collectible Descriptors"
Cohesion: 0.08
Nodes (35): buildCircularCollectibleDescriptor(), CollectibleBlocker, CollectibleDescriptor, CollectibleHooks, collectibleToBlocker(), hitsCircularCollectible(), remapCollectibleDescriptors(), resolveCollectiblePosition() (+27 more)

### Community 5 - "Work In Progress UI"
Cohesion: 0.06
Nodes (40): WorkInProgressModal(), WorkInProgressModalProps, WorkInProgressNotice(), WorkInProgressNoticeProps, RANKED_GAMES, buildFriendCode(), parseFriendCode(), debounce() (+32 more)

### Community 6 - "Card Binder Filters"
Cohesion: 0.08
Nodes (31): BinderFilterOptions, BinderSortOrder, filterAndSortCards(), RARITY_ORDER, CardTilt, clamp01(), computeCardTilt(), FOIL_SHINE_INTENSITY (+23 more)

### Community 7 - "Hub API Client"
Cohesion: 0.07
Nodes (41): Achievement, apiFetch(), ApiFetchOptions, apiUploadFile(), CardSetProgress, CasinoGame, ChatMessageType, ChatMessageView (+33 more)

### Community 8 - "Phaser Hub Scenes"
Cohesion: 0.08
Nodes (31): User, PhaserBootScene, ReturnToHubScene, MatchStatusPayload, ONLINE_SCENES, ShellPickerData, createShellSmashGame(), ShellSmashStartData (+23 more)

### Community 9 - "Bell Clash Config"
Cohesion: 0.08
Nodes (34): BALL_TRAIL_OPTIONS, BELL_CLASH_DESCRIPTOR, BellObstacleDescriptor, FALLBACK_POWERS, OverlayState, ScoreZone, ZONE_DEFS, ZoneKind (+26 more)

### Community 10 - "Shell Picker UI"
Cohesion: 0.12
Nodes (6): ShellInventory, ShellPickerScene, buildEmptyShellSelection(), PowerupMatchmakingPanel(), toHex(), getGameSocket()

### Community 11 - "Power System"
Cohesion: 0.05
Nodes (36): BOMB_DEF, BOOMERANG_DEF, BoomerangStone, BoomerangStoneState, BOUNCER_DEF, FREEZE_DEF, FrozenStone, GameEffectHook (+28 more)

### Community 12 - "Shell Curl Config"
Cohesion: 0.09
Nodes (27): GameDescriptor, Bumper, BumperDef, BumperObstacleDescriptor, FALLBACK_POWERS, SHELL_CURL_DESCRIPTOR, showAchievementPopup(), showAchievementUnlocks() (+19 more)

### Community 13 - "App Legal Shell"
Cohesion: 0.09
Nodes (23): App(), ConsentState, DOCUMENTS, INITIAL_READ_STATE, LegalDocument, LegalDocumentId, LegalHub(), ReadState (+15 more)

### Community 14 - "Bamboo UI Assets"
Cohesion: 0.12
Nodes (27): NineSliceButton(), NineSliceButtonProps, NineSliceStyle, BALL_TRAIL_OPTIONS, BAMBOO_ASSETS, BAMBOO_BASH_DESCRIPTOR, BAMBOO_TEXTURES, INGAME_PLAYER_ASSET (+19 more)

### Community 15 - "Casino Fairness Games"
Cohesion: 0.15
Nodes (25): FairnessCheck, flipSideColor(), flipSideLabel(), isBackFacing(), sideAtAngle(), FortuneWheelModal(), FortuneWheelModalProps, isBigWinSegment() (+17 more)

### Community 16 - "Social Chat Ops"
Cohesion: 0.11
Nodes (26): addUnread(), ConversationPreviewUpdate, conversationTitle(), GifMetadata, parseGifMetadata(), removeUnread(), sortConversationsByRecency(), unreadIdsFromInbox() (+18 more)

### Community 17 - "Replay Snapshot Builders"
Cohesion: 0.12
Nodes (29): BambooBashLocalReplaySnapshotOptions, BambooReplayObstacleDescriptor, BambooReplayParticipant, BellClashLocalReplaySnapshotOptions, BellClashReplayBall, BellClashScoreZoneDescriptor, buildArenaReplayProjectileSnapshot(), buildBambooBashLocalReplaySnapshot() (+21 more)

### Community 18 - "Frontend Package Metadata"
Cohesion: 0.07
Nodes (29): dependencies, phaser, react, react-dom, react-router-dom, socket.io-client, description, devDependencies (+21 more)

### Community 19 - "Common Scene Host"
Cohesion: 0.10
Nodes (7): CommonGameSceneHost, CommonGameSceneHostOptions, CommonGameSceneLifecycle, CommonSceneRuntime, SceneSocketChannel, SocketLike, SocketListenerRegistration

### Community 20 - "Board Animation Canvas"
Cohesion: 0.16
Nodes (24): BoardStep, clamp01(), easeInOutCubic(), easeInQuad(), easeOutBack(), easeOutBounce(), easeOutQuad(), runBoardAnimation() (+16 more)

### Community 21 - "Bamboo Mechanics"
Cohesion: 0.13
Nodes (21): BambooObstacleRendering, bambooRadius(), drawBamboo(), drawCane(), hitsBamboo(), randomSpot(), STAGE_POINTS, stageForAge() (+13 more)

### Community 22 - "Curling Power Runtime"
Cohesion: 0.19
Nodes (9): CurlingReplayStoneOptions, resolveStoneCollision(), stepStone(), StoneState, CurlingCollisionOptions, CurlingPowerRuntime, CurlingPowerSpawnResult, PowerDef (+1 more)

### Community 23 - "Replay Persistence"
Cohesion: 0.15
Nodes (16): ReplayImportRequest, LocalReplayPersistenceOptions, LocalReplayPersistenceRuntime, persistLocalReplayImport(), LocalReplayRuntimeOptions, LocalReplayRuntimePersistenceOptions, buildLocalReplayImportRequest(), buildLocalReplayPlayerUserIds() (+8 more)

### Community 24 - "Replay Scene Assets"
Cohesion: 0.12
Nodes (20): BAMBOO_ASSETS, BAMBOO_TEXTURES, interpolateNormalizedTrail(), interpolatePoints(), normalizeReplayStones(), parsePowerType(), PLAYER_COLOURS, ProjectileRenderState (+12 more)

### Community 26 - "Auth Route UI"
Cohesion: 0.14
Nodes (14): RouteLoading(), TempleBackdrop(), TempleBackdropProps, api, AuthError, NetworkError, SessionStatus, useSessionGate() (+6 more)

### Community 27 - "Replay Controller"
Cohesion: 0.17
Nodes (14): ReplayDetail, ReplayEvent, ReplayFrame, ReplaySummary, clamp01(), frameWindow(), getFrameDurationMs(), playbackTime() (+6 more)

### Community 28 - "Plinko Drop Path"
Cohesion: 0.16
Nodes (19): computeDropPath(), DropStep, pegLattice(), PegPosition, verifyPlinko(), bucketFromOutcome(), bucketIndexFromRolls(), bucketView() (+11 more)

### Community 29 - "Auth OAuth UI"
Cohesion: 0.10
Nodes (6): AuthCard(), AuthCardProps, OAuthButtons(), OAuthButtonsProps, OAuthProviderButton(), OAuthProviderButtonProps

### Community 30 - "Shrine Slots UI"
Cohesion: 0.19
Nodes (20): verifySlots(), drawReelIdle(), drawReelStrip(), drawSymbolImage(), loadImage(), preloadSymbolImages(), ReelPlan, ShrineSlotsModal() (+12 more)

### Community 32 - "Replay Capture Runtime"
Cohesion: 0.12
Nodes (4): LocalReplayCaptureRuntime, LocalReplayCaptureRuntimeOptions, createLocalReplayId(), SceneReplayRecorder

### Community 33 - "Casino Animation Tests"
Cohesion: 0.13
Nodes (11): FakeImage, PendingReveal, DiceConfig, FlipConfig, MonteConfig, PlinkoView, SlotsView, SpinFairness (+3 more)

### Community 34 - "Dice Game Mechanics"
Cohesion: 0.19
Nodes (17): easeOutCubic(), lerp(), buildOdometerStrip(), diceMultiplier(), diceOutcomeId(), diceValue(), diceWinChance(), diceWinningOutcomes() (+9 more)

### Community 35 - "TypeScript Config"
Cohesion: 0.10
Nodes (19): compilerOptions, allowJs, allowSyntheticDefaultImports, esModuleInterop, forceConsistentCasingInFileNames, ignoreDeprecations, isolatedModules, jsx (+11 more)

### Community 36 - "Common Runtime Exports"
Cohesion: 0.20
Nodes (14): ScoreRegionDescriptor, BallLaunchableState, LaunchableRelayoutOptions, LaunchableState, LaunchStepOptions, remapLaunchableToArena(), stepLaunchable(), SlingshotLaunchRuntimeOptions (+6 more)

### Community 37 - "Fairness Crypto"
Cohesion: 0.24
Nodes (16): computeRollBrowser(), computeRollsBrowser(), encoder, importHmacKey(), rollFromMessage(), sha256Hex(), toHex(), verifyFlip() (+8 more)

### Community 38 - "Slingshot Runtime"
Cohesion: 0.15
Nodes (3): LocalParticipant, SlingshotLaunchRuntime, Slingshot

### Community 39 - "Game Rule Hooks"
Cohesion: 0.23
Nodes (10): resolveReplayWinnerSide(), buildTurnStateFromGameRuleHooks(), computeGameRuleWinner(), GameRuleHooks, notifyGameRuleProjectileSettled(), notifyGameRuleRelease(), buildHudStateFromRoundFlow(), clamp() (+2 more)

### Community 40 - "Score HUD"
Cohesion: 0.23
Nodes (5): PHASE_LABELS, ScoreHud, ScoreHudOptions, TEAM_LABELS, TurnState

### Community 41 - "Power Picker UI"
Cohesion: 0.28
Nodes (5): CardState, POWER_DESC, PowerPicker, TokenRecord, PowerType

### Community 42 - "Replay Projectile Visuals"
Cohesion: 0.18
Nodes (6): interpolateArenaTrail(), isLegacyReplayFrame(), normalizeReplayBalls(), resolveTargetColour(), toArenaX(), toArenaY()

### Community 46 - "World Entity Store"
Cohesion: 0.19
Nodes (3): WorldEntity, WorldEntityStore, TestEntity

### Community 48 - "Replay Physics"
Cohesion: 0.22
Nodes (11): applyReplayProjectilePower(), createReplayProjectileState(), pushReplayTrailPoint(), ReplayProjectileState, ReplayStoneState, runFixedStepSimulation(), SimulatedReplayObject, simulateReplayProjectile() (+3 more)

### Community 49 - "Replay Visual State"
Cohesion: 0.26
Nodes (11): ReplayFrameSnapshot, ReplaySnapshotEntity, ReplayVisualPlayer, normalizeReplayBackgroundId(), REPLAY_BACKGROUND_TEXTURES, resolveActiveReplayBackground(), resolveActiveReplaySide(), resolveReplayPlayer() (+3 more)

### Community 50 - "Curl Sheet Rendering"
Cohesion: 0.24
Nodes (10): CURL_SHEET, drawHorizontalSheet(), drawHouseRings(), drawIceSheet(), drawVerticalSheet(), HOUSE_COLORS, RectArenaDef, rectArenaPlayableToScreenInRect() (+2 more)

### Community 52 - "Launchable Remap"
Cohesion: 0.29
Nodes (10): assertValidFrame(), frameFromOvalArena(), frameFromRectArena(), OvalArenaLike, RectArenaLike, remapLaunchable(), remapLaunchables(), RemappedLaunchable (+2 more)

### Community 56 - "Sweep Controller"
Cohesion: 0.20
Nodes (3): NOTE: stone param is accepted but not used internally — the controller only, SweepController, TrailPoint

### Community 57 - "Card Reveal Overlay"
Cohesion: 0.24
Nodes (4): PackPull, dropTagLabel(), RARITY_ACCENT, RARITY_GLYPH

### Community 59 - "End Modal UI"
Cohesion: 0.39
Nodes (7): addModalButton(), GameEndModalAction, GameEndModalOptions, GameEndModalPlayer, showGameEndModal(), OnlineRematchOptions, showOnlineRematchEndModal()

### Community 60 - "Friend Filtering"
Cohesion: 0.29
Nodes (6): filterFriends(), HasSearchableName, alice, bob, carol, Friend

### Community 61 - "Profile Card Cache"
Cohesion: 0.32
Nodes (3): CacheEntry, createProfileCardCache(), ProfileCardCache

### Community 62 - "Preload Hooks"
Cohesion: 0.46
Nodes (3): preloadOvalArenaSkin(), preloadPowerUpAssets(), preloadIngamePlayerTexture()

### Community 63 - "Replay Entities"
Cohesion: 0.43
Nodes (6): buildReplayProjectileEntities(), buildReplayStoneEntities(), ReplayStoneSnapshot, replayBallToEntity(), replayStoneToEntity(), TRANSLUCENT_POWERS

### Community 66 - "Notification Dedup"
Cohesion: 0.43
Nodes (5): HasNotificationShape, notificationIdsFrom(), prependNotificationDeduped(), removeNotificationsFrom(), Notif

### Community 67 - "Replay Player Metadata"
Cohesion: 0.57
Nodes (4): buildCommonLocalReplayParticipantContext(), buildCommonLocalReplayPlayers(), LocalReplayRegistry, buildLocalReplayPlayers()

### Community 70 - "Profile Card UI"
Cohesion: 0.47
Nodes (4): ProfileCard(), ProfileCardProps, ProfileCardUser, baseUser

### Community 71 - "Player Labels"
Cohesion: 0.60
Nodes (5): compactHudName(), hudPlayerLabel(), localPlayerDisplayName(), playerDisplayName(), PlayerLabelUser

### Community 72 - "Frontend HTML Entry"
Cohesion: 0.50
Nodes (5): Frontend Index HTML Document, Application Favicon PNG, Root Mount Element, Shell Smash Page Title, Frontend Main TypeScript Module

### Community 73 - "Hub Backgrounds"
Cohesion: 0.60
Nodes (4): hubBackgroundClass(), hubBackgroundPreset, normalizeHubBackgroundId(), resolveHubBackgroundId()

### Community 74 - "Background Drawing"
Cohesion: 0.67
Nodes (3): drawBackground(), drawBlossomTree(), PETAL_COLOURS

## Knowledge Gaps
- **280 isolated node(s):** `name`, `version`, `description`, `dev`, `build` (+275 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **15 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `api` connect `Auth Route UI` to `Casino Animation Tests`, `Dice Game Mechanics`, `Work In Progress UI`, `Card Binder Filters`, `Hub API Client`, `Phaser Hub Scenes`, `Bell Clash Config`, `Shell Curl Config`, `Bamboo UI Assets`, `Casino Fairness Games`, `Board Animation Canvas`, `Plinko Drop Path`, `Auth OAuth UI`, `Shrine Slots UI`?**
  _High betweenness centrality (0.064) - this node is a cross-community bridge._
- **Why does `BambooBashScene` connect `Bamboo Bash Scene` to `Kame Knock Scene`, `Replay Trail Runtime`, `Collectible Descriptors`, `Responsive Scene`, `Slingshot Runtime`, `Phaser Hub Scenes`, `Power Picker UI`, `Score HUD`, `Game Info Panel`, `Bamboo UI Assets`, `Common Scene Host`, `Side Panel UI`, `Preload Hooks`?**
  _High betweenness centrality (0.059) - this node is a cross-community bridge._
- **Why does `ShellCurlScene` connect `Shell Curl Scene` to `Collectible Descriptors`, `Phaser Hub Scenes`, `Bell Clash Config`, `Shell Curl Config`, `Common Scene Host`, `Bamboo Mechanics`, `Curling Power Runtime`, `Slingshot Runtime`, `Game Rule Hooks`, `Score HUD`, `Power Picker UI`, `Curling Bumpers`, `Game Info Panel`, `Curling Online Flow`, `Curl Sheet Rendering`, `Side Panel UI`, `Curling Turn Flow`, `Curling Stone Rendering`, `Sweep Controller`, `Preload Hooks`, `Curling Runtime Tests`, `Turn Manager`, `Curling Scoring`, `Responsive Scene`?**
  _High betweenness centrality (0.058) - this node is a cross-community bridge._
- **Are the 9 inferred relationships involving `PowerType` (e.g. with `.buildFullInventory()` and `.create()`) actually correct?**
  _`PowerType` has 9 INFERRED edges - model-reasoned connections that need verification._
- **What connects `name`, `version`, `description` to the rest of the system?**
  _281 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Bamboo Bash Scene` be split into smaller, more focused modules?**
  _Cohesion score 0.05254378648874062 - nodes in this community are weakly interconnected._
- **Should `Kame Knock Scene` be split into smaller, more focused modules?**
  _Cohesion score 0.05271059216013344 - nodes in this community are weakly interconnected._