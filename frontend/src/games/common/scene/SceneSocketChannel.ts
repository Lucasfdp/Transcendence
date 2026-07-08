interface SocketLike {
	on(event: string, listener: (...args: any[]) => void): void;
	off(event: string, listener: (...args: any[]) => void): void;
}

interface SocketListenerRegistration {
	readonly event: string;
	readonly listener: (...args: any[]) => void;
}

export class SceneSocketChannel {
	private readonly registrations: SocketListenerRegistration[] = [];

	constructor(private readonly getSocket: () => SocketLike) {}

	on(event: string, listener: (...args: any[]) => void): void {
		const socket = this.getSocket();
		socket.off(event, listener);
		socket.on(event, listener);
		this.registrations.push({ event, listener });
	}

	removeAll(): void {
		if (this.registrations.length === 0) return;
		const socket = this.getSocket();
		for (const { event, listener } of this.registrations)
			socket.off(event, listener);
		this.registrations.length = 0;
	}

	shutdown(): void {
		this.removeAll();
	}
}
