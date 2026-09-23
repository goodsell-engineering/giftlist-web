import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

import { useSharedGiftList } from "./useSharedGiftList";
import { fetchSharedGiftList } from "../api/sharedGiftListQueries";
import type { SharedGiftListView } from "../api/sharedGiftListQueries";
import { subscribeToSharedGiftListChanged } from "../api/sharedGiftListSubscription";
import type { SharedGiftListChangedHandlers } from "../api/sharedGiftListSubscription";
import { GraphQlRequestError } from "../../giftlists/api/graphqlClient";
import { aShareToken } from "../../test/shareTokens";

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
  subscribeToSharedGiftListChangedMock.mockImplementation(
    (_token, handlers) => {
      capturedHandlers = handlers;
      return { close: closeSubscriptionMock };
    },
  );
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
    const { result } = renderHook(() => useSharedGiftList(aShareToken()));

    // Assert
    expect(result.current.state).toEqual({ status: "loading" });
    await waitFor(() =>
      expect(result.current.state).toEqual({ status: "ready", giftList }),
    );
    expect(fetchSharedGiftListMock).toHaveBeenCalledWith(aShareToken());
  });

  it("UseSharedGiftList_ShouldResolveToErrorImmediately_WhenTheTokenDoesNotResolve", async () => {
    // Arrange — no retry ladder here: a guest arriving via a share link has no reason to expect
    // the read model is still catching up (unlike the owner's create-and-navigate arrival).
    stubSubscription();
    fetchSharedGiftListMock.mockRejectedValue(notFoundError());

    // Act
    const { result } = renderHook(() => useSharedGiftList(aShareToken()));

    // Assert
    await waitFor(() => expect(result.current.state.status).toBe("error"));
    expect(fetchSharedGiftListMock).toHaveBeenCalledTimes(1);
  });

  it("UseSharedGiftList_ShouldRefetch_WhenRefetchIsCalled", async () => {
    // Arrange
    stubSubscription();
    const giftList = aSharedGiftList();
    fetchSharedGiftListMock.mockResolvedValue(giftList);
    const { result } = renderHook(() => useSharedGiftList(aShareToken()));
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
    renderHook(() => useSharedGiftList(aShareToken()));

    // Assert
    await waitFor(() =>
      expect(subscribeToSharedGiftListChangedMock).toHaveBeenCalledWith(
        aShareToken(),
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
    const { result } = renderHook(() => useSharedGiftList(aShareToken()));
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

  it("UseSharedGiftList_ShouldNotFabricateAReadyScreen_WhenAPushArrivesBeforeTheInitialReadHasEverSucceeded", () => {
    // Arrange — a push must not fabricate a "ready" screen out of a still-loading one while the
    // fetch it's racing might still fail. It is buffered instead (the next test), not dropped.
    const { push } = stubSubscription();
    fetchSharedGiftListMock.mockReturnValue(new Promise(() => {})); // never resolves in this test
    const { result } = renderHook(() => useSharedGiftList(aShareToken()));

    // Act
    act(() => {
      push(aSharedGiftList());
    });

    // Assert
    expect(result.current.state).toEqual({ status: "loading" });
  });

  it("UseSharedGiftList_ShouldApplyABufferedPush_WhenItArrivedWhileLoadingAndTheInitialReadThenSucceeds", async () => {
    // Arrange — GL-42 (folded from GL-40's own review): the query's own DB read and a live change
    // notification race with no ordering guarantee, so the push — provably fresher — must win.
    const { push } = stubSubscription();
    let resolveFetch: (giftList: SharedGiftListView) => void = () => {};
    fetchSharedGiftListMock.mockReturnValue(
      new Promise((resolve) => {
        resolveFetch = resolve;
      }),
    );
    const { result } = renderHook(() => useSharedGiftList(aShareToken()));

    // Act — a push lands before the initial read has resolved...
    const pushedGiftList = aSharedGiftList({ name: "Pushed while loading" });
    act(() => {
      push(pushedGiftList);
    });
    expect(result.current.state).toEqual({ status: "loading" });

    // ...then the initial read finally settles, with a now-stale response of its own.
    await act(async () => {
      resolveFetch(aSharedGiftList({ name: "Stale query response" }));
    });

    // Assert — the buffered push wins, not the stale query response.
    expect(result.current.state).toEqual({
      status: "ready",
      giftList: pushedGiftList,
    });
  });

  it("UseSharedGiftList_ShouldNotApplyAStaleBufferedPush_WhenARefetchSupersedesTheFetchItRaced", async () => {
    // Arrange — the buffer is reset at the start of every fetch (this file's own header): a push
    // buffered for one fetch generation must not leak into a later, unrelated one.
    const { push } = stubSubscription();
    let resolveFirst: (giftList: SharedGiftListView) => void = () => {};
    let resolveSecond: (giftList: SharedGiftListView) => void = () => {};
    fetchSharedGiftListMock
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveSecond = resolve;
          }),
      );
    const { result } = renderHook(() => useSharedGiftList(aShareToken()));

    // Act — a push lands during the first, still in-flight fetch...
    act(() => {
      push(aSharedGiftList({ name: "Stale push from the first fetch" }));
    });

    // ...then a refetch starts a second fetch before the first ever resolves...
    act(() => {
      result.current.refetch();
    });
    expect(result.current.state).toEqual({ status: "loading" });

    // ...and the second fetch settles with its own answer.
    const secondFetchResult = aSharedGiftList({ name: "Second fetch" });
    await act(async () => {
      resolveSecond(secondFetchResult);
    });

    // Assert — the stale push from the superseded first fetch does not win.
    expect(result.current.state).toEqual({
      status: "ready",
      giftList: secondFetchResult,
    });

    // Cleanup — the first fetch's own (now-ignored) resolution.
    await act(async () => {
      resolveFirst(aSharedGiftList());
    });
  });

  it("UseSharedGiftList_ShouldCloseTheSubscription_OnUnmount", async () => {
    // Arrange
    stubSubscription();
    fetchSharedGiftListMock.mockResolvedValue(aSharedGiftList());
    const { unmount } = renderHook(() => useSharedGiftList(aShareToken()));
    await waitFor(() =>
      expect(subscribeToSharedGiftListChangedMock).toHaveBeenCalled(),
    );

    // Act
    unmount();

    // Assert
    expect(closeSubscriptionMock).toHaveBeenCalled();
  });
});
