import {
	randomBytes,
	scrypt,
	timingSafeEqual,
	type ScryptOptions,
} from "crypto";

const SCRYPT_OPTS: ScryptOptions = {
	N: 32_768,
	r: 8,
	p: 1,
	maxmem: 64 * 1024 * 1024,
};
const SCRYPT_KEYLEN = 64;

function derive(password: string, salt: string): Promise<Buffer> {
	return new Promise((resolve, reject) =>
		scrypt(password, salt, SCRYPT_KEYLEN, SCRYPT_OPTS, (err, key) =>
			err ? reject(err) : resolve(key),
		),
	);
}

export async function hashPassword(plain: string): Promise<string> {
	const salt = randomBytes(16).toString("hex");
	const derived = await derive(plain, salt);
	return `${salt}:${derived.toString("hex")}`;
}

export async function verifyPassword(
	plain: string,
	stored: string | null,
): Promise<boolean> {
	if (!stored) {
		await derive("__dummy_constant__", "__dummy_salt__").catch(() => undefined);
		return false;
	}
	const [salt, hash] = stored.split(":");
	if (!salt || !hash) return false;
	try {
		const expected = Buffer.from(hash, "hex");
		const actual = await derive(plain, salt);
		return expected.length === actual.length && timingSafeEqual(expected, actual);
	} catch {
		return false;
	}
}
