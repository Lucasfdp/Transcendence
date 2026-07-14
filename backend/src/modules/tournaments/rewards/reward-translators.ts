/**
 * reward-translators.ts — the CONFIG-OVER-CODE translation map (SPEC-013
 * "Integración con Action Engine": "El Reward Resolver no implementa
 * comportamiento. Solo traduce.").
 *
 * One pure `RewardTranslator` per supported `RewardType` maps `type + payload`
 * to the `ActionConfig[]` that the ONE Action Engine will run. Translators have
 * NO side effects and NEVER execute anything — they only build config. The
 * TARGET action `type` strings are the ones registered by `base-actions.ts`
 * (note: NO `Action` suffix — `awardPoints`, `activateRule`, `composite`, …).
 *
 * FORWARD SEAMS — some target actions are not registered yet. Per SPEC-008
 * "Casos límite" (unknown action type → factory returns null → skipped), a
 * config for an unregistered action resolves/skips cleanly today and becomes
 * real when the owning system lands and the architect narrows the port:
 *   - `grantItem`     (item)    → Inventory grant (SPEC-014, narrowed at F2).
 *   - `unlockKeyItem` (keyItem) → Key Item Progression (SPEC-017, not built).
 *   - `grantShell`    (shell)   → Shell state system (not built).
 * These strings are RESERVED here; the concrete Actions are NOT invented in
 * this wave.
 *
 * Condition propagation (SPEC-013 "Validación": Condiciones cumplidas): a
 * Reward's own `conditions` are attached to EVERY generated leaf `ActionConfig`
 * (see `translateReward` / `applyRewardConditions`) so the EXISTING Action
 * Engine gating enforces them — there is never a second condition path.
 */

import { ActionConfig, ConditionConfig } from "../actions/action.interface";
import {
	Reward,
	RewardTranslator,
	RewardTranslatorMap,
	RewardType,
	isReward,
} from "./reward.types";

// ── Payload readers ─────────────────────────────────────────────────────────

const readNumber = (
	payload: Readonly<Record<string, unknown>>,
	key: string,
): number | undefined => {
	const value = payload[key];
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
};

const readString = (
	payload: Readonly<Record<string, unknown>>,
	key: string,
): string | undefined => {
	const value = payload[key];
	return typeof value === "string" && value.length > 0 ? value : undefined;
};

// ── Per-type translators (SPEC-013 "Tipos soportados") ──────────────────────

/**
 * PointsReward → a single `awardPoints` Action (SPEC-013 "PointsReward").
 * `amount` is required: a payload with no numeric `amount` yields ZERO configs,
 * which the Resolver turns into a `no_actions` rejection (nothing to award).
 * `reason`/`source` default sensibly (SPEC-008 base-actions read the same keys).
 */
const translatePoints: RewardTranslator = (reward) => {
	const payload = reward.payload ?? {};
	const amount = readNumber(payload, "amount");
	if (amount === undefined) {
		return [];
	}
	return [
		{
			type: "awardPoints",
			parameters: {
				amount,
				reason: readString(payload, "reason") ?? "reward:points",
				source: readString(payload, "source") ?? "future",
			},
		},
	];
};

/**
 * RuleReward → a single `activateRule` Action (SPEC-013 "RuleReward"). The whole
 * payload is forwarded as the action's parameters (the `activateRule` Action
 * reads `ruleId` and any rule params from there).
 */
const translateRule: RewardTranslator = (reward) => [
	{ type: "activateRule", parameters: { ...(reward.payload ?? {}) } },
];

/**
 * ItemReward → a single `grantItem` Action (SPEC-013 "ItemReward"). FORWARD
 * SEAM: `grantItem` is not registered yet, so it resolves/skips cleanly today
 * (SPEC-008: unknown type → skipped) and becomes real when the Inventory port is
 * narrowed at F2. The Resolver never grants the item itself — it only translates.
 */
const translateItem: RewardTranslator = (reward) => [
	{ type: "grantItem", parameters: { itemId: readString(reward.payload ?? {}, "itemId") } },
];

/**
 * KeyItemReward → `unlockKeyItem` (SPEC-013 "KeyItemReward": always unlocks the
 * NEXT locked Key Item per SPEC-017 order, never one chosen by the emitter — so
 * NO target is put in parameters). FORWARD SEAM: SPEC-017 does not exist yet;
 * reserved, resolves/skips cleanly today.
 */
const translateKeyItem: RewardTranslator = () => [
	{ type: "unlockKeyItem", parameters: {} },
];

/**
 * ShellReward → `grantShell` (SPEC-013 "ShellReward": the Shell as match state).
 * FORWARD SEAM: the Shell state system does not exist yet; reserved, resolves/
 * skips cleanly today.
 */
const translateShell: RewardTranslator = () => [
	{ type: "grantShell", parameters: {} },
];

/**
 * FutureReward → an explicit no-op (SPEC-013 "FutureReward"). Zero configs here
 * is a LEGITIMATE resolved no-op, NOT a rejection (the Resolver special-cases
 * `future` so an empty translation is never `no_actions`).
 */
const translateFuture: RewardTranslator = () => [];

/**
 * CompositeReward → FLATTEN (SPEC-013 "Composite Reward"): translate each child
 * Reward in `payload.rewards` and concatenate. Child conditions are applied by
 * the recursive `translateReward`; malformed children are silently skipped here
 * (translators are pure — the Resolver owns the "Registrar advertencia" warning,
 * SPEC-013 "Reward parcialmente inválida"). This translator backs NESTED
 * composites; the top-level composite is fanned out by the Resolver so it can
 * emit CompositeRewardStarted/Finished and count the resolved children.
 */
const makeCompositeTranslator =
	(translators: RewardTranslatorMap): RewardTranslator =>
	(reward) => {
		const configs: ActionConfig[] = [];
		for (const child of readCompositeChildren(reward)) {
			if (isReward(child)) {
				configs.push(...translateReward(child, translators));
			}
		}
		return configs;
	};

// ── Shared helpers used by both translators and the Resolver ────────────────

/**
 * The child Rewards of a composite (SPEC-013 "Composite Reward":
 * `payload.rewards`). Returns the raw array as `unknown[]` (each entry is
 * validated with `isReward` by the caller); an absent/malformed `rewards` is an
 * empty list.
 */
export const readCompositeChildren = (reward: Reward): readonly unknown[] => {
	const rewards = (reward.payload as { rewards?: unknown } | undefined)?.rewards;
	return Array.isArray(rewards) ? rewards : [];
};

/**
 * Attaches `conditions` onto every config's `conditions` field (SPEC-013
 * "Validación"): the existing Action Engine gating then enforces them. Merges
 * with any conditions already on a config (AND semantics — all must pass);
 * returns a fresh array (never mutates the inputs).
 */
export const applyRewardConditions = (
	configs: readonly ActionConfig[],
	conditions: readonly ConditionConfig[] | undefined,
): ActionConfig[] => {
	if (!conditions || conditions.length === 0) {
		return [...configs];
	}
	return configs.map((config) => ({
		...config,
		conditions: [...(config.conditions ?? []), ...conditions],
	}));
};

/**
 * Translates one Reward into its `ActionConfig[]` (SPEC-013 "Resolve"), applying
 * the Reward's own `conditions` to every generated leaf config. Pure and
 * side-effect free. An unknown type yields zero configs (the Resolver's Validate
 * stage rejects unknown types before this is reached for the top-level Reward).
 */
export const translateReward = (
	reward: Reward,
	translators: RewardTranslatorMap,
): ActionConfig[] => {
	const translator = translators[reward.type];
	if (!translator) {
		return [];
	}
	return applyRewardConditions(translator(reward), reward.conditions);
};

// ── Factory ─────────────────────────────────────────────────────────────────

/**
 * Builds the default translation map — one translator per `RewardType`
 * (SPEC-013 "Todo mediante configuración"). The `composite` translator closes
 * over the map so nested composites recurse through the same translators.
 */
export const createRewardTranslators = (): RewardTranslatorMap => {
	const map = {
		points: translatePoints,
		item: translateItem,
		rule: translateRule,
		keyItem: translateKeyItem,
		shell: translateShell,
		future: translateFuture,
	} as Record<RewardType, RewardTranslator>;
	map.composite = makeCompositeTranslator(map);
	return map;
};
