import { useParams } from "react-router-dom";

import { useSharedGiftList } from "../hooks/useSharedGiftList";
import {
  useReserveGift,
  type ItemReservationUiState,
} from "../hooks/useReserveGift";
import type { ReserveGiftErrorInfo } from "../api/reservationsErrors";
import type { SharedGiftItem } from "../api/sharedGiftListQueries";

/**
 * Mockup: mockups/list-shared-anonymous.html (screen 5 of 6)
 *
 * The anonymous guest view of a shared list, reachable via the opaque share token in the URL —
 * backed by the real `sharedGiftList(token)` GraphQL query (GL-32) over the anonymous transport
 * entry point (`graphqlRequestAnonymous`, GL-33), kept live over `sharedGiftListChanged(token)`
 * (GL-38, wired in by `useSharedGiftList` itself), and now (GL-40) the real reserve button, backed
 * by the `ReserveGift` grpc-web RPC (`useReserveGift`).
 *
 * An expired list still renders here, read-only — Ryan's decision, 2026-09-16, recorded on GL-32:
 * expiry gates *reserving*, not *viewing*. The expired banner and disabled-reserve UI are GL-42's
 * job, not this page's; `expiresAt` is rendered plainly as the list's expiry date, with no
 * "expired" branch. A reserve attempt against an expired list still reaches the RPC and comes back
 * `reservation.giftlist_expired` — rendered here as an ordinary per-item error, same as any other
 * — GL-42 is what stops the guest from ever getting that far.
 *
 * "You reserved this" is derived entirely client-side, from `useReserveGift`'s own optimistic
 * state and `hasReleaseSecret` (`releaseSecretStore.ts`, backed by this browser's `localStorage`)
 * — never from a server field. There is no such field on `SharedGiftListView` to read in the
 * first place (see sharedGiftListQueries.ts's own doc comment for why), so there is nothing here
 * to accidentally wire up later. The only reservation fact this page ever reads off the server is
 * `SharedGiftItem.reserved` — a plain boolean, never who.
 *
 * No Release button yet (mockups/list-shared-anonymous.html has one) — there is no Release RPC in
 * this dispatch's scope to back it with, and a button that cannot do anything is worse than no
 * button. Left for whichever ticket adds that RPC.
 */
export default function SharedListPage() {
  const { shareToken } = useParams<{ shareToken: string }>();
  const token = shareToken ?? "";
  const { state, refetch } = useSharedGiftList(token);
  const { reserve, stateFor, errorFor, dismissConflict } = useReserveGift(token);

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
          <SharedGiftItemRow
            key={item.itemId}
            item={item}
            uiState={stateFor(item.itemId, item.reserved)}
            error={errorFor(item.itemId)}
            onReserve={() => void reserve(item.itemId)}
            onDismissConflict={() => dismissConflict(item.itemId)}
          />
        ))}
      </ul>
    </main>
  );
}

interface SharedGiftItemRowProps {
  item: SharedGiftItem;
  uiState: ItemReservationUiState;
  error: ReserveGiftErrorInfo | null;
  onReserve: () => void;
  onDismissConflict: () => void;
}

function SharedGiftItemRow({
  item,
  uiState,
  error,
  onReserve,
  onDismissConflict,
}: SharedGiftItemRowProps) {
  return (
    <li>
      <div>{item.name}</div>
      {item.description && <div>{item.description}</div>}
      {item.url && (
        <a href={item.url} target="_blank" rel="noreferrer">
          {item.url}
        </a>
      )}

      {uiState === "available" && (
        <button type="button" onClick={onReserve}>
          Reserve this gift
        </button>
      )}

      {uiState === "reserved-by-you" && (
        <>
          <span>✓ You reserved this</span>
          <p>
            Only this browser knows this one was yours — it&apos;s remembered
            locally, never on our servers.
          </p>
        </>
      )}

      {uiState === "just-taken" && (
        <>
          <span>✓ Reserved</span>
          <p role="alert">
            Someone just took this one — you were a moment too late.
            <button type="button" onClick={onDismissConflict}>
              OK
            </button>
          </p>
        </>
      )}

      {uiState === "reserved" && <span>✓ Reserved</span>}

      {error && <p role="alert">{error.message}</p>}
    </li>
  );
}
