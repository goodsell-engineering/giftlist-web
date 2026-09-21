import { useNavigate } from "react-router-dom";
import { Box, Button, Stack, Text, Title } from "@mantine/core";

import type { GiftListProjection } from "../../giftlists/api/giftListQueries";
import { AuthCard } from "../../ui/AuthCard";

/**
 * Mockup: mockups/share-owner-interstitial.html (screen 6 of 6)
 *
 * Shown when a signed-in owner opens their own share link — a documented mitigation for the
 * spoiler risk described in ARCHITECTURE.md "Owner shouldn't see what's reserved" (mitigated, not
 * guaranteed — the owner holds the link and can always open it deliberately). `ShareTokenPage`
 * decides *whether* to render this, via `useShareTokenOwnership`; this component only renders the
 * page once that decision is already "owner".
 *
 * Restyled onto `AuthCard` in GL-124 — copy and behaviour unchanged. `AuthCard` is a fixed 420px
 * (its own doc comment), 20px narrower than the mockup's own 440px for this one screen; widening
 * it means editing `src/ui/AuthCard.tsx`, which is out of this story's scope — see this story's
 * own report for the note.
 *
 * Two ways out, matching the mockup exactly:
 * - "Take me back to my list" — the owner's authenticated view of this same list.
 * - "I understand, show me the guest view" — a deliberate act, per ARCHITECTURE.md "Owner
 *   shouldn't see what's reserved"'s own wording. Handled by the caller (`onContinueAsGuest`), not
 *   here: this component has no opinion on what "the guest view" is, only that choosing it is
 *   deliberate. The bypass this produces lives in `ShareTokenPage`'s own `useState` — never
 *   persisted, so a fresh visit to the same link always lands here again.
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
    <AuthCard>
      <Stack gap="md" ta="center">
        <Text style={{ fontSize: "2.4rem", lineHeight: 1 }} aria-hidden>
          🙈
        </Text>
        <Title order={1} size="h2">
          This is your own list
        </Title>
        <Text c="var(--gl-text-muted)" size="sm">
          You&apos;re signed in as the owner of <strong>{list.name}</strong>.
          This is the page your friends and family see — it shows which
          gifts have already been reserved.
        </Text>

        <Box
          ta="left"
          p="md"
          style={{
            background: "#faf9fd",
            border: "1px solid var(--gl-border)",
            borderRadius: 10,
          }}
        >
          <Text size="sm" c="var(--gl-text-muted)">
            Carry on and you&apos;ll see <strong>which</strong> gifts have
            been claimed, which rather ruins the surprise. We can&apos;t stop
            you — you do have the link — but we&apos;d rather you did it on
            purpose than by accident.
          </Text>
          <Text size="sm" c="var(--gl-text-muted)" mt="sm">
            You still won&apos;t see <strong>who</strong> reserved anything.
            We never record that, so there&apos;s nothing to show.
          </Text>
        </Box>

        <Stack gap="sm" mt="xs">
          <Button fullWidth onClick={() => navigate(`/lists/${list.listId}`)}>
            Take me back to my list
          </Button>
          <Button fullWidth variant="default" onClick={onContinueAsGuest}>
            I understand, show me the guest view
          </Button>
        </Stack>
      </Stack>
    </AuthCard>
  );
}
