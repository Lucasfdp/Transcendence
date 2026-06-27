interface OAuthProviderButtonProps {
	label: string;
	logo: JSX.Element;
	variant?: "full" | "square";
	tone?: string;
	disabled?: boolean;
	title?: string;
	onClick?: () => void;
	className?: string;
}

export function OAuthProviderButton({
	label,
	logo,
	variant = "full",
	tone,
	disabled = false,
	title,
	onClick,
	className,
}: OAuthProviderButtonProps): JSX.Element {
	const buttonClassName = [
		"oauth-button",
		variant === "square" ? "oauth-button--square" : "",
		tone ? `oauth-button--${tone}` : "",
		className ?? "",
	]
		.filter(Boolean)
		.join(" ");

	return (
		<button
			className={buttonClassName}
			type="button"
			disabled={disabled}
			title={title ?? label}
			aria-label={label}
			onClick={onClick}
		>
			{logo}
			<span className="oauth-button__label">{label}</span>
		</button>
	);
}
