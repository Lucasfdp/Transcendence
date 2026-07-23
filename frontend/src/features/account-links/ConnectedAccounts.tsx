import type { AuthMethod } from "./contracts";
import { AccountLinkConflictModal } from "./AccountLinkConflictModal";
import { ShellsmashAccountForms } from "./ShellsmashAccountForms";
import { useAccountLinks } from "./useAccountLinks";

const DETAILS: Record<AuthMethod, { title: string; mark: string; copy: string }> = {
	shellsmash: { title: "ShellSmash account", mark: "亀", copy: "Sign in with your ShellSmash username or email and password." },
	forty_two: { title: "42", mark: "42", copy: "Connect your 42 intra identity." },
};

export function ConnectedAccounts(): JSX.Element {
	const links = useAccountLinks();

	return (
		<section className="connected-accounts" aria-labelledby="connected-accounts-title">
			<div className="connected-accounts__heading">
				<div><p>Sign-in methods</p><h3 id="connected-accounts-title">Connected accounts</h3></div>
				<span>{links.state?.methods.filter((method) => method.linked).length ?? 0}/2 linked</span>
			</div>
			{links.state?.conflict && !links.conflictOpen ? (
				<button className="connected-accounts__alert" type="button" onClick={() => links.setConflictOpen(true)}>
					Account conflict pending — resolve it now
				</button>
			) : null}
			{links.error ? <p className="connected-accounts__error" role="alert">{links.error}</p> : null}
			{links.loading ? <p>Loading connected accounts…</p> : (
				<div className="connected-accounts__grid">
					{links.state?.methods.map(({ method, linked }) => {
						const detail = DETAILS[method];
						return (
							<article className={`connected-account${linked ? " connected-account--linked" : ""}`} key={method}>
								<div className="connected-account__top"><span className="connected-account__mark" aria-hidden="true">{detail.mark}</span><div><h4>{detail.title}</h4><p>{detail.copy}</p></div><strong>{linked ? "Linked" : "Not linked"}</strong></div>
								{linked ? (
									<button className="connected-account__unlink" type="button" disabled={links.submitting} onClick={() => void links.unlink(method)}>Unlink</button>
								) : method === "shellsmash" ? (
									<ShellsmashAccountForms prefill={links.state.prefill} disabled={links.submitting} onCreate={(data) => void links.createShellsmash(data)} onLink={(data) => void links.linkShellsmash(data)} />
								) : (
									<button type="button" disabled={links.submitting} onClick={() => void links.startOAuth(method)}>Link {detail.title}</button>
								)}
							</article>
						);
					})}
				</div>
			)}
			{links.state?.conflict && links.conflictOpen ? (
				<AccountLinkConflictModal conflict={links.state.conflict} disabled={links.submitting} error={links.error} onClose={() => links.setConflictOpen(false)} onResolve={(keep) => void links.resolve(keep)} onUnlinkDuplicate={(side, method) => void links.unlinkDuplicate(side, method)} />
			) : null}
		</section>
	);
}
