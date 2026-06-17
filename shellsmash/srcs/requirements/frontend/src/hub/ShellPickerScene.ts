/**
 * hub/ShellPickerScene.ts — pre-game shell selection screen.
 *
 * Flow:
 *   HubScene → scene.start('ShellPickerScene', { gameId, targetScene, playerCount })
 *             → Player 1 picks ≤3 shells → [Player 2 picks if playerCount=2]
 *             → stores selection in registry → scene.start(targetScene)
 *
 * Guest players skip backend validation and see the full shell pool.
 * The registry key 'shellSelection' is a { player0: string[], player1: string[] }
 * object that game scenes read to build their per-player power arrays.
 */

import Phaser from 'phaser';
import { ResponsiveScene } from '../shared/responsive-scene';
import { ALL_POWERS, PowerType } from '../shared/mechanics/power-system';
import { GAME_POWERS, GameId } from '../shared/mechanics/game-powers';
import { THEME } from '../shared/theme';
import { api, ShellInventory } from './api';
import { getGameSocket, type GameSnapshot } from '../network/gameSocket';

// ── Layout constants ──────────────────────────────────────────────────────────

const CARD_W     = 88;
const CARD_H     = 96;
const CARD_GAP   = 10;
const ICON_R     = 20;
const COLS       = 5;
const GRID_PAD   = 24;
const PANEL_PAD  = 20;

const DEPTH_BG   = 0;
const DEPTH_CARD = 5;
const DEPTH_HUD  = 20;

// Maximum special (non-NONE) shells a player can pick per game.
const MAX_PICKS = 3;

// ── ShellPickerScene data interface ──────────────────────────────────────────

export interface ShellPickerData {
  gameId:      GameId;
  targetScene: string;
  playerCount: 1 | 2;
}

// ── Internal per-card state ───────────────────────────────────────────────────

interface CardState {
  type:     PowerType;
  gfx:      Phaser.GameObjects.Graphics;
  nameText: Phaser.GameObjects.Text;
  qtyText:  Phaser.GameObjects.Text;
  zone:     Phaser.GameObjects.Zone;
  x:        number;
  y:        number;
}

// ── Scene ─────────────────────────────────────────────────────────────────────

export class ShellPickerScene extends ResponsiveScene {
  // Scene init data
  private gameId!:      GameId;
  private targetScene!: string;
  private playerCount!: 1 | 2;

  // Which player we are currently picking for (0 or 1)
  private currentPlayer = 0;

  // Per-player selections: array of selected PowerType strings (not NONE)
  private selections: [string[], string[]] = [[], []];

  // Inventory fetched from backend (or full set for guests)
  private inventory: ShellInventory = {};

  // Card objects for the current player's grid
  private cards: CardState[] = [];

  // Redrawn objects
  private titleText!:    Phaser.GameObjects.Text;
  private subText!:      Phaser.GameObjects.Text;
  private descGfx!:      Phaser.GameObjects.Graphics;
  private descNameText!: Phaser.GameObjects.Text;
  private descBodyText!: Phaser.GameObjects.Text;
  private confirmBtn!:   Phaser.GameObjects.Text;
  private confirmGfx!:   Phaser.GameObjects.Graphics;
  private onlineBtn?:    Phaser.GameObjects.Text;
  private onlineGfx?:    Phaser.GameObjects.Graphics;
  private onlinePlayerCountText?: Phaser.GameObjects.Text;
  private onlinePlayerCountControls: Phaser.GameObjects.Text[] = [];
  private pickCountText!: Phaser.GameObjects.Text;
  private onlinePlayerCount = 2;

  // Full-screen background + every object buildUI() creates, so the whole layout
  // can be torn down and rebuilt on resize.
  private bgGfx!:   Phaser.GameObjects.Graphics;
  private uiLayer: Phaser.GameObjects.GameObject[] = [];

  // Currently hovered/described shell
  private hoveredType: PowerType | null = null;

  // Stale-guard for async onConfirm — incremented on each invocation so that
  // a zombie continuation after scene.stop() is a no-op.
  private _confirmRunId = 0;

  constructor() { super({ key: 'ShellPickerScene' }); }

  // ── init ────────────────────────────────────────────────────────────────────

  init(data: ShellPickerData): void {
    this.gameId       = data.gameId      ?? 'shell-curl';
    this.targetScene  = data.targetScene ?? 'ShellCurlScene';
    this.playerCount  = data.playerCount ?? 1;
    this.currentPlayer = 0;
    this.selections    = [[], []];
    this.onlinePlayerCount = 2;
    this.registry.remove('onlineMatch');
  }

  // ── create ───────────────────────────────────────────────────────────────────

  async create(): Promise<void> {
    // Guard against zombie continuations: if the scene is stopped and restarted
    // before the await below resolves, the old create()'s continuation would
    // call buildUI() on a scene that already has a second buildUI() in flight,
    // producing duplicate zones that fire scene.start() twice on click.
    let stale = false;
    this.events.once('shutdown', () => { stale = true; });

    // ── Dark background ────────────────────────────────────────────────────────
    this.bgGfx = this.add.graphics().setDepth(DEPTH_BG);
    this.drawBackground();

    // ── Fetch inventory ────────────────────────────────────────────────────────
    const user = this.registry.get('user') as { isGuest?: boolean } | undefined;
    if (!user?.isGuest) {
      try {
        this.inventory = await api.getShellInventory();
      } catch {
        // If fetch fails, fall back to full access (guest-like behaviour)
        this.inventory = this.buildFullInventory();
      }
    } else {
      this.inventory = this.buildFullInventory();
    }

    if (stale) return;
    this.buildUI();
    this.enableResponsive();   // relayout on resize/zoom (see ResponsiveScene)
  }

  private drawBackground(): void {
    const { width, height } = this.scale;
    this.bgGfx.clear();
    this.bgGfx.fillStyle(0x080604, 0.97);
    this.bgGfx.fillRect(0, 0, width, height);
  }

  protected relayout(): void {
    this.drawBackground();
    this.buildUI();
  }

  /** Destroy everything buildUI() created (cards are owned by buildGrid). */
  private clearUI(): void {
    for (const obj of this.uiLayer) obj.destroy();
    this.uiLayer = [];
  }

  // ── buildUI ──────────────────────────────────────────────────────────────────

  private buildUI(): void {
    this.clearUI();
    const { width, height } = this.scale;

    // ── Return button (top-left) ──────────────────────────────────────────────
    const returnGfx = this.add.graphics().setDepth(DEPTH_HUD);
    const returnBtnW = 100;
    const returnBtnH = 32;
    const returnBtnX = GRID_PAD;
    const returnBtnY = 16;

    const paintReturn = (hovered: boolean) => {
      returnGfx.clear();
      returnGfx.fillStyle(hovered ? THEME.gold : 0x1a1405, 0.90);
      returnGfx.fillRoundedRect(returnBtnX, returnBtnY, returnBtnW, returnBtnH, 6);
      returnGfx.lineStyle(1.5, THEME.gold, hovered ? 0 : 0.65);
      returnGfx.strokeRoundedRect(returnBtnX, returnBtnY, returnBtnW, returnBtnH, 6);
    };
    paintReturn(false);

    const returnLabel = this.add.text(
      returnBtnX + returnBtnW / 2,
      returnBtnY + returnBtnH / 2,
      '← Back',
      { fontSize: '13px', color: THEME.textGold, fontFamily: THEME.font, fontStyle: 'bold' },
    ).setOrigin(0.5).setDepth(DEPTH_HUD + 1);

    const returnZone = this.add
      .zone(returnBtnX + returnBtnW / 2, returnBtnY + returnBtnH / 2, returnBtnW, returnBtnH)
      .setInteractive({ useHandCursor: true })
      .setDepth(DEPTH_HUD + 2);

    returnZone.on('pointerover', () => { paintReturn(true);  returnLabel.setColor('#1a1410'); });
    returnZone.on('pointerout',  () => { paintReturn(false); returnLabel.setColor(THEME.textGold); });
    returnZone.on('pointerup',   () => {
      // Do NOT call this.scene.stop() explicitly — scene.start() already stops
      // the calling scene implicitly. An explicit stop() before start() causes
      // InputPlugin.shutdown() to run twice, corrupting InputManager._sceneInputPlugin
      // and permanently breaking pointerup on HubScene zones until page reload.
      this.scene.start('HubScene');
    });

    // ── Title ──────────────────────────────────────────────────────────────────
    this.titleText = this.add.text(width / 2, 28, this.playerTitle(), {
      fontSize:   '22px',
      color:      THEME.textGold,
      fontFamily: THEME.font,
      fontStyle:  'bold',
    }).setOrigin(0.5, 0).setDepth(DEPTH_HUD);

    this.subText = this.add.text(width / 2, 58, 'Pick up to 3 special shells — or go with no power.', {
      fontSize:   '13px',
      color:      THEME.textMutedHex,
      fontFamily: THEME.font,
    }).setOrigin(0.5, 0).setDepth(DEPTH_HUD);

    // ── Pick count label ───────────────────────────────────────────────────────
    this.pickCountText = this.add.text(width / 2, 86, this.pickCountLabel(), {
      fontSize:   '11px',
      color:      THEME.textGold,
      fontFamily: THEME.font,
      fontStyle:  'bold',
    }).setOrigin(0.5, 0).setDepth(DEPTH_HUD);

    // ── Shell grid ─────────────────────────────────────────────────────────────
    this.buildGrid();

    // ── Description footer ─────────────────────────────────────────────────────
    const footerH = 90;
    const footerY = height - footerH - 56;
    this.descGfx = this.add.graphics().setDepth(DEPTH_CARD);
    this.descGfx.fillStyle(0x0a0806, 0.88);
    this.descGfx.fillRoundedRect(GRID_PAD, footerY, width - GRID_PAD * 2, footerH, 8);
    this.descGfx.lineStyle(1, THEME.gold, 0.25);
    this.descGfx.strokeRoundedRect(GRID_PAD, footerY, width - GRID_PAD * 2, footerH, 8);

    this.descNameText = this.add.text(GRID_PAD + PANEL_PAD, footerY + 12, 'Hover a shell to see its description', {
      fontSize:   '13px',
      color:      THEME.textGold,
      fontFamily: THEME.font,
      fontStyle:  'bold',
    }).setDepth(DEPTH_HUD);

    this.descBodyText = this.add.text(GRID_PAD + PANEL_PAD, footerY + 36, '', {
      fontSize:   '11px',
      color:      THEME.text,
      fontFamily: THEME.font,
      wordWrap:   { width: width - GRID_PAD * 2 - PANEL_PAD * 2 },
    }).setDepth(DEPTH_HUD);

    // ── Confirm button ─────────────────────────────────────────────────────────
    this.confirmGfx = this.add.graphics().setDepth(DEPTH_HUD);
    const btnW = 200;
    const btnH = 40;
    const btnX = width / 2 - btnW / 2;
    const btnY = height - 48;

    // Create the label before painting — paintConfirmBtn() touches this.confirmBtn,
    // and on a scene restart the field still references the previous (destroyed)
    // Text. Calling setColor on that would throw and abort the rest of buildUI.
    this.confirmBtn = this.add.text(width / 2, btnY + btnH / 2, this.confirmLabel(), {
      fontSize:   '15px',
      color:      THEME.textGold,
      fontFamily: THEME.font,
      fontStyle:  'bold',
    }).setOrigin(0.5).setDepth(DEPTH_HUD + 1);

    this.paintConfirmBtn(false, btnX, btnY, btnW, btnH);

    const btnZone = this.add
      .zone(width / 2, btnY + btnH / 2, btnW, btnH)
      .setInteractive({ useHandCursor: true })
      .setDepth(DEPTH_HUD + 2);

    btnZone.on('pointerover', () => this.paintConfirmBtn(true, btnX, btnY, btnW, btnH));
    btnZone.on('pointerout',  () => this.paintConfirmBtn(false, btnX, btnY, btnW, btnH));
    btnZone.on('pointerup',   () => void this.onConfirm());

    if ((this.gameId === 'shell-curl' || this.gameId === 'bamboo-bash' || this.gameId === 'kame-knock') && this.currentPlayer === 0) {
      this.buildOnlineButton(btnY);
    }

    // Track everything for teardown on rebuild (grid cards are handled by buildGrid).
    this.uiLayer.push(
      returnGfx, returnLabel, returnZone,
      this.titleText, this.subText, this.pickCountText,
      this.descGfx, this.descNameText, this.descBodyText,
      this.confirmGfx, this.confirmBtn, btnZone,
    );
  }

  private buildOnlineButton(localBtnY: number): void {
    const { width } = this.scale;
    const btnW = 200;
    const btnH = 34;
    const btnX = width / 2 - btnW / 2;
    const btnY = localBtnY - 42;

    this.onlineGfx = this.add.graphics().setDepth(DEPTH_HUD);
    this.paintOnlineBtn(false, btnX, btnY, btnW, btnH);
    this.onlineBtn = this.add.text(width / 2, btnY + btnH / 2, 'Find Online Match', {
      fontSize: '13px', color: THEME.textGold, fontFamily: THEME.font, fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(DEPTH_HUD + 1);

    const zone = this.add
      .zone(width / 2, btnY + btnH / 2, btnW, btnH)
      .setInteractive({ useHandCursor: true })
      .setDepth(DEPTH_HUD + 2);
    zone.on('pointerover', () => this.paintOnlineBtn(true, btnX, btnY, btnW, btnH));
    zone.on('pointerout',  () => this.paintOnlineBtn(false, btnX, btnY, btnW, btnH));
    zone.on('pointerup',   () => void this.findOnlineMatch());

    this.onlinePlayerCountText = this.add.text(width / 2, btnY - 22, this.onlinePlayerCountLabel(), {
      fontSize: '12px', color: THEME.text, fontFamily: THEME.font, fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(DEPTH_HUD + 1);

    const dec = this.add.text(width / 2 - 92, btnY - 22, '‹', {
      fontSize: '18px', color: THEME.textGold, fontFamily: THEME.font, fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(DEPTH_HUD + 1).setInteractive({ useHandCursor: true });
    const inc = this.add.text(width / 2 + 92, btnY - 22, '›', {
      fontSize: '18px', color: THEME.textGold, fontFamily: THEME.font, fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(DEPTH_HUD + 1).setInteractive({ useHandCursor: true });
    dec.on('pointerup', () => this.setOnlinePlayerCount(this.onlinePlayerCount - 1));
    inc.on('pointerup', () => this.setOnlinePlayerCount(this.onlinePlayerCount + 1));
    this.onlinePlayerCountControls = [dec, inc];
    this.uiLayer.push(this.onlineGfx, this.onlineBtn, zone, this.onlinePlayerCountText, dec, inc);
  }

  // ── Grid ──────────────────────────────────────────────────────────────────────

  private buildGrid(): void {
    // Destroy old cards
    for (const c of this.cards) {
      c.gfx.destroy(); c.nameText.destroy(); c.qtyText.destroy(); c.zone.destroy();
    }
    this.cards = [];

    const powers  = GAME_POWERS[this.gameId];
    const { width } = this.scale;
    const selected = this.selections[this.currentPlayer];

    // Total grid width — centre it
    const totalW = COLS * CARD_W + (COLS - 1) * CARD_GAP;
    const startX = (width - totalW) / 2;
    const startY = 110;

    powers.forEach((type, idx) => {
      const col = idx % COLS;
      const row = Math.floor(idx / COLS);
      const x   = startX + col * (CARD_W + CARD_GAP);
      const y   = startY + row * (CARD_H + CARD_GAP);
      const qty = this.inventory[type] ?? 0;
      const isSel    = selected.includes(type);
      const isLocked = qty === 0;

      const gfx = this.add.graphics().setDepth(DEPTH_CARD);
      this.drawCard(gfx, x, y, type, isSel, false, isLocked);

      const def = ALL_POWERS[type];
      const nameText = this.add.text(x + CARD_W / 2, y + CARD_H - 20, def.label, {
        fontSize:   '9px',
        color:      isLocked ? THEME.textMutedHex : (isSel ? THEME.textGold : THEME.text),
        fontFamily: THEME.font,
        fontStyle:  isSel ? 'bold' : 'normal',
        align:      'center',
        wordWrap:   { width: CARD_W - 4 },
      }).setOrigin(0.5, 0).setDepth(DEPTH_CARD + 1);

      const qtyLabel = qty === Infinity ? '∞' : `×${qty}`;
      const qtyText = this.add.text(x + CARD_W - 6, y + 4, qtyLabel, {
        fontSize:   '8px',
        color:      isLocked ? THEME.red : THEME.textMutedHex,
        fontFamily: THEME.font,
        fontStyle:  'bold',
      }).setOrigin(1, 0).setDepth(DEPTH_CARD + 1);

      const zone = this.add
        .zone(x + CARD_W / 2, y + CARD_H / 2, CARD_W, CARD_H)
        .setInteractive({ useHandCursor: !isLocked })
        .setDepth(DEPTH_CARD + 2);

      zone.on('pointerover', () => {
        this.hoveredType = type;
        this.updateDesc(type);
        if (!isLocked) this.drawCard(gfx, x, y, type, isSel, true, false);
      });
      zone.on('pointerout', () => {
        if (this.hoveredType === type) this.hoveredType = null;
        if (!isLocked) this.drawCard(gfx, x, y, type, isSel, false, false);
      });
      zone.on('pointerup', () => {
        if (isLocked) return;
        this.toggleSelection(type);
      });

      this.cards.push({ type, gfx, nameText, qtyText, zone, x, y });
    });
  }

  private drawCard(
    gfx: Phaser.GameObjects.Graphics,
    x: number, y: number,
    type: PowerType,
    selected: boolean,
    hovered: boolean,
    locked: boolean,
  ): void {
    gfx.clear();
    const def = ALL_POWERS[type];
    const col = def.accentColour;

    // Background
    gfx.fillStyle(locked ? 0x0a0804 : (selected ? col : 0x0e0c08), locked ? 0.5 : (selected ? 0.18 : 0.88));
    gfx.fillRoundedRect(x, y, CARD_W, CARD_H, 8);

    // Border
    const borderCol   = selected ? THEME.gold : (hovered ? col : 0x3a2e20);
    const borderAlpha = selected ? 1.0 : (hovered ? 0.8 : 0.5);
    gfx.lineStyle(selected ? 2 : 1, borderCol, borderAlpha);
    gfx.strokeRoundedRect(x, y, CARD_W, CARD_H, 8);

    // Icon circle
    const cx = x + CARD_W / 2;
    const cy = y + CARD_H / 2 - 12;
    gfx.fillStyle(col, locked ? 0.18 : (selected ? 0.85 : 0.40));
    gfx.fillCircle(cx, cy, ICON_R);
    gfx.lineStyle(selected ? 2 : 1, col, locked ? 0.30 : (selected ? 1.0 : 0.60));
    gfx.strokeCircle(cx, cy, ICON_R);

    // Locked overlay
    if (locked) {
      gfx.fillStyle(0x000000, 0.45);
      gfx.fillRoundedRect(x + 1, y + 1, CARD_W - 2, CARD_H - 2, 7);
    }

    // Selected checkmark notch (top-right corner)
    if (selected) {
      gfx.fillStyle(THEME.gold, 1);
      gfx.fillCircle(x + CARD_W - 8, y + 8, 6);
      gfx.fillStyle(0x0e0c08, 1);
      // Minimal tick — two line segments drawn as tiny filled rect
      gfx.fillRect(x + CARD_W - 12, y + 7, 4, 2);
      gfx.fillRect(x + CARD_W - 10, y + 5, 2, 6);
    }
  }

  // ── Selection logic ───────────────────────────────────────────────────────────

  private toggleSelection(type: PowerType): void {
    const sel = this.selections[this.currentPlayer];
    const idx = sel.indexOf(type);

    if (idx >= 0) {
      // Deselect
      sel.splice(idx, 1);
    } else {
      if (sel.length >= MAX_PICKS) {
        // Deselect the oldest pick (FIFO)
        sel.shift();
      }
      sel.push(type);
    }

    this.pickCountText.setText(this.pickCountLabel());
    this.confirmBtn.setText(this.confirmLabel());
    this.buildGrid();
  }

  // ── Description footer ────────────────────────────────────────────────────────

  private updateDesc(type: PowerType): void {
    const def = ALL_POWERS[type];
    this.descNameText.setText(def.label);
    this.descBodyText.setText(def.description);
  }

  // ── Confirm ───────────────────────────────────────────────────────────────────

  private async onConfirm(): Promise<void> {
    // Capture run ID before any await so we can detect zombie continuations.
    // If the user clicks Back while the API call is in-flight, the scene will
    // be stopped and this.scene.start() must not fire from the stale path.
    const myRun = ++this._confirmRunId;

    const user = this.registry.get('user') as { isGuest?: boolean } | undefined;
    const picks = this.selections[this.currentPlayer];

    // Validate against backend for authenticated users
    if (!user?.isGuest && picks.length > 0) {
      try {
        await api.validateShellSelection(picks);
      } catch {
        // Validation failed — show brief error and abort
        if (myRun !== this._confirmRunId || !this.scene.isActive()) return;
        this.subText.setText('Selection invalid. Try again.').setColor(THEME.red);
        this.time.delayedCall(2000, () => {
          if (!this.scene.isActive()) return;
          this.subText.setText('Pick up to 3 special shells — or go with no power.')
            .setColor(THEME.textMutedHex);
        });
        return;
      }
    }

    // Guard: if the scene was stopped while we were awaiting (e.g. user clicked
    // Back), do nothing — the HubScene transition is already in flight.
    if (myRun !== this._confirmRunId || !this.scene.isActive()) return;

    if (this.playerCount === 2 && this.currentPlayer === 0) {
      // Move to player 2's pick
      this.currentPlayer = 1;
      this.refreshForNextPlayer();
    } else {
      // All players have picked — store in registry and start game
      this.registry.set('shellSelection', {
        player0: this.selections[0],
        player1: this.selections[1],
      });
      this.scene.start(this.targetScene);
    }
  }

  private async findOnlineMatch(): Promise<void> {
    const myRun = ++this._confirmRunId;
    const user = this.registry.get('user') as { isGuest?: boolean } | undefined;
    const picks = this.selections[0];

    if (!user?.isGuest && picks.length > 0) {
      try {
        await api.validateShellSelection(picks);
      } catch {
        if (myRun !== this._confirmRunId || !this.scene.isActive()) return;
        this.subText.setText('Selection invalid. Try again.').setColor(THEME.red);
        return;
      }
    }

    if (myRun !== this._confirmRunId || !this.scene.isActive()) return;
    this.registry.set('shellSelection', { player0: picks, player1: [] });
    this.subText.setText(`Searching for ${this.onlinePlayerCount} online players...`).setColor(THEME.textGold);
    this.onlineBtn?.setText('Searching...');

    const socket = getGameSocket();
    socket.off('match:found');
    socket.off('game:state');
    socket.off('queue:error');

    let matchId: string | null = null;
    let side = 0;
    socket.on('match:found', (payload: { matchId: string; side: number }) => {
      matchId = payload.matchId;
      side = payload.side;
      socket.emit('room:ready', { matchId: payload.matchId });
    });
    const onState = (snapshot: GameSnapshot) => {
      if (!matchId || snapshot.matchId !== matchId || snapshot.phase !== 'active' || snapshot.gameId !== this.gameId) return;
      socket.off('game:state', onState);
      this.registry.set('onlineMatch', { matchId: snapshot.matchId, side, snapshot });
      this.scene.start(this.targetScene);
    };
    socket.on('game:state', onState);
    socket.once('queue:error', (payload: { message?: string }) => {
      if (!this.scene.isActive()) return;
      this.subText.setText(payload.message ?? 'Matchmaking failed.').setColor(THEME.red);
      this.onlineBtn?.setText('Find Online Match');
    });
    socket.emit('queue:join', { gameId: this.gameId, mode: 'casual', playerCount: this.onlinePlayerCount, shellSelection: picks });
  }

  // ── Refresh UI for player 2 ───────────────────────────────────────────────────

  private refreshForNextPlayer(): void {
    this.titleText.setText(this.playerTitle());
    this.pickCountText.setText(this.pickCountLabel());
    this.confirmBtn.setText(this.confirmLabel());
    this.subText.setText('Pick up to 3 special shells — or go with no power.').setColor(THEME.textMutedHex);
    this.onlineBtn?.destroy();
    this.onlineGfx?.destroy();
    this.onlinePlayerCountText?.destroy();
    for (const control of this.onlinePlayerCountControls) control.destroy();
    this.onlineBtn = undefined;
    this.onlineGfx = undefined;
    this.onlinePlayerCountText = undefined;
    this.onlinePlayerCountControls = [];
    this.buildGrid();
  }

  // ── Helpers ───────────────────────────────────────────────────────────────────

  private playerTitle(): string {
    if (this.playerCount === 1) return 'Choose Your Shells';
    return this.currentPlayer === 0 ? 'Player 1 — Choose Your Shells' : 'Player 2 — Choose Your Shells';
  }

  private pickCountLabel(): string {
    const n = this.selections[this.currentPlayer].length;
    return `${n} / ${MAX_PICKS} special shells selected`;
  }

  private confirmLabel(): string {
    if (this.playerCount === 2 && this.currentPlayer === 0) return 'Next: Player 2 →';
    return 'Start Game';
  }

  private setOnlinePlayerCount(count: number): void {
    this.onlinePlayerCount = Math.max(2, Math.min(5, count));
    this.onlinePlayerCountText?.setText(this.onlinePlayerCountLabel());
  }

  private onlinePlayerCountLabel(): string {
    return `Online players: ${this.onlinePlayerCount}`;
  }

  private paintConfirmBtn(hovered: boolean, x: number, y: number, w: number, h: number): void {
    this.confirmGfx.clear();
    this.confirmGfx.fillStyle(hovered ? THEME.gold : 0x1a1405, 0.95);
    this.confirmGfx.fillRoundedRect(x, y, w, h, 8);
    this.confirmGfx.lineStyle(2, THEME.gold, hovered ? 0 : 0.80);
    this.confirmGfx.strokeRoundedRect(x, y, w, h, 8);
    // Guard against calling methods on a destroyed Phaser object. On the second
    // visit to ShellPickerScene, this.confirmBtn still points to the destroyed
    // Text from the previous run (truthy in JS, but .active = false). Without
    // this guard, setColor() throws a TypeError before this.confirmBtn is
    // re-assigned below, leaving the button with no text and no click zone.
    if (this.confirmBtn?.active) {
      this.confirmBtn.setColor(hovered ? '#1a1410' : THEME.textGold);
    }
  }

  private paintOnlineBtn(hovered: boolean, x: number, y: number, w: number, h: number): void {
    this.onlineGfx?.clear();
    this.onlineGfx?.fillStyle(hovered ? 0x2b5b7a : 0x101820, 0.95);
    this.onlineGfx?.fillRoundedRect(x, y, w, h, 8);
    this.onlineGfx?.lineStyle(1.5, 0x7fd7ff, hovered ? 0.95 : 0.65);
    this.onlineGfx?.strokeRoundedRect(x, y, w, h, 8);
    if (this.onlineBtn?.active) this.onlineBtn.setColor(hovered ? '#e8f8ff' : THEME.textGold);
  }

  /** Build an inventory record granting Infinity of every known shell. */
  private buildFullInventory(): ShellInventory {
    const inv: ShellInventory = { none: Infinity };
    for (const type of Object.values(PowerType)) {
      if (type !== PowerType.NONE) inv[type] = Infinity;
    }
    return inv;
  }
}
