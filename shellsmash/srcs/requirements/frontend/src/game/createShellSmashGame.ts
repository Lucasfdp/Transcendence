import Phaser from 'phaser';
import { installHiDPI } from '../shared/hidpi';
import { LandingScene } from '../hub/LandingScene';
import { HubScene } from '../hub/HubScene';
import { ShellPickerScene } from '../hub/ShellPickerScene';
import { BambooBashScene } from '../games/bamboo-bash/BambooBashScene';
import { ShellCurlScene } from '../games/shell-curl/ShellCurlScene';
import { KameKnockScene } from '../games/kame-knock/KameKnockScene';
import { BellClashScene } from '../games/bell-clash/BellClashScene';

export function createShellSmashGame(parent: string | HTMLElement): Phaser.Game {
  const config: Phaser.Types.Core.GameConfig = {
    type: Phaser.AUTO,
    width: window.innerWidth,
    height: window.innerHeight,
    backgroundColor: '#0d1117',
    parent,
    scene: [
      LandingScene,
      HubScene,
      ShellPickerScene,
      BambooBashScene,
      ShellCurlScene,
      KameKnockScene,
      BellClashScene,
    ],
    scale: {
      mode: Phaser.Scale.RESIZE,
      autoCenter: Phaser.Scale.NO_CENTER,
    },
  };

  const game = new Phaser.Game(config);
  installHiDPI(game);
  return game;
}
