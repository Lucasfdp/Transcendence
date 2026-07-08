export interface WorldEntity {
	readonly id: string;
}

export class WorldEntityStore<T extends WorldEntity> {
	private readonly entities = new Map<string, T>();

	get size(): number {
		return this.entities.size;
	}

	has(id: string): boolean {
		return this.entities.has(id);
	}

	get(id: string): T | undefined {
		const entity = this.entities.get(id);
		return entity ? this.clone(entity) : undefined;
	}

	list(): T[] {
		return [...this.entities.values()].map((entity) => this.clone(entity));
	}

	upsert(entity: T): T {
		this.entities.set(entity.id, this.clone(entity));
		return this.clone(entity);
	}

	remove(id: string): boolean {
		return this.entities.delete(id);
	}

	clear(): void {
		this.entities.clear();
	}

	serialise(): T[] {
		return this.list();
	}

	private clone(entity: T): T {
		return { ...entity };
	}
}
