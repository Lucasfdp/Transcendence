# Graph Report - .  (2026-07-06)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 1121 nodes · 2644 edges · 40 communities (22 shown, 18 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `936d85e4`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- [[_COMMUNITY_KameKnockScene|KameKnockScene]]
- [[_COMMUNITY_BellClashScene|BellClashScene]]
- [[_COMMUNITY_KameKnockScene.ts|KameKnockScene.ts]]
- [[_COMMUNITY_ShellCurlScene|ShellCurlScene]]
- [[_COMMUNITY_ScoreHud|ScoreHud]]
- [[_COMMUNITY_ReplayScene|ReplayScene]]
- [[_COMMUNITY_ReplayScene.ts|ReplayScene.ts]]
- [[_COMMUNITY_kame-knock.engine.ts|kame-knock.engine.ts]]
- [[_COMMUNITY_ReplayController|ReplayController]]
- [[_COMMUNITY_ShellCurlScene.ts|ShellCurlScene.ts]]
- [[_COMMUNITY_power-system.ts|power-system.ts]]
- [[_COMMUNITY_arena-power-runtime.ts|arena-power-runtime.ts]]
- [[_COMMUNITY_physics.ts|physics.ts]]
- [[_COMMUNITY_BambooBashScene|BambooBashScene]]
- [[_COMMUNITY_.update|.update]]
- [[_COMMUNITY_localReplay.ts|localReplay.ts]]
- [[_COMMUNITY_BambooBashEngine|BambooBashEngine]]
- [[_COMMUNITY_stone.ts|stone.ts]]
- [[_COMMUNITY_PowerType|PowerType]]
- [[_COMMUNITY_player-renderer.ts|player-renderer.ts]]
- [[_COMMUNITY_PowerPickupManager|PowerPickupManager]]
- [[_COMMUNITY_BellClashEngine|BellClashEngine]]
- [[_COMMUNITY_KameKnockEngine|KameKnockEngine]]
- [[_COMMUNITY_ShellCurlEngine|ShellCurlEngine]]
- [[_COMMUNITY_SceneReplayRecorder|SceneReplayRecorder]]
- [[_COMMUNITY_rect-arena.ts|rect-arena.ts]]
- [[_COMMUNITY_bamboo.ts|bamboo.ts]]
- [[_COMMUNITY_PowerPicker|PowerPicker]]
- [[_COMMUNITY_BaseArenaEngine|BaseArenaEngine]]
- [[_COMMUNITY_timed-targets.ts|timed-targets.ts]]
- [[_COMMUNITY_GameEngine|GameEngine]]
- [[_COMMUNITY_PowerPicker.ts|PowerPicker.ts]]
- [[_COMMUNITY_Slingshot|Slingshot]]
- [[_COMMUNITY_SweepController|SweepController]]
- [[_COMMUNITY_GameEngineCreateContext|GameEngineCreateContext]]
- [[_COMMUNITY_player-config.ts|player-config.ts]]
- [[_COMMUNITY_PowerRegistry|PowerRegistry]]

## God Nodes (most connected - your core abstractions)
1. `BambooBashScene` - 104 edges
2. `BellClashScene` - 98 edges
3. `KameKnockScene` - 98 edges
4. `ShellCurlScene` - 86 edges
5. `ReplayScene` - 41 edges
6. `BambooBashEngine` - 23 edges
7. `BellClashEngine` - 19 edges
8. `KameKnockEngine` - 19 edges
9. `SceneReplayRecorder` - 18 edges
10. `ShellCurlEngine` - 18 edges

## Surprising Connections (you probably didn't know these)
- `ArenaPowerBallEntry` --references--> `BallState`  [EXTRACTED]
  arena-power-runtime.ts → ball.ts
- `drawArenaPowerBalls()` --calls--> `drawShellBall()`  [EXTRACTED]
  arena-power-runtime.ts → ball.ts
- `ReplayProjectileState` --references--> `PowerType`  [EXTRACTED]
  physics.ts → power-system.ts
- `ReplayStoneState` --references--> `PowerType`  [EXTRACTED]
  physics.ts → power-system.ts
- `PowerPickup` --references--> `PowerType`  [EXTRACTED]
  power-pickups.ts → power-system.ts

## Import Cycles
- None detected.

## Communities (40 total, 18 thin omitted)

### Community 2 - "KameKnockScene.ts"
Cohesion: 0.05
Nodes (85): BALL_TRAIL_OPTIONS, BAMBOO_ASSETS, BAMBOO_TEXTURES, GameStateDelta, LocalParticipant, OnlineBallState, BALL_TRAIL_OPTIONS, FALLBACK_POWERS (+77 more)

### Community 4 - "ScoreHud"
Cohesion: 0.05
Nodes (30): addModalButton(), GameEndModalAction, GameEndModalOptions, GameEndModalPlayer, showGameEndModal(), mechanics::home_marcos_programming_transgender_frontend_src_services_network_gamesocket_gamesnapshot, mechanics::home_marcos_programming_transgender_frontend_src_services_network_gamesocket_getgamesocket, mechanics::home_marcos_programming_transgender_frontend_src_services_network_gamesocket_ts (+22 more)

### Community 5 - "ReplayScene"
Cohesion: 0.07
Nodes (14): interpolateArenaTrail(), interpolateNormalizedTrail(), interpolatePoints(), isLegacyReplayFrame(), normalizeReplayBalls(), normalizeReplayStones(), parsePowerType(), ReplayScene (+6 more)

### Community 6 - "ReplayScene.ts"
Cohesion: 0.04
Nodes (46): games::home_marcos_programming_transgender_frontend_src_services_network_gamesocket_bamboobashsnapshot, games::home_marcos_programming_transgender_frontend_src_services_network_gamesocket_bellclashsnapshot, games::home_marcos_programming_transgender_frontend_src_services_network_gamesocket_curlingsnapshot, games::home_marcos_programming_transgender_frontend_src_services_network_gamesocket_kameknocksnapshot, games::home_marcos_programming_transgender_frontend_src_shared_arenas_arena01_arena_01, games::home_marcos_programming_transgender_frontend_src_shared_arenas_arena01_ts, games::home_marcos_programming_transgender_frontend_src_shared_arenas_arena_arenapixels, games::home_marcos_programming_transgender_frontend_src_shared_arenas_arena_layoutovalarenaskin (+38 more)

### Community 7 - "kame-knock.engine.ts"
Cohesion: 0.10
Nodes (34): ALLOWED_POWERS, POWER_POOL, STAGE_POINTS, ArenaReplaySnapshot, BellZoneKind, engines::home_marcos_programming_transgender_backend_src_modules_matchmaking_entities_match_entity_matchmode, engines::home_marcos_programming_transgender_backend_src_modules_matchmaking_entities_match_entity_ts, engines::home_marcos_programming_transgender_backend_src_modules_matchmaking_game_map_createshellcurlmap (+26 more)

### Community 8 - "ReplayController"
Cohesion: 0.09
Nodes (25): games::home_marcos_programming_transgender_frontend_src_features_hub_api_replaydetail, games::home_marcos_programming_transgender_frontend_src_features_hub_api_replayevent, games::home_marcos_programming_transgender_frontend_src_features_hub_api_replayframe, games::home_marcos_programming_transgender_frontend_src_features_hub_api_replayframesnapshot, games::home_marcos_programming_transgender_frontend_src_features_hub_api_replaysnapshotentity, games::home_marcos_programming_transgender_frontend_src_features_hub_api_replayvisualplayer, games::ref_vitest, clamp01() (+17 more)

### Community 9 - "ShellCurlScene.ts"
Cohesion: 0.05
Nodes (37): games::home_marcos_programming_transgender_frontend_src_services_network_gamesocket_curlingthrowevent, games::home_marcos_programming_transgender_frontend_src_shared_game_info_game_info_panel_details, games::home_marcos_programming_transgender_frontend_src_shared_game_info_ts, games::home_marcos_programming_transgender_frontend_src_shared_mechanics_game_end_modal_ts, games::home_marcos_programming_transgender_frontend_src_shared_mechanics_game_powers_game_powers, games::home_marcos_programming_transgender_frontend_src_shared_mechanics_hud_ts, games::home_marcos_programming_transgender_frontend_src_shared_mechanics_online_rematch_showonlinerematchendmodal, games::home_marcos_programming_transgender_frontend_src_shared_mechanics_online_rematch_ts (+29 more)

### Community 10 - "power-system.ts"
Cohesion: 0.05
Nodes (36): BOMB_DEF, BOOMERANG_DEF, BoomerangStone, BoomerangStoneState, BOUNCER_DEF, FREEZE_DEF, FrozenStone, GameEffectHook (+28 more)

### Community 11 - "arena-power-runtime.ts"
Cohesion: 0.14
Nodes (26): applyArenaBallPowerCycle(), ArenaPowerBallEntry, clearArenaPowerBallTextures(), resolveArenaPowerBallCollisions(), arena, updateArenaPowerBalls(), BallState, drawShellBall() (+18 more)

### Community 12 - "physics.ts"
Cohesion: 0.10
Nodes (23): mechanics::home_marcos_programming_transgender_frontend_src_shared_mechanics_ball_ball_friction_base, mechanics::home_marcos_programming_transgender_frontend_src_shared_mechanics_ball_ball_src_r, mechanics::home_marcos_programming_transgender_frontend_src_shared_mechanics_power_system_giant_radius_factor, mechanics::home_marcos_programming_transgender_frontend_src_shared_mechanics_power_system_heavy_speed_factor, mechanics::home_marcos_programming_transgender_frontend_src_shared_mechanics_power_system_rocket_speed_factor, mechanics::home_marcos_programming_transgender_frontend_src_shared_mechanics_power_system_spinning_curl_bias, mechanics::home_marcos_programming_transgender_frontend_src_shared_mechanics_power_system_tiny_radius_factor, mechanics::home_marcos_programming_transgender_frontend_src_shared_mechanics_stone_bounce_damp (+15 more)

### Community 15 - "localReplay.ts"
Cohesion: 0.12
Nodes (22): games::home_marcos_programming_transgender_frontend_src_features_hub_api_replayimportrequest, games::home_marcos_programming_transgender_frontend_src_features_hub_api_ts, games::home_marcos_programming_transgender_frontend_src_services_network_gamesocket_ballsnapshotdata, games::home_marcos_programming_transgender_frontend_src_services_network_gamesocket_replayframesnapshotentity, games::home_marcos_programming_transgender_frontend_src_services_network_gamesocket_snapshotplayer, games::home_marcos_programming_transgender_frontend_src_services_network_gamesocket_ts, buildLocalReplayImportRequest(), buildLocalReplayPlayers() (+14 more)

### Community 18 - "stone.ts"
Cohesion: 0.16
Nodes (9): mechanics::home_marcos_programming_transgender_frontend_src_shared_mechanics_power_system_friction_slick, mechanics::home_marcos_programming_transgender_frontend_src_shared_mechanics_power_system_heavy_mass_ratio, PowerDef, RectArenaPixels, StoneState, TEAM_COLOUR, TEAM_DARK, NOTE: stone param is accepted but not used internally — the controller only (+1 more)

### Community 19 - "PowerType"
Cohesion: 0.15
Nodes (12): ALL_SPECIAL_POWERS, GAME_POWERS, GameId, POWER_UP_ASSETS, POWER_UP_TEXTURES, ReplayProjectileState, ReplayStoneState, PowerPickup (+4 more)

### Community 21 - "player-renderer.ts"
Cohesion: 0.20
Nodes (14): drawArenaPowerBalls(), mechanics::home_marcos_programming_transgender_frontend_src_shared_assets_ingame_player_asset, mechanics::home_marcos_programming_transgender_frontend_src_shared_assets_resolveshellskinasset, mechanics::home_marcos_programming_transgender_frontend_src_shared_assets_shell_skin_assets, mechanics::home_marcos_programming_transgender_frontend_src_shared_assets_ts, drawIngamePlayerTexture(), drawIngameShellTexture(), getOrCreatePlayerImage() (+6 more)

### Community 28 - "rect-arena.ts"
Cohesion: 0.23
Nodes (9): drawHorizontalSheet(), drawHouseRings(), drawIceSheet(), drawVerticalSheet(), HOUSE_COLORS, RectArenaDef, rectArenaPlayableToScreenInRect(), rectArenaToScreen() (+1 more)

### Community 29 - "bamboo.ts"
Cohesion: 0.21
Nodes (10): bambooRadius(), drawBamboo(), drawCane(), hitsBamboo(), randomSpot(), STAGE_POINTS, stageForAge(), stepBamboo() (+2 more)

### Community 32 - "timed-targets.ts"
Cohesion: 0.29
Nodes (7): hitsTimedTarget(), targetHitAccuracy(), TimedTarget, TimedTargetKind, timedTargetPosition(), timedTargetRadius(), TimedTargetSpot

### Community 33 - "GameEngine"
Cohesion: 0.25
Nodes (3): GameEngine, GameEngineRegistry, Injectable

### Community 34 - "PowerPicker.ts"
Cohesion: 0.22
Nodes (8): games::home_marcos_programming_transgender_frontend_src_shared_mechanics_power_system_powerregistry, games::home_marcos_programming_transgender_frontend_src_shared_mechanics_power_system_powertype, games::home_marcos_programming_transgender_frontend_src_shared_mechanics_power_system_ts, games::home_marcos_programming_transgender_frontend_src_shared_theme_theme, games::home_marcos_programming_transgender_frontend_src_shared_theme_ts, games::ref_phaser, POWER_DESC, TokenRecord

## Knowledge Gaps
- **116 isolated node(s):** `GameStateDelta`, `OnlineBallState`, `BAMBOO_TEXTURES`, `BAMBOO_ASSETS`, `BALL_TRAIL_OPTIONS` (+111 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **18 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `BellClashScene` connect `BellClashScene` to `KameKnockScene.ts`?**
  _High betweenness centrality (0.119) - this node is a cross-community bridge._
- **Why does `ShellCurlScene` connect `ShellCurlScene` to `ShellCurlScene.ts`?**
  _High betweenness centrality (0.098) - this node is a cross-community bridge._
- **Why does `BambooBashScene` connect `BambooBashScene` to `KameKnockScene.ts`, `.update`, `.startOnlineRound`, `.isLocalVersus`, `.create`, `bamboo.ts`?**
  _High betweenness centrality (0.095) - this node is a cross-community bridge._
- **What connects `GameStateDelta`, `OnlineBallState`, `BAMBOO_TEXTURES` to the rest of the system?**
  _117 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `KameKnockScene` be split into smaller, more focused modules?**
  _Cohesion score 0.05772005772005772 - nodes in this community are weakly interconnected._
- **Should `BellClashScene` be split into smaller, more focused modules?**
  _Cohesion score 0.059120555438670314 - nodes in this community are weakly interconnected._
- **Should `KameKnockScene.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.04754440961337513 - nodes in this community are weakly interconnected._