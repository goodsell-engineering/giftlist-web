/**
 * The public `/share/:shareToken` page's data source (GL-33) — the guest-facing counterpart of
 * `giftlists/hooks/useGiftList.ts`, deliberately simpler.
 *
 * No NOT_FOUND retry ladder here, unlike the owner hook: that ladder exists solely for the
 * create-and-navigate arrival, where the SPA itself just issued the write moments ago and has a
 * concrete reason to expect the read model is still catching up. A guest arriving at a share link
 * has no such moment — the list (if it ever existed) was created independently, arbitrarily long
 * before this link was opened — so a NOT_FOUND here is treated as fact on the first read, exactly
 * like the owner hook's own non-`retryOnNotFound` path.
 *
 * No forbidden state either: `sharedGiftList(token)` has no ownership check to fail (a well-formed
 * token *is* the whole credential, ARCHITECTURE.md "Auth & sharing") — only "the token is
 * malformed" and "the token doesn't resolve to anything" are possible, both surfaced via
 * `describeSharedGiftListReadError`.
 *
 * GL-40: once the initial read is `"ready"`, this hook also keeps `giftList` live over
 * `sharedGiftListChanged(token)` (GL-38) — the same reason a guest needs the page to update at
 * all: an item another guest reserves must flip to `reserved: true` on this screen without a
 * reload (ARCHITECTURE.md "Realtime updates"). A push replaces `giftList` outright rather than
 * patching it in place — it is the exact same shape the query itself returns, from the same
 * interactor, so there is nothing to reconcile field-by-field.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import {
  fetchSharedGiftList,
  type SharedGiftListView,
} from "../api/sharedGiftListQueries";
import {
  describeSharedGiftListReadError,
  type SharedGiftListReadErrorInfo,
} from "../api/sharedGiftListErrors";
import { subscribeToSharedGiftListChanged } from "../api/sharedGiftListSubscription";

export type SharedGiftListState =
  | { status: "loading" }
  | { status: "ready"; giftList: SharedGiftListView }
  | { status: "error"; info: SharedGiftListReadErrorInfo };

export function useSharedGiftList(shareToken: string) {
  const [state, setState] = useState<SharedGiftListState>({
    status: "loading",
  });
  const requestId = useRef(0);

  // Deliberately no leading `setState({ status: "loading" })` here — the mount effect below calls
  // `runFetch` directly, and `useState`'s own initial value already covers "loading" for that
  // first call. A synchronous setState reachable directly from an effect body trips
  // react-hooks/set-state-in-effect (the same reason `giftlists/hooks/useGiftList.ts`'s `runFetch`
  // has none); `refetch` below is where a *manual* reset to "loading" lives instead, since that
  // path is only ever reached from an event handler, never an effect.
  const runFetch = useCallback(() => {
    const thisRequest = ++requestId.current;

    fetchSharedGiftList(shareToken).then(
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
        setState({
          status: "error",
          info: describeSharedGiftListReadError(reason),
        });
      },
    );
  }, [shareToken]);

  useEffect(() => {
    runFetch();
    return () => {
      // Invalidates any in-flight resolution for the *previous* shareToken — without this, a
      // slow response from a token the user has since navigated away from could land after this
      // effect re-ran and clobber the new token's state.
      requestId.current += 1;
    };
  }, [runFetch]);

  const refetch = useCallback(() => {
    setState({ status: "loading" });
    runFetch();
  }, [runFetch]);

  // `state` itself is deliberately not in this effect's own dependency array — this subscribes
  // once per shareToken and stays open across every `state` transition that same subscription
  // goes on to cause (the guard below reads the *current* state, not a snapshot from whenever the
  // effect last ran), rather than tearing the socket down and reopening it on every push.
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    const subscription = subscribeToSharedGiftListChanged(shareToken, {
      onData: (giftList) => {
        // A push that arrives before the initial query has ever succeeded (or after it failed)
        // must not fabricate a "ready" screen out of a loading/error one — this channel only ever
        // refreshes an already-loaded page. `refetch()` (surfaced as "Try again" on the error
        // screen) is the recovery path for those, not this one.
        if (stateRef.current.status === "ready") {
          setState({ status: "ready", giftList });
        }
      },
      // Best-effort: a live-channel failure (e.g. the socket never connects, or drops) leaves the
      // guest looking at the last-known-good read rather than replacing it with an error — the
      // initial query already surfaced its own failures on its own terms, and reserving still
      // works over the RPC regardless of whether this channel is up.
      onError: () => {},
    });

    return () => subscription.close();
  }, [shareToken]);

  return { state, refetch };
}
