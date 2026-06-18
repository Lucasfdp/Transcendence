/**
 * LandingScene.ts — Shell Smash entry point.
 *
 * The procedural background + title are drawn on the Phaser canvas.
 * Auth UI (login form, register form, Quick Game button) is a vanilla-DOM
 * overlay — real <input> elements give proper keyboard UX with no Phaser
 * quirks.
 *
 * Flow:
 *  1. create() → GET /api/auth/me.
 *     – Session exists → fade to HubScene immediately.
 *     – 401 → fetch CSRF token, mount the form overlay.
 *  2. Login / Register → POST /auth/login or /auth/register → cookie → HubScene.
 *  3. Quick Game     → GET /auth/csrf-token (fresh) → POST /auth/guest → HubScene.
 *
 * Resize: canvas objects are torn down + redrawn; the DOM overlay uses
 * CSS (%, vh/vw) so it needs no manual repositioning.
 */

import Phaser from 'phaser';
import { ResponsiveScene } from '../../shared/responsive-scene';
import { api, AuthError, NetworkError } from './api';
import { THEME } from '../../shared/theme';
import { drawBackground } from '../../shared/drawBackground';

const RESIZE_DEBOUNCE_MS = 100;
const FADE_MS            = 280;

const DEPTH_BG    =  0;
const DEPTH_TITLE = 20;

// ── CSS for the DOM overlay ────────────────────────────────────────────────────
const OVERLAY_CSS = `
  #ls-overlay {
    position: fixed;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: flex-end;
    padding-bottom: clamp(24px, 8vh, 72px);
    pointer-events: none;
    z-index: 200;
    font-family: 'Courier New', Courier, monospace;
    box-sizing: border-box;
  }
  #ls-overlay * { box-sizing: border-box; }

  /* ── Form panel ─────────────────────────────────────────────────────────── */
  #ls-panel {
    background: rgba(8, 6, 32, 0.95);
    border: 1px solid rgba(212, 168, 67, 0.65);
    border-radius: 10px;
    padding: 28px 32px 24px;
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 12px;
    width: min(340px, 92vw);
    pointer-events: all;
  }

  #ls-mode-title {
    color: #d4a843;
    font-size: clamp(14px, 2vw, 17px);
    font-weight: bold;
    text-align: center;
    letter-spacing: 0.06em;
    margin: 0 0 4px;
    text-transform: uppercase;
  }

  /* ── Inputs ─────────────────────────────────────────────────────────────── */
  #ls-panel input[type="text"],
  #ls-panel input[type="password"] {
    width: 100%;
    padding: 11px 14px;
    background: rgba(4, 3, 14, 0.92);
    border: 1px solid rgba(212, 168, 67, 0.45);
    border-radius: 6px;
    color: #f5e6c8;
    font-family: inherit;
    font-size: 15px;
    outline: none;
    transition: border-color 0.15s;
  }
  #ls-panel input:focus {
    border-color: #d4a843;
    background: rgba(8, 6, 32, 1);
  }
  #ls-panel input::placeholder { color: rgba(212, 168, 67, 0.35); }

  /* ── Primary button ─────────────────────────────────────────────────────── */
  #ls-submit {
    width: 100%;
    padding: 12px;
    background: #d4a843;
    color: #1a1410;
    border: none;
    border-radius: 6px;
    font-family: inherit;
    font-size: 15px;
    font-weight: bold;
    cursor: pointer;
    transition: background 0.15s, color 0.15s;
    margin-top: 4px;
  }
  #ls-submit:hover   { background: #f0c050; }
  #ls-submit:active  { background: #b8902e; }
  #ls-submit:disabled {
    background: rgba(212, 168, 67, 0.35);
    color: rgba(26, 20, 16, 0.6);
    cursor: default;
  }

  /* ── Toggle link ─────────────────────────────────────────────────────────── */
  #ls-toggle {
    text-align: center;
    color: rgba(212, 168, 67, 0.6);
    font-size: 13px;
    cursor: pointer;
    user-select: none;
    transition: color 0.15s;
  }
  #ls-toggle:hover { color: #d4a843; }

  /* ── Error text ─────────────────────────────────────────────────────────── */
  #ls-error {
    color: #ff6b6b;
    font-size: 12px;
    text-align: center;
    min-height: 16px;
    line-height: 1.4;
  }

  /* ── Divider ─────────────────────────────────────────────────────────────── */
  .ls-divider {
    border: none;
    border-top: 1px solid rgba(212, 168, 67, 0.18);
    margin: 4px 0;
  }

  /* ── Quick Game button ───────────────────────────────────────────────────── */
  #ls-guest-btn {
    margin-top: 14px;
    width: min(340px, 92vw);
    padding: 12px;
    background: rgba(140, 20, 20, 0.88);
    color: #ffffff;
    border: 1px solid rgba(212, 168, 67, 0.35);
    border-radius: 6px;
    font-family: inherit;
    font-size: 15px;
    font-weight: bold;
    cursor: pointer;
    pointer-events: all;
    transition: background 0.15s, border-color 0.15s;
  }
  #ls-guest-btn:hover   { background: rgba(190, 30, 30, 0.92); border-color: rgba(212, 168, 67, 0.7); }
  #ls-guest-btn:active  { background: rgba(100, 10, 10, 0.92); }
  #ls-guest-btn:disabled {
    background: rgba(80, 20, 20, 0.55);
    color: rgba(255,255,255,0.4);
    cursor: default;
  }

  /* ── Dev link ────────────────────────────────────────────────────────────── */
  #ls-dev-link {
    margin-top: 12px;
    color: rgba(212, 168, 67, 0.4);
    font-size: 12px;
    font-style: italic;
    cursor: pointer;
    pointer-events: all;
    text-align: center;
    transition: color 0.15s;
    user-select: none;
  }
  #ls-dev-link:hover { color: rgba(212, 168, 67, 0.75); }
`;

// ─────────────────────────────────────────────────────────────────────────────

export class LandingScene extends ResponsiveScene {
  private bgLayer:      Phaser.GameObjects.GameObject[] = [];
  private titleLayer:   Phaser.GameObjects.GameObject[] = [];
  private overlayEl:    HTMLElement | null = null;
  private styleEl:      HTMLStyleElement | null = null;
  private transitioning = false;
  protected resizeDebounceMs = RESIZE_DEBOUNCE_MS;

  constructor() { super({ key: 'LandingScene' }); }

  // ── shutdown ─────────────────────────────────────────────────────────────────

  protected onShutdown(): void {
    this.removeOverlay();
  }

  // ── preload ──────────────────────────────────────────────────────────────────

  preload(): void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const g = this.make.graphics({ x: 0, y: 0 } as any, false);
    g.fillStyle(0xFFB7C5, 1);
    g.fillEllipse(10, 6, 20, 12);
    g.fillStyle(0xFFE4EC, 0.75);
    g.fillEllipse(10, 5, 12, 7);
    g.generateTexture('petal', 20, 12);
    g.destroy();
  }

  // ── create ───────────────────────────────────────────────────────────────────

  async create(): Promise<void> {
    // Reset per-run state — scene instances are reused across scene.start() calls,
    // so flags and layer refs from the previous run must be cleared here.
    this.transitioning = false;
    this.bgLayer       = [];
    this.titleLayer    = [];

    this.drawBg();
    this.drawTitle();

    // Fast-path: if there's already a valid session, skip the UI entirely.
    try {
      await api.getMe();
      if (!this.scene.isActive()) return;
      this.transitionToHub();
      return;
    } catch (err) {
      if (!this.scene.isActive()) return;
      if (!(err instanceof AuthError)) {
        console.warn('[LandingScene] Session check error:', err);
      }
    }

    // Mount form overlay — CSRF will be fetched lazily per-request.
    this.injectStyles();
    if (!this.scene.isActive()) return;
    this.mountOverlay();
    this.enableResponsive();   // relayout on resize/zoom (see ResponsiveScene)
  }

  // ── Resize ───────────────────────────────────────────────────────────────────

  protected relayout(): void {
    if (this.transitioning) return;
    this.clearLayer(this.bgLayer);
    this.drawBg();
    this.clearLayer(this.titleLayer);
    this.drawTitle();
    // DOM overlay is CSS-driven — no manual repositioning needed.
  }

  // ── Canvas helpers ────────────────────────────────────────────────────────────

  private clearLayer(layer: Phaser.GameObjects.GameObject[]): void {
    for (const obj of layer) { if (obj?.active) obj.destroy(); }
    layer.length = 0;
  }

  private drawBg(): void {
    this.bgLayer.push(...drawBackground(this, DEPTH_BG));
  }

  private drawTitle(): void {
    const { width, height } = this.scale;
    const s     = Math.min(Math.min(width, height) / 1080, 1.0);
    const cx    = width / 2;
    const titleY = height * 0.30;

    // Dark vignette in the title area for readability against the sky
    const vig = this.add.graphics().setDepth(DEPTH_TITLE - 1);
    this.titleLayer.push(vig);
    vig.fillGradientStyle(0x000000, 0x000000, 0x000000, 0x000000, 0.55, 0.55, 0, 0);
    vig.fillRect(0, 0, width, height * 0.55);

    const strokeW = Math.max(2, Math.round(6 * s));

    const title = this.add.text(cx, titleY, 'SHELL SMASH', {
      fontSize:        `${Math.max(28, Math.round(64 * s))}px`,
      color:           THEME.textGold,
      fontFamily:      THEME.font,
      fontStyle:       'bold',
      stroke:          '#000000',
      strokeThickness: strokeW,
    }).setOrigin(0.5).setDepth(DEPTH_TITLE);
    this.titleLayer.push(title);

    const sub = this.add.text(cx, titleY + Math.round(72 * s), 'Sumo Turtle Arena', {
      fontSize:        `${Math.max(14, Math.round(22 * s))}px`,
      color:           THEME.text,
      fontFamily:      THEME.font,
      stroke:          '#000000',
      strokeThickness: Math.max(1, Math.round(3 * s)),
    }).setOrigin(0.5).setDepth(DEPTH_TITLE);
    this.titleLayer.push(sub);
  }

  // ── DOM overlay ───────────────────────────────────────────────────────────────

  private injectStyles(): void {
    if (document.getElementById('ls-styles')) return;
    const style      = document.createElement('style');
    style.id         = 'ls-styles';
    style.textContent = OVERLAY_CSS;
    document.head.appendChild(style);
    this.styleEl = style;
  }

  private mountOverlay(mode: 'login' | 'register' = 'login'): void {
    this.removeOverlay();

    const overlay = document.createElement('div');
    overlay.id    = 'ls-overlay';

    // ── Form panel ────────────────────────────────────────────────────────────
    const panel   = document.createElement('div');
    panel.id      = 'ls-panel';

    const modeTitle      = document.createElement('p');
    modeTitle.id         = 'ls-mode-title';
    modeTitle.textContent = mode === 'login' ? '⛩  Login' : '⛩  Create Account';
    panel.appendChild(modeTitle);

    const usernameInput          = document.createElement('input');
    usernameInput.type           = 'text';
    usernameInput.placeholder    = 'Username';
    usernameInput.autocomplete   = 'username';
    usernameInput.maxLength      = 20;
    panel.appendChild(usernameInput);

    const passwordInput          = document.createElement('input');
    passwordInput.type           = 'password';
    passwordInput.placeholder    = 'Password';
    passwordInput.autocomplete   = mode === 'login' ? 'current-password' : 'new-password';
    panel.appendChild(passwordInput);

    const errorEl      = document.createElement('p');
    errorEl.id         = 'ls-error';
    errorEl.textContent = '';
    panel.appendChild(errorEl);

    const submitBtn      = document.createElement('button');
    submitBtn.id         = 'ls-submit';
    submitBtn.textContent = mode === 'login' ? 'Login' : 'Create Account';
    panel.appendChild(submitBtn);

    const divider1   = document.createElement('hr');
    divider1.className = 'ls-divider';
    panel.appendChild(divider1);

    const toggleEl      = document.createElement('p');
    toggleEl.id         = 'ls-toggle';
    toggleEl.textContent = mode === 'login'
      ? "Don't have an account? Create one"
      : 'Already have an account? Login';
    panel.appendChild(toggleEl);

    overlay.appendChild(panel);

    // ── Quick Game button ─────────────────────────────────────────────────────
    const guestBtn      = document.createElement('button');
    guestBtn.id         = 'ls-guest-btn';
    guestBtn.textContent = '⚡  Quick Game  (no account needed)';
    overlay.appendChild(guestBtn);

    // ── Dev link ──────────────────────────────────────────────────────────────
    if (import.meta.env.VITE_DEV_LOGIN_ENABLED === 'true') {
      const devLink      = document.createElement('p');
      devLink.id         = 'ls-dev-link';
      devLink.textContent = 'Dev Login (KameMaster)';
      overlay.appendChild(devLink);

      devLink.addEventListener('click', async () => {
        if (this.transitioning) return;
        this.setError(errorEl, null);
        devLink.style.pointerEvents = 'none';
        try {
          await api.devLogin('KameMaster');
          this.transitionToHub();
        } catch (err) {
          this.setError(errorEl, this.friendlyError(err, 'Dev login failed'));
          devLink.style.pointerEvents = '';
        }
      });
    }

    // ── Event wiring ──────────────────────────────────────────────────────────

    const setLoading = (loading: boolean): void => {
      submitBtn.disabled = loading;
      guestBtn.disabled  = loading;
      submitBtn.textContent = loading
        ? (mode === 'login' ? 'Logging in…' : 'Creating…')
        : (mode === 'login' ? 'Login' : 'Create Account');
    };

    // Submit (login or register)
    const handleSubmit = async (): Promise<void> => {
      if (this.transitioning) return;
      this.setError(errorEl, null);

      const username = usernameInput.value.trim();
      const password = passwordInput.value;

      if (!username) { this.setError(errorEl, 'Username is required.'); return; }
      if (!password) { this.setError(errorEl, 'Password is required.'); return; }
      if (mode === 'register') {
        if (password.length < 8) { this.setError(errorEl, 'Password must be at least 8 characters.'); return; }
      }

      setLoading(true);
      try {
        // Always refresh CSRF before any state-changing POST.
        await api.getCsrfToken();
      } catch {
        this.setError(errorEl, 'Cannot reach the server — is the backend running?');
        setLoading(false);
        return;
      }

      try {
        if (mode === 'login') {
          await api.login(username, password);
        } else {
          await api.register(username, password);
        }
        this.transitionToHub();
      } catch (err) {
        setLoading(false);
        this.setError(errorEl, this.friendlyError(err, mode === 'login'
          ? 'Invalid username or password.'
          : 'Registration failed — username may already be taken.',
        ));
      }
    };

    submitBtn.addEventListener('click', () => void handleSubmit());

    // Allow Enter key to submit from any input
    [usernameInput, passwordInput].forEach((el) => {
      el.addEventListener('keydown', (e: KeyboardEvent) => {
        if (e.key === 'Enter') void handleSubmit();
      });
    });

    // Toggle between login / register
    toggleEl.addEventListener('click', () => {
      if (this.transitioning) return;
      this.mountOverlay(mode === 'login' ? 'register' : 'login');
    });

    // Quick Game — fetch fresh CSRF then guest-login
    guestBtn.addEventListener('click', async () => {
      if (this.transitioning) return;
      this.setError(errorEl, null);
      guestBtn.disabled  = true;
      submitBtn.disabled = true;
      guestBtn.textContent = 'Starting…';

      try {
        await api.getCsrfToken();
      } catch {
        this.setError(errorEl, 'Cannot reach the server — is the backend running?');
        guestBtn.disabled   = false;
        submitBtn.disabled  = false;
        guestBtn.textContent = '⚡  Quick Game  (no account needed)';
        return;
      }

      try {
        await api.guestLogin();
        this.transitionToHub();
      } catch (err) {
        guestBtn.disabled   = false;
        submitBtn.disabled  = false;
        guestBtn.textContent = '⚡  Quick Game  (no account needed)';
        this.setError(errorEl, this.friendlyError(err, 'Could not start guest session.'));
      }
    });

    document.body.appendChild(overlay);
    this.overlayEl = overlay;

    // Focus username field after mount
    setTimeout(() => usernameInput.focus(), 50);
  }

  private removeOverlay(): void {
    this.overlayEl?.remove();
    document.getElementById('ls-overlay')?.remove();
    this.overlayEl = null;
  }

  // ── Helpers ───────────────────────────────────────────────────────────────────

  private setError(el: HTMLElement, msg: string | null): void {
    el.textContent = msg ?? '';
  }

  /** Produce a user-friendly error string from any thrown value. */
  private friendlyError(err: unknown, fallback: string): string {
    if (err instanceof AuthError) {
      if (err.status === 429) return 'Too many attempts — please wait a moment.';
      if (err.status === 409) return 'That username is already taken.';
      if (err.status === 401) return 'Invalid username or password.';
    }
    if (err instanceof NetworkError) return 'Network error — please check your connection.';
    return fallback;
  }

  // ── Scene transition ─────────────────────────────────────────────────────────

  private transitionToHub(): void {
    if (this.transitioning) return;
    this.transitioning = true;
    this.removeOverlay();
    this.cameras.main.fadeOut(FADE_MS, 0, 0, 0);
    this.cameras.main.once('camerafadeoutcomplete', () => {
      this.scene.start('HubScene');
    });
  }
}
