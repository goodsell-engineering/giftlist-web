/**
 * Decides, entirely client-side, whether the browser opening `/share/:shareToken` right now is
 * signed in as that list's owner (GL-39, ARCHITECTURE.md "Owner shouldn't see what's reserved" —
 * mitigated, not guaranteed). This is the one piece of that mitigation this repo is responsible
 * for; the anonymous `sharedGiftList(token)` query (GL-33) deliberately has no `ownerId` on its
 * response to check against — `SharedGiftListView` carries none, by construction — so there is no
 * way to ask the anonymous transport "is this my list" at all.
 *
 * Instead this reuses data the SPA already holds for a completely different reason: a signed-in
 * user's own `myGiftLists` (GL-23), fetched over the authenticated GraphQL transport, already
 * carries `shareToken` for every list they own (ListDetailOwnerPage's copy-only share box reads
 * the same field). If the token in the URL matches one of those, this browser is the owner;
 * otherwise it's an ordinary guest, whether or not they happen to be signed in as someone else.
 *
 * No fetch at all happens for a signed-out visitor — by far the most common case — so an ordinary
 * guest sees no added latency before `SharedListPage` starts its own fetch.
 *
 * A failed ownership check (network error, gateway unavailable) fails open to "guest" rather than
 * blocking the page: unlike the owner-facing paths that must never leak reservation state
 * (ARCHITECTURE.md "Nobody can see who reserved"), worst case here is the owner seeing the plain
 * guest view they could always reach anyway (ARCHITECTURE.md "Owner shouldn't see what's
 * reserved" — "the owner is necessarily a bearer") — a missed convenience, not a privacy
 * regression.
 */
import { useEffect, useState } from "react";

import { useAuth } from "../../identity/auth/useAuth";
import {
  fetchMyGiftLists,
  type GiftListProjection,
} from "../../giftlists/api/giftListQueries";

export type ShareTokenOwnershipState =
  | { status: "checking" }
  | { status: "owner"; list: GiftListProjection }
  | { status: "guest" };

export function useShareTokenOwnership(
  shareToken: string,
): ShareTokenOwnershipState {
  const { session } = useAuth();
  // Same expiry check RequireAuth.tsx uses, and for the same reason (that file's own comment): a
  // client-side convenience only, the server is the real enforcement. This route stays public
  // either way — an expired session must not block an owner's *own* guests from reaching the
  // guest view, so this only ever downgrades to "guest", never to a hard failure.
  const accessToken =
    session && session.accessTokenExpiresAt > new Date()
      ? session.accessToken
      : null;

  // No leading synchronous setState for the "signed out" branch here — useState's own initial
  // value already covers "guest" for that case (react-hooks/set-state-in-effect; the same reason
  // useMyGiftLists.ts's and useSharedGiftList.ts's `load`/`runFetch` have none). This does mean a
  // session that logs in or expires mid-visit without a remount can leave `state` stale — this
  // route is keyed by shareToken precisely so the ordinary path (arriving with whatever session
  // you already have) always gets a fresh mount instead.
  const [state, setState] = useState<ShareTokenOwnershipState>(
    accessToken ? { status: "checking" } : { status: "guest" },
  );

  useEffect(() => {
    if (!accessToken) {
      return;
    }

    let cancelled = false;

    fetchMyGiftLists(accessToken).then(
      (giftLists) => {
        if (cancelled) {
          return;
        }
        const owned = giftLists.find((list) => list.shareToken === shareToken);
        setState(
          owned ? { status: "owner", list: owned } : { status: "guest" },
        );
      },
      () => {
        if (!cancelled) {
          setState({ status: "guest" });
        }
      },
    );

    return () => {
      cancelled = true;
    };
  }, [accessToken, shareToken]);

  return state;
}
