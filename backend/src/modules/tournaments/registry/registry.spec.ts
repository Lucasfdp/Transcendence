import { Registry } from "./registry";

interface TestDefinition {
	id: string;
	label: string;
	nested: { values: number[] };
}

const definition = (id: string, label = "label"): TestDefinition => ({
	id,
	label,
	nested: { values: [1, 2, 3] },
});

describe("Registry", () => {
	let registry: Registry<TestDefinition>;

	beforeEach(() => {
		registry = new Registry<TestDefinition>("TestRegistry");
	});

	describe("register / get / exists", () => {
		it("registers a definition and resolves it by id", () => {
			registry.register(definition("item_a"));

			expect(registry.exists("item_a")).toBe(true);
			expect(registry.get("item_a")?.label).toBe("label");
		});

		it("returns undefined for an unknown id", () => {
			expect(registry.get("missing")).toBeUndefined();
			expect(registry.exists("missing")).toBe(false);
		});

		it("rejects duplicate ids and keeps the original definition", () => {
			registry.register(definition("item_a", "original"));

			expect(() => registry.register(definition("item_a", "copy"))).toThrow(
				/duplicate definition id "item_a"/,
			);
			expect(registry.get("item_a")?.label).toBe("original");
		});

		it("rejects blank ids", () => {
			expect(() => registry.register(definition("  "))).toThrow(/blank id/);
			expect(registry.getAll()).toHaveLength(0);
		});
	});

	describe("immutability", () => {
		it("deep-freezes registered definitions", () => {
			registry.register(definition("item_a"));
			const stored = registry.get("item_a")!;

			expect(Object.isFrozen(stored)).toBe(true);
			expect(Object.isFrozen(stored.nested)).toBe(true);
			expect(Object.isFrozen(stored.nested.values)).toBe(true);
			expect(() => {
				(stored as { label: string }).label = "mutated";
			}).toThrow(TypeError);
			expect(() => stored.nested.values.push(4)).toThrow(TypeError);
		});
	});

	describe("getAll", () => {
		it("returns every registered definition", () => {
			registry.register(definition("item_a"));
			registry.register(definition("item_b"));

			expect(registry.getAll().map((d) => d.id)).toEqual([
				"item_a",
				"item_b",
			]);
		});
	});

	describe("unregister / clear", () => {
		it("unregister removes a definition and reports whether it existed", () => {
			registry.register(definition("item_a"));

			expect(registry.unregister("item_a")).toBe(true);
			expect(registry.unregister("item_a")).toBe(false);
			expect(registry.exists("item_a")).toBe(false);
		});

		it("clear removes every definition", () => {
			registry.register(definition("item_a"));
			registry.register(definition("item_b"));

			registry.clear();

			expect(registry.getAll()).toHaveLength(0);
		});
	});

	describe("definition validation", () => {
		const requireLabel = (def: TestDefinition): string[] =>
			def.label ? [] : ["label must not be empty"];

		it("rejects definitions the validator flags, without registering them", () => {
			const validated = new Registry<TestDefinition>(
				"TestRegistry",
				requireLabel,
			);

			expect(() => validated.register(definition("item_a", ""))).toThrow(
				/invalid definition "item_a": label must not be empty/,
			);
			expect(validated.exists("item_a")).toBe(false);
		});

		it("validate() re-checks all definitions and collects issues", () => {
			let strict = false;
			const validated = new Registry<TestDefinition>(
				"TestRegistry",
				(def) => (strict && def.label !== "kept" ? ["stale label"] : []),
			);
			validated.register(definition("item_a", "kept"));
			validated.register(definition("item_b", "other"));

			expect(validated.validate()).toEqual([]);

			strict = true;
			expect(validated.validate()).toEqual([
				{ id: "item_b", message: "stale label" },
			]);
		});

		it("validate() returns no issues when the registry has no validator", () => {
			registry.register(definition("item_a"));

			expect(registry.validate()).toEqual([]);
		});
	});
});
