import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { ConnectError, Code } from "@connectrpc/connect";

import { useGiftList } from "./useGiftList";
import { fetchGiftList } from "../api/giftListQueries";
import type { GiftListProjection } from "../api/giftListQueries";
import { GraphQlRequestError } from "../api/graphqlClient";

vi.mock("../api/giftListQueries", () => ({
  fetchGiftList: vi.fn(),
}));

const fetchGiftListMock = vi.mocked(fetchGiftList);

function notFoundError(): GraphQlRequestError {
  return new GraphQlRequestError([
    {
      message: "No gift list exists with this id.",
      extensions: { code: "NOT_FOUND", errorCode: "gateway.not_found" },
    },
  ]);
}

function forbiddenError(): GraphQlRequestError {
  return new GraphQlRequestError([
    {
      message: "You do not own this gift list.",
      extensions: { code: "FORBIDDEN", errorCode: "gateway.forbidden" },
    },
  ]);
}

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

const FAST_RETRY_DELAYS_MS = [5, 5];

afterEach(() => {
  vi.useRealTimers();
});

describe("useGiftList — plain reads", () => {
  it("UseGiftList_ShouldResolveToReady_WhenTheFirstReadSucceeds", async () => {
    // Arrange
    const giftList = aGiftList();
    fetchGiftListMock.mockResolvedValue(giftList);

    // Act
    const { result } = renderHook(() => useGiftList("token-abc", "list-1"));

    // Assert
    expect(result.current.state).toEqual({ status: "loading" });
    await waitFor(() =>
      expect(result.current.state).toEqual({ status: "ready", giftList }),
    );
    expect(fetchGiftListMock).toHaveBeenCalledWith("token-abc", "list-1");
  });

  it("UseGiftList_ShouldResolveToNotFoundImmediately_WhenRetryOnNotFoundIsNotSet", async () => {
    // Arrange — batch-15 review item 3: an ordinary arrival (bookmark, mistyped id, back button
    // onto a list just deleted) has no reason to expect the read model to still be catching up, so
    // the default (`retryOnNotFound` unset) must not engage the ladder at all.
    fetchGiftListMock.mockRejectedValue(notFoundError());

    // Act
    const { result } = renderHook(() => useGiftList("token-abc", "list-1"));

    // Assert
    await waitFor(() =>
      expect(result.current.state).toEqual({ status: "not-found" }),
    );
    expect(fetchGiftListMock).toHaveBeenCalledTimes(1);
  });

  it("UseGiftList_ShouldResolveToForbidden_WhenTheCallerDoesNotOwnTheList", async () => {
    // Arrange
    fetchGiftListMock.mockRejectedValue(forbiddenError());

    // Act
    const { result } = renderHook(() =>
      useGiftList("token-abc", "list-1", { retryDelaysMs: FAST_RETRY_DELAYS_MS }),
    );

    // Assert
    await waitFor(() =>
      expect(result.current.state).toEqual({ status: "forbidden" }),
    );
    // Forbidden must not be retried the way not-found is — it will never resolve differently.
    expect(fetchGiftListMock).toHaveBeenCalledTimes(1);
  });

  it("UseGiftList_ShouldResolveToError_WhenTheFailureIsNotAGraphQlShapedError", async () => {
    // Arrange — e.g. a raw grpc-web error type reaching this GraphQL-only hook by mistake, or an
    // unrelated thrown value.
    fetchGiftListMock.mockRejectedValue(
      new ConnectError("boom", Code.Internal),
    );

    // Act
    const { result } = renderHook(() => useGiftList("token-abc", "list-1"));

    // Assert
    await waitFor(() => expect(result.current.state.status).toBe("error"));
  });
});

describe("useGiftList — retryOnNotFound (create-and-navigate arrival)", () => {
  it("UseGiftList_ShouldRetryAndThenResolveToReady_WhenNotFoundClearsUpWithinTheRetryWindow", async () => {
    // Arrange — the eventual-consistency gap `retryOnNotFound` exists for: CreateGiftList's read
    // model hasn't caught up on the very first read, but does by the second.
    const giftList = aGiftList();
    fetchGiftListMock
      .mockRejectedValueOnce(notFoundError())
      .mockResolvedValueOnce(giftList);

    // Act
    const { result } = renderHook(() =>
      useGiftList("token-abc", "list-1", {
        retryOnNotFound: true,
        retryDelaysMs: FAST_RETRY_DELAYS_MS,
      }),
    );

    // Assert — the transient "pending" state between the two attempts is real (see the hook's
    // "pending" case) but too short-lived here to reliably observe against waitFor's polling
    // interval; the call count below is what actually pins that a retry happened, not just an
    // immediate success.
    await waitFor(() =>
      expect(result.current.state).toEqual({ status: "ready", giftList }),
    );
    expect(fetchGiftListMock).toHaveBeenCalledTimes(2);
  });

  it("UseGiftList_ShouldResolveToUnresolved_WhenNotFoundPersistsPastTheRetryWindow", async () => {
    // Arrange — GL-72's residual: this can mean "still processing" or "the create command was
    // rejected and this list will never exist" — the hook cannot tell which, so it must report
    // "unresolved" rather than either "ready" or a plain not-found once retries are exhausted.
    fetchGiftListMock.mockRejectedValue(notFoundError());

    // Act
    const { result } = renderHook(() =>
      useGiftList("token-abc", "list-1", {
        retryOnNotFound: true,
        retryDelaysMs: FAST_RETRY_DELAYS_MS,
      }),
    );

    // Assert
    await waitFor(() =>
      expect(result.current.state).toEqual({ status: "unresolved" }),
    );
    // One initial attempt plus one retry per configured delay.
    expect(fetchGiftListMock).toHaveBeenCalledTimes(1 + FAST_RETRY_DELAYS_MS.length);
  });

  it("UseGiftList_ShouldRetryFromScratch_WhenRefetchIsCalledAfterUnresolved", async () => {
    // Arrange — the "Check again" button's path: unresolved, then the list turns out to exist.
    fetchGiftListMock.mockRejectedValue(notFoundError());
    const { result } = renderHook(() =>
      useGiftList("token-abc", "list-1", {
        retryOnNotFound: true,
        retryDelaysMs: FAST_RETRY_DELAYS_MS,
      }),
    );
    await waitFor(() =>
      expect(result.current.state).toEqual({ status: "unresolved" }),
    );

    const giftList = aGiftList();
    fetchGiftListMock.mockReset();
    fetchGiftListMock.mockResolvedValue(giftList);

    // Act
    act(() => {
      result.current.refetch();
    });

    // Assert
    expect(result.current.state).toEqual({ status: "loading" });
    await waitFor(() =>
      expect(result.current.state).toEqual({ status: "ready", giftList }),
    );
  });

  it("UseGiftList_ShouldNotDoubleFetch_WhenRefetchIsCalledWhileARetryIsStillPending", async () => {
    // Arrange — batch-15 review item 5: refetch() used to leave a still-pending NOT_FOUND retry
    // timer running, so a stale scheduled attempt could land after a fresh manual refetch and
    // clobber it. Real timers throughout (fake timers plus React's own act()/scheduler proved
    // unreliable together) — the auto-retry delay is long enough that a manual refetch fired
    // immediately after "pending" is guaranteed to land first, and the assertion waits past the
    // auto-retry's own delay before checking nothing extra happened.
    const AUTO_RETRY_DELAY_MS = 150;
    // Hoisted, not an inline literal in the renderHook callback below — options.retryDelaysMs is
    // a useCallback dependency, so a *fresh* array on every render would itself (harmlessly, but
    // confusingly for this test) retrigger the mount effect on every state update. Every other
    // test in this file already avoids this by passing the shared FAST_RETRY_DELAYS_MS constant;
    // this one needs its own because the delay must be long enough to reliably observe "pending"
    // before it elapses.
    const RETRY_DELAYS_MS = [AUTO_RETRY_DELAY_MS];
    const freshGiftList = aGiftList({ name: "Fresh — from the manual refetch" });
    fetchGiftListMock
      .mockRejectedValueOnce(notFoundError()) // initial load
      .mockResolvedValueOnce(freshGiftList); // the manual refetch's own call — if the cancelled
    // auto-retry fires anyway, it consumes *this* response instead and the manual refetch's own
    // fetch call falls through to no queued mock at all (a third call this test never expects).

    const { result } = renderHook(() =>
      useGiftList("token-abc", "list-1", {
        retryOnNotFound: true,
        retryDelaysMs: RETRY_DELAYS_MS,
      }),
    );

    // Flushes the initial rejection's own microtask chain deterministically, without racing
    // waitFor's polling interval against the real 150ms retry timer below (a first attempt at
    // this test did exactly that and was flaky — "pending" is transient enough that a 50ms-spaced
    // poll can miss it entirely once the retry fires).
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.current.state).toEqual({ status: "pending" });
    expect(fetchGiftListMock).toHaveBeenCalledTimes(1);

    // Act — refetch well before the auto-retry timer fires; it must cancel that timer.
    act(() => {
      result.current.refetch();
    });
    await waitFor(() =>
      expect(result.current.state).toEqual({
        status: "ready",
        giftList: freshGiftList,
      }),
    );

    // Wait past when the (should-be-cancelled) auto-retry would have fired, then assert nothing
    // more happened — a third call would mean it fired anyway.
    await new Promise((resolve) => setTimeout(resolve, AUTO_RETRY_DELAY_MS * 3));

    // Assert
    expect(result.current.state).toEqual({
      status: "ready",
      giftList: freshGiftList,
    });
    expect(fetchGiftListMock).toHaveBeenCalledTimes(2);
  });
});

describe("useGiftList — confirmChange (post Rename/AddItem/RemoveItem)", () => {
  it("UseGiftList_ConfirmChange_ShouldResolveTrueImmediately_WhenTheFirstReadAlreadySatisfiesThePredicate", async () => {
    // Arrange
    const giftList = aGiftList({ name: "Already updated" });
    fetchGiftListMock.mockResolvedValue(giftList);
    const { result } = renderHook(() =>
      useGiftList("token-abc", "list-1", { retryDelaysMs: FAST_RETRY_DELAYS_MS }),
    );
    await waitFor(() => expect(result.current.state.status).toBe("ready"));
    fetchGiftListMock.mockClear();
    fetchGiftListMock.mockResolvedValue(giftList);

    // Act
    let confirmed: boolean | undefined;
    await act(async () => {
      confirmed = await result.current.confirmChange(
        (list) => list.name === "Already updated",
      );
    });

    // Assert
    expect(confirmed).toBe(true);
    expect(fetchGiftListMock).toHaveBeenCalledTimes(1);
  });

  it("UseGiftList_ConfirmChange_ShouldRetryAndResolveTrue_WhenThePredicateOnlyMatchesOnALaterRead", async () => {
    // Arrange — the exact bug this fixes: a rename whose read model hasn't caught up on the very
    // first re-read after the write RPC returns.
    const staleList = aGiftList({ name: "Old Name" });
    const updatedList = aGiftList({ name: "New Name" });
    fetchGiftListMock.mockResolvedValue(staleList);
    const { result } = renderHook(() =>
      useGiftList("token-abc", "list-1", { retryDelaysMs: FAST_RETRY_DELAYS_MS }),
    );
    await waitFor(() => expect(result.current.state.status).toBe("ready"));
    fetchGiftListMock.mockReset();
    fetchGiftListMock
      .mockResolvedValueOnce(staleList)
      .mockResolvedValueOnce(updatedList);

    // Act
    let confirmed: boolean | undefined;
    const confirmPromise = act(async () => {
      confirmed = await result.current.confirmChange(
        (list) => list.name === "New Name",
      );
    });
    await confirmPromise;

    // Assert
    expect(confirmed).toBe(true);
    expect(fetchGiftListMock).toHaveBeenCalledTimes(2);
    expect(result.current.state).toEqual({ status: "ready", giftList: updatedList });
  });

  it("UseGiftList_ConfirmChange_ShouldResolveFalse_WhenThePredicateNeverMatchesWithinTheLadder", async () => {
    // Arrange — the honest-failure path: the change never shows up before the ladder is exhausted.
    const staleList = aGiftList({ name: "Old Name" });
    fetchGiftListMock.mockResolvedValue(staleList);
    const { result } = renderHook(() =>
      useGiftList("token-abc", "list-1", { retryDelaysMs: FAST_RETRY_DELAYS_MS }),
    );
    await waitFor(() => expect(result.current.state.status).toBe("ready"));
    fetchGiftListMock.mockClear();
    fetchGiftListMock.mockResolvedValue(staleList);

    // Act
    let confirmed: boolean | undefined;
    await act(async () => {
      confirmed = await result.current.confirmChange(
        (list) => list.name === "Never Happens",
      );
    });

    // Assert — still displaying the real (if unconfirmed) data, not blanked or reverted.
    expect(confirmed).toBe(false);
    expect(fetchGiftListMock).toHaveBeenCalledTimes(1 + FAST_RETRY_DELAYS_MS.length);
    expect(result.current.state).toEqual({ status: "ready", giftList: staleList });
  });
});

describe("useGiftList — confirmDeleted (post Delete)", () => {
  it("UseGiftList_ConfirmDeleted_ShouldResolveTrue_WhenTheNextReadIsNotFound", async () => {
    // Arrange
    const giftList = aGiftList();
    fetchGiftListMock.mockResolvedValue(giftList);
    const { result } = renderHook(() =>
      useGiftList("token-abc", "list-1", { retryDelaysMs: FAST_RETRY_DELAYS_MS }),
    );
    await waitFor(() => expect(result.current.state.status).toBe("ready"));
    fetchGiftListMock.mockReset();
    fetchGiftListMock
      .mockResolvedValueOnce(giftList) // still there on the first re-check
      .mockRejectedValueOnce(notFoundError()); // gone on the second

    // Act
    let confirmed: boolean | undefined;
    await act(async () => {
      confirmed = await result.current.confirmDeleted();
    });

    // Assert
    expect(confirmed).toBe(true);
    expect(fetchGiftListMock).toHaveBeenCalledTimes(2);
  });

  it("UseGiftList_ConfirmDeleted_ShouldResolveFalse_WhenTheListKeepsExistingPastTheLadder", async () => {
    // Arrange — the list stubbornly keeps reading back as present.
    const giftList = aGiftList();
    fetchGiftListMock.mockResolvedValue(giftList);
    const { result } = renderHook(() =>
      useGiftList("token-abc", "list-1", { retryDelaysMs: FAST_RETRY_DELAYS_MS }),
    );
    await waitFor(() => expect(result.current.state.status).toBe("ready"));
    fetchGiftListMock.mockClear();
    fetchGiftListMock.mockResolvedValue(giftList);

    // Act
    let confirmed: boolean | undefined;
    await act(async () => {
      confirmed = await result.current.confirmDeleted();
    });

    // Assert
    expect(confirmed).toBe(false);
    expect(fetchGiftListMock).toHaveBeenCalledTimes(1 + FAST_RETRY_DELAYS_MS.length);
  });

  it("UseGiftList_ConfirmDeleted_ShouldResolveFalse_WhenTheRecheckFailsWithADifferentError", async () => {
    // Arrange — e.g. a genuine outage mid-confirmation; must not be mistaken for "confirmed gone".
    const giftList = aGiftList();
    fetchGiftListMock.mockResolvedValue(giftList);
    const { result } = renderHook(() =>
      useGiftList("token-abc", "list-1", { retryDelaysMs: FAST_RETRY_DELAYS_MS }),
    );
    await waitFor(() => expect(result.current.state.status).toBe("ready"));
    fetchGiftListMock.mockReset();
    fetchGiftListMock.mockRejectedValue(new ConnectError("boom", Code.Internal));

    // Act
    let confirmed: boolean | undefined;
    await act(async () => {
      confirmed = await result.current.confirmDeleted();
    });

    // Assert
    expect(confirmed).toBe(false);
  });
});
