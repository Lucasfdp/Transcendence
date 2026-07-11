import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
	HealthCheckError,
	HealthIndicator,
	HealthIndicatorResult,
} from "@nestjs/terminus";
import * as net from "net";

const REDIS_TIMEOUT_MS = 3_000;

/**
 * Custom Redis health indicator.
 *
 * Uses a raw TCP connection so we don't need the ioredis package just for
 * health checks. When a password is configured, sends AUTH and, only after
 * receiving `+OK`, sends PING — AUTH success proves the credential is
 * valid, PING proves the server is actually serving commands (a
 * connection can auth successfully against a server that is otherwise
 * wedged). When no password is configured, PING is sent directly.
 *
 * Note: if REDIS_PASSWORD is set in this service's env but Redis itself has
 * no password configured, AUTH will reply `-ERR Client sent AUTH, but no
 * password is set` and the check will (correctly) fail — that mismatch is
 * a configuration error, not a transient outage.
 */
@Injectable()
export class RedisHealthIndicator extends HealthIndicator {
	constructor(private readonly config: ConfigService) {
		super();
	}

	async pingCheck(key: string): Promise<HealthIndicatorResult> {
		const host = this.config.get<string>("REDIS_HOST", "redis");
		const port = this.config.get<number>("REDIS_PORT", 6379);
		const password = this.config.get<string>("REDIS_PASSWORD", "");

		try {
			await this.tcpPing(host, port, password);
			return this.getStatus(key, true);
		} catch (err) {
			throw new HealthCheckError(
				`Redis health check failed: ${(err as Error).message}`,
				this.getStatus(key, false, { message: (err as Error).message }),
			);
		}
	}

	private tcpPing(
		host: string,
		port: number,
		password: string,
	): Promise<void> {
		return new Promise<void>((resolve, reject) => {
			let settled = false;
			const socket = net.createConnection({ host, port });

			const done = (err?: Error): void => {
				if (settled) return;
				settled = true;
				socket.destroy();
				if (err) reject(err);
				else resolve();
			};

			socket.setTimeout(REDIS_TIMEOUT_MS);
			socket.on("timeout", () =>
				done(new Error(`TCP timeout after ${REDIS_TIMEOUT_MS} ms`)),
			);
			socket.on("error", (err) => done(err));

			socket.on("connect", () => {
				if (password) {
					// Send AUTH command (RESP Array format)
					const authCmd = `*2\r\n$4\r\nAUTH\r\n$${Buffer.byteLength(password)}\r\n${password}\r\n`;
					socket.write(authCmd);

					// Assumes the whole RESP reply arrives in a single TCP
					// chunk. True in practice for the short +OK/+PONG/-ERR
					// replies used here; if this ever needs to be
					// bullet-proof, buffer and split on "\r\n" instead of
					// relying on a single "data" event.
					socket.once("data", (authData) => {
						const authReply = authData.toString();
						if (!authReply.startsWith("+OK")) {
							done(
								new Error(
									`Redis AUTH failed: ${authReply.trim()}`,
								),
							);
							return;
						}

						// AUTH succeeded — now confirm the server is
						// actually serving commands with PING.
						socket.write("PING\r\n");
						socket.once("data", (pingData) => {
							const pingReply = pingData.toString();
							if (pingReply.includes("PONG")) {
								done();
							} else {
								done(
									new Error(
										`Redis PING failed: ${pingReply.trim()}`,
									),
								);
							}
						});
					});
				} else {
					// No password — just PING
					socket.write("PING\r\n");

					socket.once("data", (data) => {
						const reply = data.toString();
						if (reply.includes("PONG")) {
							done();
						} else {
							done(
								new Error(`Redis PING failed: ${reply.trim()}`),
							);
						}
					});
				}
			});
		});
	}
}
