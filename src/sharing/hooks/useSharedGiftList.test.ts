import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

import { useSharedGiftList } from "./useSharedGiftList";
import { fetchSharedGiftList } from "../api/sharedGiftListQueries";
import type { SharedGiftListView } from "../api/sharedGiftListQueries";
import { subscribeToSharedGiftListChanged } from "../api/sharedGiftListSubscription";
import type { SharedGiftListChangedHandlers } from "../api/sharedGiftListSubscription";
import { GraphQlRequestError } from "../../giftlists/api/graphqlClient";

vi.mock("../api/sharedGiftListQueries", () => ({
  fetchSharedGiftList: vi.fn(),
}));
vi.mock("../api/sharedGiftListSubscription", () => ({
  subscribeToSharedGiftListChanged: vi.fn(),
}));

const fetchSharedGiftListMock = vi.mocked(fetchSharedGiftList);
const subscribeToSharedGiftListChangedMock = vi.mocked(
  subscribeToSharedGiftListChanged,
);
const closeSubscriptionMock = vi.fn();

function stubSubscription() {
  let capturedHandlers: SharedGiftListChangedHandlers | null = null;
  subscribeToSharedGiftListChangedMock.mockImplementation((_token, handlers) => {
    capturedHandlers = handlers;
    return { close: closeSubscriptionMock };
  });
  return {
    push: (giftList: SharedGiftListView) => capturedHandlers?.onData(giftList),
  };
}

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
  afterEach(() => {
    subscribeToSharedGiftListChangedMock.mockReset();
    closeSubscriptionMock.mockReset();
  });

  it("UseSharedGiftList_ShouldResolveToReady_WhenTheReadSucceeds", async () => {
    // Arrange
    stubSubscription();
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
    stubSubscription();
    fetchSharedGiftListMock.mockRejectedValue(notFoundError());

    // Act
    const { result } = renderHook(() => useSharedGiftList("share-token-1"));

    // Assert
    await waitFor(() => expect(result.current.state.status).toBe("error"));
    expect(fetchSharedGiftListMock).toHaveBeenCalledTimes(1);
  });

  it("UseSharedGiftList_ShouldRefetch_WhenRefetchIsCalled", async () => {
    // Arrange
    stubSubscription();
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

  it("UseSharedGiftList_ShouldSubscribeToSharedGiftListChanged_WithTheShareToken", async () => {
    // Arrange
    stubSubscription();
    fetchSharedGiftListMock.mockResolvedValue(aSharedGiftList());

    // Act
    renderHook(() => useSharedGiftList("share-token-1"));

    // Assert
    await waitFor(() =>
      expect(subscribeToSharedGiftListChangedMock).toHaveBeenCalledWith(
        "share-token-1",
        expect.objectContaining({
          onData: expect.any(Function),
          onError: expect.any(Function),
        }),
      ),
    );
  });

  it("UseSharedGiftList_ShouldReplaceTheGiftListWithThePushedView_WhenASubscriptionPushArrivesAfterReady", async () => {
    // Arrange — GL-38/GL-40: an item another guest reserves flips to `reserved: true` on this
    // screen without a reload.
    const { push } = stubSubscription();
    fetchSharedGiftListMock.mockResolvedValue(
      aSharedGiftList({
        items: [
          {
            itemId: "item-1",
            name: "Headphones",
            description: null,
            url: null,
            reserved: false,
          },
        ],
      }),
    );
    const { result } = renderHook(() => useSharedGiftList("share-token-1"));
    await waitFor(() => expect(result.current.state.status).toBe("ready"));

    // Act
    const pushedGiftList = aSharedGiftList({
      items: [
        {
          itemId: "item-1",
          name: "Headphones",
          description: null,
          url: null,
          reserved: true,
        },
      ],
    });
    act(() => {
      push(pushedGiftList);
    });

    // Assert
    expect(result.current.state).toEqual({
      status: "ready",
      giftList: pushedGiftList,
    });
  });

  it("UseSharedGiftList_ShouldIgnoreAPush_WhenItArrivesBeforeTheInitialReadHasEverSucceeded", () => {
    // Arrange — a push must not fabricate a "ready" screen out of a still-loading one.
    const { push } = stubSubscription();
    fetchSharedGiftListMock.mockReturnValue(new Promise(() => {})); // never resolves in this test
    const { result } = renderHook(() => useSharedGiftList("share-token-1"));

    // Act
    act(() => {
      push(aSharedGiftList());
    });

    // Assert
    expect(result.current.state).toEqual({ status: "loading" });
  });

  it("UseSharedGiftList_ShouldCloseTheSubscription_OnUnmount", async () => {
    // Arrange
    stubSubscription();
    fetchSharedGiftListMock.mockResolvedValue(aSharedGiftList());
    const { unmount } = renderHook(() => useSharedGiftList("share-token-1"));
    await waitFor(() =>
      expect(subscribeToSharedGiftListChangedMock).toHaveBeenCalled(),
    );

    // Act
    unmount();

    // Assert
    expect(closeSubscriptionMock).toHaveBeenCalled();
  });
});
