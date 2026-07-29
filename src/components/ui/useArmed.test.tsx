// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useArmed } from "./useArmed";

/**
 * The two-click destructive guard, tested for the property that gives it its
 * name: it FORGETS. An arm-and-forget confirm that stayed armed would wipe the
 * book on a click made minutes later with no question in mind.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let api: ReturnType<typeof useArmed> | null = null;
function Probe({ ms }: { ms?: number }) {
  api = useArmed(ms);
  return <span>{api.armed ? "ARMED" : "SAFE"}</span>;
}

let root: Root | null = null;
let host: HTMLElement | null = null;
function mount(ms?: number) {
  host = document.createElement("div");
  act(() => {
    root = createRoot(host!);
    root.render(<Probe ms={ms} />);
  });
}

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  api = null;
  host = null;
  vi.useRealTimers();
});

describe("useArmed", () => {
  it("starts safe, arms on demand, and disarms on command", () => {
    mount();
    expect(host!.textContent).toBe("SAFE");
    act(() => api!.arm());
    expect(host!.textContent).toBe("ARMED");
    act(() => api!.disarm());
    expect(host!.textContent).toBe("SAFE");
  });

  it("forgets it was armed after the window, so a stale click cannot fire", () => {
    vi.useFakeTimers();
    mount(5000);
    act(() => api!.arm());
    expect(host!.textContent).toBe("ARMED");
    act(() => void vi.advanceTimersByTime(4999));
    expect(host!.textContent).toBe("ARMED"); // still armed just inside the window
    act(() => void vi.advanceTimersByTime(2));
    expect(host!.textContent).toBe("SAFE"); // and disarmed once it lapses
  });

  it("re-arming restarts the forget timer rather than compounding it", () => {
    vi.useFakeTimers();
    mount(5000);
    act(() => api!.arm());
    act(() => void vi.advanceTimersByTime(4000));
    act(() => api!.arm()); // re-arm at t=4s resets the 5s window
    act(() => void vi.advanceTimersByTime(4000)); // t=8s total, but 4s since re-arm
    expect(host!.textContent).toBe("ARMED");
    act(() => void vi.advanceTimersByTime(1500)); // 5.5s since re-arm
    expect(host!.textContent).toBe("SAFE");
  });
});
