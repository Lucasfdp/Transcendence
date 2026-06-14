import Phaser from 'phaser';
import { Achievement } from '../hub/api';
import { THEME } from './theme';

const POPUP_DEPTH = 500;

export function showAchievementUnlocks(scene: Phaser.Scene, achievements: Achievement[]): void {
  if (!achievements.length) return;

  achievements.slice(0, 3).forEach((achievement, index) => {
    scene.time.delayedCall(index * 900, () => showAchievementPopup(scene, achievement));
  });
}

function showAchievementPopup(scene: Phaser.Scene, achievement: Achievement): void {
  const { width } = scene.scale;
  const popupW = Math.min(360, width - 32);
  const popupH = 112;
  const x = width - popupW - 16;
  const y = 74;
  const c = scene.add.container(x + popupW + 24, y).setDepth(POPUP_DEPTH).setAlpha(0);

  const bg = scene.add.graphics();
  bg.fillStyle(0x120b05, 0.96);
  bg.fillRoundedRect(0, 0, popupW, popupH, 10);
  bg.lineStyle(2, THEME.gold, 0.92);
  bg.strokeRoundedRect(0, 0, popupW, popupH, 10);
  bg.lineStyle(1, THEME.gold, 0.20);
  bg.strokeRoundedRect(5, 5, popupW - 10, popupH - 10, 7);

  const title = scene.add.text(58, 16, 'ACHIEVEMENT UNLOCKED', {
    fontSize: '10px',
    color: THEME.textGold,
    fontFamily: THEME.font,
    fontStyle: 'bold',
  });
  const name = scene.add.text(58, 35, achievement.title, {
    fontSize: '17px',
    color: THEME.text,
    fontFamily: THEME.font,
    fontStyle: 'bold',
  });
  const desc = scene.add.text(58, 60, achievement.unlockDescription, {
    fontSize: '11px',
    color: THEME.textMutedHex,
    fontFamily: THEME.font,
    wordWrap: { width: popupW - 76 },
  });
  const medal = scene.add.text(28, 42, 'MEDAL', {
    fontSize: '10px',
    color: THEME.textGold,
    fontFamily: THEME.font,
    fontStyle: 'bold',
  }).setOrigin(0.5);

  c.add([bg, title, name, desc, medal]);
  scene.tweens.add({ targets: c, x, alpha: 1, duration: 220, ease: 'Back.easeOut' });
  scene.tweens.add({
    targets: c,
    alpha: 0,
    x: x + 24,
    delay: 3600,
    duration: 260,
    ease: 'Power1.easeIn',
    onComplete: () => c.destroy(true),
  });
}
