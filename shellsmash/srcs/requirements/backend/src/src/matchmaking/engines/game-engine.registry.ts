import { BadRequestException, Injectable } from '@nestjs/common';
import { BambooBashEngine } from './bamboo-bash.engine';
import { GameEngine } from './game-engine';
import { ShellCurlEngine } from './shell-curl.engine';

@Injectable()
export class GameEngineRegistry {
  private readonly engines: Map<string, GameEngine>;

  constructor(shellCurl: ShellCurlEngine, bambooBash: BambooBashEngine) {
    this.engines = new Map<string, GameEngine>([
      [shellCurl.gameId, shellCurl],
      [bambooBash.gameId, bambooBash],
    ]);
  }

  get(gameId: string): GameEngine {
    const engine = this.engines.get(gameId);
    if (!engine) throw new BadRequestException(`Unsupported gameId: ${gameId}`);
    return engine;
  }
}
