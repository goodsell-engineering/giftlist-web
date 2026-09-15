import { useParams } from "react-router-dom";

/**
 * Mockup: mockups/list-shared-anonymous.html (screen 5 of 6)
 *
 * The anonymous guest view of a shared list, reachable via the opaque share token in
 * the URL. Reserve/release wiring is real data in Phase 4 (reservations) — see
 * IMPLEMENTATION_PLAN.md. Subscriptions for live "reserved" updates are share-token
 * scoped GraphQL subscriptions, added later; there is deliberately no owner-facing
 * equivalent (ARCHITECTURE.md "Realtime updates").
 *
 * "You reserved this" is derived client-side from `releaseSecret` values kept in
 * this browser's localStorage — never from a server field. Do not add one.
 *
 * This is a route stub only — no data fetching, no reservation logic.
 */
export default function SharedListPage() {
  const { shareToken } = useParams<{ shareToken: string }>();

  return (
    <main>
      <h1>Shared gift list</h1>
      <p>Share token: {shareToken}</p>
    </main>
  );
}
