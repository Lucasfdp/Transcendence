/**
 * Registry Framework (SPEC-025, Phase 1).
 *
 * Single generic implementation for every Tournament content registry
 * (boards, tiles, dice, items, ...). Specialized registries are created by
 * instantiating `Registry<T>` with their definition type — never by
 * reimplementing this class (SPEC-025 acceptance criteria).
 *
 * Design decisions:
 * - Error style: invalid operations (duplicate id, blank id, definition
 *   rejected by the validator) THROW. There is no error-result variant;
 *   registration happens at boot and a failed registration must abort the
 *   load (SPEC-024: an invalid configuration never loads).
 * - Immutability: definitions are deep-frozen on register. Callers always
 *   receive read-only objects (SPEC-025: no system ever gets a mutable
 *   reference).
 * - Missing ids: `get` returns `undefined`. Whether that is a warning or a
 *   hard error is the caller's decision (SPEC-025 "Casos límite").
 *
 * This class contains no gameplay logic and never modifies definitions.
 */

/** A problem found by `Registry.validate()` on a registered definition. */
export interface RegistryIssue {
	/** Id of the offending definition. */
	id: string;
	/** Human-readable description of the problem. */
	message: string;
}

/**
 * Per-registry definition validator. Returns a list of error messages;
 * an empty list means the definition is valid.
 */
export type DefinitionValidator<T> = (definition: T) => string[];

/** Recursively freezes an object graph (plain objects and arrays). */
const deepFreeze = <V>(value: V): V => {
	if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
		Object.freeze(value);
		for (const child of Object.values(value)) deepFreeze(child);
	}
	return value;
};

export class Registry<T extends { id: string }> {
	private readonly definitions = new Map<string, T>();

	constructor(
		private readonly name: string,
		private readonly validateDefinition?: DefinitionValidator<T>,
	) {}

	/**
	 * Registers a definition. Throws on blank id, duplicate id, or when the
	 * registry's validator rejects the definition (nothing is registered in
	 * those cases). The definition is deep-frozen from this point on.
	 */
	register(definition: T): void {
		if (!definition.id || definition.id.trim() === "")
			throw new Error(`[${this.name}] cannot register a definition with a blank id`);
		if (this.definitions.has(definition.id))
			throw new Error(`[${this.name}] duplicate definition id "${definition.id}"`);

		const errors = this.validateDefinition?.(definition) ?? [];
		if (errors.length > 0)
			throw new Error(
				`[${this.name}] invalid definition "${definition.id}": ${errors.join("; ")}`,
			);

		this.definitions.set(definition.id, deepFreeze(definition));
	}

	/** Removes a definition. Returns whether it existed. */
	unregister(id: string): boolean {
		return this.definitions.delete(id);
	}

	/** Read-only definition, or `undefined` when the id is unknown. */
	get(id: string): Readonly<T> | undefined {
		return this.definitions.get(id);
	}

	exists(id: string): boolean {
		return this.definitions.has(id);
	}

	/** Snapshot of every registered definition (each one frozen). */
	getAll(): readonly Readonly<T>[] {
		return [...this.definitions.values()];
	}

	/**
	 * Re-runs the registry's validator over every registered definition and
	 * returns the collected issues (empty list = all valid). Useful for
	 * cross-reference checks after all catalogs have been registered.
	 */
	validate(): RegistryIssue[] {
		if (!this.validateDefinition) return [];
		const issues: RegistryIssue[] = [];
		for (const definition of this.definitions.values())
			for (const message of this.validateDefinition(definition))
				issues.push({ id: definition.id, message });
		return issues;
	}

	clear(): void {
		this.definitions.clear();
	}
}
