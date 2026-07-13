/**
 * hub/ShellPickerScene.ts — pre-game shell selection screen.
 *
 * Flow:
 *   game route → scene.start('ShellPickerScene', { gameId, targetScene, playerCount })
 *              → Player 1 picks ≤3 shells → [Player 2 picks if playerCount=2]
 *              → stores selection in registry → scene.start(targetScene)
 *
 * Guest players skip backend validation and see the full shell pool.
 * The registry key 'shellSelection' is a { player0: string[], player1: string[] }
 * object that game scenes read to build their per-player power arrays.
 */

import Phaser from "phaser";
import { ResponsiveScene } from "../../shared/responsive-scene";
import { ALL_POWERS, PowerType } from "../../shared/mechanics/power-system";
import { GAME_POWERS, GameId } from "../../shared/mechanics/game-powers";
import { THEME } from "../../shared/theme";
import { api, ShellInventory } from "./api";
import {
	getGameSocket,
	type BellClashPhysicsState,
	type GameSnapshot,
} from "../../services/network/gameSocket";

// ── Layout constants ──────────────────────────────────────────────────────────

const CARD_W = 88;
const CARD_H = 96;
const CARD_GAP = 10;
const ICON_R = 20;
const COLS = 5;
const GRID_PAD = 24;
const PANEL_PAD = 20;

const DEPTH_BG = 0;
const DEPTH_CARD = 5;
const DEPTH_HUD = 20;

// Maximum special (non-NONE) shells a player can pick per game.
const MAX_PICKS = 3;

const ONLINE_SCENES: Record<string, string> = {
	"temple-curling": "ShellCurlScene",
	"bamboo-bash": "BambooBashScene",
	"kame-knock": "KameKnockScene",
	"bell-clash": "BellClashScene",
};

// ── ShellPickerScene data interface ──────────────────────────────────────────

export interface ShellPickerData {
	gameId: GameId;
	targetScene: string;
	playerCount: 1 | 2;
}

// ── Internal per-card state ───────────────────────────────────────────────────

interface CardState {
	type: PowerType;
	gfx: Phaser.GameObjects.Graphics;
	nameText: Phaser.GameObjects.Text;
	qtyText: Phaser.GameObjects.Text;
	zone: Phaser.GameObjects.Zone;
	x: number;
	y: number;
}

interface MatchStatusPayload {
	inMatch: boolean;
	matchId?: string;
	gameId?: string;
	phase?: GameSnapshot["phase"];
	side?: number;
	reconnectExpiresAt?: number | null;
	snapshot?: GameSnapshot;
	physicsState?: BellClashPhysicsState;
}

// ── Scene ─────────────────────────────────────────────────────────────────────

export class ShellPickerScene extends ResponsiveScene {
	// Scene init data
	private gameId!: GameId;
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
	private titleText!: Phaser.GameObjects.Text;
	private subText!: Phaser.GameObjects.Text;
	private descGfx!: Phaser.GameObjects.Graphics;
	private descNameText!: Phaser.GameObjects.Text;
	private descBodyText!: Phaser.GameObjects.Text;
	private confirmBtn!: Phaser.GameObjects.Text;
	private confirmGfx!: Phaser.GameObjects.Graphics;
	private onlineBtn?: Phaser.GameObjects.Text;
	private onlineGfx?: Phaser.GameObjects.Graphics;
	private abandonBtn?: Phaser.GameObjects.Text;
	private abandonGfx?: Phaser.GameObjects.Graphics;
	private abandonZone?: Phaser.GameObjects.Zone;
	private onlinePlayerCountGfx?: Phaser.GameObjects.Graphics;
	private onlinePlayerCountText?: Phaser.GameObjects.Text;
	private onlinePlayerCountControls: Phaser.GameObjects.Text[] = [];
	private pickCountText!: Phaser.GameObjects.Text;
	private onlinePlayerCount = 2;
	private isSearchingOnline = false;
	private activeMatchStatus: MatchStatusPayload | null = null;
	private matchStatusTimer?: Phaser.Time.TimerEvent;
	private sentAwayStatus = false;

	// Full-screen background + every object buildUI() creates, so the whole layout
	// can be torn down and rebuilt on resize.
	private bgGfx!: Phaser.GameObjects.Graphics;
	private uiLayer: Phaser.GameObjects.GameObject[] = [];

	// Currently hovered/described shell
	private hoveredType: PowerType | null = null;

	// Stale-guard for async onConfirm — incremented on each invocation so that
	// a zombie continuation after scene.stop() is a no-op.
	private _confirmRunId = 0;

	constructor() {
		super({ key: "ShellPickerScene" });
	}

	// ── init ────────────────────────────────────────────────────────────────────

	init(data: ShellPickerData): void {
		this.gameId = data.gameId ?? "temple-curling";
		this.targetScene = data.targetScene ?? "ShellCurlScene";
		this.playerCount = data.playerCount ?? 1;
		this.currentPlayer = 0;
		this.selections = [[], []];
		this.onlinePlayerCount = 2;
		this.isSearchingOnline = false;
		this.activeMatchStatus = null;
		this.sentAwayStatus = false;
		this.registry.remove("onlineMatch");
	}

	// ── create ───────────────────────────────────────────────────────────────────

	async create(): Promise<void> {
		// Guard against zombie continuations: if the scene is stopped and restarted
		// before the await below resolves, the old create()'s continuation would
		// call buildUI() on a scene that already has a second buildUI() in flight,
		// producing duplicate zones that fire scene.start() twice on click.
		let stale = false;
		this.events.once("shutdown", () => {
			stale = true;
		});

		// ── Dark background ────────────────────────────────────────────────────────
		this.bgGfx = this.add.graphics().setDepth(DEPTH_BG);
		this.drawBackground();

		// ── Fetch inventory ────────────────────────────────────────────────────────
		const user = this.registry.get("user") as
			| { isGuest?: boolean }
			| undefined;
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
		this.setupMatchStatus();
		this.enableResponsive(); // relayout on resize/zoom (see ResponsiveScene)
	}

	private setupMatchStatus(): void {
		const socket = getGameSocket();
		socket.off("match:status", this.handleMatchStatus);
		socket.on("match:status", this.handleMatchStatus);
		this.requestMatchStatus(true);

		this.events.once("shutdown", () => {
			socket.off("match:status", this.handleMatchStatus);
			this.matchStatusTimer?.remove(false);
			this.matchStatusTimer = undefined;
			if (this.isSearchingOnline) socket.emit("queue:leave");
		});
	}

	private handleMatchStatus = (payload: MatchStatusPayload): void => {
		if (!this.scene.isActive()) return;
		this.activeMatchStatus = payload.inMatch ? payload : null;
		if (this.activeMatchStatus) this.isSearchingOnline = false;
		else {
			this.matchStatusTimer?.remove(false);
			this.matchStatusTimer = undefined;
		}
		this.refreshOnlineState();

		if (
			this.activeMatchStatus?.reconnectExpiresAt &&
			!this.matchStatusTimer
		) {
			this.matchStatusTimer = this.time.addEvent({
				delay: 500,
				loop: true,
				callback: () => this.refreshOnlineState(),
			});
		}
	};

	private requestMatchStatus(away = false): void {
		if (away) this.sentAwayStatus = true;
		getGameSocket().emit("match:status", away ? { away: true } : undefined);
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
			returnGfx.fillStyle(hovered ? THEME.gold : 0x1a1405, 0.9);
			returnGfx.fillRoundedRect(
				returnBtnX,
				returnBtnY,
				returnBtnW,
				returnBtnH,
				6,
			);
			returnGfx.lineStyle(1.5, THEME.gold, hovered ? 0 : 0.65);
			returnGfx.strokeRoundedRect(
				returnBtnX,
				returnBtnY,
				returnBtnW,
				returnBtnH,
				6,
			);
		};
		paintReturn(false);

		const returnLabel = this.add
			.text(
				returnBtnX + returnBtnW / 2,
				returnBtnY + returnBtnH / 2,
				"← Back",
				{
					fontSize: "13px",
					color: THEME.textGold,
					fontFamily: THEME.font,
					fontStyle: "bold",
				},
			)
			.setOrigin(0.5)
			.setDepth(DEPTH_HUD + 1);

		const returnZone = this.add
			.zone(
				returnBtnX + returnBtnW / 2,
				returnBtnY + returnBtnH / 2,
				returnBtnW,
				returnBtnH,
			)
			.setInteractive({ useHandCursor: true })
			.setDepth(DEPTH_HUD + 2);

		returnZone.on("pointerover", () => {
			paintReturn(true);
			returnLabel.setColor("#1a1410");
		});
		returnZone.on("pointerout", () => {
			paintReturn(false);
			returnLabel.setColor(THEME.textGold);
		});
		returnZone.on("pointerup", () => {
			// Do NOT call this.scene.stop() explicitly — scene.start() already stops
			// the calling scene implicitly. An explicit stop() before start() causes
			// InputPlugin.shutdown() to run twice, corrupting InputManager._sceneInputPlugin
			// and permanently breaking pointerup on HubScene zones until page reload.
			this.scene.start("HubScene");
		});

		// ── Title ──────────────────────────────────────────────────────────────────
		this.titleText = this.add
			.text(width / 2, 28, this.playerTitle(), {
				fontSize: "22px",
				color: THEME.textGold,
				fontFamily: THEME.font,
				fontStyle: "bold",
			})
			.setOrigin(0.5, 0)
			.setDepth(DEPTH_HUD);

		this.subText = this.add
			.text(
				width / 2,
				58,
				"Pick up to 3 special shells — or go with no power.",
				{
					fontSize: "13px",
					color: THEME.textMutedHex,
					fontFamily: THEME.font,
				},
			)
			.setOrigin(0.5, 0)
			.setDepth(DEPTH_HUD);

		// ── Pick count label ───────────────────────────────────────────────────────
		this.pickCountText = this.add
			.text(width / 2, 86, this.pickCountLabel(), {
				fontSize: "11px",
				color: THEME.textGold,
				fontFamily: THEME.font,
				fontStyle: "bold",
			})
			.setOrigin(0.5, 0)
			.setDepth(DEPTH_HUD);

		// ── Shell grid ─────────────────────────────────────────────────────────────
		this.buildGrid();

		// ── Description footer ─────────────────────────────────────────────────────
		const footerH = 90;
		const footerY = height - footerH - 56;
		this.descGfx = this.add.graphics().setDepth(DEPTH_CARD);
		this.descGfx.fillStyle(0x0a0806, 0.88);
		this.descGfx.fillRoundedRect(
			GRID_PAD,
			footerY,
			width - GRID_PAD * 2,
			footerH,
			8,
		);
		this.descGfx.lineStyle(1, THEME.gold, 0.25);
		this.descGfx.strokeRoundedRect(
			GRID_PAD,
			footerY,
			width - GRID_PAD * 2,
			footerH,
			8,
		);

		this.descNameText = this.add
			.text(
				GRID_PAD + PANEL_PAD,
				footerY + 12,
				"Hover a shell to see its description",
				{
					fontSize: "13px",
					color: THEME.textGold,
					fontFamily: THEME.font,
					fontStyle: "bold",
				},
			)
			.setDepth(DEPTH_HUD);

		this.descBodyText = this.add
			.text(GRID_PAD + PANEL_PAD, footerY + 36, "", {
				fontSize: "11px",
				color: THEME.text,
				fontFamily: THEME.font,
				wordWrap: { width: width - GRID_PAD * 2 - PANEL_PAD * 2 },
			})
			.setDepth(DEPTH_HUD);

		// ── Confirm button ─────────────────────────────────────────────────────────
		this.confirmGfx = this.add.graphics().setDepth(DEPTH_HUD);
		const btnW = 200;
		const btnH = 40;
		const btnX = width / 2 - btnW / 2;
		const btnY = height - 48;

		// Create the label before painting — paintConfirmBtn() touches this.confirmBtn,
		// and on a scene restart the field still references the previous (destroyed)
		// Text. Calling setColor on that would throw and abort the rest of buildUI.
		this.confirmBtn = this.add
			.text(width / 2, btnY + btnH / 2, this.confirmLabel(), {
				fontSize: "15px",
				color: THEME.textGold,
				fontFamily: THEME.font,
				fontStyle: "bold",
			})
			.setOrigin(0.5)
			.setDepth(DEPTH_HUD + 1);

		this.paintConfirmBtn(false, btnX, btnY, btnW, btnH);

		const btnZone = this.add
			.zone(width / 2, btnY + btnH / 2, btnW, btnH)
			.setInteractive({ useHandCursor: true })
			.setDepth(DEPTH_HUD + 2);

		btnZone.on("pointerover", () =>
			this.paintConfirmBtn(true, btnX, btnY, btnW, btnH),
		);
		btnZone.on("pointerout", () =>
			this.paintConfirmBtn(false, btnX, btnY, btnW, btnH),
		);
		btnZone.on("pointerup", () => void this.onConfirm());

		if (
			(this.gameId === "temple-curling" ||
				this.gameId === "bamboo-bash" ||
				this.gameId === "kame-knock" ||
				this.gameId === "bell-clash") &&
			this.currentPlayer === 0
		) {
			this.buildOnlineButton(btnY);
		}

		// Track everything for teardown on rebuild (grid cards are handled by buildGrid).
		this.uiLayer.push(
			returnGfx,
			returnLabel,
			returnZone,
			this.titleText,
			this.subText,
			this.pickCountText,
			this.descGfx,
			this.descNameText,
			this.descBodyText,
			this.confirmGfx,
			this.confirmBtn,
			btnZone,
		);
	}

	private buildOnlineButton(localBtnY: number): void {
		const { width } = this.scale;
		const compact = width < 680;
		const btnW = 200;
		const btnH = 34;
		const rowGap = 12;
		const actionBtnW = compact ? 180 : btnW;
		const btnX = width / 2 - actionBtnW / 2;
		const btnY = localBtnY - 42;
		const selectorW = compact ? 260 : 300;
		const selectorH = 36;
		const selectorX = width / 2 - selectorW / 2;
		const selectorY = btnY - 54;

		this.onlineGfx = this.add.graphics().setDepth(DEPTH_HUD);
		this.paintOnlineBtn(false, btnX, btnY, actionBtnW, btnH);
		this.onlineBtn = this.add
			.text(btnX + actionBtnW / 2, btnY + btnH / 2, "Find Online Match", {
				fontSize: "13px",
				color: THEME.textGold,
				fontFamily: THEME.font,
				fontStyle: "bold",
			})
			.setOrigin(0.5)
			.setDepth(DEPTH_HUD + 1);

		const zone = this.add
			.zone(btnX + actionBtnW / 2, btnY + btnH / 2, actionBtnW, btnH)
			.setInteractive({ useHandCursor: true })
			.setDepth(DEPTH_HUD + 2);
		zone.on("pointerover", () =>
			this.paintOnlineBtn(true, btnX, btnY, actionBtnW, btnH),
		);
		zone.on("pointerout", () =>
			this.paintOnlineBtn(false, btnX, btnY, actionBtnW, btnH),
		);
		zone.on("pointerup", () => void this.onOnlineButton());

		this.onlinePlayerCountGfx = this.add.graphics().setDepth(DEPTH_HUD);
		this.onlinePlayerCountGfx.fillStyle(0x161006, 0.96);
		this.onlinePlayerCountGfx.fillRoundedRect(
			selectorX,
			selectorY,
			selectorW,
			selectorH,
			10,
		);
		this.onlinePlayerCountGfx.lineStyle(2, THEME.gold, 0.8);
		this.onlinePlayerCountGfx.strokeRoundedRect(
			selectorX,
			selectorY,
			selectorW,
			selectorH,
			10,
		);

		this.onlinePlayerCountText = this.add
			.text(
				width / 2,
				selectorY + selectorH / 2,
				this.onlinePlayerCountLabel(),
				{
					fontSize: "14px",
					color: THEME.textGold,
					fontFamily: THEME.font,
					fontStyle: "bold",
				},
			)
			.setOrigin(0.5)
			.setDepth(DEPTH_HUD + 1);

		const dec = this.add
			.text(selectorX + 24, selectorY + selectorH / 2, "‹", {
				fontSize: "26px",
				color: THEME.textGold,
				fontFamily: THEME.font,
				fontStyle: "bold",
			})
			.setOrigin(0.5)
			.setDepth(DEPTH_HUD + 1)
			.setInteractive({ useHandCursor: true });
		const inc = this.add
			.text(selectorX + selectorW - 24, selectorY + selectorH / 2, "›", {
				fontSize: "26px",
				color: THEME.textGold,
				fontFamily: THEME.font,
				fontStyle: "bold",
			})
			.setOrigin(0.5)
			.setDepth(DEPTH_HUD + 1)
			.setInteractive({ useHandCursor: true });
		dec.on("pointerup", () =>
			this.setOnlinePlayerCount(this.onlinePlayerCount - 1),
		);
		inc.on("pointerup", () =>
			this.setOnlinePlayerCount(this.onlinePlayerCount + 1),
		);
		this.onlinePlayerCountControls = [dec, inc];

		const abandonBtnX = compact ? btnX : btnX + actionBtnW + rowGap;
		const abandonBtnY = compact ? selectorY - 42 : btnY;
		this.abandonGfx = this.add.graphics().setDepth(DEPTH_HUD);
		this.paintAbandonBtn(false, abandonBtnX, abandonBtnY, actionBtnW, btnH);
		this.abandonBtn = this.add
			.text(
				abandonBtnX + actionBtnW / 2,
				abandonBtnY + btnH / 2,
				"Abandon Match",
				{
					fontSize: "13px",
					color: THEME.red,
					fontFamily: THEME.font,
					fontStyle: "bold",
				},
			)
			.setOrigin(0.5)
			.setDepth(DEPTH_HUD + 1);
		this.abandonZone = this.add
			.zone(
				abandonBtnX + actionBtnW / 2,
				abandonBtnY + btnH / 2,
				actionBtnW,
				btnH,
			)
			.setDepth(DEPTH_HUD + 2);
		this.abandonZone.on("pointerover", () =>
			this.paintAbandonBtn(
				true,
				abandonBtnX,
				abandonBtnY,
				actionBtnW,
				btnH,
			),
		);
		this.abandonZone.on("pointerout", () =>
			this.paintAbandonBtn(
				false,
				abandonBtnX,
				abandonBtnY,
				actionBtnW,
				btnH,
			),
		);
		this.abandonZone.on("pointerup", () => this.abandonActiveMatch());

		this.uiLayer.push(
			this.onlineGfx,
			this.onlineBtn,
			zone,
			this.onlinePlayerCountGfx,
			this.onlinePlayerCountText,
			dec,
			inc,
			this.abandonGfx,
			this.abandonBtn,
			this.abandonZone,
		);
		this.refreshOnlineState();
	}

	private async onOnlineButton(): Promise<void> {
		if (this.activeMatchStatus) {
			this.rejoinActiveMatch();
			return;
		}

		if (this.isSearchingOnline) {
			this.cancelOnlineSearch();
			return;
		}

		await this.findOnlineMatch();
	}

	private cancelOnlineSearch(): void {
		const socket = getGameSocket();
		socket.emit("queue:leave");
		this.isSearchingOnline = false;
		this.subText
			.setText(
				"Search cancelled. You can start a new search whenever you are ready.",
			)
			.setColor(THEME.textMutedHex);
		this.refreshOnlineState();
	}

	private rejoinActiveMatch(): void {
		const status = this.activeMatchStatus;
		if (
			!status?.matchId ||
			status.side === undefined ||
			!status.snapshot ||
			!status.gameId
		)
			return;
		const targetScene = ONLINE_SCENES[status.gameId];
		if (!targetScene) return;
		getGameSocket().emit("match:rejoin");
		this.registry.set("onlineMatch", {
			matchId: status.matchId,
			side: status.side,
			snapshot: status.snapshot,
			physicsState: status.physicsState,
		});
		this.scene.start(targetScene);
	}

	private abandonActiveMatch(): void {
		if (!this.activeMatchStatus) return;
		getGameSocket().emit("match:abandon");
		this.activeMatchStatus = null;
		this.subText
			.setText("Match abandoned. You can search for a new match.")
			.setColor(THEME.textMutedHex);
		this.refreshOnlineState();
	}

	private refreshOnlineState(): void {
		if (!this.onlineBtn?.active) return;

		if (this.activeMatchStatus) {
			if (
				!this.activeMatchStatus.reconnectExpiresAt &&
				!this.sentAwayStatus
			)
				this.requestMatchStatus(true);
			const remainingMs = this.activeMatchStatus.reconnectExpiresAt
				? this.activeMatchStatus.reconnectExpiresAt - Date.now()
				: 45_000;
			const remaining = Math.max(0, Math.ceil(remainingMs / 1000));
			if (this.activeMatchStatus.reconnectExpiresAt && remaining <= 0)
				this.requestMatchStatus();
			this.onlineBtn.setText(
				ONLINE_SCENES[this.activeMatchStatus.gameId ?? ""]
					? "Rejoin Match"
					: "Match In Progress",
			);
			this.onlinePlayerCountText?.setText(
				`Reconnect window: ${remaining}s`,
			);
			for (const control of this.onlinePlayerCountControls)
				control.setAlpha(0.35);
			this.abandonGfx?.setVisible(true);
			this.abandonBtn?.setVisible(true);
			this.abandonZone?.setInteractive({ useHandCursor: true });
			this.subText
				.setText(
					remaining > 0
						? `You are in an active match. Rejoin within ${remaining}s or abandon now.`
						: "Resolving abandoned match. You will be able to search again shortly.",
				)
				.setColor(THEME.textGold);
			return;
		}

		for (const control of this.onlinePlayerCountControls)
			control.setAlpha(1);
		this.onlinePlayerCountText?.setText(this.onlinePlayerCountLabel());
		this.onlineBtn.setText(
			this.isSearchingOnline ? "Cancel Search" : "Find Online Match",
		);
		this.abandonGfx?.setVisible(false);
		this.abandonBtn?.setVisible(false);
		this.abandonZone?.disableInteractive();
	}

	// ── Grid ──────────────────────────────────────────────────────────────────────

	private buildGrid(): void {
		// Destroy old cards
		for (const c of this.cards) {
			c.gfx.destroy();
			c.nameText.destroy();
			c.qtyText.destroy();
			c.zone.destroy();
		}
		this.cards = [];

		const powers = GAME_POWERS[this.gameId];
		const { width } = this.scale;
		const selected = this.selections[this.currentPlayer];

		// Total grid width — centre it
		const totalW = COLS * CARD_W + (COLS - 1) * CARD_GAP;
		const startX = (width - totalW) / 2;
		const startY = 110;

		powers.forEach((type, idx) => {
			const col = idx % COLS;
			const row = Math.floor(idx / COLS);
			const x = startX + col * (CARD_W + CARD_GAP);
			const y = startY + row * (CARD_H + CARD_GAP);
			const qty = this.inventory[type] ?? 0;
			const isSel = selected.includes(type);
			const isLocked = qty === 0;

			const gfx = this.add.graphics().setDepth(DEPTH_CARD);
			this.drawCard(gfx, x, y, type, isSel, false, isLocked);

			const def = ALL_POWERS[type];
			const nameText = this.add
				.text(x + CARD_W / 2, y + CARD_H - 20, def.label, {
					fontSize: "9px",
					color: isLocked
						? THEME.textMutedHex
						: isSel
							? THEME.textGold
							: THEME.text,
					fontFamily: THEME.font,
					fontStyle: isSel ? "bold" : "normal",
					align: "center",
					wordWrap: { width: CARD_W - 4 },
				})
				.setOrigin(0.5, 0)
				.setDepth(DEPTH_CARD + 1);

			const qtyLabel = qty === Infinity ? "∞" : `×${qty}`;
			const qtyText = this.add
				.text(x + CARD_W - 6, y + 4, qtyLabel, {
					fontSize: "8px",
					color: isLocked ? THEME.red : THEME.textMutedHex,
					fontFamily: THEME.font,
					fontStyle: "bold",
				})
				.setOrigin(1, 0)
				.setDepth(DEPTH_CARD + 1);

			const zone = this.add
				.zone(x + CARD_W / 2, y + CARD_H / 2, CARD_W, CARD_H)
				.setInteractive({ useHandCursor: !isLocked })
				.setDepth(DEPTH_CARD + 2);

			zone.on("pointerover", () => {
				this.hoveredType = type;
				this.updateDesc(type);
				if (!isLocked)
					this.drawCard(gfx, x, y, type, isSel, true, false);
			});
			zone.on("pointerout", () => {
				if (this.hoveredType === type) this.hoveredType = null;
				if (!isLocked)
					this.drawCard(gfx, x, y, type, isSel, false, false);
			});
			zone.on("pointerup", () => {
				if (isLocked) return;
				this.toggleSelection(type);
			});

			this.cards.push({ type, gfx, nameText, qtyText, zone, x, y });
		});
	}

	private drawCard(
		gfx: Phaser.GameObjects.Graphics,
		x: number,
		y: number,
		type: PowerType,
		selected: boolean,
		hovered: boolean,
		locked: boolean,
	): void {
		gfx.clear();
		const def = ALL_POWERS[type];
		const col = def.accentColour;

		// Background
		gfx.fillStyle(
			locked ? 0x0a0804 : selected ? col : 0x0e0c08,
			locked ? 0.5 : selected ? 0.18 : 0.88,
		);
		gfx.fillRoundedRect(x, y, CARD_W, CARD_H, 8);

		// Border
		const borderCol = selected ? THEME.gold : hovered ? col : 0x3a2e20;
		const borderAlpha = selected ? 1.0 : hovered ? 0.8 : 0.5;
		gfx.lineStyle(selected ? 2 : 1, borderCol, borderAlpha);
		gfx.strokeRoundedRect(x, y, CARD_W, CARD_H, 8);

		// Icon circle
		const cx = x + CARD_W / 2;
		const cy = y + CARD_H / 2 - 12;
		gfx.fillStyle(col, locked ? 0.18 : selected ? 0.85 : 0.4);
		gfx.fillCircle(cx, cy, ICON_R);
		gfx.lineStyle(
			selected ? 2 : 1,
			col,
			locked ? 0.3 : selected ? 1.0 : 0.6,
		);
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

		const user = this.registry.get("user") as
			| { isGuest?: boolean }
			| undefined;
		const picks = this.selections[this.currentPlayer];

		// Validate against backend for authenticated users
		if (!user?.isGuest && picks.length > 0) {
			try {
				await api.validateShellSelection(picks);
			} catch {
				// Validation failed — show brief error and abort
				if (myRun !== this._confirmRunId || !this.scene.isActive())
					return;
				this.subText
					.setText("Selection invalid. Try again.")
					.setColor(THEME.red);
				this.time.delayedCall(2000, () => {
					if (!this.scene.isActive()) return;
					this.subText
						.setText(
							"Pick up to 3 special shells — or go with no power.",
						)
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
			this.registry.set("shellSelection", {
				player0: this.selections[0],
				player1: this.selections[1],
			});
			this.scene.start(this.targetScene);
		}
	}

	private async findOnlineMatch(): Promise<void> {
		if (this.isSearchingOnline || this.activeMatchStatus) return;
		const myRun = ++this._confirmRunId;
		const user = this.registry.get("user") as
			| { isGuest?: boolean }
			| undefined;
		const picks = this.selections[0];

		if (!user?.isGuest && picks.length > 0) {
			try {
				await api.validateShellSelection(picks);
			} catch {
				if (myRun !== this._confirmRunId || !this.scene.isActive())
					return;
				this.subText
					.setText("Selection invalid. Try again.")
					.setColor(THEME.red);
				return;
			}
		}

		if (myRun !== this._confirmRunId || !this.scene.isActive()) return;
		this.registry.set("shellSelection", { player0: picks, player1: [] });
		this.isSearchingOnline = true;
		this.subText
			.setText(
				`Searching for ${this.onlinePlayerCount} online players...`,
			)
			.setColor(THEME.textGold);
		this.refreshOnlineState();

		const socket = getGameSocket();
		socket.off("match:found");
		socket.off("game:state");
		socket.off("queue:error");
		socket.off("queue:left");

		let matchId: string | null = null;
		let side = 0;
		socket.on(
			"match:found",
			(payload: { matchId: string; side: number }) => {
				this.isSearchingOnline = false;
				matchId = payload.matchId;
				side = payload.side;
				socket.emit("room:ready", { matchId: payload.matchId });
			},
		);
		const onState = (snapshot: GameSnapshot) => {
			if (
				!matchId ||
				snapshot.matchId !== matchId ||
				snapshot.phase !== "active" ||
				snapshot.gameId !== this.gameId
			)
				return;
			socket.off("game:state", onState);
			this.registry.set("onlineMatch", {
				matchId: snapshot.matchId,
				side,
				snapshot,
			});
			this.isSearchingOnline = false;
			this.scene.start(this.targetScene);
		};
		socket.on("game:state", onState);
		socket.once("queue:error", (payload: { message?: string }) => {
			if (!this.scene.isActive()) return;
			this.isSearchingOnline = false;
			this.subText
				.setText(payload.message ?? "Matchmaking failed.")
				.setColor(THEME.red);
			this.refreshOnlineState();
		});
		socket.once("queue:left", () => {
			if (!this.scene.isActive()) return;
			this.isSearchingOnline = false;
			this.refreshOnlineState();
		});
		socket.emit("queue:join", {
			gameId: this.gameId,
			mode: "casual",
			playerCount: this.onlinePlayerCount,
			shellSelection: picks,
		});
	}

	// ── Refresh UI for player 2 ───────────────────────────────────────────────────

	private refreshForNextPlayer(): void {
		this.titleText.setText(this.playerTitle());
		this.pickCountText.setText(this.pickCountLabel());
		this.confirmBtn.setText(this.confirmLabel());
		this.subText
			.setText("Pick up to 3 special shells — or go with no power.")
			.setColor(THEME.textMutedHex);
		this.onlineBtn?.destroy();
		this.onlineGfx?.destroy();
		this.abandonBtn?.destroy();
		this.abandonGfx?.destroy();
		this.abandonZone?.destroy();
		this.onlinePlayerCountGfx?.destroy();
		this.onlinePlayerCountText?.destroy();
		for (const control of this.onlinePlayerCountControls) control.destroy();
		this.onlineBtn = undefined;
		this.onlineGfx = undefined;
		this.abandonBtn = undefined;
		this.abandonGfx = undefined;
		this.abandonZone = undefined;
		this.onlinePlayerCountGfx = undefined;
		this.onlinePlayerCountText = undefined;
		this.onlinePlayerCountControls = [];
		this.buildGrid();
	}

	// ── Helpers ───────────────────────────────────────────────────────────────────

	private playerTitle(): string {
		if (this.playerCount === 1) return "Choose Your Shells";
		return this.currentPlayer === 0
			? "Player 1 — Choose Your Shells"
			: "Player 2 — Choose Your Shells";
	}

	private pickCountLabel(): string {
		const n = this.selections[this.currentPlayer].length;
		return `${n} / ${MAX_PICKS} special shells selected`;
	}

	private confirmLabel(): string {
		if (this.playerCount === 2 && this.currentPlayer === 0)
			return "Next: Player 2 →";
		return "Start Game";
	}

	private setOnlinePlayerCount(count: number): void {
		this.onlinePlayerCount = Math.max(2, Math.min(5, count));
		if (!this.activeMatchStatus)
			this.onlinePlayerCountText?.setText(this.onlinePlayerCountLabel());
	}

	private onlinePlayerCountLabel(): string {
		return `Online players: ${this.onlinePlayerCount}`;
	}

	private paintConfirmBtn(
		hovered: boolean,
		x: number,
		y: number,
		w: number,
		h: number,
	): void {
		this.confirmGfx.clear();
		this.confirmGfx.fillStyle(hovered ? THEME.gold : 0x1a1405, 0.95);
		this.confirmGfx.fillRoundedRect(x, y, w, h, 8);
		this.confirmGfx.lineStyle(2, THEME.gold, hovered ? 0 : 0.8);
		this.confirmGfx.strokeRoundedRect(x, y, w, h, 8);
		// Guard against calling methods on a destroyed Phaser object. On the second
		// visit to ShellPickerScene, this.confirmBtn still points to the destroyed
		// Text from the previous run (truthy in JS, but .active = false). Without
		// this guard, setColor() throws a TypeError before this.confirmBtn is
		// re-assigned below, leaving the button with no text and no click zone.
		if (this.confirmBtn?.active) {
			this.confirmBtn.setColor(hovered ? "#1a1410" : THEME.textGold);
		}
	}

	private paintOnlineBtn(
		hovered: boolean,
		x: number,
		y: number,
		w: number,
		h: number,
	): void {
		this.onlineGfx?.clear();
		this.onlineGfx?.fillStyle(hovered ? 0x2b5b7a : 0x101820, 0.95);
		this.onlineGfx?.fillRoundedRect(x, y, w, h, 8);
		this.onlineGfx?.lineStyle(1.5, 0x7fd7ff, hovered ? 0.95 : 0.65);
		this.onlineGfx?.strokeRoundedRect(x, y, w, h, 8);
		if (this.onlineBtn?.active)
			this.onlineBtn.setColor(hovered ? "#e8f8ff" : THEME.textGold);
	}

	private paintAbandonBtn(
		hovered: boolean,
		x: number,
		y: number,
		w: number,
		h: number,
	): void {
		this.abandonGfx?.clear();
		this.abandonGfx?.fillStyle(hovered ? 0x5a1616 : 0x1d0b0b, 0.95);
		this.abandonGfx?.fillRoundedRect(x, y, w, h, 8);
		this.abandonGfx?.lineStyle(1.5, THEME.red, hovered ? 0.95 : 0.65);
		this.abandonGfx?.strokeRoundedRect(x, y, w, h, 8);
		if (this.abandonBtn?.active)
			this.abandonBtn.setColor(hovered ? "#ffe6e6" : THEME.red);
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
