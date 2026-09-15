import { useParams } from "react-router-dom";

/**
 * Mockup: mockups/share-owner-interstitial.html (screen 6 of 6)
 *
 * Shown when a signed-in owner opens their own share link — a documented mitigation
 * for the spoiler risk described in ARCHITECTURE.md "Reservation privacy", not an enforced block (the
 * owner holds the link and can always open it). Which `viewer` gets shown this page
 * versus SharedListPage is decided server-side by the Gateway's `ViewGiftList(viewer)`
 * use case; the route itself stays a plain stub here.
 *
 * This is a route stub only — no data fetching.
 */
export default function ShareOwnerInterstitialPage() {
  const { shareToken } = useParams<{ shareToken: string }>();

  return (
    <main>
      <h1>This is your own list</h1>
      <p>Share token: {shareToken}</p>
    </main>
  );
}
