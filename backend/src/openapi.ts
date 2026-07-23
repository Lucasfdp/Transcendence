import { Logger } from "@nestjs/common";
import { NestExpressApplication } from "@nestjs/platform-express";
import {
	DocumentBuilder,
	OpenAPIObject,
	SwaggerModule,
} from "@nestjs/swagger";
import { dirname, join } from "path";
import type { Response as ExpressResponse } from "express";

const HTTP_METHODS = [
	"get",
	"put",
	"post",
	"delete",
	"options",
	"head",
	"patch",
	"trace",
] as const;
const SAFE_METHODS = new Set(["get", "head", "options"]);
const PUBLIC_AUTH_PATHS = new Set([
	"/api/auth/csrf-token",
	"/api/auth/guest",
	"/api/auth/register",
	"/api/auth/login",
	"/api/auth/42",
	"/api/auth/42/authorise",
	"/api/auth/42/callback",
]);
const PUBLIC_PATH_PREFIXES = ["/api/health", "/api/minigames"];

type Operation = {
	operationId?: string;
	summary?: string;
	description?: string;
	tags?: string[];
	parameters?: Array<Record<string, unknown>>;
	responses?: Record<string, { description?: string }>;
	security?: Array<Record<string, string[]>>;
};

function words(value: string): string {
	return value
		.replace(/([a-z0-9])([A-Z])/g, "$1 $2")
		.replace(/[_-]+/g, " ")
		.trim()
		.toLowerCase();
}

function operationSummary(operation: Operation, method: string, path: string): string {
	if (operation.summary?.trim()) return operation.summary;
	const action = operation.operationId?.split("_").slice(1).join("_");
	if (action) {
		const text = words(action);
		return text.charAt(0).toUpperCase() + text.slice(1);
	}
	return `${method.toUpperCase()} ${path}`;
}

function isPublicOperation(path: string): boolean {
	return (
		PUBLIC_AUTH_PATHS.has(path) ||
		PUBLIC_PATH_PREFIXES.some(
			(prefix) => path === prefix || path.startsWith(`${prefix}/`),
		)
	);
}

/** Align generated metadata with the authentication policy enforced at runtime. */
export function completeOpenApiDocument(document: OpenAPIObject): OpenAPIObject {
	for (const [path, pathItem] of Object.entries(document.paths)) {
		for (const method of HTTP_METHODS) {
			const operation = pathItem?.[method] as unknown as Operation | undefined;
			if (!operation) continue;

			operation.summary = operationSummary(operation, method, path);
			operation.responses ??= {};
			if (Object.keys(operation.responses).length === 0) {
				operation.responses[method === "post" ? "201" : "200"] = {
					description: "Successful response",
				};
			}
			for (const response of Object.values(operation.responses)) {
				response.description ||= "Response";
			}

			if (path.startsWith("/api/public")) {
				operation.security = SAFE_METHODS.has(method)
					? []
					: [{ "x-api-key": [] }];
			} else if (path === "/api/metrics") {
				operation.security = [{ "metrics-bearer": [] }];
			} else if (isPublicOperation(path)) {
				operation.security = [];
			} else {
				operation.security = [{ "auth-cookie": [] }];
				if (!SAFE_METHODS.has(method)) {
					operation.parameters ??= [];
					if (
						!operation.parameters.some(
							(parameter) => parameter.in === "header" && parameter.name === "X-CSRF-Token",
						)
					) {
						operation.parameters.push({
							in: "header",
							name: "X-CSRF-Token",
							required: true,
							description: "Fresh double-submit CSRF token from GET /api/auth/csrf-token",
							schema: { type: "string", minLength: 64, maxLength: 64 },
						});
					}
				}
			}

			operation.responses["400"] ??= { description: "Invalid request" };
			if ((operation.security?.length ?? 0) > 0) {
				operation.responses["401"] ??= { description: "Authentication failed" };
				operation.responses["403"] ??= { description: "Permission denied" };
			}
			operation.responses["429"] ??= { description: "Rate limit exceeded" };
			operation.responses["500"] ??= { description: "Unexpected server error" };
		}
	}
	return document;
}

export function createOpenApiDocument(
	app: NestExpressApplication,
): OpenAPIObject {
	const config = new DocumentBuilder()
		.setTitle("Shell Smash REST API")
		.setDescription(
			"Complete REST contract for Shell Smash. WebSocket events are documented separately.",
		)
		.setVersion("1.0.0")
		.addCookieAuth(
			"auth_token",
			{
				type: "apiKey",
				in: "cookie",
				description: "HTTP-only session cookie issued by the authentication endpoints",
			},
			"auth-cookie",
		)
		.addApiKey(
			{
				type: "apiKey",
				name: "X-API-Key",
				in: "header",
				description: "Required only for state-changing public API operations",
			},
			"x-api-key",
		)
		.addBearerAuth(
			{
				type: "http",
				scheme: "bearer",
				bearerFormat: "opaque metrics token",
				description: "Dedicated token used only by the metrics collector",
			},
			"metrics-bearer",
		)
		.build();

	return completeOpenApiDocument(
		SwaggerModule.createDocument(app, config, {
			operationIdFactory: (controllerKey, methodKey) =>
				`${controllerKey.replace(/Controller$/, "")}_${methodKey}`,
		}),
	);
}

export const scalarConfiguration = {
	pageTitle: "Shell Smash API Reference",
	cdn: "/api/docs/scalar.js",
	url: "/api/docs-json",
	theme: "deepSpace" as const,
	layout: "modern" as const,
	modelsSectionLabel: "Schemas" as const,
	showOperationId: true,
	showDeveloperTools: "never" as const,
	hideClientButton: false,
	hideTestRequestButton: false,
	withDefaultFonts: false,
	persistAuth: false,
	telemetry: false,
	isEditable: false,
	agent: { disabled: true, hideAddApi: true },
	mcp: { disabled: true },
	documentDownloadType: "both" as const,
	customFetch: async (input: string | URL | Request, init?: RequestInit) => {
		const initialRequest = new Request(input, {
			...init,
			credentials: "include",
		});
		const method = initialRequest.method.toUpperCase();
		if (["POST", "PUT", "PATCH", "DELETE"].includes(method)) {
			const csrfResponse = await window.fetch("/api/auth/csrf-token", {
				credentials: "include",
			});
			if (!csrfResponse.ok) throw new Error("Unable to obtain a CSRF token");
			const body = (await csrfResponse.json()) as { csrfToken: string };
			const headers = new Headers(initialRequest.headers);
			headers.set("X-CSRF-Token", body.csrfToken);
			return window.fetch(
				new Request(initialRequest, { credentials: "include", headers }),
			);
		}
		return window.fetch(initialRequest);
	},
};

export function renderScalarHtml(): string {
	const { customFetch: _customFetch, ...serialisable } = scalarConfiguration;
	void _customFetch;
	return `<!doctype html>
<html lang="en">
	<head>
		<meta charset="utf-8" />
		<meta name="viewport" content="width=device-width, initial-scale=1" />
		<title>Shell Smash API Reference</title>
	</head>
	<body>
		<div id="app"></div>
		<script src="/api/docs/scalar.js"></script>
		<script>
			Scalar.createApiReference('#app', {
				...${JSON.stringify(serialisable)},
				customFetch: async (input, init = {}) => {
					const initialRequest = new Request(input, { ...init, credentials: 'include' });
					if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(initialRequest.method.toUpperCase())) {
						const csrfResponse = await window.fetch('/api/auth/csrf-token', { credentials: 'include' });
						if (!csrfResponse.ok) throw new Error('Unable to obtain a CSRF token');
						const { csrfToken } = await csrfResponse.json();
						const headers = new Headers(initialRequest.headers);
						headers.set('X-CSRF-Token', csrfToken);
						return window.fetch(new Request(initialRequest, { credentials: 'include', headers }));
					}
					return window.fetch(initialRequest);
				},
			});
		</script>
	</body>
</html>`;
}

function scalarBundlePath(): string {
	return join(
		dirname(require.resolve("@scalar/api-reference")),
		"browser",
		"standalone.js",
	);
}

export function configureApiDocumentation(app: NestExpressApplication): void {
	const document = createOpenApiDocument(app);
	SwaggerModule.setup("api/docs", app, document, {
		swaggerUiEnabled: false,
		jsonDocumentUrl: "/api/docs-json",
		yamlDocumentUrl: "/api/docs-yaml",
	});

	const adapter = app.getHttpAdapter();
	adapter.get(
		"/api/docs/scalar.js",
		(_request: unknown, response: ExpressResponse) => {
		response.type("application/javascript");
		response.setHeader("Cache-Control", "public, max-age=31536000, immutable");
		response.sendFile(scalarBundlePath());
		},
	);
	const renderScalar = (_request: unknown, response: ExpressResponse) => {
		response.type("text/html").send(renderScalarHtml());
	};
	adapter.get("/api/docs", renderScalar);
	adapter.get("/api/docs/", renderScalar);

	new Logger("OpenAPI").log(
		`Scalar API reference mounted with ${Object.keys(document.paths).length} paths`,
	);
}
