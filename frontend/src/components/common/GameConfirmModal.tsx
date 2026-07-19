import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";

interface GameConfirmModalProps {
	isOpen: boolean;
	title: string;
	description: string;
	confirmLabel?: string;
	cancelLabel?: string;
	onConfirm: () => void;
	onCancel: () => void;
}

export function GameConfirmModal({
	isOpen,
	title,
	description,
	confirmLabel = "Confirm",
	cancelLabel = "Cancel",
	onConfirm,
	onCancel,
}: GameConfirmModalProps): JSX.Element | null {
	const titleId = useId();
	const descriptionId = useId();
	const cancelButtonRef = useRef<HTMLButtonElement>(null);
	const onCancelRef = useRef(onCancel);
	onCancelRef.current = onCancel;

	useEffect(() => {
		if (!isOpen) return;
		const previousOverflow = document.body.style.overflow;
		document.body.style.overflow = "hidden";
		cancelButtonRef.current?.focus();

		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") onCancelRef.current();
		};
		window.addEventListener("keydown", handleKeyDown);
		return () => {
			document.body.style.overflow = previousOverflow;
			window.removeEventListener("keydown", handleKeyDown);
		};
	}, [isOpen]);

	if (!isOpen) return null;

	return createPortal(
		<div
			className="game-confirm"
			role="alertdialog"
			aria-modal="true"
			aria-labelledby={titleId}
			aria-describedby={descriptionId}
		>
			<button
				className="game-confirm__backdrop"
				type="button"
				aria-label={`Close ${title}`}
				onClick={onCancel}
			/>
			<section className="game-confirm__panel">
				<header className="game-confirm__header">
					<p className="game-confirm__eyebrow">Make your choice</p>
					<h2 id={titleId}>{title}</h2>
				</header>
				<p id={descriptionId} className="game-confirm__description">
					{description}
				</p>
				<div className="game-confirm__actions">
					<button
						ref={cancelButtonRef}
						className="game-confirm__button game-confirm__button--cancel"
						type="button"
						onClick={onCancel}
					>
						{cancelLabel}
					</button>
					<button
						className="game-confirm__button game-confirm__button--danger"
						type="button"
						onClick={onConfirm}
					>
						{confirmLabel}
					</button>
				</div>
			</section>
		</div>,
		document.body,
	);
}
