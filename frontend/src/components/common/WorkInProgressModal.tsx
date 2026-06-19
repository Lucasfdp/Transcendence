import { useEffect } from "react";
import { createPortal } from "react-dom";
import {
	WorkInProgressNotice,
	type WorkInProgressNoticeProps,
} from "./WorkInProgressNotice";

type WorkInProgressModalProps = WorkInProgressNoticeProps & {
	isOpen: boolean;
	onClose: () => void;
	closeLabel?: string;
};

export function WorkInProgressModal({
	isOpen,
	onClose,
	closeLabel = "Back to Menu",
	...noticeProps
}: WorkInProgressModalProps): JSX.Element | null {
	useEffect(() => {
		if (!isOpen) return;

		const previousOverflow = document.body.style.overflow;
		document.body.style.overflow = "hidden";

		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				onClose();
			}
		};

		window.addEventListener("keydown", handleKeyDown);
		return () => {
			document.body.style.overflow = previousOverflow;
			window.removeEventListener("keydown", handleKeyDown);
		};
	}, [isOpen, onClose]);

	if (!isOpen) {
		return null;
	}

	return createPortal(
		<div
			className="wip-modal"
			role="dialog"
			aria-modal="true"
			aria-labelledby="wip-modal-title"
		>
			<button
				className="wip-modal__backdrop"
				type="button"
				aria-label="Close work in progress modal"
				onClick={onClose}
			/>

			<div className="wip-modal__panel">
				<div id="wip-modal-title" className="wip-modal__content">
					<WorkInProgressNotice {...noticeProps} />
				</div>

				<div className="wip-modal__actions">
					<button
						className="wip-modal__button"
						type="button"
						onClick={onClose}
					>
						{closeLabel}
					</button>
				</div>
			</div>
		</div>,
		document.body,
	);
}
