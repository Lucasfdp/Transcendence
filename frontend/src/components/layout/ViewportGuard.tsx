import { useEffect, useState, type ReactNode } from "react";

interface ViewportGuardProps {
	children: ReactNode;
}

const ORIENTATION_WARNING_STORAGE_KEY = "viewport-guard:orientation-warning-dismissed";

function hasDismissedOrientationWarning(): boolean {
	try {
		return window.localStorage.getItem(ORIENTATION_WARNING_STORAGE_KEY) === "1";
	} catch {
		return false;
	}
}

function rememberOrientationWarningDismissed(): void {
	try {
		window.localStorage.setItem(ORIENTATION_WARNING_STORAGE_KEY, "1");
	} catch {
		// Storage unavailable (private browsing, disabled) — the warning simply
		// reappears next load, which is an acceptable fallback.
	}
}

function isMobileDevice(): boolean {
	const mobileUserAgent = /Android|iPhone|iPod|IEMobile|Opera Mini/i.test(
		navigator.userAgent,
	);
	const compactTouchDevice =
		globalThis.matchMedia?.("(pointer: coarse)").matches === true &&
		Math.min(window.screen.width, window.screen.height) <= 900;

	return mobileUserAgent || compactTouchDevice;
}

function isPortraitViewport(): boolean {
	return window.innerHeight > window.innerWidth;
}

function useViewportGuardState(): { mobile: boolean; portrait: boolean } {
	const [state, setState] = useState(() => ({
		mobile: isMobileDevice(),
		portrait: isPortraitViewport(),
	}));

	useEffect(() => {
		const updateViewport = (): void => {
			const mobile = isMobileDevice();
			const portrait = isPortraitViewport();
			setState((current) =>
				current.mobile === mobile && current.portrait === portrait
					? current
					: { mobile, portrait },
			);
		};

		window.addEventListener("resize", updateViewport);
		window.addEventListener("orientationchange", updateViewport);
		return () => {
			window.removeEventListener("resize", updateViewport);
			window.removeEventListener("orientationchange", updateViewport);
		};
	}, []);

	return state;
}

function OrientationGate({ onContinue }: { onContinue: () => void }): JSX.Element {
	return (
		<main className="viewport-guard" aria-labelledby="orientation-gate-title">
			<div className="viewport-guard__sun" aria-hidden="true" />
			<section className="viewport-guard__panel viewport-guard__panel--orientation">
				<div className="viewport-guard__device" aria-hidden="true">
					<span className="viewport-guard__device-frame" />
					<span className="viewport-guard__rotation-arrow">↻</span>
				</div>
				<p className="viewport-guard__eyebrow">SCREEN ORIENTATION</p>
				<h1 id="orientation-gate-title">Rotate to landscape</h1>
				<p>
					Shell Smash is better experienced in a horizontal screen — the
					arena, controls, and multiplayer HUD are built for landscape.
				</p>
				<button className="viewport-guard__continue" type="button" onClick={onContinue}>
					Continue at your own risk
				</button>
			</section>
		</main>
	);
}

function MobileNotice({ onContinue }: { onContinue: () => void }): JSX.Element {
	return (
		<main className="viewport-guard" aria-labelledby="mobile-notice-title">
			<div className="viewport-guard__sun" aria-hidden="true" />
			<section className="viewport-guard__panel">
				<p className="viewport-guard__eyebrow">DESKTOP EXPERIENCE</p>
				<h1 id="mobile-notice-title">Built for a bigger arena</h1>
				<p>
					Shell Smash is designed for desktop controls and a wide display.
					On mobile, some screens and matches may not perform as intended.
				</p>
				<p className="viewport-guard__risk">Continue at your own risk.</p>
				<button className="viewport-guard__continue" type="button" onClick={onContinue}>
					I understand, continue
				</button>
			</section>
		</main>
	);
}

/**
 * Warns phone visitors that Shell Smash favours landscape/desktop, letting
 * them acknowledge and continue anyway. The orientation warning remembers its
 * dismissal across page loads (localStorage), so it only appears once; the
 * desktop-experience notice re-asks each session.
 */
export function ViewportGuard({ children }: ViewportGuardProps): JSX.Element {
	const { mobile, portrait } = useViewportGuardState();
	const [mobileNoticeAccepted, setMobileNoticeAccepted] = useState(false);
	const [orientationWarningDismissed, setOrientationWarningDismissed] = useState(
		hasDismissedOrientationWarning,
	);

	if (portrait && !orientationWarningDismissed)
		return (
			<OrientationGate
				onContinue={() => {
					rememberOrientationWarningDismissed();
					setOrientationWarningDismissed(true);
				}}
			/>
		);
	if (mobile && !mobileNoticeAccepted)
		return <MobileNotice onContinue={() => setMobileNoticeAccepted(true)} />;

	return <>{children}</>;
}
