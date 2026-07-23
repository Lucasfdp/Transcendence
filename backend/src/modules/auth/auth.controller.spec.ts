import { NotFoundException } from "@nestjs/common";
import { AuthController } from "./auth.controller";

describe("AuthController", () => {
	it("keeps public 42 sign-in unavailable", () => {
		const controller = Object.create(AuthController.prototype) as AuthController;

		expect(() => controller.fortyTwoLogin()).toThrow(NotFoundException);
	});
});
