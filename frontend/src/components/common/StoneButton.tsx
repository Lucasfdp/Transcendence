import type { ButtonHTMLAttributes, ReactNode } from "react";
import { STONE_BUTTON_ASSETS } from "../../shared/assets";

export interface StoneButtonProps
	extends ButtonHTMLAttributes<HTMLButtonElement> {
	children: ReactNode;
	variant?: keyof typeof STONE_BUTTON_ASSETS;
}

export function StoneButton({
	children,
	className,
	variant = "base",
	...props
}: StoneButtonProps): JSX.Element {
	return (
		<button
			className={[
				"stone-button",
				`stone-button--${variant}`,
				className,
			]
				.filter(Boolean)
				.join(" ")}
			{...props}
		>
			<img
				className="stone-button__image"
				src={STONE_BUTTON_ASSETS[variant]}
				alt=""
				aria-hidden="true"
			/>
			<span className="stone-button__content">{children}</span>
		</button>
	);
}
