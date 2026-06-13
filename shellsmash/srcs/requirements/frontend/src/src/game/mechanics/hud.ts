/**
 * mechanics/hud.ts — shared in-game HUD widgets for every minigame.
 */

import Phaser from 'phaser';
import { THEME } from '../../hub/theme';

/**
 * Add a "Return to Hub" button to the top-right corner of the scene.
 * Returns the created objects so callers can destroy/reposition on resize.
 */
export function buildReturnButton(
  scene: Phaser.Scene,
  targetScene = 'HubScene',
): Phaser.GameObjects.GameObject[] {
  const PAD = 14;
  const BW  = 172;
  const BH  = 44;
  const bx  = scene.scale.width - PAD - BW;
  const by  = PAD;

  const g = scene.add.graphics().setDepth(20);
  g.fillStyle(0x0a1208, 0.92);
  g.fillRoundedRect(bx, by, BW, BH, 8);
  g.lineStyle(1.5, THEME.gold, 0.8);
  g.strokeRoundedRect(bx, by, BW, BH, 8);

  const label = scene.add.text(bx + BW / 2, by + BH / 2, '← Return to Hub', {
    fontSize: '15px',
    color: THEME.textGold,
    fontFamily: THEME.font,
    fontStyle: 'bold',
  }).setOrigin(0.5).setDepth(21);

  const zone = scene.add
    .zone(bx + BW / 2, by + BH / 2, BW, BH)
    .setInteractive({ useHandCursor: true })
    .setDepth(22)
    .on('pointerup', () => scene.scene.start(targetScene));

  return [g, label, zone];
}
