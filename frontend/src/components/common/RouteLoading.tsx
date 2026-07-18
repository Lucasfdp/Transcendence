export function RouteLoading(): JSX.Element {
	return (
		<div className="grid min-h-screen place-items-center gap-[0.9rem]">
			<div
				className="h-12 w-12 animate-route-loading-spin rounded-full border-[0.24rem] border-solid border-[rgba(241,211,145,0.16)] border-r-[var(--accent)] border-t-[var(--accent-strong)]"
				aria-hidden="true"
			/>
			<span className="text-[0.8rem] uppercase tracking-[0.15em] text-[var(--accent)]">
				Loading route
			</span>
		</div>
	);
}
