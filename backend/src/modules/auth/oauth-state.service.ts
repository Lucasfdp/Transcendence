import {
	Injectable,
	InternalServerErrorException,
	UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { randomBytes } from "crypto";
import * as net from "net";
export interface OAuthStatePayload {
	provider: "forty_two";
	initiatorUserId: number | null;
	returnTo: string;
}

const STATE_TTL_SECONDS = 10 * 60;
const CONNECT_TIMEOUT_MS = 3_000;

@Injectable()
export class OAuthStateService {
	private readonly host: string;
	private readonly port: number;
	private readonly password: string;

	constructor(config: ConfigService) {
		this.host = config.get<string>("REDIS_HOST", "redis");
		this.port = config.get<number>("REDIS_PORT", 6379);
		this.password = config.get<string>("REDIS_PASSWORD", "");
	}

	async create(payload: OAuthStatePayload): Promise<string> {
		const state = randomBytes(32).toString("base64url");
		try {
			const result = await this.command([
				"SET",
				`oauth_state:${state}`,
				JSON.stringify(payload),
				"EX",
				String(STATE_TTL_SECONDS),
				"NX",
			]);
			if (result !== "OK") throw new Error("Redis refused OAuth state");
			return state;
		} catch {
			throw new InternalServerErrorException(
				"OAuth is temporarily unavailable because secure state storage failed",
			);
		}
	}

	async consume(state: string | undefined): Promise<OAuthStatePayload> {
		if (!state || state.length > 128) {
			throw new UnauthorizedException("Invalid or expired OAuth state");
		}
		try {
			const raw = await this.command(["GETDEL", `oauth_state:${state}`]);
			if (!raw) throw new UnauthorizedException("Invalid or expired OAuth state");
			return JSON.parse(raw) as OAuthStatePayload;
		} catch (error) {
			if (error instanceof UnauthorizedException) throw error;
			throw new InternalServerErrorException("Could not validate OAuth state");
		}
	}

	private encode(args: string[]): string {
		return `*${args.length}\r\n${args
			.map((arg) => `$${Buffer.byteLength(arg)}\r\n${arg}\r\n`)
			.join("")}`;
	}

	private command(args: string[]): Promise<string | null> {
		return new Promise((resolve, reject) => {
			const socket = net.createConnection({ host: this.host, port: this.port });
			let buffer = "";
			let authPending = Boolean(this.password);
			let settled = false;
			const finish = (error?: Error, value: string | null = null) => {
				if (settled) return;
				settled = true;
				socket.destroy();
				if (error) reject(error);
				else resolve(value);
			};
			socket.setTimeout(CONNECT_TIMEOUT_MS);
			socket.on("timeout", () => finish(new Error("Redis timeout")));
			socket.on("error", (error) => finish(error));
			socket.on("close", () => {
				if (!settled) finish(new Error("Redis connection closed"));
			});
			socket.on("connect", () => {
				const auth = this.password
					? this.encode(["AUTH", this.password])
					: "";
				socket.write(auth + this.encode(args));
			});
			socket.on("data", (chunk: Buffer) => {
				buffer += chunk.toString("utf8");
				if (authPending) {
					const end = buffer.indexOf("\r\n");
					if (end < 0) return;
					if (!buffer.startsWith("+OK")) {
						finish(new Error("Redis authentication failed"));
						return;
					}
					buffer = buffer.slice(end + 2);
					authPending = false;
				}
				if (buffer.startsWith("$-1\r\n")) return finish(undefined, null);
				if (buffer.startsWith("+")) {
					const end = buffer.indexOf("\r\n");
					if (end >= 0) finish(undefined, buffer.slice(1, end));
					return;
				}
				if (buffer.startsWith("-")) {
					const end = buffer.indexOf("\r\n");
					if (end >= 0) finish(new Error(buffer.slice(1, end)));
					return;
				}
				if (buffer.startsWith("$")) {
					const end = buffer.indexOf("\r\n");
					if (end < 0) return;
					const length = Number(buffer.slice(1, end));
					const start = end + 2;
					if (buffer.length >= start + length + 2) {
						finish(undefined, buffer.slice(start, start + length));
					}
				}
			});
		});
	}
}
