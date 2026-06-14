import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

export interface MiniGameDefinition {
  id: string;
  name: string;
  status: 'available' | 'locked' | 'coming_soon';
  description: string;
}

// The Shell Smash hub map. Each entry is a "shrine" the player can
// visit. Only Shell Smash Arena is playable for now — everything else
// is shown as "Coming Soon" in the hub.
const MINIGAMES: MiniGameDefinition[] = [
  {
    id: 'shell-smash-arena',
    name: 'Shell Smash Arena',
    status: 'available',
    description: '1v1 sumo knockout — launch your shell and send your rival flying.',
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
    status: 'coming_soon',
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
