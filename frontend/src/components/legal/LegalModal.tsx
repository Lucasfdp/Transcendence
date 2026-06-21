import { useEffect } from "react";
import { createPortal } from "react-dom";

type LegalModalProps = {
	documentId: string;
	isOpen: boolean;
	title: string;
	content: string;
	isLoading: boolean;
	error: string;
	onClose: () => void;
	onReadComplete: (documentId: string) => void;
};

export function LegalModal({
	documentId,
	isOpen,
	title,
	content,
	isLoading,
	error,
	onClose,
	onReadComplete,
}: LegalModalProps): JSX.Element | null {
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

	const handleContentScroll = (
		event: React.UIEvent<HTMLPreElement, UIEvent>,
	) => {
		const target = event.currentTarget;
		const reachedBottom =
			target.scrollTop + target.clientHeight >= target.scrollHeight - 8;

		if (reachedBottom) {
			onReadComplete(documentId);
		}
	};

	return createPortal(
		<div
			className="legal-modal"
			role="dialog"
			aria-modal="true"
			aria-labelledby="legal-modal-title"
		>
			<button
				className="legal-modal__backdrop"
				type="button"
				aria-label="Close legal modal"
				onClick={onClose}
			/>

			<div className="legal-modal__panel">
				<header className="legal-modal__header">
					<div>
						<p className="legal-modal__eyebrow">Legal Archive</p>
						<h2 id="legal-modal-title" className="legal-modal__title">
							{title}
						</h2>
					</div>

					<button
						className="legal-modal__close"
						type="button"
						onClick={onClose}
					>
						Close
					</button>
				</header>

				<div className="legal-modal__body">
					{isLoading ? (
						<p className="legal-modal__status">Loading document...</p>
					) : null}
					{error ? (
						<p className="legal-modal__status legal-modal__status--error">
							{error}
						</p>
					) : null}
						{!isLoading && !error ? (
							<pre
								className="legal-modal__content"
								onScroll={handleContentScroll}
							>
								{content}
							</pre>
						) : null}
					</div>
				</div>
		</div>,
		document.body,
	);
}
