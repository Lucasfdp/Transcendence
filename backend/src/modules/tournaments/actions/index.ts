/**
 * index.ts — public surface of the Action Engine module (SPEC-008).
 *
 * The architect wires this into the Runtime later; this barrel is the single
 * import point for the engine, the contracts, the registry/factory and the
 * base actions/conditions.
 */

export * from "./action.interface";
export * from "./action-engine";
export * from "./action-registry";
export * from "./base-actions";
export * from "./base-conditions";
