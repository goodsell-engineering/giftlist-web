import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { Code, ConnectError } from "@connectrpc/connect";

import { useReserveGift } from "./useReserveGift";
import type { ReserveGiftLiveItem } from "./useReserveGift";
import { reservationsClient } from "../api/reservationsClient";
import { hasReleaseSecret } from "../storage/releaseSecretStore";
import { aShareToken } from "../../test/shareTokens";

vi.mock("../api/reservationsClient", () => ({
  reservationsClient: { reserveGift: vi.fn() },
}));

const reserveGiftMock = vi.mocked(reservationsClient.reserveGift);

/** Casts a plain object through the RPC's real return type without pinning to every field a
 * generated protobuf `Message` carries (`$typeName`, ...) — this hook only ever reads
 * `releaseSecret` off it. */
function resolvedReserveGiftResponse(releaseSecret: string) {
  return { releaseSecret } as unknown as Awaited<
    ReturnType<typeof reservationsClient.reserveGift>
  >;
}

function alreadyReservedError(): ConnectError {
  return new ConnectError(
    "This gift has already been reserved.",
    Code.Aborted,
    {
      "giftlist-error-code": "reservation.already_reserved",
    },
  );
}

function replyTimeoutError(): ConnectError {
  return new ConnectError("unavailable", Code.Unavailable, {
    "giftlist-error-code": "messaging.reply_timeout",
  });
}

describe("useReserveGift", () => {
  afterEach(() => {
    window.localStorage.clear();
    reserveGiftMock.mockReset();
    vi.restoreAllMocks();
  });

  it("UseReserveGift_ShouldReturnAvailable_WhenNothingHasHappenedAndTheServerSaysUnreserved", () => {
    // Arrange
    const { result } = renderHook(() => useReserveGift(aShareToken()));

    // Act
    const state = result.current.stateFor("item-1", false);

    // Assert
    expect(state).toBe("available");
  });

  it("UseReserveGift_ShouldReturnReserved_WhenNothingLocalHasHappenedAndTheServerSaysReserved", () => {
    // Arrange — someone else's reservation, known only via SharedGiftItem.reserved.
    const { result } = renderHook(() => useReserveGift(aShareToken()));

    // Act
    const state = result.current.stateFor("item-1", true);

    // Assert
    expect(state).toBe("reserved");
  });

  it("UseReserveGift_ShouldMarkTheItemReservedByYouOptimistically_BeforeTheRpcHasReplied", async () => {
    // Arrange — a promise this test controls, so the "mid-flight" moment is directly observable.
    let resolveReserve: (
      value: Awaited<ReturnType<typeof reservationsClient.reserveGift>>,
    ) => void = () => {};
    reserveGiftMock.mockReturnValue(
      new Promise((resolve) => {
        resolveReserve = resolve;
      }),
    );
    const { result } = renderHook(() => useReserveGift(aShareToken()));

    // Act
    act(() => {
      void result.current.reserve("item-1");
    });

    // Assert — optimistic, before the RPC has resolved at all.
    expect(result.current.stateFor("item-1", false)).toBe("reserved-by-you");
    expect(reserveGiftMock).toHaveBeenCalledWith({
      shareToken: aShareToken(),
      itemId: "item-1",
    });

    // Cleanup
    await act(async () => {
      resolveReserve(resolvedReserveGiftResponse("secret-abc"));
      await Promise.resolve();
    });
  });

  it("UseReserveGift_ShouldNeverSendOrLogTheReleaseSecret_WhenTheRpcSucceeds", async () => {
    // Arrange — ARCHITECTURE.md "Nobody can see *who* reserved": `releaseSecret` travels only to
    // `localStorage`. GL-119 (Batch review): the only spy this codebase had for this guarantee
    // bracketed `saveReleaseSecret` itself (releaseSecretStore.test.ts) — a function that trivially
    // cannot log anything — rather than this hook's own success path, where the secret first
    // arrives off the wire. A reviewer's mutation probe
    // (`console.log("secret", response.releaseSecret)` right after the RPC resolves, above
    // `saveReleaseSecret`'s own call) left every one of this repo's sharing tests green. This spies
    // around `reserve()` itself instead, so a leak introduced *before* the secret ever reaches the
    // store cannot hide behind it.
    reserveGiftMock.mockResolvedValue(
      resolvedReserveGiftResponse("super-secret-value"),
    );
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { result } = renderHook(() => useReserveGift(aShareToken()));

    // Act
    await act(async () => {
      await result.current.reserve("item-1");
    });

    // Assert
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(logSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("UseReserveGift_ShouldStayReservedByYouAndPersistTheSecret_WhenTheRpcSucceeds", async () => {
    // Arrange — "optimistic → confirmed": the rendered state does not change across this
    // transition, which is the point of doing it optimistically.
    reserveGiftMock.mockResolvedValue(
      resolvedReserveGiftResponse("secret-abc"),
    );
    const { result } = renderHook(() => useReserveGift(aShareToken()));

    // Act
    await act(async () => {
      await result.current.reserve("item-1");
    });

    // Assert
    expect(result.current.stateFor("item-1", false)).toBe("reserved-by-you");
    expect(hasReleaseSecret(aShareToken(), "item-1")).toBe(true);
  });

  it("UseReserveGift_ShouldStillReadReservedByYouFromLocalStorage_AfterARemount", async () => {
    // Arrange — "you reserved this" must survive a fresh hook instance (a page reload, in
    // practice) purely from localStorage, with no optimistic state left to fall back on.
    reserveGiftMock.mockResolvedValue(
      resolvedReserveGiftResponse("secret-abc"),
    );
    const first = renderHook(() => useReserveGift(aShareToken()));
    await act(async () => {
      await first.result.current.reserve("item-1");
    });
    first.unmount();

    // Act
    const second = renderHook(() => useReserveGift(aShareToken()));

    // Assert
    expect(second.result.current.stateFor("item-1", false)).toBe(
      "reserved-by-you",
    );
  });

  it("UseReserveGift_ShouldRollBackToJustTaken_WhenTheRpcFailsWithAlreadyReserved", async () => {
    // Arrange — "optimistic → already_reserved rollback": losing the race is not left as a stale
    // "reserved by you".
    reserveGiftMock.mockRejectedValue(alreadyReservedError());
    const { result } = renderHook(() => useReserveGift(aShareToken()));

    // Act
    await act(async () => {
      await result.current.reserve("item-1");
    });

    // Assert
    expect(result.current.stateFor("item-1", true)).toBe("just-taken");
    expect(result.current.errorFor("item-1")).toBeNull();
    expect(hasReleaseSecret(aShareToken(), "item-1")).toBe(false);
  });

  it("UseReserveGift_ShouldRollBackToAvailableWithAnError_WhenTheRpcFailsForAnyOtherReason", async () => {
    // Arrange — a genuine failure (not a race) is surfaced as an ordinary error, not silently
    // dropped and not treated as a conflict.
    reserveGiftMock.mockRejectedValue(
      new ConnectError("down", Code.Unavailable),
    );
    const { result } = renderHook(() => useReserveGift(aShareToken()));

    // Act
    await act(async () => {
      await result.current.reserve("item-1");
    });

    // Assert
    expect(result.current.stateFor("item-1", false)).toBe("available");
    expect(result.current.errorFor("item-1")?.kind).toBe("unavailable");
  });

  it("UseReserveGift_ShouldNotCallTheRpcAgain_WhenReserveIsCalledWhileAlreadyMidFlight", async () => {
    // Arrange — guards the gap between the click and the re-render that removes the button.
    let resolveReserve: (
      value: Awaited<ReturnType<typeof reservationsClient.reserveGift>>,
    ) => void = () => {};
    reserveGiftMock.mockReturnValue(
      new Promise((resolve) => {
        resolveReserve = resolve;
      }),
    );
    const { result } = renderHook(() => useReserveGift(aShareToken()));

    // Act
    act(() => {
      void result.current.reserve("item-1");
    });
    act(() => {
      void result.current.reserve("item-1");
    });

    // Assert
    expect(reserveGiftMock).toHaveBeenCalledTimes(1);

    // Cleanup
    await act(async () => {
      resolveReserve(resolvedReserveGiftResponse("secret-abc"));
      await Promise.resolve();
    });
  });

  it("UseReserveGift_ShouldNotCallTheRpcAgain_WhenReserveIsCalledForAnItemAlreadyReservedByYou", async () => {
    // Arrange
    reserveGiftMock.mockResolvedValue(
      resolvedReserveGiftResponse("secret-abc"),
    );
    const { result } = renderHook(() => useReserveGift(aShareToken()));
    await act(async () => {
      await result.current.reserve("item-1");
    });

    // Act
    await act(async () => {
      await result.current.reserve("item-1");
    });

    // Assert
    expect(reserveGiftMock).toHaveBeenCalledTimes(1);
  });

  it("UseReserveGift_ShouldFoldJustTakenBackToReserved_WhenDismissConflictIsCalled", async () => {
    // Arrange
    reserveGiftMock.mockRejectedValue(alreadyReservedError());
    const { result } = renderHook(() => useReserveGift(aShareToken()));
    await act(async () => {
      await result.current.reserve("item-1");
    });
    expect(result.current.stateFor("item-1", true)).toBe("just-taken");

    // Act
    act(() => {
      result.current.dismissConflict("item-1");
    });

    // Assert
    expect(result.current.stateFor("item-1", true)).toBe("reserved");
  });

  it("UseReserveGift_ShouldResolveToUndefined_NeverLeakingTheReleaseSecretToItsCaller", async () => {
    // Arrange — the secret's only destination is localStorage (releaseSecretStore.ts); the promise
    // this hook hands back must carry nothing.
    reserveGiftMock.mockResolvedValue(
      resolvedReserveGiftResponse("super-secret-value"),
    );
    const { result } = renderHook(() => useReserveGift(aShareToken()));

    // Act
    let returned: unknown;
    await act(async () => {
      returned = await result.current.reserve("item-1");
    });

    // Assert
    expect(returned).toBeUndefined();
  });

  it("UseReserveGift_ShouldStayReservedByYouWithAnHonestNotice_WhenTheRpcFailsWithReplyTimeout", async () => {
    // Arrange — GL-41/GL-42: this browser cannot tell whether the command committed, so it stays
    // optimistic rather than rolling back to "available" and inviting a retry.
    reserveGiftMock.mockRejectedValue(replyTimeoutError());
    const { result } = renderHook(() => useReserveGift(aShareToken()));

    // Act
    await act(async () => {
      await result.current.reserve("item-1");
    });

    // Assert
    expect(result.current.stateFor("item-1", false)).toBe("reserved-by-you");
    expect(result.current.errorFor("item-1")?.kind).toBe("reply-timeout");
    expect(hasReleaseSecret(aShareToken(), "item-1")).toBe(false);

    // Act — a further click is a no-op, not a second RPC: the guard covers this because the item
    // is still in the optimistic set (this file's own header, 3d).
    await act(async () => {
      await result.current.reserve("item-1");
    });

    // Assert
    expect(reserveGiftMock).toHaveBeenCalledTimes(1);
  });

  it("UseReserveGift_ShouldRevertToAvailable_WhenTheLiveItemsShowTheTimedOutAttemptNeverLanded", async () => {
    // Arrange — "until a push decides" (this file's own header): the server's own view is the
    // tie-breaker for an ambiguous reply-timeout.
    reserveGiftMock.mockRejectedValue(replyTimeoutError());
    const { result, rerender } = renderHook(
      ({ items }: { items: ReserveGiftLiveItem[] }) =>
        useReserveGift(aShareToken(), items),
      { initialProps: { items: [] as ReserveGiftLiveItem[] } },
    );
    await act(async () => {
      await result.current.reserve("item-1");
    });
    expect(result.current.stateFor("item-1", false)).toBe("reserved-by-you");

    // Act
    act(() => {
      rerender({ items: [{ itemId: "item-1", reserved: false }] });
    });

    // Assert — reservable again, honestly, with no leftover notice.
    expect(result.current.stateFor("item-1", false)).toBe("available");
    expect(result.current.errorFor("item-1")).toBeNull();

    // Act — a fresh attempt now reaches the RPC for real.
    reserveGiftMock.mockResolvedValue(
      resolvedReserveGiftResponse("secret-abc"),
    );
    await act(async () => {
      await result.current.reserve("item-1");
    });

    // Assert
    expect(reserveGiftMock).toHaveBeenCalledTimes(2);
  });

  it("UseReserveGift_ShouldStayReservedByYouAndClearTheNotice_WhenTheLiveItemsConfirmItWasReserved", async () => {
    // Arrange
    reserveGiftMock.mockRejectedValue(replyTimeoutError());
    const { result, rerender } = renderHook(
      ({ items }: { items: ReserveGiftLiveItem[] }) =>
        useReserveGift(aShareToken(), items),
      { initialProps: { items: [] as ReserveGiftLiveItem[] } },
    );
    await act(async () => {
      await result.current.reserve("item-1");
    });

    // Act — the push confirms the item is now reserved.
    act(() => {
      rerender({ items: [{ itemId: "item-1", reserved: true }] });
    });

    // Assert — still "reserved-by-you" (unchanged), but the ambiguous notice is gone.
    expect(result.current.stateFor("item-1", true)).toBe("reserved-by-you");
    expect(result.current.errorFor("item-1")).toBeNull();
  });
});
