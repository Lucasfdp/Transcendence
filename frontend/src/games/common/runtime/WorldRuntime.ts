export interface WorldEntitySnapshot {
	readonly id: string | number;
	readonly type: string;
	readonly x?: number;
	readonly y?: number;
	readonly [key: string]: unknown;
}

type WorldEntityId = string | number;

export class WorldRuntime<TEntity> {
	private readonly entities: TEntity[] = [];

	constructor(private readonly getId?: (entity: TEntity) => WorldEntityId) {}

	get size(): number {
		return this.entities.length;
	}

	all(): TEntity[] {
		return this.entities;
	}

	keys(): readonly WorldEntityId[] {
		return this.entities.map((entity) => this.resolveId(entity));
	}

	get(id: WorldEntityId): TEntity | undefined {
		return this.entities.find((entity) => this.resolveId(entity) === id);
	}

	set(entity: TEntity): void {
		const id = this.resolveId(entity);
		const index = this.entities.findIndex(
			(candidate) => this.resolveId(candidate) === id,
		);
		if (index >= 0) this.entities[index] = entity;
		else this.entities.push(entity);
	}

	replace(entities: readonly TEntity[]): void {
		this.clear();
		this.entities.push(...entities);
	}

	remove(id: WorldEntityId): boolean {
		const index = this.entities.findIndex(
			(entity) => this.resolveId(entity) === id,
		);
		if (index < 0) return false;
		this.entities.splice(index, 1);
		return true;
	}

	filter(predicate: (entity: TEntity) => boolean): readonly TEntity[] {
		for (let index = this.entities.length - 1; index >= 0; index--) {
			if (!predicate(this.entities[index])) this.entities.splice(index, 1);
		}
		return this.entities;
	}

	clear(): void {
		this.entities.length = 0;
	}

	serialise<TSnapshot = TEntity>(
		mapper: (entity: TEntity) => TSnapshot = (entity) =>
			({ ...entity }) as TSnapshot,
	): TSnapshot[] {
		return this.all().map((entity) => mapper(entity));
	}

	private resolveId(entity: TEntity): WorldEntityId {
		if (this.getId) return this.getId(entity);
		const maybeEntity = entity as Partial<WorldEntitySnapshot>;
		if (
			typeof maybeEntity.id === "string" ||
			typeof maybeEntity.id === "number"
		)
			return maybeEntity.id;
		throw new Error("World entity does not expose an id.");
	}
}

export class WorldMapRuntime<TKey, TEntity> {
	private readonly entitiesByKey = new Map<TKey, TEntity>();

	get size(): number {
		return this.entitiesByKey.size;
	}

	map(): Map<TKey, TEntity> {
		return this.entitiesByKey;
	}

	get(key: TKey): TEntity | undefined {
		return this.entitiesByKey.get(key);
	}

	set(key: TKey, entity: TEntity): void {
		this.entitiesByKey.set(key, entity);
	}

	replace(entities: ReadonlyMap<TKey, TEntity>): void {
		this.entitiesByKey.clear();
		for (const [key, entity] of entities) this.entitiesByKey.set(key, entity);
	}

	clear(): void {
		this.entitiesByKey.clear();
	}

	serialise<TSnapshot = TEntity>(
		mapper: (key: TKey, entity: TEntity) => TSnapshot,
	): TSnapshot[] {
		return [...this.entitiesByKey.entries()].map(([key, entity]) =>
			mapper(key, entity),
		);
	}
}
