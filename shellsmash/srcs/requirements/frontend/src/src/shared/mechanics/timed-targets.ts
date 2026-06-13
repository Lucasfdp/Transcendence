import { ArenaPixels } from '../arenas/arena';

export type TimedTargetKind = 'daruma' | 'crate' | 'drum';

export interface TimedTarget {
  readonly id: number;
  readonly kind: TimedTargetKind;
  readonly breakable: boolean;
  nx: number;
  ny: number;
  ageMs: number;
  lifetimeMs: number;
  radiusSrc: number;
  points: number;
}

export interface TimedTargetSpot {
  readonly nx: number;
  readonly ny: number;
}

const MAX_RADIUS = 0.78;
const CLEAR_OF_CENTRE = 0.24;
const MIN_TARGET_SEPARATION = 0.15;
const SPAWN_ATTEMPTS = 32;

export function stepTimedTargets(targets: TimedTarget[], deltaMs: number): TimedTarget[] {
  for (const target of targets) {
    target.ageMs += deltaMs;
  }

  return targets.filter((target) => target.ageMs < target.lifetimeMs);
}

export function randomTimedTargetSpot(existing: readonly TimedTarget[]): TimedTargetSpot | null {
  for (let attempt = 0; attempt < SPAWN_ATTEMPTS; attempt++) {
    const radius = Math.sqrt(Math.random()) * MAX_RADIUS;
    const theta = Math.random() * Math.PI * 2;
    const nx = Math.cos(theta) * radius;
    const ny = Math.sin(theta) * radius;

    if (Math.hypot(nx, ny) < CLEAR_OF_CENTRE) continue;
    if (existing.some((target) => Math.hypot(target.nx - nx, target.ny - ny) < MIN_TARGET_SEPARATION)) continue;

    return { nx, ny };
  }

  return null;
}

export function timedTargetPosition(target: TimedTarget, arena: ArenaPixels): { x: number; y: number } {
  return {
    x: arena.cx + target.nx * arena.rx,
    y: arena.cy + target.ny * arena.ry,
  };
}

export function timedTargetRadius(target: TimedTarget, arena: ArenaPixels): number {
  return target.radiusSrc * arena.scale;
}

export function hitsTimedTarget(
  target: TimedTarget,
  arena: ArenaPixels,
  cx: number,
  cy: number,
  cr: number,
): boolean {
  const pos = timedTargetPosition(target, arena);
  const dx = pos.x - cx;
  const dy = pos.y - cy;
  const reach = cr + timedTargetRadius(target, arena);
  return dx * dx + dy * dy <= reach * reach;
}

export function targetHitAccuracy(
  target: TimedTarget,
  arena: ArenaPixels,
  cx: number,
  cy: number,
): number {
  const pos = timedTargetPosition(target, arena);
  const radius = Math.max(1, timedTargetRadius(target, arena));
  return Math.hypot(pos.x - cx, pos.y - cy) / radius;
}
