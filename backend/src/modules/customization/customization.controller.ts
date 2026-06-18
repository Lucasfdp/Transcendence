import { Body, Controller, Get, Post, Request, UnauthorizedException, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { UsersService } from '../users/users.service';
import { CosmeticView } from './customization.constants';
import { CustomizationService } from './customization.service';
import { BuyCosmeticDto } from './dto/buy-cosmetic.dto';
import { EquipCosmeticDto } from './dto/equip-cosmetic.dto';

@ApiTags('customization')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('customization')
export class CustomizationController {
  constructor(
    private readonly customizationService: CustomizationService,
    private readonly usersService:         UsersService,
  ) {}

  @Get()
  async list(@Request() req: { user: { id: number } }): Promise<CosmeticView[]> {
    const user = await this.usersService.findById(req.user.id);
    if (!user) throw new UnauthorizedException();
    return this.customizationService.listForUser(user);
  }

  @Post('equip')
  async equip(
    @Request() req: { user: { id: number } },
    @Body() dto: EquipCosmeticDto,
  ): Promise<CosmeticView[]> {
    const user = await this.usersService.findById(req.user.id);
    if (!user) throw new UnauthorizedException();
    return this.customizationService.equip(user, dto.cosmeticId);
  }

  @Post('buy')
  async buy(
    @Request() req: { user: { id: number } },
    @Body() dto: BuyCosmeticDto,
  ): Promise<CosmeticView[]> {
    const user = await this.usersService.findById(req.user.id);
    if (!user) throw new UnauthorizedException();
    return this.customizationService.buy(user, dto.cosmeticId);
  }
}
