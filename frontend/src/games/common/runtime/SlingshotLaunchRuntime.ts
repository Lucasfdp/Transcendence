import type Phaser from "phaser";
import { Slingshot } from "../../../shared/mechanics/slingshot";
import type { LaunchableState } from "./LaunchRuntime";

export interface SlingshotLaunchRuntimeOptions<TLaunchable extends LaunchableState> {
	readonly scene: Phaser.Scene;
	readonly getLaunchable: () => TLaunchable;
	readonly getScale: () => number;
	readonly maxDragSrc: number;
	readonly launchSpeedSrc: number;
	readonly grabRadiusFactor?: number;
	readonly depth?: number;
	readonly onLaunch: (vx: number, vy: number) => void;
}

export class SlingshotLaunchRuntime<TLaunchable extends LaunchableState> {
	private slingshot: Slingshot | null = null;

	constructor(
		private readonly options: SlingshotLaunchRuntimeOptions<TLaunchable>,
	) {}

	recreate(): void {
		this.destroy();
		const scale = this.options.getScale();
		this.slingshot = new Slingshot(
			this.options.scene,
			this.options.getLaunchable(),
			{
				maxDrag: this.options.maxDragSrc * scale,
				launchSpeed: this.options.launchSpeedSrc * scale,
				grabRadiusFactor: this.options.grabRadiusFactor,
				depth: this.options.depth,
			},
			this.options.onLaunch,
		);
	}

	attach(): void {
		this.ensureSlingshot().attach();
	}

	cancel(): void {
		this.slingshot?.cancel();
	}

	syncScale(): void {
		const slingshot = this.ensureSlingshot();
		const scale = this.options.getScale();
		slingshot.maxDrag = this.options.maxDragSrc * scale;
		slingshot.launchSpeed = this.options.launchSpeedSrc * scale;
	}

	destroy(): void {
		this.slingshot?.destroy();
		this.slingshot = null;
	}

	private ensureSlingshot(): Slingshot {
		if (!this.slingshot) this.recreate();
		return this.slingshot;
	}
}
