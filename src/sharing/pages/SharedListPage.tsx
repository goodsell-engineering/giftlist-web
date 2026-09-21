import { Link, useParams } from "react-router-dom";
import {
  Alert,
  Anchor,
  Badge,
  Box,
  Button,
  Center,
  Group,
  Loader,
  Paper,
  Stack,
  Text,
  Title,
} from "@mantine/core";

import { useSharedGiftList } from "../hooks/useSharedGiftList";
import {
  useReserveGift,
  type ItemReservationUiState,
} from "../hooks/useReserveGift";
import type { ReserveGiftErrorInfo } from "../api/reservationsErrors";
import type { SharedGiftItem } from "../api/sharedGiftListQueries";
import { TopBar } from "../../ui/TopBar";
import { formatCalendarDate } from "../../ui/dates";

/**
 * Mockup: mockups/list-shared-anonymous.html (screen 5 of 6)
 *
 * The anonymous guest view of a shared list, reachable via the opaque share token in the URL —
 * backed by the real `sharedGiftList(token)` GraphQL query (GL-32) over the anonymous transport
 * entry point (`graphqlRequestAnonymous`, GL-33), kept live over `sharedGiftListChanged(token)`
 * (GL-38, wired in by `useSharedGiftList` itself), and the real reserve button, backed by the
 * `ReserveGift` grpc-web RPC (`useReserveGift`, GL-40).
 *
 * Restyled onto Mantine in GL-124 — layout and copy only; `useReserveGift`'s state machine, the
 * `reservationsClient` call, `reservationsErrors`'s mapping, the subscription wired into
 * `useSharedGiftList`, and `releaseSecretStore` are all unchanged from before this story. The
 * release secret itself is still never read by this component, let alone rendered — the only
 * reservation facts this page ever touches are `ItemReservationUiState` (derived) and
 * `SharedGiftItem.reserved` (a plain boolean, never who).
 *
 * An expired list still renders here, read-only — Ryan's decision, 2026-09-16, recorded on GL-32:
 * expiry gates *reserving*, not *viewing*. The expired banner and disabled-reserve UI are GL-42's
 * job, not this page's; `expiresAt` is rendered plainly as a countdown, with no "expired" branch —
 * `daysRemaining` below is clamped at 0 rather than going negative for exactly this reason. A
 * reserve attempt against an expired list still reaches the RPC and comes back
 * `reservation.giftlist_expired` — rendered here as an ordinary per-item error, same as any other
 * — GL-42 is what stops the guest from ever getting that far.
 *
 * No Release button — mockups/list-shared-anonymous.html shows one next to "✓ You reserved this",
 * but there is still no Release RPC in scope to back it with (`reservationsClient.ts` exposes only
 * `reserveGift`), and this file's own precedent (pre-GL-124) already turned that down once: "a
 * button that cannot do anything is worse than no button." A restyle is not the ticket that adds
 * that RPC, so the badge alone is what renders for that state — see this story's own report for
 * the deviation note.
 */
/** Clamped at 0 rather than going negative for an already-expired list — see this component's own
 * doc comment on why an expired list gets no "expired" wording here. A standalone helper (not an
 * inline `Date.now()` call in the render body) for the same reason `DashboardPage.tsx`'s
 * `giftListStatus` is one: `react-hooks/purity` flags an impure call written directly in a
 * component/hook body, not one reached through an ordinary function call. */
function daysRemainingUntil(expiresAt: string): number {
  return Math.max(
    0,
    Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 86_400_000),
  );
}

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

  const topBar = (
    <TopBar
      right={
        <Anchor component={Link} to="/login" size="sm">
          Log in
        </Anchor>
      }
    />
  );

  if (state.status === "loading") {
    return (
      <>
        {topBar}
        <Center component="main" mih="60vh">
          <Stack align="center" gap="sm">
            <Loader color="primary" />
            <Text c="dimmed" size="sm">
              Loading shared list…
            </Text>
          </Stack>
        </Center>
      </>
    );
  }

  if (state.status === "error") {
    return (
      <>
        {topBar}
        <Center component="main" mih="60vh" px="md">
          <Stack align="center" gap="md" maw={420}>
            <Alert color="danger" variant="light" role="alert" w="100%">
              {state.info.message}
            </Alert>
            {state.info.kind === "unavailable" && (
              <Button variant="default" onClick={refetch}>
                Try again
              </Button>
            )}
          </Stack>
        </Center>
      </>
    );
  }

  const { giftList } = state;
  const daysRemaining = daysRemainingUntil(giftList.expiresAt);

  return (
    <>
      {topBar}
      <Box component="main">
        <Box ta="center" pt={40} pb={20} px={24}>
          <Text
            size="sm"
            fw={600}
            c="dimmed"
            tt="uppercase"
            style={{ letterSpacing: "0.04em" }}
          >
            Shared gift list
          </Text>
          <Title order={1} size="h2" mt={8} mb={6}>
            {giftList.name}
          </Title>
          <Text c="accent" fw={600} size="sm">
            ⏳ Expires in {daysRemaining} day{daysRemaining === 1 ? "" : "s"} —{" "}
            {formatCalendarDate(giftList.expiresAt)}
          </Text>
        </Box>

        <Text
          ta="center"
          c="dimmed"
          size="sm"
          maw={560}
          mx="auto"
          mb={28}
          px={24}
        >
          Reserve a gift so nobody buys it twice. Reservations are completely
          anonymous — no name is ever recorded, so no one can see who reserved
          what. Not other guests, not the person who shared this list.
        </Text>

        <Box maw={720} mx="auto" px={{ base: 16, sm: 24 }} pb={64}>
          {giftList.items.length === 0 && (
            <Text ta="center" c="dimmed">
              This list has no items yet.
            </Text>
          )}
          <Stack
            component="ul"
            gap={14}
            style={{ listStyle: "none", margin: 0, padding: 0 }}
          >
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
          </Stack>
        </Box>
      </Box>
    </>
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
    <Paper
      component="li"
      radius="lg"
      shadow="sm"
      withBorder
      p="lg"
      style={{ listStyle: "none" }}
    >
      <Group align="flex-start" wrap="nowrap" gap={14}>
        <Box
          w={44}
          h={44}
          style={{
            borderRadius: 10,
            background: "var(--mantine-color-accent-0)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "1.2rem",
            flexShrink: 0,
          }}
          aria-hidden
        >
          🎁
        </Box>
        <Stack gap={2} style={{ flex: 1, minWidth: 0 }}>
          <Text fw={600} size="sm">
            {item.name}
          </Text>
          {item.description && (
            <Text size="sm" c="dimmed">
              {item.description}
            </Text>
          )}
          {item.url && (
            <Anchor href={item.url} target="_blank" rel="noreferrer" size="xs">
              {item.url}
            </Anchor>
          )}
        </Stack>

        <Group gap={10} wrap="nowrap" style={{ flexShrink: 0 }}>
          {uiState === "available" && (
            <Button size="sm" onClick={onReserve}>
              Reserve this gift
            </Button>
          )}

          {(uiState === "reserved-by-you" ||
            uiState === "just-taken" ||
            uiState === "reserved") && (
            <Badge
              color={uiState === "reserved-by-you" ? "success" : "primary"}
              variant="light"
              size="lg"
            >
              {uiState === "reserved-by-you" ? "✓ You reserved this" : "✓ Reserved"}
            </Badge>
          )}
        </Group>
      </Group>

      {uiState === "reserved-by-you" && (
        <Text size="xs" c="dimmed" mt={10} pl={58}>
          Only this browser knows this one was yours — it&apos;s remembered
          locally, never on our servers.
        </Text>
      )}

      {uiState === "just-taken" && (
        <Alert color="accent" variant="light" role="alert" mt={10}>
          <Group justify="space-between" align="center" gap="sm" wrap="nowrap">
            <Text size="sm">
              Someone just took this one — you were a moment too late.
            </Text>
            <Button size="xs" variant="default" onClick={onDismissConflict}>
              OK
            </Button>
          </Group>
        </Alert>
      )}

      {error && (
        <Alert color="danger" variant="light" role="alert" mt={10}>
          {error.message}
        </Alert>
      )}
    </Paper>
  );
}
