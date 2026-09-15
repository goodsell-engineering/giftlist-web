/**
 * Dashboard's data source (GL-24): `myGiftLists` over GraphQL. No retry/polling here — this is a
 * deliberate application of useGiftList's own rule for "the write may not be visible yet" (see
 * that file's header), not an oversight (batch-15 review item 1 flagged this hook's total lack of
 * retry logic as a *third*, inconsistent answer before the reasoning below existed in writing):
 *
 * - CreateGiftList never displays anything about the new list on this page — the caller navigates
 *   straight to /lists/:listId with the generated id, and *that* page (useGiftList,
 *   `retryOnNotFound`) is the one that owns absorbing the read-model lag.
 * - Rename/AddItem/RemoveItem never touch this page at all; they only ever happen from
 *   /lists/:listId.
 * - Delete is the one command that could otherwise leave this hook showing a stale, already-
 *   deleted list as if nothing happened — ListDetailOwnerPage's `handleDelete` prevents that by
 *   awaiting `useGiftList`'s `confirmDeleted()` and only navigating back here once the read model
 *   has confirmed the list is actually gone, rather than navigating immediately. By the time this
 *   hook's first fetch on mount runs, the deletion is already reflected.
 *
 * If a future caller starts linking here in a way that *does* need this hook to expect its own
 * data to be stale (rather than confirming before arriving, as above), give it the same ladder
 * useGiftList uses rather than inventing a fourth answer.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { fetchMyGiftLists, type GiftListProjection } from "../api/giftListQueries";
import {
  describeGiftListReadError,
  type GiftListReadErrorInfo,
} from "../api/graphqlErrors";

export type MyGiftListsState =
  | { status: "loading" }
  | { status: "ready"; giftLists: GiftListProjection[] }
  | { status: "error"; info: GiftListReadErrorInfo };

export function useMyGiftLists(accessToken: string) {
  const [state, setState] = useState<MyGiftListsState>({ status: "loading" });
  // Guards against an in-flight request from a previous render resolving after a newer one — not
  // just an unmount guard: refetch() can be called again (e.g. after returning to this page)
  // before the first call has settled, and the two must not race to decide the final state.
  const requestId = useRef(0);

  // Deliberately no leading `setState({ status: "loading" })` here — this is the function the
  // mount effect below calls directly, and useState's own initial value already covers "loading"
  // for that first call. A synchronous setState reachable directly from an effect body (rather
  // than from inside this promise's own .then, an async boundary) trips
  // react-hooks/set-state-in-effect; refetch() below is where a *manual* reset to "loading" lives
  // instead, since that path is only ever reached from an event handler, never an effect.
  const load = useCallback(() => {
    const thisRequest = ++requestId.current;
    fetchMyGiftLists(accessToken).then(
      (giftLists) => {
        if (requestId.current === thisRequest) {
          setState({ status: "ready", giftLists });
        }
      },
      (reason: unknown) => {
        if (requestId.current === thisRequest) {
          setState({
            status: "error",
            info: describeGiftListReadError(reason),
          });
        }
      },
    );
  }, [accessToken]);

  useEffect(() => {
    load();
  }, [load]);

  const refetch = useCallback(() => {
    setState({ status: "loading" });
    load();
  }, [load]);

  return { state, refetch };
}
