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
 * 3d. RPC fails with `reply-timeout` (GL-42, folded from GL-40's own review) → deliberately *not*
 *     rolled back, ever, by anything short of the list itself expiring. GL-41's decision: expiry is
 *     the *only* escape hatch for a timed-out reserve. This browser cannot tell whether
 *     `ReserveGift` actually committed — only that the reply itself didn't arrive in time — so
 *     snapping back to `available` on anything less than a positive confirmation would invite a
 *     retry that, if the first attempt *did* land, comes back `reservation.already_reserved` and
 *     would misrender the guest's own reservation as someone else's (Batch 45 review, B1: absence
 *     of news about this item is not evidence about this item — a push can arrive, changing
 *     `items`' identity, for a reason that has nothing to do with this item at all). The item stays
 *     optimistic (still `reserved-by-you`, no button, so there is nothing left to click anyway)
 *     with an honest notice in `errors` naming *both* possible outcomes, and is only ever resolved
 *     by a *positive* confirmation — see `items` below and the `already-reserved` branch of the
 *     catch block, both of which only ever move an item *out* of ambiguity, never back to
 *     `available`.
 *
 * **The other race** — a *different* guest reserves an item this browser has not touched at all,
 * and the news arrives over `sharedGiftListChanged(token)` before this guest ever clicks — needs
 * no handling here: `stateFor` takes the live `serverReserved` flag as a fallback answer once the
 * optimistic/conflict/local-secret checks are exhausted, so the "Reserve this gift" button simply
 * stops being rendered on `SharedListPage`'s next render. There is nothing to roll back, because
 * nothing here was ever committed to that item in the first place.
 *
 * **`items`** is `SharedListPage`'s own live list (from `useSharedGiftList`) — passed in solely so
 * this hook can watch for the one push it *does* need to react to: an item this browser's own
 * reserve attempt timed out on (3d above). Only `reserved: true` on that exact item is ever
 * treated as meaningful — a *positive* confirmation that the attempt landed (stays
 * `reserved-by-you`, the uncertain notice is cleared). `reserved: false` is deliberately **not**
 * treated as its opposite: `items` is the *whole* list's view, so its identity changes on every
 * push for the share token, including one about a completely different item — reading "still
 * false" as "never landed" would resolve the ambiguity on the strength of news that was never
 * about this item at all (Batch 45 review, B1). If the attempt genuinely never landed, no push
 * about *this* item will ever say so, and this hook leaves it optimistic until the list expires —
 * exactly what GL-41 prescribes, not a bug.
 */
import { useCallback, useState } from "react";

import { reservationsClient } from "../api/reservationsClient";
import {
  describeReserveGiftError,
  type ReserveGiftErrorInfo,
} from "../api/reservationsErrors";
import {
  hasReleaseSecret,
  saveReleaseSecret,
} from "../storage/releaseSecretStore";

export interface ReserveGiftLiveItem {
  itemId: string;
  reserved: boolean;
}

export type ItemReservationUiState =
  "available" | "reserved-by-you" | "just-taken" | "reserved";

export interface UseReserveGiftResult {
  reserve: (itemId: string) => Promise<void>;
  /** `serverReserved` is `SharedGiftItem.reserved` for this item — the live server truth. */
  stateFor: (itemId: string, serverReserved: boolean) => ItemReservationUiState;
  errorFor: (itemId: string) => ReserveGiftErrorInfo | null;
  dismissConflict: (itemId: string) => void;
}

function withoutId(
  ids: ReadonlySet<string>,
  itemId: string,
): ReadonlySet<string> {
  if (!ids.has(itemId)) {
    return ids;
  }
  const next = new Set(ids);
  next.delete(itemId);
  return next;
}

function withoutError(
  errors: ReadonlyMap<string, ReserveGiftErrorInfo>,
  itemId: string,
): ReadonlyMap<string, ReserveGiftErrorInfo> {
  if (!errors.has(itemId)) {
    return errors;
  }
  const next = new Map(errors);
  next.delete(itemId);
  return next;
}

// A stable default for `items` below — a `= []` default parameter is re-evaluated on every call,
// producing a *new* array each render, which the render-time reconciliation further down would then
// see as "the live items changed" on every single render (an infinite loop: every one of this
// file's own tests that calls `useReserveGift(shareToken)` with no second argument hit exactly
// this before this constant existed).
const NO_LIVE_ITEMS: readonly ReserveGiftLiveItem[] = [];

export function useReserveGift(
  shareToken: string,
  items: readonly ReserveGiftLiveItem[] = NO_LIVE_ITEMS,
): UseReserveGiftResult {
  const [optimisticIds, setOptimisticIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [conflictIds, setConflictIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  // Items awaiting a `reply-timeout` verdict (3d in this file's own header) — a subset of
  // `optimisticIds`, tracked separately because it changes what a *following* `already-reserved`
  // means for that item: the catch block below treats one for an item in this set as confirmation
  // ("it landed"), not conflict ("someone else took it") — and it's also what the render-time
  // reconciliation further down watches `items` for.
  const [timedOutIds, setTimedOutIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [errors, setErrors] = useState<
    ReadonlyMap<string, ReserveGiftErrorInfo>
  >(() => new Map());

  const reserve = useCallback(
    async (itemId: string) => {
      // Guards against a double-submit landing between the click and the re-render that removes
      // the button (React state updates are not synchronous) — a second call for an item already
      // mid-flight, already ours, or already lost is a no-op rather than a second RPC. An item
      // awaiting a reply-timeout verdict is still in `optimisticIds` (3d), so this same check is
      // also what makes GL-41's honesty rule hold: nothing in this hook can ever send a *second*
      // `ReserveGift` for that item — and so risk misrendering the guest's own reservation as
      // someone else's — unless and until a *positive* confirmation (this file's own header) lifts
      // it back out of `optimisticIds`, which per GL-41 may never happen before the list itself
      // expires.
      if (optimisticIds.has(itemId) || hasReleaseSecret(shareToken, itemId)) {
        return;
      }

      setOptimisticIds((prev) => new Set(prev).add(itemId));
      setConflictIds((prev) => withoutId(prev, itemId));
      setTimedOutIds((prev) => withoutId(prev, itemId));
      setErrors((prev) => withoutError(prev, itemId));

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

        if (info.kind === "reply-timeout") {
          // 3d: stays optimistic. Not rolled back, not moved into `conflictIds` — see this file's
          // own header and reservationsErrors.ts's for why.
          setTimedOutIds((prev) => new Set(prev).add(itemId));
          setErrors((prev) => new Map(prev).set(itemId, info));
          return;
        }

        if (info.kind === "already-reserved" && timedOutIds.has(itemId)) {
          // Belt and braces (Batch 45 review, B1/S3): the double-submit guard above already makes
          // a *second* `ReserveGift` for a timed-out item unreachable in practice, but if it were
          // ever reached anyway, `already_reserved` here is confirmation that this browser's own
          // earlier attempt landed — GL-41's honesty rule — not evidence that someone else took
          // it. Stays optimistic; only the now-resolved notice is cleared.
          setTimedOutIds((prev) => withoutId(prev, itemId));
          setErrors((prev) => withoutError(prev, itemId));
          return;
        }

        setOptimisticIds((prev) => withoutId(prev, itemId));

        if (info.kind === "already-reserved") {
          setConflictIds((prev) => new Set(prev).add(itemId));
        } else {
          setErrors((prev) => new Map(prev).set(itemId, info));
        }
      }
    },
    [shareToken, optimisticIds, timedOutIds],
  );

  // "Until a push decides" (this file's own header, 3d): the next time a timed-out item's own
  // entry in the live server view says `reserved: true`, that is a *positive* confirmation the
  // attempt landed, and the uncertain notice can be cleared. There is deliberately no symmetric
  // "`reserved: false` means it failed" arm (Batch 45 review, B1) — `items` is the whole list's
  // view, so its identity changes on *every* push for this share token, including one about a
  // completely different item, while this exact item's own field is still (truthfully) `false`
  // because the projection hasn't caught up with *its* possibly-committed reservation yet. Reading
  // that as "never landed" would resolve the ambiguity on news that was never about this item,
  // re-arm the double-submit guard, and reopen exactly the retry-into-`already_reserved` hazard
  // 3d exists to prevent. If the attempt genuinely never landed, no push will ever say `true` for
  // it, and this hook leaves it optimistic until the list itself expires — GL-41's own decision
  // that expiry is the only escape hatch, not an oversight here.
  //
  // Adjusted synchronously during render, not inside a `useEffect` — this is React's own
  // "adjusting state when a prop changes" pattern (there is no external system to synchronize
  // with here, only derived state), and `react-hooks/set-state-in-effect` flags the effect-shaped
  // version of exactly this as an anti-pattern. `reconciledItems` is the guard that makes it safe:
  // without it, calling `setState` unconditionally on every render would loop forever. A `useState`
  // rather than a `useRef` for that guard, on purpose — `react-hooks/refs` (a newer,
  // compiler-aligned rule than the "adjusting state" pattern React's own docs still show with a
  // ref) flags reading or writing a ref's `current` during render; the fix the same docs describe
  // elsewhere for this exact situation is a second piece of state instead.
  const [reconciledItems, setReconciledItems] = useState(items);
  if (reconciledItems !== items) {
    setReconciledItems(items);

    for (const item of items) {
      if (!timedOutIds.has(item.itemId) || !item.reserved) {
        continue;
      }

      // Confirmed: leave `optimisticIds` exactly as it is (still "reserved-by-you") and clear
      // only the now-resolved ambiguity.
      setTimedOutIds((prev) => withoutId(prev, item.itemId));
      setErrors((prev) => withoutError(prev, item.itemId));
    }
  }

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
