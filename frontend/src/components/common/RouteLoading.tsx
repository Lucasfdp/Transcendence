export function RouteLoading(): JSX.Element {
	return (
		<div className="route-loading">
			<div className="route-loading-spinner" aria-hidden="true" />
			<span className="route-loading-label">Loading route</span>
		</div>
	);
}
