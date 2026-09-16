import { useParams } from "react-router-dom";

import { useSharedGiftList } from "../hooks/useSharedGiftList";

/**
 * Mockup: mockups/list-shared-anonymous.html (screen 5 of 6)
 *
 * The anonymous guest view of a shared list, reachable via the opaque share token in the URL —
 * backed by the real `sharedGiftList(token)` GraphQL query (GL-32) over the anonymous transport
 * entry point (`graphqlRequestAnonymous`, GL-33). Read-only: no reservations, no reserve buttons,
 * no `releaseSecret`, no subscriptions — all Phase 4 (GL-42 and friends). This page renders
 * exactly what `SharedGiftListView` carries and nothing else.
 *
 * An expired list still renders here, read-only — Ryan's decision, 2026-09-16, recorded on GL-32:
 * expiry gates *reserving*, not *viewing*. The expired banner and disabled-reserve UI are GL-42's
 * job, not this page's; `expiresAt` is rendered plainly as the list's expiry date, with no
 * "expired" branch.
 *
 * "You reserved this" is derived client-side from `releaseSecret` values kept in this browser's
 * localStorage — never from a server field. There is no such field on `SharedGiftListView` to
 * read in the first place (see sharedGiftListQueries.ts's own doc comment for why), so there is
 * nothing here to accidentally wire up later.
 */
export default function SharedListPage() {
  const { shareToken } = useParams<{ shareToken: string }>();
  const { state, refetch } = useSharedGiftList(shareToken ?? "");

  if (!shareToken) {
    // The router only ever matches this route with a :shareToken param — defensive, not
    // reachable in normal operation.
    return null;
  }

  if (state.status === "loading") {
    return (
      <main>
        <p>Loading shared list…</p>
      </main>
    );
  }

  if (state.status === "error") {
    return (
      <main>
        <p role="alert">{state.info.message}</p>
        {state.info.kind === "unavailable" && (
          <button type="button" onClick={refetch}>
            Try again
          </button>
        )}
      </main>
    );
  }

  const { giftList } = state;

  return (
    <main>
      <p>Shared gift list</p>
      <h1>{giftList.name}</h1>
      <p>Expires {new Date(giftList.expiresAt).toLocaleDateString()}</p>

      <p>
        Reserve a gift so nobody buys it twice. Reservations are completely
        anonymous — no name is ever recorded, so no one can see who reserved
        what. Not other guests, not the person who shared this list.
      </p>

      {giftList.items.length === 0 && <p>This list has no items yet.</p>}
      <ul>
        {giftList.items.map((item) => (
          <li key={item.itemId}>
            <div>{item.name}</div>
            {item.description && <div>{item.description}</div>}
            {item.url && (
              <a href={item.url} target="_blank" rel="noreferrer">
                {item.url}
              </a>
            )}
          </li>
        ))}
      </ul>
    </main>
  );
}
