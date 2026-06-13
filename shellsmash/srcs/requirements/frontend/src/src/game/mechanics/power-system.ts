/**
 * game/mechanics/power-system.ts — power-up definitions for Shell Smash minigames.
 *
 * Games import PowerType, PowerDef, PowerRegistry, and ALL_POWERS.
 * Each game opts into only the powers it wants to offer via PowerRegistry.
 * This file has zero imports from any specific minigame directory.
 */

import type { StoneState } from './stone';
import type { RectArenaPixels } from './rect-arena';

// ── Power enum ────────────────────────────────────────────────────────────────

export enum PowerType {
  NONE     = 'none',
  HEAVY    = 'heavy',
  BOMB     = 'bomb',
  SPLITTER = 'splitter',
  GHOST    = 'ghost',
  MAGNET   = 'magnet',
  SPINNING = 'spinning',
  BOUNCER  = 'bouncer',
  SHIELD   = 'shield',
  FREEZE   = 'freeze',
  SLICK    = 'slick',
}

// ── Power definition interface ────────────────────────────────────────────────

export interface PowerDef {
  readonly type: PowerType;
  readonly label: string;
  readonly accentColour: number;
  readonly description: string;
  /** Mutate stone properties immediately on launch. */
  onApply(stone: StoneState, arena: RectArenaPixels): void;
  /** Called every frame while stone is moving (optional). */
  onUpdate?(stone: StoneState, deltaMs: number, arena: RectArenaPixels): void;
  /** Called on stone-stone collision (optional). */
  onCollide?(stone: StoneState, other: StoneState, arena: RectArenaPixels): void;
  /** Called when the stone comes to rest (optional). */
  onStop?(stone: StoneState, arena: RectArenaPixels, allStones: StoneState[]): void;
}

// ── Physics constants used by powers ──────────────────────────────────────────

/** Near-frictionless multiplier for SLICK (per-frame at 60 fps). */
export const FRICTION_SLICK       = 0.9998;
/** HEAVY stone radius scale factor. */
export const HEAVY_RADIUS_FACTOR  = 1.40;
/** Mass ratio applied to collision impulse for HEAVY stones. */
export const HEAVY_MASS_RATIO     = 2.5;
/** SPINNING curl bias (≈5× default CURL_BIAS). */
export const SPINNING_CURL_BIAS   = 0.22;
/** Explosion push radius in source px — scale by arena.scale at runtime. */
export const BOMB_RADIUS_SRC      = 160;
/** Radial velocity impulse from BOMB in source px/s. */
export const BOMB_IMPULSE_SRC     = 380;
/** Range within which MAGNET attracts in source px. */
export const MAGNET_RANGE_SRC     = 220;
/** Attraction velocity for MAGNET in source px/s. */
export const MAGNET_PULL_SRC      = 55;
/** SPLITTER child stone radius factor. */
export const SPLITTER_RADIUS      = 0.65;
/** Spread angle (radians) for SPLITTER child stones. */
export const SPLITTER_SPREAD      = Math.PI / 12; // 15°

// ── Power implementations ─────────────────────────────────────────────────────

const NONE_DEF: PowerDef = {
  type: PowerType.NONE,
  label: 'No Power',
  accentColour: 0x888888,
  description: 'Standard stone — no special ability.',
  onApply() { /* nothing */ },
};

const HEAVY_DEF: PowerDef = {
  type: PowerType.HEAVY,
  label: 'Heavy Shell',
  accentColour: 0x886633,
  description: 'Larger, harder to deflect. Slower curl.',
  onApply(stone) {
    stone.r         *= HEAVY_RADIUS_FACTOR;
    stone.curlBias  *= 0.4; // harder to drift
  },
};

const BOMB_DEF: PowerDef = {
  type: PowerType.BOMB,
  label: 'Bomb Shell',
  accentColour: 0xff6600,
  description: 'Explodes on rest — pushes all nearby stones outward.',
  onApply() { /* nothing at launch */ },
  onStop(stone, arena, allStones) {
    const blastR = BOMB_RADIUS_SRC * arena.scale;
    const impulse = BOMB_IMPULSE_SRC * arena.scale;
    for (const other of allStones) {
      if (other.id === stone.id) continue;
      const dx = other.x - stone.x;
      const dy = other.y - stone.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < blastR && dist > 0.001) {
        const nx = dx / dist;
        const ny = dy / dist;
        const falloff = 1 - dist / blastR;
        other.vx += nx * impulse * falloff;
        other.vy += ny * impulse * falloff;
        other.stopped = false;
      }
    }
    // TODO(#audio): scene.sound.play('bomb-explode')
  },
};

const SPLITTER_DEF: PowerDef = {
  type: PowerType.SPLITTER,
  label: 'Splitter',
  accentColour: 0xffee00,
  description: 'Splits into 3 smaller stones on first collision.',
  onApply() { /* nothing at launch */ },
  // Actual split logic is handled in ShellCurlScene which can create new stones.
  // The flag is read by the scene; see stone.splitterPending.
  onCollide(stone) {
    if (!(stone as SplittableStone).hasSplit) {
      (stone as SplittableStone).hasSplit = true;
      (stone as SplittableStone).splitterPending = true;
    }
  },
};

const GHOST_DEF: PowerDef = {
  type: PowerType.GHOST,
  label: 'Ghost Shell',
  accentColour: 0xaaddff,
  description: 'Passes through the first stone it hits.',
  onApply() { /* nothing at launch */ },
  onCollide(stone) {
    if (!(stone as GhostStone).ghostUsed) {
      (stone as GhostStone).ghostUsed = true;
      // TODO(#ghost-visual): brief translucent overlay on pass-through
    }
  },
};

const MAGNET_DEF: PowerDef = {
  type: PowerType.MAGNET,
  label: 'Magnet Shell',
  accentColour: 0xff44cc,
  description: 'Pulls nearby stones toward it when it stops.',
  onApply() { /* nothing at launch */ },
  onStop(stone, arena, allStones) {
    const range = MAGNET_RANGE_SRC * arena.scale;
    const pull  = MAGNET_PULL_SRC  * arena.scale;
    for (const other of allStones) {
      if (other.id === stone.id || other.stopped) continue;
      const dx = stone.x - other.x;
      const dy = stone.y - other.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < range && dist > 0.001) {
        const nx = dx / dist;
        const ny = dy / dist;
        other.vx += nx * pull;
        other.vy += ny * pull;
        other.stopped = false;
      }
    }
    // TODO(#magnet-visual): dotted line overlay for 1.5 s
  },
};

const SPINNING_DEF: PowerDef = {
  type: PowerType.SPINNING,
  label: 'Spinning Shell',
  accentColour: 0x44ffcc,
  description: 'Extreme curl — arcs dramatically across the sheet.',
  onApply(stone) {
    stone.curlBias = SPINNING_CURL_BIAS;
    // TODO(#spinning-trail): add particle emitter (ice-blue spiral)
  },
};

const BOUNCER_DEF: PowerDef = {
  type: PowerType.BOUNCER,
  label: 'Bouncer Shell',
  accentColour: 0xff8800,
  description: 'Bounces off side-walls without losing speed.',
  onApply() { /* BOUNCE_DAMP bypass is checked in stepStone via stone.power */ },
};

const SHIELD_DEF: PowerDef = {
  type: PowerType.SHIELD,
  label: 'Shield Shell',
  accentColour: 0x44cc44,
  description: 'Cannot be pushed out of the scoring house once it lands.',
  onApply() { /* guard checked in stepStone */ },
  onUpdate(stone, _delta, arena) {
    const dx = stone.x - arena.houseBottomCX;
    const dy = stone.y - arena.houseBottomCY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const outerR = arena.houseRadii[0];
    if (dist > outerR && stone.stopped) {
      // Clamp back to house edge
      const nx = dx / dist;
      const ny = dy / dist;
      stone.x  = arena.houseBottomCX + nx * outerR;
      stone.y  = arena.houseBottomCY + ny * outerR;
      stone.vx = 0;
      stone.vy = 0;
    }
  },
};

const FREEZE_DEF: PowerDef = {
  type: PowerType.FREEZE,
  label: 'Freeze Shell',
  accentColour: 0x88ccff,
  description: 'Freezes the first enemy stone it touches for the rest of the end.',
  onApply() { /* nothing at launch */ },
  onCollide(_stone, other) {
    other.vx = 0;
    other.vy = 0;
    other.stopped = true;
    (other as FrozenStone).frozen = true;
  },
};

const SLICK_DEF: PowerDef = {
  type: PowerType.SLICK,
  label: 'Slick Shell',
  accentColour: 0xccffee,
  description: 'Near-zero friction — travels much farther than normal.',
  onApply(stone) {
    (stone as SlickStone).frictionOverride = FRICTION_SLICK;
  },
};

// ── Registry ──────────────────────────────────────────────────────────────────

/** Map of all built-in power definitions. */
export const ALL_POWERS: Record<PowerType, PowerDef> = {
  [PowerType.NONE]:     NONE_DEF,
  [PowerType.HEAVY]:    HEAVY_DEF,
  [PowerType.BOMB]:     BOMB_DEF,
  [PowerType.SPLITTER]: SPLITTER_DEF,
  [PowerType.GHOST]:    GHOST_DEF,
  [PowerType.MAGNET]:   MAGNET_DEF,
  [PowerType.SPINNING]: SPINNING_DEF,
  [PowerType.BOUNCER]:  BOUNCER_DEF,
  [PowerType.SHIELD]:   SHIELD_DEF,
  [PowerType.FREEZE]:   FREEZE_DEF,
  [PowerType.SLICK]:    SLICK_DEF,
};

/**
 * Games instantiate their own registry and register only the powers they want
 * to expose to players. Other games can reuse the same power definitions.
 */
export class PowerRegistry {
  private readonly defs = new Map<PowerType, PowerDef>();

  register(def: PowerDef): this {
    this.defs.set(def.type, def);
    return this;
  }

  get(type: PowerType): PowerDef {
    const def = this.defs.get(type) ?? ALL_POWERS[PowerType.NONE];
    return def;
  }

  available(): PowerDef[] {
    return [...this.defs.values()];
  }
}

// ── Extended stone interfaces (flags added by powers) ─────────────────────────
// These are structural extensions to StoneState used internally by power logic.

interface SplittableStone {
  hasSplit: boolean;
  splitterPending: boolean;
}

interface GhostStone {
  ghostUsed: boolean;
}

interface FrozenStone {
  frozen: boolean;
}

interface SlickStone {
  frictionOverride: number;
}
