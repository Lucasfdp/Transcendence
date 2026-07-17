import { api } from "../../features/hub/api";
import { OAuthProviderButton } from "./OAuthProviderButton";

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

function GoogleLogo(): JSX.Element {
	return (
		<ImageLogo src="/assets/oauth/google.svg" alt="Google" />
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
	return (
		<div className="auth-card__oauth">
			<div className="auth-card__divider">
				<span>OAuth access</span>
			</div>

			<div className="auth-card__oauth-stack">
				<div className="auth-card__oauth-grid">
					<OAuthProviderButton
						label="Continue with 42"
						logo={<FortyTwoLogo />}
						tone="42"
						disabled={isSubmitting}
						onClick={() => onOAuthLogin(api.loginUrl())}
					/>
					<OAuthProviderButton
						label="Continue with Google"
						logo={<GoogleLogo />}
						tone="google"
						disabled={isSubmitting}
						onClick={() => onOAuthLogin(api.googleLoginUrl())}
					/>
				</div>
			</div>
		</div>
	);
}
