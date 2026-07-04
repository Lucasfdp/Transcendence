import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Request } from "express";
import * as net from "net";

const REDIS_CONNECT_TIMEOUT_MS = 3_000;
const PUBLIC_RATE_LIMIT_PREFIX = "rate_limit:";

@Injectable()
export class RedisRateLimiterService {
	private readonly logger = new Logger(RedisRateLimiterService.name);
	private readonly host: string;
	private readonly port: number;
	private readonly password: string;
	private readonly script = [
		"local current = redis.call('INCR', KEYS[1])",
		"if current == 1 then",
		"  redis.call('PEXPIRE', KEYS[1], ARGV[1])",
		"end",
		"return current",
	].join("\n");

	constructor(private readonly configService: ConfigService) {
		this.host = this.configService.get<string>("REDIS_HOST", "redis");
		this.port = this.configService.get<number>("REDIS_PORT", 6379);
		this.password = this.configService.get<string>("REDIS_PASSWORD", "");
	}

	async allow(
		req: Request,
		bucket: string,
		max: number,
		windowMs: number,
	): Promise<boolean> {
		const ip = this.getIp(req);
		const key = `${PUBLIC_RATE_LIMIT_PREFIX}${bucket}:${ip}`;

		try {
			const result = await this.sendCommand([
				"EVAL",
				this.script,
				"1",
				key,
				String(windowMs),
			]);
			return Number(result) <= max;
		} catch (err) {
			this.logger.error(
				`Redis rate limit failed for bucket=${bucket} ip=${ip}`,
				err instanceof Error ? err.stack : undefined,
			);
			return false;
		}
	}

	private getIp(req: Request): string {
		const forwarded = req.headers["x-forwarded-for"];
		if (typeof forwarded === "string") {
			return forwarded.split(",")[0].trim();
		}
		return req.socket?.remoteAddress ?? "unknown";
	}

	private buildRespCommand(args: string[]): string {
		let cmd = `*${args.length}\r\n`;
		for (const arg of args) {
			cmd += `$${Buffer.byteLength(arg, "utf8")}\r\n${arg}\r\n`;
		}
		return cmd;
	}

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
				if (err != null) reject(err);
				else resolve(value ?? null);
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
					if (authResponsePending) {
						const crlfIdx = buffer.indexOf("\r\n");
						if (crlfIdx === -1) return;
						const line = buffer.slice(0, crlfIdx);
						if (!line.startsWith("+")) {
							done(new Error(`Redis AUTH failed: ${line}`));
							return;
						}
						buffer = buffer.slice(crlfIdx + 2);
						authResponsePending = false;
					}

					if (buffer.length === 0) return;

					const firstChar = buffer[0];
					if (firstChar === "+") {
						const end = buffer.indexOf("\r\n");
						if (end === -1) return;
						done(undefined, buffer.slice(1, end));
						return;
					}

					if (firstChar === "-") {
						const end = buffer.indexOf("\r\n");
						done(
							new Error(
								`Redis error: ${end === -1 ? buffer.slice(1) : buffer.slice(1, end)}`,
							),
						);
						return;
					}

					if (buffer.startsWith("$-1\r\n")) {
						done(undefined, null);
						return;
					}

					if (firstChar === "$") {
						const headerEnd = buffer.indexOf("\r\n");
						if (headerEnd === -1) return;
						const len = parseInt(buffer.slice(1, headerEnd), 10);
						const dataStart = headerEnd + 2;
						if (buffer.length >= dataStart + len + 2) {
							done(undefined, buffer.slice(dataStart, dataStart + len));
						}
						return;
					}

					if (firstChar === ":") {
						const end = buffer.indexOf("\r\n");
						if (end === -1) return;
						done(undefined, buffer.slice(1, end));
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
