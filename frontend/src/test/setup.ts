/**
 * Global test setup — runs once before each test file.
 *
 * - Extends `expect` with jest-dom matchers (toBeInTheDocument, etc.)
 * - Unmounts React trees after every test to prevent cross-test leakage.
 */
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => {
	cleanup();
});
