import type { ReactNode } from "react";
import { Link } from "react-router-dom";

interface ViewProfileLinkProps {
	username: string;
	children?: ReactNode;
	className?: string;
}

export function ViewProfileLink({
	username,
	children = "View profile",
	className,
}: ViewProfileLinkProps): JSX.Element {
	return (
		<Link className={className} to={`/profile/${encodeURIComponent(username)}`}>
			{children}
		</Link>
	);
}
