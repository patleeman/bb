// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import type { Thread } from "@bb/domain";
import { afterEach, describe, expect, it, vi } from "vitest";
import { COMPACT_VIEWPORT_QUERY } from "@bb/shared-ui/hooks/use-compact-viewport";
import { POINTER_COARSE_QUERY } from "@bb/shared-ui/hooks/use-pointer-coarse";
import {
  ThreadActionsContextMenu,
  ThreadActionsMenu,
} from "./ThreadActionsMenu";

const mocks = vi.hoisted(() => ({
  copyToClipboardWithToast: vi.fn(),
}));

vi.mock("@/lib/clipboard", () => ({
  copyToClipboardWithToast: mocks.copyToClipboardWithToast,
}));

vi.mock("./ThreadActionsProvider", () => ({
  useThreadActions: () => ({
    archiveThreadAndChildren: vi.fn(),
    requestRename: vi.fn(),
    requestDelete: vi.fn(),
    togglePin: vi.fn(),
    toggleRead: vi.fn(),
    unarchiveThread: vi.fn(),
  }),
}));

function createThread(): Thread {
  return {
    id: "thr_test",
    projectId: "proj_test",
    archivedAt: null,
    pinnedAt: null,
  } as Thread;
}

afterEach(() => {
  cleanup();
  mocks.copyToClipboardWithToast.mockReset();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("ThreadActionsMenu", () => {
  it("copies the canonical thread URL from every menu instance", () => {
    render(<ThreadActionsMenu thread={createThread()} />);

    fireEvent.pointerDown(
      screen.getByRole("button", { name: "Thread actions" }),
      { button: 0 },
    );
    fireEvent.click(screen.getByRole("menuitem", { name: "Copy thread link" }));

    expect(mocks.copyToClipboardWithToast).toHaveBeenCalledWith(
      `${window.location.origin}/projects/proj_test/threads/thr_test`,
      {
        successMessage: "Thread link copied",
        errorMessage: "Failed to copy thread link",
      },
    );
  });

  it("uses the mobile tray for coarse pointers even above the compact width", () => {
    vi.useFakeTimers();
    vi.spyOn(window, "matchMedia").mockImplementation((query) => ({
      matches: query === POINTER_COARSE_QUERY,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }));
    const onOpenChange = vi.fn();

    render(
      <ThreadActionsContextMenu
        thread={createThread()}
        onOpenChange={onOpenChange}
      >
        <div data-testid="thread-row">Thread row</div>
      </ThreadActionsContextMenu>,
    );

    const row = screen.getByTestId("thread-row");
    fireEvent.pointerDown(row, {
      pointerId: 1,
      pointerType: "touch",
      isPrimary: true,
      clientX: 100,
      clientY: 100,
    });
    expect(window.matchMedia(COMPACT_VIEWPORT_QUERY).matches).toBe(false);

    act(() => {
      vi.advanceTimersByTime(700);
    });
    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(onOpenChange).toHaveBeenCalledWith(true);
    expect(
      document.querySelector("[data-persistent-drawer-content]"),
    ).not.toBeNull();
    expect(document.querySelector("[role='menu']")).toBeNull();
  });
});
