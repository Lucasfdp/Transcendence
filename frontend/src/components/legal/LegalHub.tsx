import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { LegalModal } from "./LegalModal";

type LegalDocumentId = "privacy" | "terms";
type ConsentState = "accepted" | "essential";
type ReadState = Record<LegalDocumentId, boolean>;

type LegalDocument = {
	id: LegalDocumentId;
	title: string;
	path: string;
};

const CONSENT_STORAGE_KEY = "shellsmash-cookie-consent";

const DOCUMENTS: Record<LegalDocumentId, LegalDocument> = {
	privacy: {
		id: "privacy",
		title: "Privacy Policy",
		path: "/legal/privacy-policy.txt",
	},
	terms: {
		id: "terms",
		title: "Terms and Conditions",
		path: "/legal/terms-and-conditions.txt",
	},
};

const INITIAL_READ_STATE: ReadState = {
	privacy: false,
	terms: false,
};

export function LegalHub(): JSX.Element {
	const location = useLocation();
	const [consent, setConsent] = useState<ConsentState | null>(null);
	const [activeDocumentId, setActiveDocumentId] =
		useState<LegalDocumentId | null>(null);
	const [documents, setDocuments] = useState<
		Partial<Record<LegalDocumentId, string>>
	>({});
	const [isLoadingDocument, setIsLoadingDocument] = useState(false);
	const [documentError, setDocumentError] = useState("");
	const [readState, setReadState] = useState<ReadState>(INITIAL_READ_STATE);

	useEffect(() => {
		const storedConsent = window.localStorage.getItem(CONSENT_STORAGE_KEY);
		if (storedConsent === "accepted" || storedConsent === "essential") {
			setConsent(storedConsent);
		}
	}, []);

	useEffect(() => {
		if (!activeDocumentId || documents[activeDocumentId]) {
			return;
		}

		let cancelled = false;
		const { path } = DOCUMENTS[activeDocumentId];

		setIsLoadingDocument(true);
		setDocumentError("");

		void fetch(path)
			.then(async (response) => {
				if (!response.ok) {
					throw new Error(`Document request failed with ${response.status}`);
				}

				return response.text();
			})
			.then((text) => {
				if (cancelled) {
					return;
				}

				setDocuments((current) => ({
					...current,
					[activeDocumentId]: text,
				}));
			})
				.catch((error: unknown) => {
					console.warn("[LegalHub] Failed to load legal document:", error);
				if (!cancelled) {
					setDocumentError(
						"Could not load the document. Please try again in a few seconds.",
					);
				}
			})
			.finally(() => {
				if (!cancelled) {
					setIsLoadingDocument(false);
				}
			});

		return () => {
			cancelled = true;
		};
	}, [activeDocumentId, documents]);

	const isGameRoute = location.pathname === "/game";
	const activeDocument = activeDocumentId ? DOCUMENTS[activeDocumentId] : null;
	const hasReadEverything = readState.privacy && readState.terms;

	const openDocument = (documentId: LegalDocumentId) => {
		setDocumentError("");
		setActiveDocumentId(documentId);
	};

	const closeModal = () => {
		setActiveDocumentId(null);
		setDocumentError("");
	};

	const setConsentChoice = (value: ConsentState) => {
		window.localStorage.setItem(CONSENT_STORAGE_KEY, value);
		setConsent(value);
	};

	const markDocumentAsRead = (documentId: string) => {
		if (documentId !== "privacy" && documentId !== "terms") {
			return;
		}

		setReadState((current) => {
			if (current[documentId]) {
				return current;
			}

			return {
				...current,
				[documentId]: true,
			};
		});
	};

	return (
		<>
			{!isGameRoute ? (
				<div className="legal-dock" aria-label="Legal links">
					<button
						className="legal-dock__link"
						type="button"
						onClick={() => openDocument("privacy")}
					>
						Privacy policy
					</button>
					<button
						className="legal-dock__link"
						type="button"
						onClick={() => openDocument("terms")}
					>
						Terms and conditions
					</button>
				</div>
			) : null}

			{!consent && !isGameRoute ? (
					<section className="cookie-banner" aria-label="Cookie notice">
						<div className="cookie-banner__copy">
							<p className="cookie-banner__eyebrow">Cookies</p>
							<h2 className="cookie-banner__title">Session and legal access</h2>
							<p className="cookie-banner__text">
								We use essential cookies to keep login, CSRF protection,
								and the basic application state working. To accept all,
								you must open both documents and scroll to the bottom of
								each one.
							</p>

							<ul className="cookie-banner__checklist">
								<li className="cookie-banner__checklist-item">
									<span
										className={`cookie-banner__check ${
											readState.privacy
												? "cookie-banner__check--done"
												: ""
										}`}
										aria-hidden="true"
									>
										{readState.privacy ? "✓" : ""}
									</span>
									<button
										className="cookie-banner__inline-link"
										type="button"
										onClick={() => openDocument("privacy")}
									>
										Read privacy policy
									</button>
								</li>
								<li className="cookie-banner__checklist-item">
									<span
										className={`cookie-banner__check ${
											readState.terms
												? "cookie-banner__check--done"
												: ""
										}`}
										aria-hidden="true"
									>
										{readState.terms ? "✓" : ""}
									</span>
									<button
										className="cookie-banner__inline-link"
										type="button"
										onClick={() => openDocument("terms")}
									>
										Read terms and conditions
									</button>
								</li>
							</ul>
						</div>

						<div className="cookie-banner__actions">
							<button
							className="cookie-banner__button cookie-banner__button--secondary"
							type="button"
							onClick={() => setConsentChoice("essential")}
						>
							Essential only
						</button>
							<button
								className="cookie-banner__button cookie-banner__button--primary"
								type="button"
								onClick={() => setConsentChoice("accepted")}
								disabled={!hasReadEverything}
							>
								Accept
							</button>
						</div>
				</section>
			) : null}

			<LegalModal
				documentId={activeDocument?.id ?? ""}
				isOpen={activeDocument !== null}
				title={activeDocument?.title ?? ""}
				content={
					activeDocument ? documents[activeDocument.id] ?? "" : ""
				}
				isLoading={isLoadingDocument}
				error={documentError}
				onClose={closeModal}
				onReadComplete={markDocumentAsRead}
			/>
		</>
	);
}
