import {
	BadRequestException,
	Injectable,
	InternalServerErrorException,
	Logger,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { ShellInventoryItem } from "./entities/shell-inventory-item.entity";
import { User } from "../users/entities/user.entity";
import { VALID_SHELL_TYPES, SEEDED_SHELL_TYPES } from "./shell-types";

@Injectable()
export class ShellsService {
	private readonly logger = new Logger(ShellsService.name);

	constructor(
		@InjectRepository(ShellInventoryItem)
		private readonly inventoryRepo: Repository<ShellInventoryItem>,
	) {}

	/**
	 * Seeds 999 of every shell type for a newly registered user.
	 * Called by UsersService.create() after the user row is saved.
	 * Errors are logged but not re-thrown so registration still completes.
	 */
	async seedInventory(user: User): Promise<void> {
		try {
			const items = SEEDED_SHELL_TYPES.map((shellType) =>
				this.inventoryRepo.create({ user, shellType, quantity: 999 }),
			);
			await this.inventoryRepo.save(items);
		} catch (err) {
			this.logger.error(
				`Failed to seed inventory for user ${user.id}: ${String(err)}`,
			);
		}
	}

	/**
	 * Returns the player's full inventory as a plain record.
	 * The 'none' shell is always injected at Infinity — it is never stored.
	 */
	async getInventory(userId: number): Promise<Record<string, number>> {
		try {
			const rows = await this.inventoryRepo.find({
				where: { user: { id: userId } },
			});
			const inventory: Record<string, number> = { none: Infinity };
			for (const row of rows) {
				inventory[row.shellType] = row.quantity;
			}
			return inventory;
		} catch {
			throw new InternalServerErrorException(
				"Failed to fetch shell inventory",
			);
		}
	}

	/**
	 * Validates that all requested shells are known and available in the player's
	 * inventory. Returns the validated array on success, throws BadRequestException
	 * if anything is invalid.
	 *
	 * Max 3 special shells per game — 'none' does not count towards this limit.
	 * This method is read-only and safe to call multiple times.
	 */
	async validateSelection(
		userId: number,
		shellTypes: string[],
	): Promise<string[]> {
		const specials = shellTypes.filter((t) => t !== "none");

		if (specials.length > 3) {
			throw new BadRequestException("Maximum 3 special shells per game");
		}

		for (const type of specials) {
			if (!VALID_SHELL_TYPES.has(type)) {
				throw new BadRequestException(`Unknown shell type: ${type}`);
			}
		}

		if (specials.length === 0) return shellTypes;

		const inventory = await this.getInventory(userId);
		for (const type of specials) {
			if ((inventory[type] ?? 0) < 1) {
				throw new BadRequestException(
					`Shell not in inventory: ${type}`,
				);
			}
		}

		return shellTypes;
	}
}
