import { useState } from "react";
import { api } from "../../features/hub/api";
import { OAuthProviderButton } from "./OAuthProviderButton";

const GITHUB_AUTH_URL = import.meta.env.VITE_GITHUB_AUTH_URL ?? "";

function ImageLogo({
	src,
	alt,
	className = "oauth-button__logo oauth-button__logo--image",
}: {
	src: string;
	alt: string;
	className?: string;
}): JSX.Element {
	return <img aria-hidden="true" className={className} src={src} alt={alt} />;
}

function FortyTwoLogo(): JSX.Element {
	return (
		<svg
			aria-hidden="true"
			className="oauth-button__logo oauth-button__logo--42"
			viewBox="0 0 32 24"
		>
			<text
				x="16"
				y="17"
				fill="currentColor"
				fontFamily="Arial Black, Arial, sans-serif"
				fontSize="16"
				fontWeight="900"
				textAnchor="middle"
			>
				42
			</text>
		</svg>
	);
}

function GitHubLogo(): JSX.Element {
	return (
		<ImageLogo src="/assets/oauth/github.svg" alt="GitHub" />
	);
}

function RedditLogo(): JSX.Element {
	return (
		<ImageLogo src="/assets/oauth/reddit.svg" alt="Reddit" />
	);
}

function XboxLogo(): JSX.Element {
	return (
		<ImageLogo src="/assets/oauth/xbox.svg" alt="Xbox" />
	);
}

function PlayStationLogo(): JSX.Element {
	return (
		<ImageLogo src="/assets/oauth/playstation.svg" alt="PlayStation" />
	);
}

function ChatGPTLogo(): JSX.Element {
	return (
		<ImageLogo src="/assets/oauth/chatgpt.svg" alt="ChatGPT" />
	);
}

function SteamLogo(): JSX.Element {
	return (
		<ImageLogo src="/assets/oauth/steam.svg" alt="Steam" />
	);
}

function NintendoLogo(): JSX.Element {
	return (
		<ImageLogo src="/assets/oauth/nintendo.svg" alt="Nintendo" />
	);
}

function GoogleLogo(): JSX.Element {
	return (
		<ImageLogo src="/assets/oauth/google.svg" alt="Google" />
	);
}

function ClaudeLogo(): JSX.Element {
	return (
		<ImageLogo src="/assets/oauth/claude.svg" alt="Claude" />
	);
}

function DeepSeekLogo(): JSX.Element {
	return (
		<ImageLogo src="/assets/oauth/deepseek.svg" alt="DeepSeek" />
	);
}

function PerplexityLogo(): JSX.Element {
	return (
		<ImageLogo src="/assets/oauth/perplexity.svg" alt="Perplexity" />
	);
}

interface OAuthButtonsProps {
	isSubmitting: boolean;
	onOAuthLogin: (url: string) => void;
}

export function OAuthButtons({
	isSubmitting,
	onOAuthLogin,
}: OAuthButtonsProps): JSX.Element {
	const [isExpanded, setIsExpanded] = useState(false);

	return (
		<div className="auth-card__oauth">
			<div className="auth-card__divider">
				<span>OAuth access</span>
			</div>

			<div className="auth-card__oauth-stack">
				<div
					className={`auth-card__oauth-grid ${isExpanded ? "auth-card__oauth-grid--expanded" : ""}`}
				>
					<OAuthProviderButton
						label="Continue with 42"
						logo={<FortyTwoLogo />}
						variant={isExpanded ? "square" : "full"}
						tone="42"
						className="oauth-button--primary"
						disabled={isSubmitting}
						onClick={() => onOAuthLogin(api.loginUrl())}
					/>
					<OAuthProviderButton
						label="Continue with GitHub"
						logo={<GitHubLogo />}
						variant={isExpanded ? "square" : "full"}
						tone="github"
						className="oauth-button--primary"
						disabled={isSubmitting || !GITHUB_AUTH_URL}
						onClick={() => onOAuthLogin(GITHUB_AUTH_URL)}
						title={
							GITHUB_AUTH_URL
								? "Continue with GitHub"
								: "GitHub OAuth is not configured yet"
						}
					/>
					<OAuthProviderButton
						label="Continue with Google"
						logo={<GoogleLogo />}
						variant="square"
						tone="google"
						disabled
						title="Google OAuth is not configured yet"
					/>
					<OAuthProviderButton
						label="Continue with Reddit"
						logo={<RedditLogo />}
						variant="square"
						tone="reddit"
						disabled
						title="Reddit OAuth is not configured yet"
					/>
					<OAuthProviderButton
						label="Continue with Steam"
						logo={<SteamLogo />}
						variant="square"
						tone="steam"
						disabled
						title="Steam OAuth is not configured yet"
					/>
					<OAuthProviderButton
						label="Continue with Xbox"
						logo={<XboxLogo />}
						variant="square"
						tone="xbox"
						disabled
						title="Xbox OAuth is not configured yet"
					/>
					<OAuthProviderButton
						label="Continue with Nintendo"
						logo={<NintendoLogo />}
						variant="square"
						tone="nintendo"
						disabled
						title="Nintendo OAuth is not configured yet"
					/>
					<OAuthProviderButton
						label="Continue with PlayStation"
						logo={<PlayStationLogo />}
						variant="square"
						tone="playstation"
						disabled
						title="PlayStation OAuth is not configured yet"
					/>
					<OAuthProviderButton
						label="Continue with ChatGPT"
						logo={<ChatGPTLogo />}
						variant="square"
						tone="chatgpt"
						disabled
						title="ChatGPT OAuth is not configured yet"
					/>
					<OAuthProviderButton
						label="Continue with Claude"
						logo={<ClaudeLogo />}
						variant="square"
						tone="claude"
						disabled
						title="Claude OAuth is not configured yet"
					/>
					<OAuthProviderButton
						label="Continue with DeepSeek"
						logo={<DeepSeekLogo />}
						variant="square"
						tone="deepseek"
						disabled
						title="DeepSeek OAuth is not configured yet"
					/>
					<OAuthProviderButton
						label="Continue with Perplexity"
						logo={<PerplexityLogo />}
						variant="square"
						tone="perplexity"
						disabled
						title="Perplexity OAuth is not configured yet"
					/>
				</div>
				<button
					className={`oauth-toggle ${isExpanded ? "oauth-toggle--expanded" : ""}`}
					type="button"
					aria-expanded={isExpanded}
					aria-label={
						isExpanded
							? "Collapse OAuth providers"
							: "Expand OAuth providers"
					}
					title={
						isExpanded
							? "Collapse OAuth providers"
							: "Expand OAuth providers"
					}
					onClick={() => setIsExpanded((current) => !current)}
				>
					<span className="oauth-toggle__chevron" aria-hidden="true">
						▾
					</span>
				</button>
			</div>
		</div>
	);
}
