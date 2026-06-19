export type WorkInProgressNoticeProps = {
	featureName?: string;
	title?: string;
	description?: string;
	imageSrc?: string;
	imageWebpSrc?: string;
	imageAlt?: string;
};

export function WorkInProgressNotice({
	featureName,
	title,
	description,
	imageSrc = "/assets/img/wip.png",
	imageWebpSrc = "/assets/img/wip.webp",
	imageAlt = "Work in progress illustration",
}: WorkInProgressNoticeProps): JSX.Element {
	const hasText = Boolean(featureName || title || description);

	return (
		<div className="wip-notice">
			<div className="wip-notice__art-frame">
				<picture>
					<source srcSet={imageWebpSrc} type="image/webp" />
					<img
						className="wip-notice__image"
						src={imageSrc}
						alt={imageAlt}
						width={960}
						height={960}
						decoding="async"
						loading="eager"
						fetchPriority="high"
					/>
				</picture>
			</div>

			{hasText ? (
				<div className="wip-notice__body">
					{featureName ? (
						<span className="wip-notice__eyebrow">{featureName}</span>
					) : null}
					{title ? <h2 className="wip-notice__title">{title}</h2> : null}
					{description ? (
						<p className="wip-notice__description">{description}</p>
					) : null}
				</div>
			) : null}
		</div>
	);
}
