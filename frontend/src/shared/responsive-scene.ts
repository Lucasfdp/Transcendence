/**
 * shared/responsive-scene.ts — a Phaser.Scene base that relayouts on resize.
 *
 * WHY THIS EXISTS
 * ---------------
 * Phaser's ScaleManager resizes the canvas and camera on a viewport/zoom change,
 * but it NEVER moves your GameObjects — they keep the absolute coordinates you
 * gave them at create() time. So a scene only reflows if it subscribes to the
 * 'resize' event and recomputes its own layout. Phaser also does NOT auto-call a
 * scene's `shutdown()` method, so any listener you add (like that resize one)
 * leaks across scene visits unless you remove it on SHUTDOWN yourself.
 *
 * Every scene used to hand-roll both of these (and one — ShellPickerScene —
 * forgot the resize half, and several leaked the listener). This base wires both
 * correctly, once, so a scene only has to say HOW to lay itself out.
 *
 * USAGE
 * -----
 *   export class MyScene extends ResponsiveScene {
 *     create() {
 *       this.buildLayout();       // one-time setup + initial layout
 *       this.enableResponsive();  // start relayout()-on-resize — call LAST
 *     }
 *     protected relayout(): void { this.buildLayout(); }  // re-run from this.scale.*
 *     protected onShutdown(): void { ...optional teardown... }
 *   }
 *
 * - `relayout()` runs on every resize (with a scene-active guard); it never runs
 *   for the initial build — do that yourself in create() before enableResponsive().
 * - `onShutdown()` runs once on SHUTDOWN; override it to destroy resources
 *   (the resize listener is removed for you). Default is a no-op.
 * - Set `resizeDebounceMs > 0` to coalesce bursts of resize events.
 */

import Phaser from "phaser";

export abstract class ResponsiveScene extends Phaser.Scene {
	/** Override (>0) to debounce relayout() against bursts of resize events. */
	protected resizeDebounceMs = 0;

	private _resizeTimer: ReturnType<typeof setTimeout> | null = null;
	private _responsiveOn = false;

	/**
	 * Recompute the scene's layout from the current `this.scale.width/height`.
	 * Called on every resize — NOT on the initial build (do that in create()).
	 */
	protected abstract relayout(): void;

	/**
	 * Teardown hook, called once on scene SHUTDOWN (Phaser does not auto-call
	 * shutdown()). Override to destroy resources; the resize listener is already
	 * removed for you. Default: no-op.
	 */
	protected onShutdown(): void {}

	/** Begin relayout-on-resize. Call once, AFTER the initial layout is built. */
	protected enableResponsive(): void {
		if (this._responsiveOn) return;
		this._responsiveOn = true;
		this.scale.on(Phaser.Scale.Events.RESIZE, this._onResizeEvent, this);
		this.events.once(Phaser.Scenes.Events.SHUTDOWN, this._teardown, this);
	}

	private _onResizeEvent(): void {
		if (this.resizeDebounceMs <= 0) {
			this._runRelayout();
			return;
		}
		if (this._resizeTimer !== null) clearTimeout(this._resizeTimer);
		this._resizeTimer = setTimeout(() => {
			this._resizeTimer = null;
			this._runRelayout();
		}, this.resizeDebounceMs);
	}

	private _runRelayout(): void {
		// A debounce timer (or a late event) can fire after shutdown — guard the
		// dead scene rather than relayout into destroyed objects.
		if (!this.scene.isActive()) return;
		this.relayout();
	}

	private _teardown(): void {
		if (this._resizeTimer !== null) {
			clearTimeout(this._resizeTimer);
			this._resizeTimer = null;
		}
		this.scale.off(Phaser.Scale.Events.RESIZE, this._onResizeEvent, this);
		this._responsiveOn = false;
		this.onShutdown();
	}
}
