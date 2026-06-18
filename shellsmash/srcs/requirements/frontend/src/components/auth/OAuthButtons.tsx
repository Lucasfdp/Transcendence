import { api } from '../../hub/api';

const GITHUB_AUTH_URL = import.meta.env.VITE_GITHUB_AUTH_URL ?? '';

function FortyTwoLogo(): JSX.Element {
  return (
    <svg aria-hidden="true" className="oauth-button__logo oauth-button__logo--42" viewBox="0 0 32 24">
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
    <svg aria-hidden="true" className="oauth-button__logo" viewBox="0 0 24 24">
      <path
        fill="currentColor"
        d="M12 .5a12 12 0 0 0-3.79 23.39c.6.12.82-.26.82-.58v-2.05c-3.34.72-4.04-1.42-4.04-1.42-.54-1.4-1.34-1.76-1.34-1.76-1.1-.75.08-.73.08-.73 1.22.08 1.86 1.25 1.86 1.25 1.08 1.85 2.84 1.31 3.53 1 .1-.79.42-1.31.76-1.61-2.66-.3-5.46-1.34-5.46-5.93 0-1.31.47-2.37 1.24-3.21-.12-.31-.54-1.56.12-3.25 0 0 1.01-.32 3.3 1.23a11.4 11.4 0 0 1 6 0c2.28-1.55 3.29-1.23 3.29-1.23.67 1.69.25 2.94.12 3.25.78.84 1.24 1.9 1.24 3.21 0 4.61-2.8 5.62-5.48 5.92.43.37.82 1.1.82 2.22v3.29c0 .32.22.71.83.58A12 12 0 0 0 12 .5Z"
      />
    </svg>
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

      <div className="auth-card__oauth-list">
        <button
          className="oauth-button oauth-button--42"
          type="button"
          disabled={isSubmitting}
          onClick={() => onOAuthLogin(api.loginUrl())}
        >
          <FortyTwoLogo />
          <span>Continue with 42</span>
        </button>

        <button
          className="oauth-button oauth-button--github"
          type="button"
          disabled={isSubmitting || !GITHUB_AUTH_URL}
          onClick={() => onOAuthLogin(GITHUB_AUTH_URL)}
          title={GITHUB_AUTH_URL ? 'Continue with GitHub' : 'GitHub OAuth is not configured yet'}
        >
          <GitHubLogo />
          <span>Continue with GitHub</span>
        </button>
      </div>
    </div>
  );
}
