import {
	Body,
	Controller,
	Get,
	Post,
	Request,
	UseGuards,
} from "@nestjs/common";
import { ShellsService } from "./shells.service";
import { ValidateSelectionDto } from "./dto/validate-selection.dto";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";

@UseGuards(JwtAuthGuard)
@Controller("shells")
export class ShellsController {
	constructor(private readonly shellsService: ShellsService) {}

	/**
	 * GET /api/shells/inventory
	 *
	 * Returns the logged-in player's shell inventory as a record of
	 * { shellType: quantity }. The 'none' key is always present with
	 * value Infinity. Requires an active session.
	 */
	@Get("inventory")
	async getInventory(
		@Request() req: { user: { id: number } },
	): Promise<Record<string, number>> {
		return this.shellsService.getInventory(req.user.id);
	}

	/**
	 * POST /api/shells/validate-selection
	 *
	 * Body: { shellTypes: string[] } — up to 3 special shell IDs.
	 *
	 * Validates that all requested shells are known and owned by the player.
	 * Returns the validated list on success; 400 if any shell is invalid or
	 * not in inventory; 401 if unauthenticated.
	 *
	 * This endpoint is read-only — it does NOT deduct from inventory.
	 * Deduction is a future concern (when shell acquisition mechanics exist).
	 */
	@Post("validate-selection")
	async validateSelection(
		@Request() req: { user: { id: number } },
		@Body() dto: ValidateSelectionDto,
	): Promise<{ shellTypes: string[] }> {
		const validated = await this.shellsService.validateSelection(
			req.user.id,
			dto.shellTypes,
		);
		return { shellTypes: validated };
	}
}
