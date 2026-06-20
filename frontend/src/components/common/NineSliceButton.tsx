import type { ButtonHTMLAttributes, CSSProperties, ReactNode } from "react";
import { UI_9SLICE_BUTTON_PANEL } from "../../shared/assets";

interface NineSliceButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
	children: ReactNode;
}

type NineSliceStyle = CSSProperties & {
	"--nine-slice-source": string;
	"--nine-slice-slice": string;
	"--nine-slice-width": string;
};

export function NineSliceButton({
	children,
	className,
	style,
	...props
}: NineSliceButtonProps): JSX.Element {
	const nineSliceStyle: NineSliceStyle = {
		"--nine-slice-source": `url(${UI_9SLICE_BUTTON_PANEL.source})`,
		"--nine-slice-slice": `${UI_9SLICE_BUTTON_PANEL.slice}`,
		"--nine-slice-width": `${UI_9SLICE_BUTTON_PANEL.slice}px`,
		...style,
	};

	return (
		<button
			className={["nine-slice-button", className].filter(Boolean).join(" ")}
			style={nineSliceStyle}
			{...props}
		>
			{children}
		</button>
	);
}
