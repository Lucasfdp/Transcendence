import { describe, expect, it } from "vitest";

import { WorldEntityStore } from "../runtime/worldEntityStore";

interface TestEntity {
	id: string;
	kind: "ball" | "stone";
	x: number;
	y: number;
	vx: number;
	vy: number;
}

describe("WorldEntityStore", () => {
	it("upserts, replaces, and reads entities by id", () => {
		const store = new WorldEntityStore<TestEntity>();

		store.upsert({
			id: "entity-1",
			kind: "ball",
			x: 10,
			y: 20,
			vx: 1,
			vy: 2,
		});
		store.upsert({
			id: "entity-1",
			kind: "stone",
			x: 30,
			y: 40,
			vx: 3,
			vy: 4,
		});

		expect(store.size).toBe(1);
		expect(store.get("entity-1")).toEqual({
			id: "entity-1",
			kind: "stone",
			x: 30,
			y: 40,
			vx: 3,
			vy: 4,
		});
	});

	it("removes and clears entities", () => {
		const store = new WorldEntityStore<TestEntity>();
		store.upsert({ id: "a", kind: "ball", x: 0, y: 0, vx: 0, vy: 0 });
		store.upsert({ id: "b", kind: "stone", x: 1, y: 1, vx: 1, vy: 1 });

		expect(store.remove("a")).toBe(true);
		expect(store.remove("missing")).toBe(false);
		expect(store.has("a")).toBe(false);
		expect(store.size).toBe(1);

		store.clear();

		expect(store.size).toBe(0);
		expect(store.serialise()).toEqual([]);
	});

	it("serialises entities in insertion order", () => {
		const store = new WorldEntityStore<TestEntity>();
		store.upsert({ id: "a", kind: "ball", x: 0, y: 0, vx: 0, vy: 0 });
		store.upsert({ id: "b", kind: "stone", x: 1, y: 1, vx: 1, vy: 1 });

		expect(store.serialise().map((entity) => entity.id)).toEqual(["a", "b"]);
	});

	it("returns shallow copies so callers cannot mutate stored state directly", () => {
		const store = new WorldEntityStore<TestEntity>();
		const entity: TestEntity = {
			id: "a",
			kind: "ball",
			x: 0,
			y: 0,
			vx: 0,
			vy: 0,
		};

		const inserted = store.upsert(entity);
		const listed = store.list();

		inserted.x = 100;
		listed[0].x = 200;

		expect(store.get("a")?.x).toBe(0);
	});
});
