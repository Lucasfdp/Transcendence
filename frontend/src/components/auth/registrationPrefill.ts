export interface RegistrationPrefill {
	username: string;
	email: string;
}

export function registrationPrefill(identifier: string): RegistrationPrefill {
	const value = identifier.trim();
	return value.includes("@")
		? { username: "", email: value }
		: { username: value, email: "" };
}
