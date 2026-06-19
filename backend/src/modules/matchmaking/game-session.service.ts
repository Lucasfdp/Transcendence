import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { GameResultsService } from "../game-results/game-results.service";
import { UsersService } from "../users/users.service";
import { Match } from "./entities/match.entity";
import { MatchPlayer } from "./entities/match-player.entity";
import { UserRating } from "./entities/user-rating.entity";
import { GameEngineRegistry } from "./engines/game-engine.registry";
import { GameInputPayload, MatchRoom, RoomPlayer } from "./matchmaking.types";
import { RoomService } from "./room.service";

@Injectable()
export class GameSessionService {
	constructor(
		private readonly roomService: RoomService,
		private readonly engines: GameEngineRegistry,
		private readonly usersService: UsersService,
		private readonly gameResultsService: GameResultsService,
		@InjectRepository(Match) private readonly matchRepo: Repository<Match>,
		@InjectRepository(MatchPlayer)
		private readonly matchPlayerRepo: Repository<MatchPlayer>,
		@InjectRepository(UserRating)
		private readonly ratingRepo: Repository<UserRating>,
	) {}

	handleInput(userId: number, input: GameInputPayload): MatchRoom | null {
		const room = this.roomService.getRoom(input.matchId);
		if (!room) return null;
		return this.engines.get(room.gameId).handleInput(room, userId, input);
	}

	async startIfReady(matchId: string): Promise<MatchRoom | null> {
		const room = this.roomService.getRoom(matchId);
		if (
			!room ||
			room.status !== "pending" ||
			!room.players.every((player) => player.ready)
		)
			return room;
		const started = this.roomService.start(matchId);
		await this.matchRepo.update(matchId, {
			status: "active",
			startedAt: new Date(),
		});
		return started;
	}

	async finishIfEnded(room: MatchRoom): Promise<void> {
		if (room.status !== "finished" && room.status !== "abandoned") return;
		this.roomService.finish(
			room.matchId,
			room.state.winnerSide,
			room.status === "abandoned",
		);
		await this.persistFinishedRoom(room, room.status === "abandoned");
	}

	async abandon(
		room: MatchRoom,
		abandonedPlayer: RoomPlayer,
	): Promise<MatchRoom | null> {
		const winnerSide = this.engines
			.get(room.gameId)
			.abandon(room, abandonedPlayer);
		const finished = this.roomService.finish(
			room.matchId,
			winnerSide,
			true,
		);
		if (finished) await this.persistFinishedRoom(finished, true);
		return finished;
	}

	private async persistFinishedRoom(
		room: MatchRoom,
		abandoned: boolean,
	): Promise<void> {
		const winnerSide = room.state.winnerSide;
		const winnerUserId =
			winnerSide === null ? null : room.players[winnerSide].user.id;
		await this.matchRepo.update(room.matchId, {
			status: abandoned ? "abandoned" : "finished",
			winnerUserId,
			winnerSide,
			finishedAt: new Date(),
		});

		for (const player of room.players) {
			const outcome =
				winnerSide === null
					? "draw"
					: player.side === winnerSide
						? "win"
						: abandoned
							? "abandoned"
							: "loss";
			await this.matchPlayerRepo.update(
				{ matchId: room.matchId, userId: player.user.id },
				{ outcome },
			);
		}

		await this.grantMatchRewards(room, abandoned);

		if (room.mode === "ranked" && winnerSide !== null)
			await this.updateRatings(room, winnerSide);
	}

	private async grantMatchRewards(
		room: MatchRoom,
		abandoned: boolean,
	): Promise<void> {
		if (room.rewardsGranted) return;
		if (abandoned) {
			room.rewardsGranted = true;
			return;
		}
		const winnerSide = room.state.winnerSide;

		for (const player of room.players) {
			if (!player.connected) continue;
			const user = await this.usersService.findById(player.user.id);
			if (!user || user.isGuest) continue;

			await this.gameResultsService.submitResult(user, {
				gameId: room.gameId,
				outcome:
					winnerSide === null
						? "draw"
						: player.side === winnerSide
							? "win"
							: "loss",
			});
		}

		room.rewardsGranted = true;
	}

	private async updateRatings(
		room: MatchRoom,
		winnerSide: number,
	): Promise<void> {
		for (const player of room.players) {
			let rating = await this.ratingRepo.findOne({
				where: { userId: player.user.id, gameId: room.gameId },
			});
			if (!rating)
				rating = this.ratingRepo.create({
					userId: player.user.id,
					gameId: room.gameId,
				});
			const won = player.side === winnerSide;
			rating.rating += won ? 25 : -25;
			if (won) rating.wins += 1;
			else rating.losses += 1;
			await this.ratingRepo.save(rating);
		}
	}
}
