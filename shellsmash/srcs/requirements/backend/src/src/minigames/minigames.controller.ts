import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

export interface MiniGameDefinition {
  id: string;
  name: string;
  status: 'available' | 'locked' | 'coming_soon';
  description: string;
}

// The Shell Smash hub map. Each entry is a "shrine" the player can
// visit. Kame Knock is the first playable shrine — everything else
// is shown as "Coming Soon" in the hub.
const MINIGAMES: MiniGameDefinition[] = [
  {
    id: 'kame-knock',
    name: 'Kame Knock',
    status: 'available',
    description: 'Billiards-like target smashing — launch your shell and clear every round.',
  },
  {
    id: 'bell-clash',
    name: 'Bell Clash',
    status: 'available',
    description: 'Ring the great temple bell from the perfect angle.',
  },
  {
    id: 'river-rush',
    name: 'River Rush',
    status: 'coming_soon',
    description: 'Race down the cherry-blossom river before the current sweeps you away.',
  },
  {
    id: 'bamboo-bash',
    name: 'Bamboo Bash',
    status: 'available',
    description: 'Survive the bamboo forest as obstacles close in.',
  },
];

@ApiTags('minigames')
@Controller('minigames')
export class MiniGamesController {
  @Get()
  findAll(): MiniGameDefinition[] {
    return MINIGAMES;
  }
}
