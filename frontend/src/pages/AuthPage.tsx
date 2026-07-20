import { useEffect, useState } from "react";
import { useNavigate, Navigate } from "react-router-dom";
import { AuthCard, type AuthMode } from "../components/auth/AuthCard";
import { registrationPrefill } from "../components/auth/registrationPrefill";
import { TempleBackdrop } from "../components/layout/TempleBackdrop";
import { RouteLoading } from "../components/common/RouteLoading";
import { useSessionGate } from "../hooks/useSessionGate";
import { api, AuthError, NetworkError } from "../features/hub/api";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function AuthPage(): JSX.Element {
	const navigate = useNavigate();
	const { status } = useSessionGate();
	const [loginBackdropVersion] = useState(() => Date.now().toString());
	const [mode, setMode] = useState<AuthMode>("login");
	const [identifier, setIdentifier] = useState("");
	const [username, setUsername] = useState("");
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [isSubmitting, setIsSubmitting] = useState(false);
	const [csrfReady, setCsrfReady] = useState(false);
	const [error, setError] = useState("");

	useEffect(() => {
		let cancelled = false;
		void api
			.getCsrfToken()
			.then(() => {
				if (!cancelled) {
					setCsrfReady(true);
				}
			})
			.catch((err: unknown) => {
				if (!cancelled) {
					console.warn("[AuthPage] Failed to initialise authentication:", err);
					setError("Authentication is temporarily unavailable.");
				}
			});

		return () => {
			cancelled = true;
		};
	}, []);

	const ensureCsrf = async (): Promise<void> => {
		if (csrfReady) return;
		await api.getCsrfToken();
		setCsrfReady(true);
	};

	const handleLocalLogin = async (): Promise<void> => {
		const nextIdentifier = identifier.trim();
		if (!nextIdentifier || !password) {
			setError("Enter your email or username and password.");
			return;
		}

		setIsSubmitting(true);
		setError("");
		try {
			await ensureCsrf();
			await api.login(nextIdentifier, password);
			navigate("/", { replace: true });
		} catch (err: unknown) {
			if (err instanceof AuthError) {
				if (err.status === 403) {
					setError(err.message);
				} else if (err.status === 401) {
					setError("Invalid email, username or password.");
				} else if (err.status === 400 || err.status === 422) {
					setError(err.message);
				} else if (err.status === 429) {
					setError("Too many attempts. Wait a moment and try again.");
				} else if (err.status >= 502 && err.status <= 504) {
					// Rankings Bug Audit §3.3: nginx answers 502/503/504 while
					// the backend is down or restarting. This used to fall into
					// the generic "check your credentials" branch, which reads
					// as an authentication problem and sent testers restarting
					// the whole stack to "fix" logins.
					setError(
						"The game server is unreachable or restarting — this is not a problem with your credentials. Try again shortly.",
					);
				} else {
					setError("Login failed. Check your credentials and try again.");
				}
			} else if (err instanceof NetworkError) {
				setError("Could not reach the server.");
			} else {
				setError("Login failed.");
			}
		} finally {
			setIsSubmitting(false);
		}
	};

	const handleRegister = async (): Promise<void> => {
		const nextUsername = username.trim();
		const nextEmail = email.trim().toLowerCase();
		if (!nextUsername || !nextEmail || !password) {
			setError("Enter a username, email and password.");
			return;
		}
		if (!EMAIL_RE.test(nextEmail)) {
			setError("Enter a valid email address.");
			return;
		}

		setIsSubmitting(true);
		setError("");
		try {
			await ensureCsrf();
			await api.register(nextUsername, nextEmail, password);
			navigate("/", { replace: true });
		} catch (err: unknown) {
			if (err instanceof AuthError) {
				if (err.status === 409) {
					setError("That username or email is already in use.");
				} else if (err.status === 400 || err.status === 422) {
					setError(err.message);
				} else if (err.status === 429) {
					setError(
						"Too many registration attempts. Wait a moment and try again.",
					);
				} else if (err.status >= 502 && err.status <= 504) {
					// See the matching branch in handleLogin (§3.3): a gateway
					// error means the backend is down, not a bad form.
					setError(
						"The game server is unreachable or restarting — try again shortly.",
					);
				} else if (err.status >= 500) {
					setError("The server could not complete the registration.");
				} else {
					setError("Could not create the account.");
				}
			} else if (err instanceof NetworkError) {
				setError("Could not reach the server.");
			} else {
				setError("Could not create the account.");
			}
		} finally {
			setIsSubmitting(false);
		}
	};

	const handleSubmit = (event: React.FormEvent<HTMLFormElement>): void => {
		event.preventDefault();
		if (isSubmitting) return;
		void (mode === "register" ? handleRegister() : handleLocalLogin());
	};

	const handleOAuthLogin = (url: string): void => {
		window.location.assign(url);
	};

	const handleGuestLogin = async (): Promise<void> => {
		if (isSubmitting) return;
		setIsSubmitting(true);
		setError("");
		try {
			await ensureCsrf();
			await api.guestLogin();
			navigate("/", { replace: true });
		} catch (err: unknown) {
			if (err instanceof AuthError && err.status === 429) {
				setError("Too many guest sessions. Wait a moment and try again.");
			} else if (err instanceof NetworkError) {
				setError("Could not reach the server.");
			} else {
				setError("Could not create a guest session.");
			}
		} finally {
			setIsSubmitting(false);
		}
	};

	const handleModeChange = (nextMode: AuthMode): void => {
		if (mode === "login" && nextMode === "register") {
			const prefill = registrationPrefill(identifier);
			if (prefill.email) {
				setEmail((currentEmail) => currentEmail || prefill.email);
			} else if (prefill.username) {
				setUsername((currentUsername) =>
					currentUsername || prefill.username,
				);
			}
		}
		setMode(nextMode);
		setError("");
	};

	if (status === "checking") return <RouteLoading />;
	if (status === "authenticated") return <Navigate to="/" replace />;

	return (
		<main
			className="auth-page"
			style={
				{
					"--auth-login-bg": `url("/assets/backgrounds/login_bg.png?v=${loginBackdropVersion}")`,
				} as React.CSSProperties
			}
		>
			<TempleBackdrop pageClassName="auth-page" />

			<p className="auth-page__disclaimer">
				This is a work of fiction. Any resemblance to actual persons,
				living or dead, or actual events is purely coincidental.
			</p>

			<section className="auth-page__shell">
				<div className="auth-page__intro">
					<h1 className="auth-page__logo-title">
						<img
							className="auth-page__logo"
							src="/assets/logoShellSmash.png"
							alt="Shell Smash"
						/>
					</h1>
					<p className="auth-page__description">
						Access the courtyard first. Once your session is active,
						the main menu will be unlocked.
					</p>
				</div>

				<AuthCard
					mode={mode}
					identifier={identifier}
					username={username}
					email={email}
					password={password}
					error={error}
					isSubmitting={isSubmitting}
					onModeChange={handleModeChange}
					onIdentifierChange={setIdentifier}
					onUsernameChange={setUsername}
					onEmailChange={setEmail}
					onPasswordChange={setPassword}
					onSubmit={handleSubmit}
					onOAuthLogin={handleOAuthLogin}
					onGuestLogin={() => void handleGuestLogin()}
				/>
			</section>
		</main>
	);
}
