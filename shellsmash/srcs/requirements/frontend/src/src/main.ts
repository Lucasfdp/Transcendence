import Phaser from 'phaser';
import { HubScene } from './hub/HubScene';
import { AuthCallbackScene } from './hub/AuthCallbackScene';

// Check if user has a token (stored after OAuth callback)
const token = localStorage.getItem('jwt_token');

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  width: window.innerWidth,
  height: window.innerHeight,
  backgroundColor: '#0d1117',
  parent: 'game',
  scene: [AuthCallbackScene, HubScene],
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
