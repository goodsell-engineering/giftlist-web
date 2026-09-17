import { useNavigate } from "react-router-dom";

import type { GiftListProjection } from "../../giftlists/api/giftListQueries";

/**
 * Mockup: mockups/share-owner-interstitial.html (screen 6 of 6)
 *
 * Shown when a signed-in owner opens their own share link — a documented mitigation for the
 * spoiler risk described in ARCHITECTURE.md "Owner shouldn't see what's reserved" (mitigated, not
 * guaranteed — the owner holds the link and can always open it deliberately). `ShareTokenPage`
 * decides *whether* to render this, via `useShareTokenOwnership`; this component only renders the
 * page once that decision is already "owner".
 *
 * Two ways out, matching the mockup exactly:
 * - "Take me back to my list" — the owner's authenticated view of this same list.
 * - "I understand, show me the guest view" — a deliberate act, per ARCHITECTURE.md "Owner
 *   shouldn't see what's reserved"'s own wording. Handled by the caller (`onContinueAsGuest`), not
 *   here: this component has no opinion on what "the guest view" is, only that choosing it is
 *   deliberate.
 */
export interface ShareOwnerInterstitialPageProps {
  list: GiftListProjection;
  onContinueAsGuest: () => void;
}

export default function ShareOwnerInterstitialPage({
  list,
  onContinueAsGuest,
}: ShareOwnerInterstitialPageProps) {
  const navigate = useNavigate();

  return (
    <main>
      <h1>This is your own list</h1>
      <p>
        You&apos;re signed in as the owner of <strong>{list.name}</strong>. This
        is the page your friends and family see — it shows which gifts have
        already been reserved.
      </p>

      <p>
        Carry on and you&apos;ll see <strong>which</strong> gifts have been
        claimed, which rather ruins the surprise. We can&apos;t stop you — you
        do have the link — but we&apos;d rather you did it on purpose than by
        accident.
      </p>
      <p>
        You still won&apos;t see <strong>who</strong> reserved anything. We
        never record that, so there&apos;s nothing to show.
      </p>

      <button type="button" onClick={() => navigate(`/lists/${list.listId}`)}>
        Take me back to my list
      </button>
      <button type="button" onClick={onContinueAsGuest}>
        I understand, show me the guest view
      </button>
    </main>
  );
}
