import { OpenAPIObject } from "@nestjs/swagger";
import { completeOpenApiDocument, renderScalarHtml } from "./openapi";

function documentFixture(): OpenAPIObject {
	return {
		openapi: "3.0.0",
		info: { title: "Test", version: "1" },
		paths: {
			"/api/public/users": {
				get: { operationId: "PublicApi_listUsers", responses: {} },
				post: { operationId: "PublicApi_queryUsers", responses: {} },
			},
			"/api/users/me": {
				patch: { operationId: "Users_updateMe", responses: {} },
			},
			"/api/metrics": {
				get: { operationId: "Metrics_getMetrics", responses: {} },
			},
		},
		components: {
			securitySchemes: {
				"auth-cookie": { type: "apiKey", in: "cookie", name: "auth_token" },
				"x-api-key": { type: "apiKey", in: "header", name: "X-API-Key" },
				"metrics-bearer": { type: "http", scheme: "bearer" },
			},
		},
	};
}

describe("OpenAPI contract completion", () => {
	it("marks real security per operation and fills required contract metadata", () => {
		const document = completeOpenApiDocument(documentFixture());
		const publicGet = document.paths["/api/public/users"].get;
		const publicPost = document.paths["/api/public/users"].post;
		const internalPatch = document.paths["/api/users/me"].patch;
		const metrics = document.paths["/api/metrics"].get;

		expect(publicGet.security).toEqual([]);
		expect(publicPost.security).toEqual([{ "x-api-key": [] }]);
		expect(internalPatch.security).toEqual([{ "auth-cookie": [] }]);
		expect(internalPatch.parameters).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ name: "X-CSRF-Token", required: true }),
			]),
		);
		expect(metrics.security).toEqual([{ "metrics-bearer": [] }]);
		for (const operation of [publicGet, publicPost, internalPatch, metrics]) {
			expect(operation.summary).toBeTruthy();
			expect(Object.keys(operation.responses)).not.toHaveLength(0);
		}
	});

	it("renders Scalar with only the local bundle and no persisted secrets", () => {
		const body = renderScalarHtml();
		expect(body).toContain('src="/api/docs/scalar.js"');
		expect(body).toContain('"persistAuth":false');
		expect(body).toContain('"telemetry":false');
		expect(body).toContain('"agent":{"disabled":true');
		expect(body).toContain('"mcp":{"disabled":true}');
		expect(body).toContain("credentials: 'include'");
		expect(body).toContain("/api/auth/csrf-token");
		expect(body).not.toContain("cdn.jsdelivr.net");
		expect(body).not.toContain("change-me-public-api-key");
	});
});
