/**
 * hidpi.ts — crisp, responsive (reflow) rendering for the Phaser canvas.
 *
 * The problem
 * -----------
 * Phaser's `Scale.RESIZE` mode sizes the canvas *backing store* to the parent in
 * **CSS pixels**, never multiplying by `window.devicePixelRatio`. On a HiDPI
 * display — or whenever the browser is zoomed (zoom raises the effective dpr) —
 * each CSS pixel spans several physical pixels, so the browser upscales the
 * low-res backing store and everything looks blurry.
 *
 * The approach (crisp + responsive reflow)
 * ----------------------------------------
 *   • logical size   = cssPx                  → what scenes lay out against
 *   • backing store  = cssPx × currentDPR     → native resolution, always crisp
 *
 * `baseDPR` is the display's native devicePixelRatio captured once at load;
 * `currentDPR` tracks live zoom. We LEAVE the logical gameSize at the CSS-px
 * viewport size (Phaser's RESIZE value — we don't override it), so scenes reflow
 * with the browser viewport, symmetrically in BOTH zoom directions: zoom in
 * shrinks the CSS viewport → scenes relayout "smaller" → the camera magnifies
 * them back to fill the screen → things look bigger; zoom out is the mirror
 * image. Nothing ever crops, because the logical world always *exactly* fits the
 * backing.
 *
 * Phaser ties the world coordinate space to the backing store. We bridge the
 * logical→backing gap with the camera zoom = `currentDPR`, which maps the cssPx
 * world exactly onto the cssPx × currentDPR backing. The backing always matches
 * the physical pixels, so it stays sharp. On a standard 1× display with no zoom,
 * currentDPR === 1 and every step here is an identity no-op.
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

// Every Text created through the (patched) factory, so we can refresh their
// render resolution when the zoom changes. Entries remove themselves on destroy.
const trackedTexts = new Set<Phaser.GameObjects.Text>();

// The scene reflows with browser zoom and the camera bridges the logical world
// onto the physical backing (zoom = currentDPR), so text scales along with
// everything else automatically — we must NOT also setScale it. But text
// rasterises to a texture at `resolution`, so unlike vector graphics it won't be
// crisp at its on-screen size unless we raise the resolution to match. Bump it to
// currentDPR. A no-op when not zoomed (currentDPR === baseDPR).
function applyTextResolution(t: Phaser.GameObjects.Text): void {
  t.setResolution(currentDPR);
}

export function installHiDPI(game: Phaser.Game): void {
  baseDPR = clampDPR(window.devicePixelRatio);
  currentDPR = baseDPR;

  // Sharpen every Text the moment it's created (so text made while already zoomed
  // is crisp immediately), then track it for future zoom changes. Patching the
  // factory catches every `this.add.text(...)`, including dynamic popups. No-op
  // when not zoomed.
  const factoryProto = Phaser.GameObjects.GameObjectFactory.prototype as unknown as {
    text: (...args: unknown[]) => Phaser.GameObjects.Text;
    __hidpiPatched?: boolean;
  };
  if (!factoryProto.__hidpiPatched) {
    const originalText = factoryProto.text;
    factoryProto.text = function (this: unknown, ...args: unknown[]): Phaser.GameObjects.Text {
      const t = originalText.apply(this, args);
      applyTextResolution(t);
      trackedTexts.add(t);
      t.once(Phaser.GameObjects.Events.DESTROY, () => trackedTexts.delete(t));
      return t;
    };
    factoryProto.__hidpiPatched = true;
  }

  const applyCamera = (cam: Phaser.Cameras.Scene2D.Camera): void => {
    // Bridge the logical world (gameSize = CSS px) onto the physical backing.
    // Camera zoom = currentDPR maps the cssPx-wide world EXACTLY onto the
    // cssPx × currentDPR backing — a perfect fit, so nothing ever crops in either
    // zoom direction. The scroll offset anchors that mapping at the top-left for
    // BOTH the render transform and Camera.worldView (Phaser derives worldView
    // from the camera centre regardless of origin, so changing the origin would
    // desync them — and desync hit-testing). Identity no-op at dpr 1 / no zoom.
    const bw = game.scale.baseSize.width;
    const bh = game.scale.baseSize.height;
    cam.setSize(bw, bh);
    cam.setZoom(currentDPR);
    cam.setScroll((bw / 2) * (1 / currentDPR - 1), (bh / 2) * (1 / currentDPR - 1));
  };

  const apply = (): void => {
    currentDPR = clampDPR(window.devicePixelRatio);

    // Phaser (RESIZE) just set gameSize to the parent's CSS-px size. We LEAVE it
    // there — that CSS-px size is exactly what we want scenes to lay out against,
    // so they reflow with the browser viewport (and thus with zoom) in both
    // directions. We only override the backing store below.
    const cssW = game.scale.gameSize.width;
    const cssH = game.scale.gameSize.height;

    const bw = Math.max(1, Math.round(cssW * currentDPR));        // backing = physical px
    const bh = Math.max(1, Math.round(cssH * currentDPR));

    // Backing store at native resolution → crisp. (gameSize / canvas *display*
    // size stay in CSS px.)
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
    // canvasBounds.width; bw/cssW === currentDPR; a no-op at dpr 1.)
    game.scale.displayScale.set(bw / cssW, bh / cssH);

    // Refresh every live text's render resolution for the new zoom level so it
    // stays crisp under the magnified camera.
    for (const t of trackedTexts) applyTextResolution(t);

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
