import Phaser from 'phaser';
import { LandingScene } from './hub/LandingScene';
import { HubScene } from './hub/HubScene';
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
  scene: [LandingScene, HubScene, BambooBashScene, ShellCurlScene, KameKnockScene, BellClashScene],
  scale: {
    mode: Phaser.Scale.RESIZE,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
};

export const game = new Phaser.Game(config);

// Tear down the Phaser instance on Vite HMR updates so the resize listener
// registered inside HubScene.shutdown() is cleaned up before the module is
// re-evaluated.  Without this, each hot-reload stacks another listener.
if (import.meta.hot) {
  import.meta.hot.dispose(() => { game.destroy(true); });
}
