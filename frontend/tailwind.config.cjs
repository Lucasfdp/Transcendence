/** @type {import("tailwindcss").Config} */
module.exports = {
	content: ["./index.html", "./src/**/*.{ts,tsx}"],
	theme: {
		extend: {
			animation: {
				"route-loading-spin": "route-loading-spin 0.85s linear infinite",
				"toast-in": "toast-in 160ms ease-out",
			},
			fontFamily: {
				display: ["var(--display-font)"],
				body: ["var(--body-font)"],
				brush: ["var(--blowbrush-font)"],
				rowdy: ["var(--rowdy-font)"],
			},
			keyframes: {
				"route-loading-spin": {
					to: { transform: "rotate(360deg)" },
				},
				"toast-in": {
					from: {
						opacity: "0",
						transform: "translateY(8px)",
					},
					to: {
						opacity: "1",
						transform: "translateY(0)",
					},
				},
			},
		},
	},
	corePlugins: {
		preflight: false,
	},
};
