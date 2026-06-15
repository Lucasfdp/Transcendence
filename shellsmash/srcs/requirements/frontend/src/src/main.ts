import Phaser from 'phaser';
import { installHiDPI } from './shared/hidpi';
import { LandingScene } from './hub/LandingScene';
import { HubScene } from './hub/HubScene';
import { ShellPickerScene } from './hub/ShellPickerScene';
import { BambooBashScene } from './games/bamboo-bash/BambooBashScene';
import { ShellCurlScene } from './games/shell-curl/ShellCurlScene';
import { KameKnockScene } from './games/kame-knock/KameKnockScene';
import { BellClashScene } from './games/bell-clash/BellClashScene';

// NOTE: AuthCallbackScene is superseded by cookie-based auth — the backend now
// sets an httpOnly cookie and redirects to "/" directly. See auth.controller.ts.

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  width: window.innerWidth,
  height: window.innerHeight,
  backgroundColor: '#0d1117',
  parent: 'game',
  // LandingScene is always the boot scene.
  // It detects an existing session and transitions to HubScene automatically.
  scene: [LandingScene, HubScene, ShellPickerScene, BambooBashScene, ShellCurlScene, KameKnockScene, BellClashScene],
  scale: {
    mode: Phaser.Scale.RESIZE,
    // No autoCenter: the canvas fills its (viewport-pinned) host via CSS, so
    // Phaser must not also apply centering margins — those margins fight the
    // manual backing-store sizing in shared/hidpi.ts and shift the layout.
    autoCenter: Phaser.Scale.NO_CENTER,
  },
};

export const game = new Phaser.Game(config);

// Render at the display's native resolution (crisp on HiDPI and at any browser
// zoom) while keeping the game's logical size constant, so browser zoom keeps
// everything sharp without reflowing the layout. See shared/hidpi.ts. Must run
// synchronously after construction so its resize handler is registered before
// Phaser's own renderer/camera handlers.
installHiDPI(game);

// Tear down the Phaser instance on Vite HMR updates so the resize listener
// registered inside HubScene.shutdown() is cleaned up before the module is
// re-evaluated.  Without this, each hot-reload stacks another listener.
if (import.meta.hot) {
  import.meta.hot.dispose(() => { game.destroy(true); });
}
