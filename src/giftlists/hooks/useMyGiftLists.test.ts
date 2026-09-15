import { describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

import { useMyGiftLists } from "./useMyGiftLists";
import { fetchMyGiftLists } from "../api/giftListQueries";
import type { GiftListProjection } from "../api/giftListQueries";

vi.mock("../api/giftListQueries", () => ({
  fetchMyGiftLists: vi.fn(),
}));

const fetchMyGiftListsMock = vi.mocked(fetchMyGiftLists);

function aGiftList(overrides: Partial<GiftListProjection> = {}): GiftListProjection {
  return {
    listId: "list-1",
    ownerId: "owner-1",
    name: "Birthday Wishlist",
    expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    shareToken: "share-token-1",
    createdAt: new Date().toISOString(),
    items: [],
    ...overrides,
  };
}

describe("useMyGiftLists", () => {
  it("UseMyGiftLists_ShouldStartLoading_ThenResolveToReady_WhenTheQuerySucceeds", async () => {
    // Arrange
    const giftLists = [aGiftList()];
    fetchMyGiftListsMock.mockResolvedValue(giftLists);

    // Act
    const { result } = renderHook(() => useMyGiftLists("token-abc"));

    // Assert
    expect(result.current.state).toEqual({ status: "loading" });
    await waitFor(() =>
      expect(result.current.state).toEqual({ status: "ready", giftLists }),
    );
    expect(fetchMyGiftListsMock).toHaveBeenCalledWith("token-abc");
  });

  it("UseMyGiftLists_ShouldResolveToError_WhenTheQueryFails", async () => {
    // Arrange
    fetchMyGiftListsMock.mockRejectedValue(new Error("network down"));

    // Act
    const { result } = renderHook(() => useMyGiftLists("token-abc"));

    // Assert
    await waitFor(() => expect(result.current.state.status).toBe("error"));
  });

  it("UseMyGiftLists_ShouldReflectOnlyTheLatestRefetch_WhenAnOlderRequestResolvesAfterANewerOne", async () => {
    // Arrange — the exact race this hook's requestId guard exists for: refetch() called twice in
    // quick succession, and the *first* call's promise settles last. Without the guard, the stale
    // first response would clobber the fresh second one.
    let resolveFirst!: (value: GiftListProjection[]) => void;
    const firstCall = new Promise<GiftListProjection[]>((resolve) => {
      resolveFirst = resolve;
    });
    const secondGiftLists = [aGiftList({ listId: "list-2", name: "Second" })];

    fetchMyGiftListsMock
      .mockReturnValueOnce(firstCall)
      .mockResolvedValueOnce(secondGiftLists);

    const { result } = renderHook(() => useMyGiftLists("token-abc"));
    await waitFor(() => expect(fetchMyGiftListsMock).toHaveBeenCalledTimes(1));

    // Act — trigger the second, faster-resolving request while the first is still pending.
    act(() => {
      result.current.refetch();
    });
    await waitFor(() =>
      expect(result.current.state).toEqual({
        status: "ready",
        giftLists: secondGiftLists,
      }),
    );
    // Now let the stale first request resolve.
    act(() => resolveFirst([aGiftList({ listId: "stale" })]));

    // Assert — the stale response must not have overwritten the fresh one.
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(result.current.state).toEqual({
      status: "ready",
      giftLists: secondGiftLists,
    });
  });
});
