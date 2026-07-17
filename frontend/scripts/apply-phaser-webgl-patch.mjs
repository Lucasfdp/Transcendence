import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const PHASER_TEXTURE_WRAPPERS = [
	"node_modules/phaser/src/renderer/webgl/wrappers/WebGLTextureWrapper.js",
	"node_modules/phaser/dist/phaser.js",
];

const RAW_UPLOAD_MARKER = "var isRawUpload = !pixels || pixels.compressed";
const MIPMAP_MARKER = "var usesMipmaps = (";

function replaceOnce(source, beforeLines, afterLines, newline, file) {
	const before = beforeLines.join(newline);
	if (!source.includes(before))
		throw new Error(`Phaser patch context changed in ${file}`);
	return source.replace(before, afterLines.join(newline));
}

async function patchTextureWrapper(relativePath) {
	const file = resolve(relativePath);
	let source = await readFile(file, "utf8");
	const newline = source.includes("\r\n") ? "\r\n" : "\n";
	let changed = false;

	if (!source.includes(RAW_UPLOAD_MARKER)) {
		source = replaceOnce(
			source,
			[
				"        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, this.pma);",
				"        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, this.flipY);",
				"",
				"        var pixels = this.pixels;",
				"        var mipLevel = this.mipLevel;",
				"        var width = this.width;",
				"        var height = this.height;",
				"        var format = this.format;",
			],
			[
				"        var pixels = this.pixels;",
				"        var mipLevel = this.mipLevel;",
				"        var width = this.width;",
				"        var height = this.height;",
				"        var format = this.format;",
				"        var isRawUpload = !pixels || pixels.compressed || pixels instanceof Uint8Array;",
				"",
				"        // WebGL ignores these DOM-source conversions for raw pixel uploads and",
				"        // Firefox warns when they are enabled. Apply them only where valid.",
				"        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, isRawUpload ? false : this.pma);",
				"        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, isRawUpload ? false : this.flipY);",
			],
			newline,
			relativePath,
		);
		changed = true;
	}

	if (!source.includes(MIPMAP_MARKER)) {
		source = replaceOnce(
			source,
			["        if (generateMipmap)"],
			[
				"        var usesMipmaps = (",
				"            this.minFilter === gl.NEAREST_MIPMAP_NEAREST ||",
				"            this.minFilter === gl.LINEAR_MIPMAP_NEAREST ||",
				"            this.minFilter === gl.NEAREST_MIPMAP_LINEAR ||",
				"            this.minFilter === gl.LINEAR_MIPMAP_LINEAR",
				"        );",
				"",
				"        // Phaser's default LINEAR filter never samples mip levels. Avoid",
				"        // generating unused levels, which also triggers Firefox lazy-init warnings.",
				"        if (generateMipmap && usesMipmaps)",
			],
			newline,
			relativePath,
		);
		changed = true;
	}

	if (changed) await writeFile(file, source, "utf8");
}

await Promise.all(PHASER_TEXTURE_WRAPPERS.map(patchTextureWrapper));
