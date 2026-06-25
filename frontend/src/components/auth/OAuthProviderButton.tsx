interface OAuthProviderButtonProps {
	label: string;
	logo: JSX.Element;
	variant?: "full" | "square";
	tone?: string;
	disabled?: boolean;
	title?: string;
	onClick?: () => void;
}

export function OAuthProviderButton({
	label,
	logo,
	variant = "full",
	tone,
	disabled = false,
	title,
	onClick,
}: OAuthProviderButtonProps): JSX.Element {
	const className = [
		"oauth-button",
		variant === "square" ? "oauth-button--square" : "",
		tone ? `oauth-button--${tone}` : "",
	]
		.filter(Boolean)
		.join(" ");

	return (
		<button
			className={className}
			type="button"
			disabled={disabled}
			title={title ?? label}
			aria-label={label}
			onClick={onClick}
		>
			{logo}
			{variant === "full" ? <span>{label}</span> : null}
		</button>
	);
}
