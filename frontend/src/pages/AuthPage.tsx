import { useEffect, useState } from "react";
import { useNavigate, Navigate } from "react-router-dom";
import { AuthCard } from "../components/auth/AuthCard";
import { TempleBackdrop } from "../components/layout/TempleBackdrop";
import { RouteLoading } from "../components/common/RouteLoading";
import { useSessionGate } from "../hooks/useSessionGate";
import { api, AuthError, NetworkError } from "../features/hub/api";

export function AuthPage(): JSX.Element {
	const navigate = useNavigate();
	const { status } = useSessionGate();
	const [loginBackdropVersion] = useState(() => Date.now().toString());
	const [username, setUsername] = useState("");
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
				console.warn("[AuthPage] Failed to preload CSRF token:", err);
				if (!cancelled) {
					setError("Authentication is temporarily unavailable.");
				}
			});

		return () => {
			cancelled = true;
		};
	}, []);

	const handleLocalLogin = async (
		event: React.FormEvent<HTMLFormElement>,
	) => {
		event.preventDefault();
		if (isSubmitting) return;

		const nextUsername = username.trim();
		if (!nextUsername || !password) {
			setError("Enter your username and password.");
			return;
		}

		setIsSubmitting(true);
		setError("");
		try {
			if (!csrfReady) {
				await api.getCsrfToken();
				setCsrfReady(true);
			}
			await api.login(nextUsername, password);
			navigate("/", { replace: true });
		} catch (err: unknown) {
			if (err instanceof AuthError) {
				if (err.status === 401 || err.status === 403) {
					setError(
						"Invalid credentials or missing session permissions.",
					);
				} else if (err.status === 400 || err.status === 422) {
					setError(err.message);
				} else if (err.status === 429) {
					setError("Too many attempts. Wait a moment and try again.");
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

	const handleOAuthLogin = (url: string) => {
		window.location.assign(url);
	};

	const handleGuestLogin = async () => {
		if (isSubmitting) return;

		setIsSubmitting(true);
		setError("");
		try {
			if (!csrfReady) {
				await api.getCsrfToken();
				setCsrfReady(true);
			}
			await api.guestLogin();
			navigate("/", { replace: true });
		} catch (err: unknown) {
			if (err instanceof AuthError) {
				if (err.status === 429) {
					setError(
						"Too many guest sessions. Wait a moment and try again.",
					);
				} else if (err.status === 401 || err.status === 403) {
					setError("Guest access is temporarily unavailable.");
				} else if (err.status === 400 || err.status === 422) {
					setError(err.message);
				} else {
					setError("Could not create a guest session.");
				}
			} else if (err instanceof NetworkError) {
				setError("Could not reach the server.");
			} else {
				setError("Could not create a guest session.");
			}
		} finally {
			setIsSubmitting(false);
		}
	};

	const handleRegister = async () => {
		if (isSubmitting) return;

		const nextUsername = username.trim();
		if (!nextUsername || !password) {
			setError("Enter your username and password.");
			return;
		}

		setIsSubmitting(true);
		setError("");
		try {
			if (!csrfReady) {
				await api.getCsrfToken();
				setCsrfReady(true);
			}
			await api.register(nextUsername, password);
			navigate("/", { replace: true });
		} catch (err: unknown) {
			if (err instanceof AuthError) {
				if (err.status === 409) {
					setError("That username is already taken.");
				} else if (err.status === 400 || err.status === 422) {
					setError(err.message);
				} else if (err.status === 429) {
					setError(
						"Too many registration attempts. Wait a moment and try again.",
					);
				} else if (err.status === 401 || err.status === 403) {
					setError("Registration is temporarily unavailable.");
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

	if (status === "checking") {
		return <RouteLoading />;
	}

	if (status === "authenticated") {
		return <Navigate to="/" replace />;
	}

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

			<section className="auth-page__shell">
				<div className="auth-page__intro">
					<p className="auth-page__eyebrow">Dojo Gate</p>
					<h1 className="auth-page__title">Shell Smash</h1>
					<p className="auth-page__description">
						Access the courtyard first. Once your session is active,
						the main menu will be unlocked.
					</p>
				</div>

				<AuthCard
					username={username}
					password={password}
					error={error}
					isSubmitting={isSubmitting}
					onUsernameChange={setUsername}
					onPasswordChange={setPassword}
					onSubmit={handleLocalLogin}
					onOAuthLogin={handleOAuthLogin}
					onGuestLogin={handleGuestLogin}
					onRegister={handleRegister}
				/>
			</section>
		</main>
	);
}
