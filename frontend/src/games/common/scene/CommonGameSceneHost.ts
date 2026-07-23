import type Phaser from "phaser";
import type { GameDescriptor } from "../descriptors/GameDescriptor";

export interface CommonSceneRuntime {
	readonly id: string;
	update?(time: number, delta: number): void;
	relayout?(): void;
	shutdown?(): void;
}

export interface CommonGameSceneLifecycle {
	readonly update?: (time: number, delta: number) => void;
	readonly relayout?: () => void;
	readonly shutdown?: () => void;
}

export interface CommonGameSceneHostOptions extends CommonGameSceneLifecycle {
	readonly descriptor: GameDescriptor;
}

export class CommonGameSceneHost {
	private readonly runtimes = new Map<string, CommonSceneRuntime>();
	private hasShutdown = false;

	constructor(
		readonly scene: Phaser.Scene,
		readonly options: CommonGameSceneHostOptions,
	) {}

	get descriptor(): GameDescriptor {
		return this.options.descriptor;
	}

	registerRuntime(runtime: CommonSceneRuntime): void {
		if (this.runtimes.has(runtime.id))
			throw new Error(`Runtime already registered: ${runtime.id}`);
		this.runtimes.set(runtime.id, runtime);
	}

	getRuntime<T extends CommonSceneRuntime>(id: string): T | undefined {
		return this.runtimes.get(id) as T | undefined;
	}

	activate(): void {
		this.hasShutdown = false;
	}

	update(time: number, delta: number): void {
		if (this.hasShutdown) return;
		this.options.update?.(time, delta);
		if (this.runtimes.size === 0) return;
		for (const runtime of this.runtimes.values())
			runtime.update?.(time, delta);
	}

	relayout(): void {
		if (this.hasShutdown) return;
		this.options.relayout?.();
		for (const runtime of this.runtimes.values()) runtime.relayout?.();
	}

	shutdown(): void {
		if (this.hasShutdown) return;
		this.hasShutdown = true;
		for (const runtime of [...this.runtimes.values()].reverse())
			runtime.shutdown?.();
		this.runtimes.clear();
		this.options.shutdown?.();
	}
}
