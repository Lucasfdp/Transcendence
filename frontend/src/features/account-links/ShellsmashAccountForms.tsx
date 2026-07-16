import { useEffect, useState } from "react";

export function ShellsmashAccountForms({
	prefill,
	disabled,
	onCreate,
	onLink,
}: {
	prefill: { username: string; email: string };
	disabled: boolean;
	onCreate: (data: { username: string; email: string; password: string }) => void;
	onLink: (data: { identifier: string; password: string }) => void;
}): JSX.Element {
	const [mode, setMode] = useState<"none" | "create" | "link">("none");
	const [username, setUsername] = useState(prefill.username);
	const [email, setEmail] = useState(prefill.email);
	const [password, setPassword] = useState("");
	const [identifier, setIdentifier] = useState("");

	useEffect(() => {
		setUsername((value) => value || prefill.username);
		setEmail((value) => value || prefill.email);
	}, [prefill.email, prefill.username]);

	if (mode === "none") {
		return (
			<div className="connected-account__actions">
				<button type="button" disabled={disabled} onClick={() => setMode("create")}>Create account</button>
				<button type="button" disabled={disabled} onClick={() => setMode("link")}>Link existing account</button>
			</div>
		);
	}

	return (
		<form
			className="connected-account__form"
			onSubmit={(event) => {
				event.preventDefault();
				if (mode === "create") onCreate({ username: username.trim(), email: email.trim(), password });
				else onLink({ identifier: identifier.trim(), password });
			}}
		>
			{mode === "create" ? (
				<>
					<label>Username<input required pattern="[A-Za-z0-9_]{1,20}" maxLength={20} autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} /></label>
					<label>Email<input required type="email" maxLength={254} autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label>
				</>
			) : (
				<label>Email or username<input required autoComplete="username" value={identifier} onChange={(event) => setIdentifier(event.target.value)} /></label>
			)}
			<label>Password<input required type="password" minLength={8} maxLength={128} autoComplete={mode === "create" ? "new-password" : "current-password"} value={password} onChange={(event) => setPassword(event.target.value)} /></label>
			<div className="connected-account__actions">
				<button type="button" disabled={disabled} onClick={() => { setMode("none"); setPassword(""); }}>Cancel</button>
				<button type="submit" disabled={disabled}>{disabled ? "Working…" : mode === "create" ? "Create account" : "Link account"}</button>
			</div>
		</form>
	);
}
