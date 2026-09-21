/**
 * The reserve button's own state machine (GL-40) — optimistic, race-safe, and the one place
 * `releaseSecret` ever leaves a grpc-web response on its way into `localStorage`
 * (ARCHITECTURE.md "Nobody can see *who* reserved").
 *
 * One hook, shared across every item on the page, keyed by `itemId` — not one hook instance per
 * item — because the optimistic/conflict sets below need to be siblings of each other for
 * `SharedListPage` to render the whole list from one source of truth.
 *
 * **The state machine, per item:**
 *
 * 1. `available` — the ordinary case: no local secret, not mid-flight, not in conflict, and the
 *    live server view (`SharedGiftItem.reserved`, kept fresh by `useSharedGiftList`'s own
 *    subscription) says nobody has it. Renders the "Reserve this gift" button.
 * 2. Click → `reserve(itemId)` marks the item optimistic *immediately*, before the RPC has
 *    replied — this is the "optimistic" half of the ticket. `stateFor` treats an optimistic item
 *    exactly like a confirmed one (`reserved-by-you`) for rendering purposes; the two are only
 *    distinguished by whether `hasReleaseSecret` is true yet, which callers that need that detail
 *    can still ask for separately.
 * 3a. RPC succeeds → the `releaseSecret` is saved to `localStorage` and the item drops out of the
 *     optimistic set. `hasReleaseSecret` now answers `true` on its own, so the rendered state
 *     does not change at all across this transition — "optimistic → confirmed" is invisible to
 *     the guest, which is the point of doing it optimistically in the first place.
 * 3b. RPC fails with `already-reserved` → the item drops out of the optimistic set and into the
 *     conflict set instead. `stateFor` now answers `just-taken`, not `available` and not
 *     `reserved-by-you` — this is the rollback the ticket calls "a normal outcome, not an error
 *     toast": no entry is added to `errors`, so no page anywhere renders this as a failure.
 * 3c. RPC fails any other way (expired list, unavailable, ...) → same rollback out of the
 *     optimistic set, but into `errors` instead of the conflict set — an ordinary, dismissable
 *     per-item error message.
 *
 * **The other race** — a *different* guest reserves an item this browser has not touched at all,
 * and the news arrives over `sharedGiftListChanged(token)` before this guest ever clicks — needs
 * no handling here: `stateFor` takes the live `serverReserved` flag as a fallback answer once the
 * optimistic/conflict/local-secret checks are exhausted, so the "Reserve this gift" button simply
 * stops being rendered on `SharedListPage`'s next render. There is nothing to roll back, because
 * nothing here was ever committed to that item in the first place.
 */
import { useCallback, useState } from "react";

import { reservationsClient } from "../api/reservationsClient";
import {
  describeReserveGiftError,
  type ReserveGiftErrorInfo,
} from "../api/reservationsErrors";
import { hasReleaseSecret, saveReleaseSecret } from "../storage/releaseSecretStore";

export type ItemReservationUiState =
  | "available"
  | "reserved-by-you"
  | "just-taken"
  | "reserved";

export interface UseReserveGiftResult {
  reserve: (itemId: string) => Promise<void>;
  /** `serverReserved` is `SharedGiftItem.reserved` for this item — the live server truth. */
  stateFor: (itemId: string, serverReserved: boolean) => ItemReservationUiState;
  errorFor: (itemId: string) => ReserveGiftErrorInfo | null;
  dismissConflict: (itemId: string) => void;
}

function withoutId(ids: ReadonlySet<string>, itemId: string): ReadonlySet<string> {
  if (!ids.has(itemId)) {
    return ids;
  }
  const next = new Set(ids);
  next.delete(itemId);
  return next;
}

export function useReserveGift(shareToken: string): UseReserveGiftResult {
  const [optimisticIds, setOptimisticIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [conflictIds, setConflictIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [errors, setErrors] = useState<ReadonlyMap<string, ReserveGiftErrorInfo>>(
    () => new Map(),
  );

  const reserve = useCallback(
    async (itemId: string) => {
      // Guards against a double-submit landing between the click and the re-render that removes
      // the button (React state updates are not synchronous) — a second call for an item already
      // mid-flight, already ours, or already lost is a no-op rather than a second RPC.
      if (optimisticIds.has(itemId) || hasReleaseSecret(shareToken, itemId)) {
        return;
      }

      setOptimisticIds((prev) => new Set(prev).add(itemId));
      setConflictIds((prev) => withoutId(prev, itemId));
      setErrors((prev) => {
        if (!prev.has(itemId)) {
          return prev;
        }
        const next = new Map(prev);
        next.delete(itemId);
        return next;
      });

      try {
        const response = await reservationsClient.reserveGift({
          shareToken,
          itemId,
        });
        // The one and only place this secret is kept — never returned to any caller of this
        // hook, never logged (see releaseSecretStore.ts's own header for the rest of that rule).
        saveReleaseSecret(shareToken, itemId, response.releaseSecret);
        setOptimisticIds((prev) => withoutId(prev, itemId));
      } catch (reason) {
        const info = describeReserveGiftError(reason);
        setOptimisticIds((prev) => withoutId(prev, itemId));

        if (info.kind === "already-reserved") {
          setConflictIds((prev) => new Set(prev).add(itemId));
        } else {
          setErrors((prev) => new Map(prev).set(itemId, info));
        }
      }
    },
    [shareToken, optimisticIds],
  );

  const stateFor = useCallback(
    (itemId: string, serverReserved: boolean): ItemReservationUiState => {
      if (optimisticIds.has(itemId) || hasReleaseSecret(shareToken, itemId)) {
        return "reserved-by-you";
      }
      if (conflictIds.has(itemId)) {
        return "just-taken";
      }
      if (serverReserved) {
        return "reserved";
      }
      return "available";
    },
    [shareToken, optimisticIds, conflictIds],
  );

  const errorFor = useCallback(
    (itemId: string) => errors.get(itemId) ?? null,
    [errors],
  );

  /** Folds a `just-taken` item back into the plain `reserved` badge once the guest has seen it. */
  const dismissConflict = useCallback((itemId: string) => {
    setConflictIds((prev) => withoutId(prev, itemId));
  }, []);

  return { reserve, stateFor, errorFor, dismissConflict };
}
