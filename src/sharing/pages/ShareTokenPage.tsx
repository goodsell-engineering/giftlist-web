import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Anchor } from "@mantine/core";

import { useShareTokenOwnership } from "../hooks/useShareTokenOwnership";
import ShareOwnerInterstitialPage from "./ShareOwnerInterstitialPage";
import SharedListPage from "./SharedListPage";
import { LoadingScreen } from "../../ui/LoadingScreen";

/**
 * The real `/share/:shareToken` route element (GL-39) — the single place that decides between
 * the two screens `mockups/index.html` lists for this URL: the anonymous guest view
 * (`SharedListPage`, GL-33) and the owner's spoiler interstitial (`ShareOwnerInterstitialPage`).
 * ARCHITECTURE.md "Owner shouldn't see what's reserved": "a request to /share/:token carrying the
 * owner's session gets a spoiler interstitial" — this is that request handler, client-side.
 *
 * The router used to send every visitor of this URL straight to `SharedListPage`, with the
 * interstitial reachable only as a separate, never-linked `/owner-preview` stub path. That's gone
 * now — `useShareTokenOwnership` makes the real decision at the real URL, so there is nothing left
 * for a second route to stub out.
 *
 * This outer component does nothing but read the `:shareToken` param and key the actual gate by
 * it. React Router reuses one mounted element across param changes on the same route pattern, but
 * `ShareTokenGate`'s `bypassInterstitial` state (see its own doc comment) must not survive a
 * navigation from one share token to another — the `key` below forces a fresh mount instead of
 * carrying that per-token choice over to a list this browser did not just choose to peek at.
 *
 * GL-124: the only visual change that story made here was the "checking" branch, restyled onto a
 * Mantine `Center`/`Loader`. The ownership decision itself, and which of the two child pages gets
 * rendered for "owner"/"guest", are unchanged.
 *
 * GL-42 (folded from GL-39's own review): that "checking" branch now renders through
 * `ui/LoadingScreen` — the same component `SharedListPage`'s own "loading" branch renders through
 * — rather than its own hand-rolled, slightly different markup. A signed-in visitor who turns out
 * to be an ordinary guest used to see this file's bare loading screen while
 * `useShareTokenOwnership` checked `myGiftLists`, immediately followed by a second,
 * differently-laid-out one from `SharedListPage` once ownership resolved and its own fetch
 * started — two genuinely separate network round trips, but rendered identically now, so they read
 * as one continuous wait rather than the page visibly flashing and re-laying-out between them.
 */
export default function ShareTokenPage() {
  const { shareToken } = useParams<{ shareToken: string }>();

  if (!shareToken) {
    // The router only ever matches this route with a :shareToken param — defensive, not reachable
    // in normal operation.
    return null;
  }

  return <ShareTokenGate key={shareToken} shareToken={shareToken} />;
}

function ShareTokenGate({ shareToken }: { shareToken: string }) {
  const ownership = useShareTokenOwnership(shareToken);
  const [bypassInterstitial, setBypassInterstitial] = useState(false);

  if (ownership.status === "checking") {
    // Same `topBarRight` `SharedListPage` renders for its own guest-facing states, so this loading
    // screen and the one that may immediately follow it look identical — see this file's own
    // header.
    return (
      <LoadingScreen
        topBarRight={
          <Anchor component={Link} to="/login" size="sm">
            Log in
          </Anchor>
        }
      />
    );
  }

  if (ownership.status === "owner" && !bypassInterstitial) {
    return (
      <ShareOwnerInterstitialPage
        list={ownership.list}
        onContinueAsGuest={() => setBypassInterstitial(true)}
      />
    );
  }

  return <SharedListPage />;
}
