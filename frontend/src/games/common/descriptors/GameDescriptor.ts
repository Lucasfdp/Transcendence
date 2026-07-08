export interface GameDescriptor {
	readonly gameId: string;
	readonly sceneKey: string;
	readonly playerCount?: {
		readonly min: number;
		readonly max: number;
	};
	readonly localModes?: readonly string[];
}
