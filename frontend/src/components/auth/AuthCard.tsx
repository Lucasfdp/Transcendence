import { OAuthButtons } from "./OAuthButtons";

export type AuthMode = "login" | "register";

interface AuthCardProps {
	mode: AuthMode;
	identifier: string;
	username: string;
	email: string;
	password: string;
	error: string;
	isSubmitting: boolean;
	onModeChange: (mode: AuthMode) => void;
	onIdentifierChange: (value: string) => void;
	onUsernameChange: (value: string) => void;
	onEmailChange: (value: string) => void;
	onPasswordChange: (value: string) => void;
	onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
	onOAuthLogin: (url: string) => void;
	onGuestLogin: () => void;
}

export function AuthCard({
	mode,
	identifier,
	username,
	email,
	password,
	error,
	isSubmitting,
	onModeChange,
	onIdentifierChange,
	onUsernameChange,
	onEmailChange,
	onPasswordChange,
	onSubmit,
	onOAuthLogin,
	onGuestLogin,
}: AuthCardProps): JSX.Element {
	const isRegistering = mode === "register";

	return (
		<section className="auth-card" aria-labelledby="login-title">
			<p className="auth-card__kicker">Player Access</p>
			<h2 className="auth-card__title" id="login-title">
				{isRegistering ? "Create account" : "Login"}
			</h2>
			<p className="auth-card__copy">
				{isRegistering
					? "Register with an email address you can access."
					: "Use your email, username or an OAuth provider."}
			</p>

			<form className="auth-card__form" onSubmit={onSubmit}>
				{isRegistering ? (
					<>
						<label className="auth-card__field">
							<span className="auth-card__field-label">Username</span>
							<input
								autoComplete="username"
								name="username"
								type="text"
								maxLength={20}
								value={username}
								onChange={(event) =>
									onUsernameChange(event.target.value)
								}
							/>
						</label>

						<label className="auth-card__field">
							<span className="auth-card__field-label">Email</span>
							<input
								autoComplete="email"
								name="email"
								type="email"
								maxLength={254}
								value={email}
								onChange={(event) =>
									onEmailChange(event.target.value)
								}
							/>
						</label>
					</>
				) : (
					<label className="auth-card__field">
						<span className="auth-card__field-label">
							Email or username
						</span>
						<input
							autoComplete="username"
							name="identifier"
							type="text"
							value={identifier}
							onChange={(event) =>
								onIdentifierChange(event.target.value)
							}
						/>
					</label>
				)}

				<label className="auth-card__field">
					<span className="auth-card__field-label">Password</span>
					<input
						autoComplete={
							isRegistering ? "new-password" : "current-password"
						}
						name="password"
						type="password"
						minLength={8}
						maxLength={128}
						value={password}
						onChange={(event) =>
							onPasswordChange(event.target.value)
						}
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
					{isSubmitting
						? isRegistering
							? "Creating account..."
							: "Signing in..."
						: isRegistering
							? "Create account"
							: "Sign in"}
				</button>

				<div className="auth-card__aux-links" aria-label="Secondary actions">
					{isRegistering ? (
						<button
							className="auth-card__text-link"
							type="button"
							disabled={isSubmitting}
							onClick={() => onModeChange("login")}
						>
							Back to login
						</button>
					) : (
						<>
							<button
								className="auth-card__text-link"
								type="button"
								disabled={isSubmitting}
								onClick={onGuestLogin}
							>
								Enter as Guest
							</button>
							<span className="auth-card__aux-separator" aria-hidden="true">
								|
							</span>
							<button
								className="auth-card__text-link"
								type="button"
								disabled={isSubmitting}
								onClick={() => onModeChange("register")}
							>
								Register
							</button>
						</>
					)}
				</div>
			</form>

			{!isRegistering ? (
				<OAuthButtons
					isSubmitting={isSubmitting}
					onOAuthLogin={onOAuthLogin}
				/>
			) : null}
		</section>
	);
}
