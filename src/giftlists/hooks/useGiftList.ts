/**
 * List Detail (owner)'s data source (GL-24) — and, as of the batch-15 review, the one place this
 * whole feature answers "the write may not be visible yet" (review item 1: three inconsistent
 * answers existed across this feature before this fix — this file's own ladder, a bare
 * immediate-refetch after rename/add/remove-item, and no retry at all on the dashboard).
 *
 * THE RULE (write it here once; a later Phase-3 surface should reuse this file rather than invent
 * a fourth answer):
 *
 * 1. Every GiftListsService RPC is fire-and-forget (the Gateway sends the command onto the bus and
 *    returns before GiftLists' handler has even run — giftlists.proto's own remarks), so no
 *    response from any of the five commands is ever proof the read model reflects the change.
 * 2. Arriving at a list via the create-and-navigate flow (CreateGiftList's generated id,
 *    DashboardPage) has a real, specific reason to expect the read model to still be catching up,
 *    so — and only so — `retryOnNotFound` retries NOT_FOUND on a bounded backoff ladder
 *    (`"pending"`) before giving up into `"unresolved"`. Every other arrival (a bookmark, a
 *    mistyped id, the back button onto a list just deleted) has no such reason: NOT_FOUND there is
 *    immediate and authoritative (`"not-found"`), not several seconds of a message about an
 *    internal race that doesn't apply to it.
 * 3. After Rename/AddItem/RemoveItem, `confirmChange` polls the same ladder for the specific
 *    change to actually show up, so the caller (ListDetailOwnerPage) can keep its own busy
 *    indicator active — and the still-displayed list current, from each fresher read, but never
 *    asserted as reflecting the just-made change — until it's confirmed or the ladder is
 *    exhausted. The page must not go quiet the instant the write RPC returns and call that success.
 * 4. After Delete, `confirmDeleted` polls the same ladder for the *next* read to become NOT_FOUND.
 *    The caller only navigates away once that resolves `true` — never immediately — so a deleted
 *    list can never still be sitting in the dashboard's list as if nothing happened (see
 *    useMyGiftLists's own doc comment for why that hook itself needs no separate retry logic as a
 *    result).
 *
 * `"unresolved"` (case 2, ladder exhausted) is deliberately ambiguous, and GL-72 decided it stays
 * that way. A command GiftLists rejects *after* the Gateway has accepted it onto the bus is
 * discarded with nothing sent back to the browser, and the decision was to accept that and write it
 * down rather than bolt on a feedback path (ARCHITECTURE.md "Command → event flow"). So this hook genuinely cannot
 * tell "still processing" apart from "was rejected and will never exist" — GetGiftListInteractor
 * returns the identical `gateway.not_found` for both — and this ladder resolving into an explicit
 * `"unresolved"` is the agreed user-facing consequence of that, not a placeholder for an open
 * question. (Projecting the rejection into the read model is the architecturally correct fix; it
 * was declined on scope for a demo, and is where to start if this is ever revisited outside one.)
 * Do not resolve the ambiguity by guessing in either direction, and do not leak a ticket number
 * into any user-facing string — it means nothing to the person reading it (batch-15 review
 * item 2).
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { fetchGiftList, type GiftListProjection } from "../api/giftListQueries";
import {
  describeGiftListReadError,
  type GiftListReadErrorInfo,
} from "../api/graphqlErrors";

export type GiftListState =
  | { status: "loading" }
  | { status: "ready"; giftList: GiftListProjection }
  /** NOT_FOUND, still inside the retry window — only reachable when `retryOnNotFound` is set. */
  | { status: "pending" }
  /** NOT_FOUND, retry window elapsed. See this file's header, rule 2 — deliberately ambiguous. */
  | { status: "unresolved" }
  /** NOT_FOUND, `retryOnNotFound` not set — immediate and authoritative, no ambiguity. */
  | { status: "not-found" }
  | { status: "forbidden" }
  | { status: "error"; info: GiftListReadErrorInfo };

const DEFAULT_RETRY_DELAYS_MS = [1000, 2000, 4000];

export interface UseGiftListOptions {
  /**
   * Enables the bounded NOT_FOUND retry ladder — true only when this page was reached via the
   * create-and-navigate flow (DashboardPage passes this through router state; see this file's
   * header, rule 2). Defaults to `false`: an ordinary arrival treats NOT_FOUND as immediate fact.
   */
  retryOnNotFound?: boolean;
  retryDelaysMs?: readonly number[];
}

export function useGiftList(
  accessToken: string,
  listId: string,
  options: UseGiftListOptions = {},
) {
  const { retryOnNotFound = false, retryDelaysMs = DEFAULT_RETRY_DELAYS_MS } =
    options;

  const [state, setState] = useState<GiftListState>({ status: "loading" });
  // True while confirmChange/confirmDeleted is polling for a just-issued write to show up — kept
  // separate from `state` so the page can keep rendering the last-known-good list (refreshed as
  // fresher reads arrive) underneath a busy indicator, rather than being forced back to a
  // full-page loading state for what is, from the read side, an ordinary already-succeeding query.
  const [isConfirming, setIsConfirming] = useState(false);
  const requestId = useRef(0);
  // Every setTimeout this hook schedules (the NOT_FOUND retry ladder, and confirmChange's/
  // confirmDeleted's own polling) is tracked here so an unmount/listId-change can cancel all of
  // them in one place — the singular `retryTimeout` ref this hook used to have only ever cancelled
  // the NOT_FOUND ladder's own timer, which (batch-15 review item 5) `refetch()` didn't do either.
  const scheduledTimeouts = useRef<Set<ReturnType<typeof setTimeout>>>(
    new Set(),
  );
  // `runFetch` schedules a retry of itself (attempt + 1) from inside a `setTimeout` callback, but
  // referencing the `useCallback` result directly from within its own body is a temporal-dead-zone
  // hazard the linter (rightly) rejects — a ref holding "whichever `runFetch` is current" sidesteps
  // it without losing the up-to-date accessToken/listId/retryDelaysMs closure on every render.
  const runFetchRef = useRef<(attempt: number) => void>(() => {});

  const scheduleTimeout = useCallback((run: () => void, delay: number) => {
    const handle = setTimeout(() => {
      scheduledTimeouts.current.delete(handle);
      run();
    }, delay);
    scheduledTimeouts.current.add(handle);
    return handle;
  }, []);

  const cancelScheduledTimeouts = useCallback(() => {
    scheduledTimeouts.current.forEach((handle) => clearTimeout(handle));
    scheduledTimeouts.current.clear();
  }, []);

  // Deliberately no leading `setState({ status: "loading"/"pending" })` at the top of this
  // function — the mount effect below calls `runFetch(0)` directly, and useState's own initial
  // value already covers "loading" for that first call. A synchronous setState reachable directly
  // from an effect body (rather than from inside this promise's own .then/setTimeout callbacks,
  // both async boundaries) trips react-hooks/set-state-in-effect; refetch() below is where a
  // *manual* reset to "loading" lives instead, since that path is only ever reached from an event
  // handler, never an effect.
  const runFetch = useCallback(
    (attempt: number) => {
      const thisRequest = ++requestId.current;

      fetchGiftList(accessToken, listId).then(
        (giftList) => {
          if (requestId.current !== thisRequest) {
            return;
          }
          setState({ status: "ready", giftList });
        },
        (reason: unknown) => {
          if (requestId.current !== thisRequest) {
            return;
          }

          const info = describeGiftListReadError(reason);
          if (info.kind === "not-found") {
            if (!retryOnNotFound) {
              setState({ status: "not-found" });
              return;
            }
            if (attempt < retryDelaysMs.length) {
              setState({ status: "pending" });
              scheduleTimeout(
                () => runFetchRef.current(attempt + 1),
                retryDelaysMs[attempt],
              );
              return;
            }
            setState({ status: "unresolved" });
            return;
          }
          if (info.kind === "forbidden") {
            setState({ status: "forbidden" });
            return;
          }
          setState({ status: "error", info });
        },
      );
    },
    [accessToken, listId, retryOnNotFound, retryDelaysMs, scheduleTimeout],
  );

  // Kept in sync via an effect, not assigned directly during render — refs exist precisely to be
  // read/written outside render (event handlers, effects, the setTimeout callback above); mutating
  // one mid-render is rejected by the linter (and is exactly the class of bug React Compiler's
  // memoization would otherwise silently misbehave on).
  useEffect(() => {
    runFetchRef.current = runFetch;
  }, [runFetch]);

  const refetch = useCallback(() => {
    // Batch-15 review item 5: a manual refetch must cancel any retry/confirmation timer still in
    // flight from a previous attempt — otherwise that stale timer's own fetch can land after this
    // fresh one and clobber it.
    cancelScheduledTimeouts();
    setState({ status: "loading" });
    runFetch(0);
  }, [runFetch, cancelScheduledTimeouts]);

  useEffect(() => {
    runFetch(0);
    return () => {
      // Invalidates any in-flight resolution and cancels every scheduled timer for the *previous*
      // listId/accessToken — without this, a scheduled retry/confirmation from a list the user has
      // since navigated away from could otherwise land after this effect re-ran and clobber the
      // new list's state.
      requestId.current += 1;
      cancelScheduledTimeouts();
    };
  }, [runFetch, cancelScheduledTimeouts]);

  /**
   * Confirms a just-issued Rename/AddItem/RemoveItem actually reached the read model (this file's
   * header, rule 3) — polls the same bounded ladder, updating `state` with each fresher read
   * regardless of whether it matches yet (it's always real data, never fabricated), and resolves
   * `true` the moment `predicate` is satisfied or `false` once the ladder is exhausted. Never
   * rejects; a fetch failure while confirming just stops the poll and resolves `false` rather than
   * replacing whatever is currently displayed with an error page over what might be a one-off blip.
   */
  const confirmChange = useCallback(
    (predicate: (giftList: GiftListProjection) => boolean): Promise<boolean> => {
      const thisRequest = ++requestId.current;
      setIsConfirming(true);

      return new Promise<boolean>((resolve) => {
        const attempt = (index: number) => {
          fetchGiftList(accessToken, listId).then(
            (giftList) => {
              if (requestId.current !== thisRequest) {
                resolve(false);
                return;
              }
              setState({ status: "ready", giftList });
              if (predicate(giftList)) {
                setIsConfirming(false);
                resolve(true);
                return;
              }
              if (index < retryDelaysMs.length) {
                scheduleTimeout(() => attempt(index + 1), retryDelaysMs[index]);
                return;
              }
              setIsConfirming(false);
              resolve(false);
            },
            () => {
              if (requestId.current === thisRequest) {
                setIsConfirming(false);
              }
              resolve(false);
            },
          );
        };
        attempt(0);
      });
    },
    [accessToken, listId, retryDelaysMs, scheduleTimeout],
  );

  /**
   * Confirms a just-issued Delete actually reached the read model (this file's header, rule 4) —
   * the mirror image of confirmChange: success here means the *next* read is NOT_FOUND, not that a
   * payload changed shape. `ListDetailOwnerPage` only navigates away once this resolves `true`.
   */
  const confirmDeleted = useCallback((): Promise<boolean> => {
    const thisRequest = ++requestId.current;
    setIsConfirming(true);

    return new Promise<boolean>((resolve) => {
      const attempt = (index: number) => {
        fetchGiftList(accessToken, listId).then(
          () => {
            if (requestId.current !== thisRequest) {
              resolve(false);
              return;
            }
            if (index < retryDelaysMs.length) {
              scheduleTimeout(() => attempt(index + 1), retryDelaysMs[index]);
              return;
            }
            setIsConfirming(false);
            resolve(false);
          },
          (reason: unknown) => {
            if (requestId.current !== thisRequest) {
              resolve(false);
              return;
            }
            const info = describeGiftListReadError(reason);
            setIsConfirming(false);
            resolve(info.kind === "not-found");
          },
        );
      };
      attempt(0);
    });
  }, [accessToken, listId, retryDelaysMs, scheduleTimeout]);

  return { state, isConfirming, refetch, confirmChange, confirmDeleted };
}
