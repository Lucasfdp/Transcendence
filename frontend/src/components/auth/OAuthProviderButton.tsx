interface OAuthProviderButtonProps {
	label: string;
	logo: JSX.Element;
	tone?: string;
	disabled?: boolean;
	title?: string;
	onClick?: () => void;
}

export function OAuthProviderButton({
	label,
	logo,
	tone,
	disabled = false,
	title,
	onClick,
}: OAuthProviderButtonProps): JSX.Element {
	const buttonClassName = [
		"oauth-button",
		tone ? `oauth-button--${tone}` : "",
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
