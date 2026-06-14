export type CosmeticType = 'shell_skin';

export interface CosmeticDefinition {
  id: string;
  type: CosmeticType;
  name: string;
  description: string;
  price: number;
  unlockAchievementId?: string;
  defaultUnlocked?: boolean;
  accentColor: number;
}

export interface CosmeticView extends CosmeticDefinition {
  owned: boolean;
  equipped: boolean;
  lockedReason?: 'achievement-locked' | 'not enough coins' | 'purchasable';
}

export const COSMETICS: CosmeticDefinition[] = [
  {
    id: 'kanagawa',
    type: 'shell_skin',
    name: 'Kanagawa Shell',
    description: 'Classic blue shell pattern. The default dojo style.',
    price: 0,
    defaultUnlocked: true,
    accentColor: 0x1a3a5c,
  },
  {
    id: 'dragon',
    type: 'shell_skin',
    name: 'Dragon Shell',
    description: 'A fierce red shell for proven winners.',
    price: 150,
    unlockAchievementId: 'first-win',
    accentColor: 0x8b0000,
  },
  {
    id: 'bamboo',
    type: 'shell_skin',
    name: 'Bamboo Shell',
    description: 'A calm green shell awarded to regular dojo players.',
    price: 250,
    unlockAchievementId: 'dojo-regular',
    accentColor: 0x2d5a1b,
  },
];

export function findCosmetic(cosmeticId: string): CosmeticDefinition | undefined {
  return COSMETICS.find((cosmetic) => cosmetic.id === cosmeticId);
}
