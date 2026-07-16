import { createPortal } from "react-dom";
import { useRef } from "react";
import { useDialogFocusTrap } from "../../hooks/useDialogFocusTrap";
import type { AccountLinkConflict, AccountPreview, AuthMethod } from "./contracts";

const METHOD_LABELS: Record<AuthMethod, string> = {
	shellsmash: "ShellSmash",
	google: "Google",
	forty_two: "42",
};

function Preview({
	label,
	preview,
	duplicateMethods,
	side,
	disabled,
	onUnlink,
}: {
	label: string;
	preview: AccountPreview;
	duplicateMethods: AuthMethod[];
	side: "current" | "linked";
	disabled: boolean;
	onUnlink: (side: "current" | "linked", method: AuthMethod) => void;
}): JSX.Element {
	const stats = [
		["Level", preview.level],
		["XP", preview.xp],
		["Coins", preview.coins],
		["Matches", preview.games],
		["Achievements", preview.achievements],
		["Inventory", preview.inventory],
		["Friends", preview.friends],
		["Chats", preview.chats],
		["Replays", preview.replays],
	] as const;
	return (
		<article className="account-conflict__preview">
			<p className="account-conflict__label">{label}</p>
			<div className="account-conflict__identity">
				{preview.avatar ? (
					<img src={preview.avatar} alt="" />
				) : (
					<span aria-hidden="true">亀</span>
				)}
				<div>
					<strong>{preview.turtleName ?? preview.username}</strong>
					<small>@{preview.username}</small>
					<small>Active {new Date(preview.lastActivity).toLocaleDateString()}</small>
				</div>
			</div>
			<dl className="account-conflict__stats">
				{stats.map(([name, value]) => (
					<div key={name}>
						<dt>{name}</dt>
						<dd>{value.toLocaleString()}</dd>
					</div>
				))}
			</dl>
			<div className="account-conflict__methods">
				{preview.methods.map((method) => (
					<span key={method}>
						{METHOD_LABELS[method]}
						{duplicateMethods.includes(method) ? (
							<button
								type="button"
								disabled={disabled || preview.methods.length <= 1}
								onClick={() => onUnlink(side, method)}
							>
								Unlink
							</button>
						) : null}
					</span>
				))}
			</div>
		</article>
	);
}

export function AccountLinkConflictModal({
	conflict,
	disabled,
	error,
	onClose,
	onResolve,
	onUnlinkDuplicate,
}: {
	conflict: AccountLinkConflict;
	disabled: boolean;
	error: string;
	onClose: () => void;
	onResolve: (keep: "initiator" | "linked") => void;
	onUnlinkDuplicate: (side: "current" | "linked", method: AuthMethod) => void;
}): JSX.Element {
	const panelRef = useRef<HTMLElement>(null);
	const closeRef = useRef<HTMLButtonElement>(null);
	useDialogFocusTrap(panelRef, onClose, closeRef);
	const blocked = conflict.duplicateMethods.length > 0;

	return createPortal(
		<div className="account-conflict" role="dialog" aria-modal="true" aria-labelledby="account-conflict-title">
			<div className="account-conflict__backdrop" aria-hidden="true" />
			<section ref={panelRef} tabIndex={-1} className="account-conflict__panel">
				<header>
					<div>
						<p>Account consolidation</p>
						<h2 id="account-conflict-title">Choose the account to keep</h2>
					</div>
					<button ref={closeRef} type="button" onClick={onClose}>Close</button>
				</header>
				<p className="account-conflict__intro">
					The chosen preview is kept exactly as shown. Progress is never added or mixed.
				</p>
				{blocked ? (
					<p className="account-conflict__warning" role="alert">
						Unlink one copy of each duplicated method before continuing: {conflict.duplicateMethods.map((method) => METHOD_LABELS[method]).join(", ")}.
					</p>
				) : null}
				{error ? <p className="account-conflict__error" role="alert">{error}</p> : null}
				<div className="account-conflict__grid">
					<Preview label={conflict.labels.current} preview={conflict.current} duplicateMethods={conflict.duplicateMethods} side="current" disabled={disabled} onUnlink={onUnlinkDuplicate} />
					<Preview label={conflict.labels.linked} preview={conflict.linked} duplicateMethods={conflict.duplicateMethods} side="linked" disabled={disabled} onUnlink={onUnlinkDuplicate} />
				</div>
				<div className="account-conflict__actions">
					<button type="button" disabled={disabled || blocked} onClick={() => onResolve("initiator")}>{conflict.labels.keepCurrent}</button>
					<button type="button" disabled={disabled || blocked} onClick={() => onResolve("linked")}>{conflict.labels.keepLinked}</button>
				</div>
			</section>
		</div>,
		document.body,
	);
}
