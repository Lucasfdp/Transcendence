/**
 * hidpi.ts — crisp, zoom-stable rendering for the Phaser canvas.
 *
 * The problem
 * -----------
 * Phaser's `Scale.RESIZE` mode sizes the canvas *backing store* to the parent in
 * **CSS pixels**, never multiplying by `window.devicePixelRatio`. On a HiDPI
 * display — or whenever the browser is zoomed (zoom raises the effective dpr) —
 * each CSS pixel spans several physical pixels, so the browser upscales the
 * low-res backing store and everything looks blurry.
 *
 * The approach (crisp + zoom-stable)
 * ----------------------------------
 * Two independent quantities, both derived from the parent's CSS-px size:
 *
 *   • backing store  = cssPx × currentDPR        → native resolution, always crisp
 *   • logical size   = backing / baseDPR         → what scenes lay out against
 *
 * `baseDPR` is the display's native devicePixelRatio captured once at load (the
 * unzoomed density). `currentDPR` tracks live zoom. Because browser zoom shrinks
 * the CSS viewport in exact proportion to how it raises the dpr, `cssPx ×
 * currentDPR` (hence the logical size) stays ~constant as you zoom — so the
 * scenes never reflow and nothing moves. The backing store, meanwhile, always
 * matches the physical pixels, so it stays sharp.
 *
 * Phaser ties the world coordinate space to the backing store, so we bridge the
 * logical→backing gap (factor `baseDPR`) with a fixed camera zoom. That zoom is
 * CONSTANT (it depends only on the display, not on browser zoom), so it never
 * causes movement while zooming. On a standard 1× display baseDPR === 1, the
 * camera zoom is 1, and every step here is an identity no-op.
 *
 * Wired up by a single `installHiDPI(game)` call in main.ts; scenes need no
 * changes. The canvas *display* size is owned by CSS (see index.html); we only
 * ever set the backing-store resolution here.
 */

import Phaser from 'phaser';

// Cap the backing multiplier so extreme zoom doesn't allocate huge buffers.
const MAX_DPR = 3;

let baseDPR = 1;     // display's native dpr at load (zoom-independent)
let currentDPR = 1;  // live dpr (rises with browser zoom)

function clampDPR(v: number): number {
  return Math.max(1, Math.min(v || 1, MAX_DPR));
}

export function installHiDPI(game: Phaser.Game): void {
  baseDPR = clampDPR(window.devicePixelRatio);
  currentDPR = baseDPR;

  // Render Text at baseDPR resolution so it stays sharp under the (constant)
  // camera zoom. No-op when baseDPR === 1. Patching the factory catches every
  // `this.add.text(...)`, including dynamic popups.
  const factoryProto = Phaser.GameObjects.GameObjectFactory.prototype as unknown as {
    text: (...args: unknown[]) => Phaser.GameObjects.Text;
    __hidpiPatched?: boolean;
  };
  if (!factoryProto.__hidpiPatched) {
    const originalText = factoryProto.text;
    factoryProto.text = function (this: unknown, ...args: unknown[]): Phaser.GameObjects.Text {
      const t = originalText.apply(this, args);
      t.setResolution(baseDPR);
      return t;
    };
    factoryProto.__hidpiPatched = true;
  }

  const applyCamera = (cam: Phaser.Cameras.Scene2D.Camera): void => {
    // Map the logical world (size = baseSize / baseDPR) onto the physical backing
    // store. Keep the default centred origin and offset scroll so the zoom is
    // anchored top-left for BOTH the render transform and Camera.worldView
    // (Phaser derives worldView from the camera centre regardless of origin, so
    // changing the origin would desync them). All a no-op when baseDPR === 1.
    const bw = game.scale.baseSize.width;
    const bh = game.scale.baseSize.height;
    cam.setSize(bw, bh);
    cam.setZoom(baseDPR);
    cam.setScroll((bw / 2) * (1 / baseDPR - 1), (bh / 2) * (1 / baseDPR - 1));
  };

  const apply = (): void => {
    currentDPR = clampDPR(window.devicePixelRatio);

    // Phaser (RESIZE) just set gameSize to the parent's CSS-px size.
    const cssW = game.scale.gameSize.width;
    const cssH = game.scale.gameSize.height;

    const bw = Math.max(1, Math.round(cssW * currentDPR));        // backing = physical px
    const bh = Math.max(1, Math.round(cssH * currentDPR));
    const gw = Math.max(1, Math.round(bw / baseDPR));             // logical (zoom-stable)
    const gh = Math.max(1, Math.round(bh / baseDPR));

    // Logical size scenes lay out against — constant across zoom → no reflow.
    game.scale.gameSize.setSize(gw, gh);
    // Backing store at native resolution → crisp. (Canvas *display* size is CSS.)
    game.scale.baseSize.setSize(bw, bh);

    const canvas = game.canvas;
    if (canvas.width !== bw || canvas.height !== bh) {
      canvas.width = bw;
      canvas.height = bh;
    }

    game.renderer.resize(bw, bh);

    // Keep the ScaleManager's pointer transform in sync with our overridden
    // baseSize. Phaser computes displayScale = baseSize / canvasBounds in its own
    // resize pass, but that runs BEFORE we swap in the physical baseSize here, so
    // it's left at the unzoomed ratio (1). transformX/Y use displayScale to map
    // DOM pointer coords into backing-store space; left stale, the pointer only
    // spans the top-left 1/currentDPR of the canvas, so input hit areas drift away
    // from the rendered objects as you zoom in. Recompute it against the physical
    // backing so hit areas track the visuals. (cssW is the CSS-px canvas width =
    // canvasBounds.width; bw/cssW === currentDPR/baseDPR; a no-op at dpr 1.)
    game.scale.displayScale.set(bw / cssW, bh / cssH);

    for (const scene of game.scene.getScenes(true)) {
      if (scene.cameras?.main) applyCamera(scene.cameras.main);
    }
  };

  // Registered before Phaser's own renderer/camera resize handlers (added later
  // during async boot) so they observe our physical `baseSize`.
  game.scale.on(Phaser.Scale.Events.RESIZE, apply);

  // Re-apply the camera whenever a scene is (re)created/woken — fresh scenes boot
  // a default camera at zoom 1.
  game.events.once(Phaser.Core.Events.READY, () => {
    apply();
    for (const scene of game.scene.scenes) {
      scene.sys.events.on(Phaser.Scenes.Events.CREATE, () => {
        if (scene.cameras?.main) applyCamera(scene.cameras.main);
      });
      scene.sys.events.on(Phaser.Scenes.Events.WAKE, () => {
        if (scene.cameras?.main) applyCamera(scene.cameras.main);
      });
    }
  });
}
