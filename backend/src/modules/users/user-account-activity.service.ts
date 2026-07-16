import { Injectable } from "@nestjs/common";

/** Process-local queue markers complement persisted active-match checks. */
@Injectable()
export class UserAccountActivityService {
	private readonly queuedUsers = new Set<number>();

	setQueued(userId: number, queued: boolean): void {
		if (queued) this.queuedUsers.add(userId);
		else this.queuedUsers.delete(userId);
	}

	isQueued(userId: number): boolean {
		return this.queuedUsers.has(userId);
	}
}
