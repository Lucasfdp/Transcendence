# Trail Rendering Optimisation Plan

## Context

Advanced trail cosmetics are currently kept as data and player-facing choices, but their extra in-match visual rendering is disabled. Matches still draw the base classic trail line, while values such as `trail_comet`, `trail_spark`, `trail_ghost`, and `trail_ripple` remain valid for inventories, selections, snapshots, and replays.

This avoids removing a cosmetic feature from the product model while reducing the amount of per-frame `Graphics` drawing before the broader vector-rendering Tier 0 and Tier 1 work is completed.

## Current Temporary Behaviour

- `frontend/src/shared/mechanics/player-trails.ts` records trail effect identifiers as before.
- All trails render through the classic line path during gameplay.
- The advanced glow, spark, ghost, and ripple overlays are not drawn.
- No backend, cosmetic catalogue, replay, or selection contract is changed.

## Future Implementation

When there is time to reintroduce advanced trail visuals, implement them with texture-based rendering rather than re-stroking complex vector paths every frame.

Recommended order:

1. Add a small procedural texture cache for trail stamps keyed by colour, size, and effect family.
2. Create one `RenderTexture` per trail layer in each game scene.
3. Stamp new trail points into the `RenderTexture` when points are recorded, instead of clearing and redrawing the whole trail history every frame.
4. Reintroduce `trail_classic` first using circular or soft-line stamps.
5. Reintroduce `trail_comet`, `trail_spark`, `trail_ghost`, and `trail_ripple` one by one, measuring frame time after each effect.
6. Keep the current classic line renderer as a fallback for missing textures or unsupported render paths.

## Verification Targets

- Bamboo Bash should be profiled before and after advanced trails are re-enabled.
- Resize and replay flows must keep trails aligned with the arena.
- Online snapshots must continue to accept all existing trail effect identifiers.
- Cosmetic selection must not require a migration.
