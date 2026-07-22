import { readFile } from "fs/promises";

const MINIMUM_PATHS = 97;
const MINIMUM_OPERATIONS = 108;
const HTTP_METHODS = new Set([
	"get",
	"put",
	"post",
	"delete",
	"options",
	"head",
	"patch",
	"trace",
]);

type OpenApiDocument = {
	openapi?: string;
	paths?: Record<string, Record<string, unknown>>;
	components?: {
		schemas?: Record<string, Record<string, unknown>>;
		securitySchemes?: Record<string, unknown>;
	};
};

async function loadDocument(source: string): Promise<OpenApiDocument> {
	if (/^https?:\/\//.test(source)) {
		const response = await fetch(source);
		if (!response.ok) {
			throw new Error(`OpenAPI request failed with HTTP ${response.status}`);
		}
		return (await response.json()) as OpenApiDocument;
	}
	return JSON.parse(await readFile(source, "utf8")) as OpenApiDocument;
}

function isEmptySchema(schema: Record<string, unknown>): boolean {
	return Object.keys(schema).length === 0;
}

export function validateOpenApiDocument(document: OpenApiDocument): {
	paths: number;
	operations: number;
} {
	const errors: string[] = [];
	if (!document.openapi?.startsWith("3.")) {
		errors.push("the document is not OpenAPI 3.x");
	}
	const paths = document.paths ?? {};
	const pathCount = Object.keys(paths).length;
	const operationIds = new Set<string>();
	let operationCount = 0;
	const securitySchemes = new Set(
		Object.keys(document.components?.securitySchemes ?? {}),
	);

	for (const [path, pathItem] of Object.entries(paths)) {
		if (!path.startsWith("/")) errors.push(`invalid path: ${path}`);
		for (const [method, candidate] of Object.entries(pathItem)) {
			if (!HTTP_METHODS.has(method)) continue;
			operationCount += 1;
			const operation = candidate as {
				operationId?: string;
				summary?: string;
				responses?: Record<string, unknown>;
				security?: Array<Record<string, string[]>>;
			};
			const label = `${method.toUpperCase()} ${path}`;
			if (!operation.summary?.trim()) errors.push(`${label} has no summary`);
			if (!operation.responses || Object.keys(operation.responses).length === 0) {
				errors.push(`${label} has no response`);
			}
			if (!operation.operationId?.trim()) {
				errors.push(`${label} has no operationId`);
			} else if (operationIds.has(operation.operationId)) {
				errors.push(`duplicate operationId: ${operation.operationId}`);
			} else {
				operationIds.add(operation.operationId);
			}
			for (const requirement of operation.security ?? []) {
				for (const name of Object.keys(requirement)) {
					if (!securitySchemes.has(name)) {
						errors.push(`${label} references undefined security scheme ${name}`);
					}
				}
			}
		}
	}

	if (pathCount < MINIMUM_PATHS) {
		errors.push(`path count regressed: ${pathCount} < ${MINIMUM_PATHS}`);
	}
	if (operationCount < MINIMUM_OPERATIONS) {
		errors.push(
			`operation count regressed: ${operationCount} < ${MINIMUM_OPERATIONS}`,
		);
	}
	for (const [name, schema] of Object.entries(
		document.components?.schemas ?? {},
	)) {
		if (isEmptySchema(schema)) errors.push(`empty component schema: ${name}`);
	}

	if (errors.length > 0) {
		throw new Error(`OpenAPI validation failed:\n- ${errors.join("\n- ")}`);
	}
	return { paths: pathCount, operations: operationCount };
}

async function main(): Promise<void> {
	const source = process.argv[2] ?? "http://localhost:8000/api/docs-json";
	const result = validateOpenApiDocument(await loadDocument(source));
	process.stdout.write(
		`OpenAPI valid: ${result.paths} paths, ${result.operations} operations\n`,
	);
}

if (require.main === module) {
	void main().catch((error: unknown) => {
		process.stderr.write(
			`${error instanceof Error ? error.message : String(error)}\n`,
		);
		process.exitCode = 1;
	});
}
