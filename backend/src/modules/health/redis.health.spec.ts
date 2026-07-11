import * as net from "net";
import { ConfigService } from "@nestjs/config";
import { HealthCheckError } from "@nestjs/terminus";
import { RedisHealthIndicator } from "./redis.health";

describe("RedisHealthIndicator", () => {
	let configService: { get: jest.Mock };
	let indicator: RedisHealthIndicator;
	let servers: net.Server[];

	/** Starts a stub TCP server that reacts to raw RESP writes via `onData`. */
	const startStubServer = (
		onData: (chunks: string[], socket: net.Socket) => void,
	): Promise<number> => {
		return new Promise((resolve) => {
			const chunks: string[] = [];
			const server = net.createServer((socket) => {
				socket.on("data", (data) => {
					chunks.push(data.toString());
					onData(chunks, socket);
				});
			});
			servers.push(server);
			server.listen(0, "127.0.0.1", () => {
				const address = server.address();
				resolve(typeof address === "object" && address ? address.port : 0);
			});
		});
	};

	const configureFor = (port: number, password = ""): void => {
		configService.get.mockImplementation((key: string, def?: unknown) => {
			if (key === "REDIS_HOST") return "127.0.0.1";
			if (key === "REDIS_PORT") return port;
			if (key === "REDIS_PASSWORD") return password;
			return def;
		});
	};

	beforeEach(() => {
		servers = [];
		configService = { get: jest.fn() };
		indicator = new RedisHealthIndicator(
			configService as unknown as ConfigService,
		);
	});

	afterEach(async () => {
		await Promise.all(
			servers.map(
				(server) =>
					new Promise<void>((resolve) => server.close(() => resolve())),
			),
		);
		jest.clearAllMocks();
	});

	it("reports up when the server replies PONG (no password configured)", async () => {
		const port = await startStubServer((chunks, socket) => {
			if (chunks[chunks.length - 1].startsWith("PING")) {
				socket.write("+PONG\r\n");
			}
		});
		configureFor(port);

		const result = await indicator.pingCheck("redis");

		expect(result.redis.status).toBe("up");
	});

	it("reports up when AUTH succeeds (+OK) followed by PONG (D10 regression: PING must be sent after AUTH)", async () => {
		const port = await startStubServer((chunks, socket) => {
			const last = chunks[chunks.length - 1];
			if (last.includes("AUTH")) {
				socket.write("+OK\r\n");
			} else if (last.startsWith("PING")) {
				socket.write("+PONG\r\n");
			}
		});
		configureFor(port, "correct-password");

		const result = await indicator.pingCheck("redis");

		expect(result.redis.status).toBe("up");
	});

	it("reports down on a -ERR AUTH reply and never sends PING", async () => {
		const writes: string[] = [];
		const port = await startStubServer((chunks, socket) => {
			writes.push(chunks[chunks.length - 1]);
			socket.write("-ERR invalid password\r\n");
		});
		configureFor(port, "wrong-password");

		await expect(indicator.pingCheck("redis")).rejects.toThrow(
			HealthCheckError,
		);
		expect(writes.some((w) => w.startsWith("PING"))).toBe(false);
	});

	it("reports down when the connection is refused", async () => {
		// Bind then immediately close a server to obtain a port nothing is
		// listening on, instead of guessing a "probably free" fixed port.
		const probe = net.createServer();
		const port: number = await new Promise((resolve) => {
			probe.listen(0, "127.0.0.1", () => {
				const address = probe.address();
				resolve(typeof address === "object" && address ? address.port : 0);
			});
		});
		await new Promise<void>((resolve) => probe.close(() => resolve()));

		configureFor(port);

		await expect(indicator.pingCheck("redis")).rejects.toThrow(
			HealthCheckError,
		);
	});

	it(
		"reports down on TCP timeout when the server never responds",
		async () => {
			const port = await startStubServer(() => {
				// Intentionally never responds — exercises the 3s socket timeout.
			});
			configureFor(port);

			await expect(indicator.pingCheck("redis")).rejects.toThrow(
				HealthCheckError,
			);
		},
		10_000,
	);
});
