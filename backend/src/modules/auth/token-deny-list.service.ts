import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as net from "net";

const REDIS_CONNECT_TIMEOUT_MS = 3_000;
const JTI_KEY_PREFIX = "jti:";

@Injectable()
export class TokenDenyListService {
	private readonly logger = new Logger(TokenDenyListService.name);
	private readonly host: string;
	private readonly port: number;
	private readonly password: string;

	constructor(private readonly configService: ConfigService) {
		this.host = this.configService.get<string>("REDIS_HOST", "redis");
		this.port = this.configService.get<number>("REDIS_PORT", 6379);
		this.password = this.configService.get<string>("REDIS_PASSWORD", "");
	}

	/**
	 * Revoke a JWT by caching its jti in Redis for `ttlSeconds` seconds.
	 * Subsequent `isRevoked()` calls will return true until the key expires.
	 */
	async revoke(jti: string, ttlSeconds: number): Promise<void> {
		try {
			await this.sendCommand([
				"SET",
				`${JTI_KEY_PREFIX}${jti}`,
				"1",
				"EX",
				String(ttlSeconds),
			]);
		} catch (err) {
			this.logger.error(
				`TokenDenyList: failed to revoke jti=${jti}`,
				err,
			);
			throw err;
		}
	}

	/**
	 * Returns true if the given jti exists in the deny list.
	 * On Redis failure, logs the error and returns false to avoid blocking
	 * all authenticated requests during a Redis outage.
	 */
	async isRevoked(jti: string): Promise<boolean> {
		try {
			const result = await this.sendCommand([
				"GET",
				`${JTI_KEY_PREFIX}${jti}`,
			]);
			return result !== null;
		} catch (err) {
			this.logger.error(
				`TokenDenyList: failed to check revocation for jti=${jti}`,
				err,
			);
			return false;
		}
	}

	/**
	 * Build a RESP (Redis Serialization Protocol) array command string.
	 */
	private buildRespCommand(args: string[]): string {
		let cmd = `*${args.length}\r\n`;
		for (const arg of args) {
			cmd += `$${Buffer.byteLength(arg, "utf8")}\r\n${arg}\r\n`;
		}
		return cmd;
	}

	/**
	 * Opens a one-shot TCP connection to Redis, optionally sends AUTH,
	 * then sends one command and returns the parsed response value.
	 * Returns null for a Redis nil bulk-string ($-1).
	 */
	private sendCommand(args: string[]): Promise<string | null> {
		return new Promise<string | null>((resolve, reject) => {
			const socket = net.createConnection({
				host: this.host,
				port: this.port,
			});

			let buffer = "";
			let settled = false;
			let authResponsePending = Boolean(this.password);

			const done = (err?: Error, value?: string | null): void => {
				if (settled) return;
				settled = true;
				socket.destroy();
				if (err != null) {
					reject(err);
				} else {
					resolve(value ?? null);
				}
			};

			socket.setTimeout(REDIS_CONNECT_TIMEOUT_MS);
			socket.on("timeout", () =>
				done(
					new Error(
						`Redis TCP timeout after ${REDIS_CONNECT_TIMEOUT_MS} ms`,
					),
				),
			);
			socket.on("error", (err) => done(err));
			socket.on("close", () => {
				if (!settled) {
					done(
						new Error(
							"Redis connection closed before a response was received",
						),
					);
				}
			});

			socket.on("connect", () => {
				let outgoing = "";
				if (this.password) {
					outgoing += this.buildRespCommand(["AUTH", this.password]);
				}
				outgoing += this.buildRespCommand(args);
				socket.write(outgoing);
			});

			socket.on("data", (chunk: Buffer) => {
				buffer += chunk.toString("utf8");

				try {
					// AUTH response must be consumed before the command response.
					if (authResponsePending) {
						const crlfIdx = buffer.indexOf("\r\n");
						if (crlfIdx === -1) return; // incomplete — wait for more data
						const line = buffer.slice(0, crlfIdx);
						if (!line.startsWith("+")) {
							done(new Error(`Redis AUTH failed: ${line}`));
							return;
						}
						buffer = buffer.slice(crlfIdx + 2);
						authResponsePending = false;
					}

					if (buffer.length === 0) return; // command response not yet received

					const firstChar = buffer[0];

					// Simple string: +OK\r\n
					if (firstChar === "+") {
						const end = buffer.indexOf("\r\n");
						if (end === -1) return; // incomplete
						done(undefined, buffer.slice(1, end));
						return;
					}

					// Error: -ERR ...\r\n
					if (firstChar === "-") {
						const end = buffer.indexOf("\r\n");
						done(
							new Error(
								`Redis error: ${end === -1 ? buffer.slice(1) : buffer.slice(1, end)}`,
							),
						);
						return;
					}

					// Nil bulk string: $-1\r\n
					if (buffer.startsWith("$-1\r\n")) {
						done(undefined, null);
						return;
					}

					// Bulk string: $N\r\nvalue\r\n
					if (firstChar === "$") {
						const headerEnd = buffer.indexOf("\r\n");
						if (headerEnd === -1) return; // incomplete header
						const len = parseInt(buffer.slice(1, headerEnd), 10);
						const dataStart = headerEnd + 2;
						if (buffer.length >= dataStart + len + 2) {
							done(undefined, buffer.slice(dataStart, dataStart + len));
						}
						// else: incomplete bulk data — wait for more chunks
						return;
					}

					// Integer: :N\r\n
					if (firstChar === ":") {
						const end = buffer.indexOf("\r\n");
						if (end === -1) return; // incomplete
						done(undefined, buffer.slice(1, end));
						return;
					}
				} catch (err) {
					done(
						err instanceof Error ? err : new Error(String(err)),
					);
				}
			});
		});
	}
}
