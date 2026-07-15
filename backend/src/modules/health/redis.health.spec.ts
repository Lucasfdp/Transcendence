import { EventEmitter } from "events";
import { ConfigService } from "@nestjs/config";
import { HealthCheckError } from "@nestjs/terminus";
import * as net from "net";
import { RedisHealthIndicator } from "./redis.health";

jest.mock("net", () => ({ createConnection: jest.fn() }));

class FakeSocket extends EventEmitter {
	readonly writes: string[] = [];
	readonly setTimeout = jest.fn();
	readonly destroy = jest.fn();

	constructor(private readonly onWrite?: (value: string) => string | undefined) {
		super();
	}

	write(value: string): boolean {
		this.writes.push(value);
		const response = this.onWrite?.(value);
		if (response !== undefined) {
			queueMicrotask(() => this.emit("data", Buffer.from(response)));
		}
		return true;
	}
}

describe("RedisHealthIndicator", () => {
	let configService: { get: jest.Mock };
	let indicator: RedisHealthIndicator;
	const createConnection = net.createConnection as jest.MockedFunction<
		typeof net.createConnection
	>;

	const configure = (password = ""): void => {
		configService.get.mockImplementation((key: string, fallback?: unknown) => {
			if (key === "REDIS_HOST") return "redis";
			if (key === "REDIS_PORT") return 6379;
			if (key === "REDIS_PASSWORD") return password;
			return fallback;
		});
	};

	const connectWith = (
		socket: FakeSocket,
		event: "connect" | "error" | "timeout" = "connect",
	): FakeSocket => {
		createConnection.mockReturnValue(socket as unknown as net.Socket);
		queueMicrotask(() => {
			if (event === "error") socket.emit("error", new Error("ECONNREFUSED"));
			else socket.emit(event);
		});
		return socket;
	};

	beforeEach(() => {
		configService = { get: jest.fn() };
		indicator = new RedisHealthIndicator(
			configService as unknown as ConfigService,
		);
	});

	afterEach(() => {
		jest.clearAllMocks();
	});

	it("reports up when Redis replies PONG without authentication", async () => {
		configure();
		const socket = connectWith(
			new FakeSocket((write) => (write === "PING\r\n" ? "+PONG\r\n" : undefined)),
		);

		await expect(indicator.pingCheck("redis")).resolves.toEqual({
			redis: { status: "up" },
		});
		expect(socket.writes).toEqual(["PING\r\n"]);
	});

	it("sends PING only after authentication succeeds", async () => {
		configure("correct-password");
		const socket = connectWith(
			new FakeSocket((write) =>
				write.includes("AUTH") ? "+OK\r\n" : "+PONG\r\n",
			),
		);

		await expect(indicator.pingCheck("redis")).resolves.toEqual({
			redis: { status: "up" },
		});
		expect(socket.writes[0]).toContain("AUTH");
		expect(socket.writes[1]).toBe("PING\r\n");
	});

	it("reports down on an authentication error without sending PING", async () => {
		configure("wrong-password");
		const socket = connectWith(new FakeSocket(() => "-ERR invalid password\r\n"));

		await expect(indicator.pingCheck("redis")).rejects.toThrow(
			HealthCheckError,
		);
		expect(socket.writes).toHaveLength(1);
		expect(socket.writes[0]).toContain("AUTH");
	});

	it("reports down when the connection is refused", async () => {
		configure();
		connectWith(new FakeSocket(), "error");

		await expect(indicator.pingCheck("redis")).rejects.toThrow(
			HealthCheckError,
		);
	});

	it("reports down when the socket times out", async () => {
		configure();
		const socket = connectWith(new FakeSocket(), "timeout");

		await expect(indicator.pingCheck("redis")).rejects.toThrow(
			HealthCheckError,
		);
		expect(socket.setTimeout).toHaveBeenCalledWith(3_000);
	});
});
