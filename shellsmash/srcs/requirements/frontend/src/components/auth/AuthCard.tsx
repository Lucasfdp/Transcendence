import { OAuthButtons } from './OAuthButtons';

interface AuthCardProps {
  username: string;
  password: string;
  error: string;
  isSubmitting: boolean;
  onUsernameChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
  onOAuthLogin: (url: string) => void;
}

export function AuthCard({
  username,
  password,
  error,
  isSubmitting,
  onUsernameChange,
  onPasswordChange,
  onSubmit,
  onOAuthLogin,
}: AuthCardProps): JSX.Element {
  return (
    <section className="auth-card" aria-labelledby="login-title">
      <p className="auth-card__kicker">Player Access</p>
      <h2 className="auth-card__title" id="login-title">Login</h2>
      <p className="auth-card__copy">
        Use your local account or continue with an OAuth provider.
      </p>

      <form className="auth-card__form" onSubmit={onSubmit}>
        <label className="auth-card__field">
          <span className="auth-card__field-label">Username</span>
          <input
            autoComplete="username"
            name="username"
            type="text"
            value={username}
            onChange={(event) => onUsernameChange(event.target.value)}
          />
        </label>

        <label className="auth-card__field">
          <span className="auth-card__field-label">Password</span>
          <input
            autoComplete="current-password"
            name="password"
            type="password"
            value={password}
            onChange={(event) => onPasswordChange(event.target.value)}
          />
        </label>

        <p className="auth-card__error" role="alert">
          {error}
        </p>

        <button
          className="auth-card__submit"
          type="submit"
          disabled={isSubmitting}
        >
          {isSubmitting ? 'Signing in...' : 'Sign in'}
        </button>
      </form>

      <OAuthButtons onOAuthLogin={onOAuthLogin} />
    </section>
  );
}
