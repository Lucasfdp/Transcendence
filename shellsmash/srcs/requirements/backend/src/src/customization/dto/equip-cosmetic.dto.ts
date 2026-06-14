import { IsString } from 'class-validator';

export class EquipCosmeticDto {
  @IsString()
  cosmeticId: string;
}
