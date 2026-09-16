import { describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

import { useSharedGiftList } from "./useSharedGiftList";
import { fetchSharedGiftList } from "../api/sharedGiftListQueries";
import type { SharedGiftListView } from "../api/sharedGiftListQueries";
import { GraphQlRequestError } from "../../giftlists/api/graphqlClient";

vi.mock("../api/sharedGiftListQueries", () => ({
  fetchSharedGiftList: vi.fn(),
}));

const fetchSharedGiftListMock = vi.mocked(fetchSharedGiftList);

function aSharedGiftList(
  overrides: Partial<SharedGiftListView> = {},
): SharedGiftListView {
  return {
    listId: "list-1",
    name: "Birthday Wishlist",
    expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    items: [],
    ...overrides,
  };
}

function notFoundError(): GraphQlRequestError {
  return new GraphQlRequestError([
    {
      message: "No gift list exists for this token.",
      extensions: { code: "NOT_FOUND", errorCode: "gateway.not_found" },
    },
  ]);
}

describe("useSharedGiftList", () => {
  it("UseSharedGiftList_ShouldResolveToReady_WhenTheReadSucceeds", async () => {
    // Arrange
    const giftList = aSharedGiftList();
    fetchSharedGiftListMock.mockResolvedValue(giftList);

    // Act
    const { result } = renderHook(() => useSharedGiftList("share-token-1"));

    // Assert
    expect(result.current.state).toEqual({ status: "loading" });
    await waitFor(() =>
      expect(result.current.state).toEqual({ status: "ready", giftList }),
    );
    expect(fetchSharedGiftListMock).toHaveBeenCalledWith("share-token-1");
  });

  it("UseSharedGiftList_ShouldResolveToErrorImmediately_WhenTheTokenDoesNotResolve", async () => {
    // Arrange — no retry ladder here: a guest arriving via a share link has no reason to expect
    // the read model is still catching up (unlike the owner's create-and-navigate arrival).
    fetchSharedGiftListMock.mockRejectedValue(notFoundError());

    // Act
    const { result } = renderHook(() => useSharedGiftList("share-token-1"));

    // Assert
    await waitFor(() => expect(result.current.state.status).toBe("error"));
    expect(fetchSharedGiftListMock).toHaveBeenCalledTimes(1);
  });

  it("UseSharedGiftList_ShouldRefetch_WhenRefetchIsCalled", async () => {
    // Arrange
    const giftList = aSharedGiftList();
    fetchSharedGiftListMock.mockResolvedValue(giftList);
    const { result } = renderHook(() => useSharedGiftList("share-token-1"));
    await waitFor(() => expect(result.current.state.status).toBe("ready"));

    // Act
    act(() => {
      result.current.refetch();
    });

    // Assert
    expect(result.current.state).toEqual({ status: "loading" });
    await waitFor(() =>
      expect(result.current.state).toEqual({ status: "ready", giftList }),
    );
    expect(fetchSharedGiftListMock).toHaveBeenCalledTimes(2);
  });
});
