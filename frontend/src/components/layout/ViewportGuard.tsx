import { useEffect, useState, type ReactNode } from "react";

interface ViewportGuardProps {
	children: ReactNode;
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
		const updateViewport = (): void =>
			setState({ mobile: isMobileDevice(), portrait: isPortraitViewport() });

		window.addEventListener("resize", updateViewport);
		window.addEventListener("orientationchange", updateViewport);
		return () => {
			window.removeEventListener("resize", updateViewport);
			window.removeEventListener("orientationchange", updateViewport);
		};
	}, []);

	return state;
}

function OrientationGate(): JSX.Element {
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
					Shell Smash needs a horizontal screen to keep the arena, controls,
					and multiplayer HUD playable.
				</p>
				<p className="viewport-guard__instruction">Rotate your device to continue.</p>
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
 * Prevents the game from starting in portrait view and asks phone visitors to
 * explicitly acknowledge the desktop-first layout for the current session.
 */
export function ViewportGuard({ children }: ViewportGuardProps): JSX.Element {
	const { mobile, portrait } = useViewportGuardState();
	const [mobileNoticeAccepted, setMobileNoticeAccepted] = useState(false);

	if (portrait) return <OrientationGate />;
	if (mobile && !mobileNoticeAccepted)
		return <MobileNotice onContinue={() => setMobileNoticeAccepted(true)} />;

	return <>{children}</>;
}
