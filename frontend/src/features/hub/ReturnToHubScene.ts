import Phaser from "phaser";

export const RETURN_TO_HUB_EVENT = "shellsmash:return-to-hub";

export class ReturnToHubScene extends Phaser.Scene {
	constructor() {
		super({ key: "HubScene" });
	}

	create(): void {
		window.dispatchEvent(new CustomEvent(RETURN_TO_HUB_EVENT));
	}
}
