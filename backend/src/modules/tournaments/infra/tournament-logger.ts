/**
 * TournamentLogger — SPEC-027 Logging & Diagnostics.
 *
 * The Logging API IS the existing NestJS `Logger`, wrapped with tournament
 * context (tournamentId, matchId, system). No new frameworks, no storage,
 * no transports: Nest's Logger does the output; this class only guarantees
 * that every line carries the SPEC-027 context fields as a compact,
 * single-line JSON suffix so any error can be traced back to a concrete
 * match, player and system.
 *
 * SPEC-027 levels map onto Nest 10 Logger methods:
 *   TRACE -> verbose | DEBUG -> debug | INFO -> log
 *   WARN  -> warn    | ERROR -> error | FATAL -> fatal
 *
 * `playerId` is per-call (not every log involves a player); `metadata` is
 * free-form per-call diagnostic data. `child(system)` derives a logger for
 * another system that shares the same tournament/match context.
 *
 * The Logging System never participates in gameplay.
 */

import { Logger } from "@nestjs/common";

export interface TournamentLogContext {
	tournamentId: string;
	matchId?: string;
	system: string;
}

export interface TournamentLogOptions {
	/** Platform userId (number) or a domain player identifier. */
	playerId?: string | number;
	metadata?: Record<string, unknown>;
}

export interface TournamentErrorLogOptions extends TournamentLogOptions {
	/** Route this error to the FATAL level (errors that stop the match). */
	fatal?: boolean;
}

export class TournamentLogger {
	private readonly context: TournamentLogContext;
	private readonly logger: Logger;

	constructor(context: TournamentLogContext) {
		this.context = { ...context };
		this.logger = new Logger(`Tournament:${context.system}`);
	}

	/**
	 * Returns a logger for another tournament system, preserving the same
	 * tournamentId/matchId context.
	 */
	child(system: string): TournamentLogger {
		return new TournamentLogger({ ...this.context, system });
	}

	/** SPEC-027 TRACE. */
	verbose(message: string, options?: TournamentLogOptions): void {
		this.logger.verbose(this.format(message, options));
	}

	/** SPEC-027 DEBUG. */
	debug(message: string, options?: TournamentLogOptions): void {
		this.logger.debug(this.format(message, options));
	}

	/** SPEC-027 INFO. */
	log(message: string, options?: TournamentLogOptions): void {
		this.logger.log(this.format(message, options));
	}

	/** SPEC-027 WARN. */
	warn(message: string, options?: TournamentLogOptions): void {
		this.logger.warn(this.format(message, options));
	}

	/** SPEC-027 ERROR (or FATAL when `options.fatal` is set). */
	error(message: string, options?: TournamentErrorLogOptions): void {
		if (options?.fatal) {
			this.fatal(message, options);
			return;
		}
		this.logger.error(this.format(message, options));
	}

	/** SPEC-027 FATAL — errors that prevent the match from continuing. */
	fatal(message: string, options?: TournamentLogOptions): void {
		this.logger.fatal(this.format(message, options));
	}

	/**
	 * `<message> | {"tournamentId":...,"matchId":...,"system":...,
	 * "playerId":...,"metadata":...}` — compact single-line JSON suffix.
	 * Undefined fields are omitted from the JSON.
	 */
	private format(message: string, options?: TournamentLogOptions): string {
		const entry: Record<string, unknown> = {
			tournamentId: this.context.tournamentId,
		};
		if (this.context.matchId !== undefined) {
			entry.matchId = this.context.matchId;
		}
		entry.system = this.context.system;
		if (options?.playerId !== undefined) {
			entry.playerId = options.playerId;
		}
		if (options?.metadata !== undefined) {
			entry.metadata = options.metadata;
		}
		return `${message} | ${JSON.stringify(entry)}`;
	}
}
