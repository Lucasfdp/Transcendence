import { renderHook, act } from "@testing-library/react";
import { type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	DEFAULT_TOAST_DURATION_MS,
	MAX_TOASTS,
	ToastProvider,
	useToast,
} from "./ToastContext";

function wrapper({ children }: { children: ReactNode }): JSX.Element {
	return <ToastProvider>{children}</ToastProvider>;
}

describe("useToast", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it("should add a toast when showToast is called", () => {
		const { result } = renderHook(() => useToast(), { wrapper });
		act(() => {
			result.current.showToast({ message: "Added" });
		});
		expect(result.current.toasts).toHaveLength(1);
		expect(result.current.toasts[0].message).toBe("Added");
	});

	it("should auto-dismiss a toast after the default duration", () => {
		const { result } = renderHook(() => useToast(), { wrapper });
		act(() => {
			result.current.showToast({ message: "Bye" });
		});
		expect(result.current.toasts).toHaveLength(1);
		act(() => {
			vi.advanceTimersByTime(DEFAULT_TOAST_DURATION_MS);
		});
		expect(result.current.toasts).toHaveLength(0);
	});

	it("should remove a toast immediately when dismissToast is called", () => {
		const { result } = renderHook(() => useToast(), { wrapper });
		let id = "";
		act(() => {
			id = result.current.showToast({ message: "x" });
		});
		act(() => {
			result.current.dismissToast(id);
		});
		expect(result.current.toasts).toHaveLength(0);
	});

	it("should cap the number of simultaneous toasts at MAX_TOASTS", () => {
		const { result } = renderHook(() => useToast(), { wrapper });
		act(() => {
			for (let i = 0; i < MAX_TOASTS + 3; i++) {
				result.current.showToast({ message: `t${i}` });
			}
		});
		expect(result.current.toasts.length).toBeLessThanOrEqual(MAX_TOASTS);
	});

	it("should throw when useToast is used outside a ToastProvider", () => {
		vi.spyOn(console, "error").mockImplementation(() => undefined);
		expect(() => renderHook(() => useToast())).toThrow(
			/ToastProvider/,
		);
	});
});
