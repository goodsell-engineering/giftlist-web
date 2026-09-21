/**
 * Mockup: mockups/dashboard.html (screen 3 of 6)
 *
 * "My gift lists" — the owner's list of lists, backed by the real `myGiftLists` GraphQL query
 * (GL-23) for reads and the real grpc-web `CreateGiftList` command (GL-71) for creating one
 * (GL-24). No reservation UI anywhere on this page — it doesn't exist yet (Phase 4), and even
 * once it does, an owner's own dashboard/list-detail views never surface reservation state at all
 * (ARCHITECTURE.md "Reservation privacy").
 *
 * Restyled onto Mantine in GL-122 — see that ticket for the specifics. The grpc-web command, the
 * GraphQL query, the read-model-lag ladder documented on the functions below and `useMyGiftLists`
 * itself, and `RequireAuth` are all unchanged; only the markup changed. One deliberate departure
 * from GL-122's own spec: `TopBar`'s user menu needs a display name and `AuthSession` (GL-19)
 * doesn't carry one anywhere reachable from this page (only `signUp`'s caller ever sees the value
 * typed at sign-up, and it's never stored on the session) — rather than fabricate one (e.g. from
 * `userId`, which would render as a raw id run through `initialsFor`), `TopBar` is mounted with no
 * `right` slot here. Wiring the real name in is identity-side work outside this ticket's touched
 * files.
 */
import { useCallback, useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import {
  Badge,
  Box,
  Button,
  Card,
  Group,
  Loader,
  Modal,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { DatePickerInput } from "@mantine/dates";

import { useAuth } from "../../identity/auth/useAuth";
import { useMyGiftLists } from "../hooks/useMyGiftLists";
import { createGiftListsClient } from "../api/giftListsClient";
import {
  describeGiftListsCommandError,
  MISSING_EXPIRY_MESSAGE,
  PAST_EXPIRY_MESSAGE,
} from "../api/giftListsErrors";
import type { GiftListProjection } from "../api/giftListQueries";
import { TopBar } from "../../ui/TopBar";
import { Page } from "../../ui/Page";
import { formatCalendarDate } from "../../ui/dates";

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

type GiftListStatus = "active" | "expiring-soon" | "expired";

/** Computed client-side from `expiresAt` — the read model carries no separate status field to
 * trust instead, and the three states here are exactly the ones mockups/dashboard.html shows. */
function giftListStatus(expiresAt: string): GiftListStatus {
  const msRemaining = new Date(expiresAt).getTime() - Date.now();
  if (msRemaining <= 0) {
    return "expired";
  }
  return msRemaining <= SEVEN_DAYS_MS ? "expiring-soon" : "active";
}

const STATUS_LABEL: Record<GiftListStatus, string> = {
  active: "Active",
  "expiring-soon": "Expiring soon",
  expired: "Expired",
};

// `expiring-soon` deliberately does not get its own theme tuple (GL-122's own spec): `success`
// and `danger` already exist in `../../ui/theme` for the other two states, but a third
// hand-generated 10-shade tuple just for mockups/style.css's one-off `--badge-soon`
// (`#fff4de`/`#a9720d`) would be a lot of ceremony for a colour nothing else in the app uses.
// Mantine's own `yellow`, in its `light` variant, lands in the same warm-amber family.
const STATUS_BADGE_COLOR: Record<GiftListStatus, string> = {
  active: "success",
  "expiring-soon": "yellow",
  expired: "danger",
};

/**
 * Parses the value `DatePickerInput.onChange` reports ("YYYY-MM-DD", `@mantine/dates`'
 * `DateStringValue` — a plain calendar day, not a `Date`; see this file's `expiresAt` state) as
 * UTC midnight of that calendar day, not local midnight (batch-15 review item 4, from the
 * `<input type="date">` this replaces: `new Date("2026-01-01T00:00:00")` — no zone suffix — is
 * local time, so a caller at a positive UTC offset got the *previous* UTC day once serialized).
 * Appending "Z" pins it to the date the user actually picked regardless of their timezone. This
 * still holds for `DatePickerInput`'s value even though it arrives as a string already, rather
 * than the `Date` object an earlier draft of this ticket expected: `DateStringValue` carries no
 * time-zone information of its own for this function to get wrong, but the "append Z, don't
 * construct a bare local Date" discipline is what keeps that true, so it stays.
 *
 * Returns `null` for an empty or unparseable value (e.g. the field never filled in — the form is
 * `noValidate`, like every other form in this codebase, per the existing convention of leaving
 * business validation to the server) rather than letting `new Date("T00:00:00")` — Invalid Date —
 * reach `timestampFromDate`, which throws for it; that throw used to surface as this page's
 * generic "Something went wrong" instead of the specific message that exists for exactly this case.
 *
 * Deliberately says nothing about whether the parsed date is in the past — that is
 * `isExpiryDateNotInFuture`'s job, kept separate so this function's contract stays "parse, or don't"
 * (GL-82).
 */
function parseExpiryDate(value: string): Date | null {
  if (value.trim() === "") {
    return null;
  }
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * The calendar day `date` falls on, expressed in UTC as "YYYY-MM-DD" — the same shape
 * `parseExpiryDate` consumes and `DatePickerInput.onChange` reports. Used by the date picker's
 * `minDate`, by `utcDateStringPlusDays` (min is tomorrow, not today — see that function), and by
 * `isExpiryDateNotInFuture`'s "today" so all three agree with each other and with
 * `parseExpiryDate`'s own UTC-midnight convention (GL-82).
 */
function utcDateString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * `date`, `days` UTC calendar days later, as "YYYY-MM-DD" — used to set the date picker's
 * `minDate` to tomorrow rather than today (GL-82 review): `minDate` is inclusive, so `minDate` =
 * today would advertise today as the earliest *legal* choice when it is in fact a
 * guaranteed-failing one (see `isExpiryDateNotInFuture`'s doc comment for the arithmetic).
 */
function utcDateStringPlusDays(date: Date, days: number): string {
  return new Date(date.getTime() + days * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Rejects a calendar day at or before today — UTC's today, not the browser's local one (GL-82).
 * Local would fight `parseExpiryDate`'s convention rather than agree with it: a user at a negative
 * UTC offset (e.g. 20:00 PST on Jan 1 is 04:00 UTC on Jan 2) has local "today" = Jan 1, but
 * `parseExpiryDate` would turn a Jan-1 pick into `2026-01-01T00:00:00Z`, already ~28 hours in the
 * past by the time they submit — exactly the silent-rejection path this ticket closes. Basing
 * "today" on `now`'s UTC calendar day instead means the boundary this function enforces is the
 * same one `parseExpiryDate` will use to interpret whatever day gets picked.
 *
 * Still reachable even though `DatePickerInput`'s `minDate` now stops most of these at the UI
 * layer (GL-122): `minDate` is recomputed on every render rather than pinned once, precisely so a
 * form left open across a UTC-midnight boundary doesn't go on advertising a now-past day as
 * pickable — but the day was already *picked* before that render happened, and nothing forces a
 * re-render between picking and submitting. This is the backstop for exactly that race, not dead
 * code left over from the native `<input type="date">` this replaced.
 *
 * Rejects "today" itself too, not just days before it (GL-82 review — an earlier version of this
 * function did not, on the theory that a same-day rejection depends on server timing the client
 * can't see. That theory does not hold: `parseExpiryDate` turns a today pick into
 * `T00:00:00Z`, and GiftLists' domain rule (`ExpiryDate.IsInFuture`, `value > now`) requires the
 * expiry to be strictly after the instant the server processes it. UTC midnight of today is
 * necessarily in the past by the time *any* request reaches the server — not "usually", not
 * "depending on timing", but for literally every request made after `00:00:00.000Z`. That is
 * exactly as foreseeable from the picker as "yesterday" is, using arithmetic this function already
 * performs, so it belongs to this ticket's scope, not to GL-72's residual for rejections the
 * client genuinely cannot foresee.
 */
function isExpiryDateNotInFuture(expiryDate: Date, now: Date): boolean {
  const startOfTodayUtc = new Date(`${utcDateString(now)}T00:00:00Z`);
  return expiryDate.getTime() <= startOfTodayUtc.getTime();
}

/** Never returned as, or rendered inside, an `<a>` — see GiftListCard's "Share" button below. */
function shareLinkFor(shareToken: string): string {
  return `${window.location.origin}/share/${shareToken}`;
}

function GiftListCard({ giftList }: { giftList: GiftListProjection }) {
  const [copied, setCopied] = useState(false);
  const status = giftListStatus(giftList.expiresAt);

  async function handleShare() {
    // Copy-only, never a clickable link (ARCHITECTURE.md "Reservation privacy"): opening a list's
    // own share link while signed in as its owner is the documented way to see which items are
    // reserved and spoil the surprise for yourself. This button's only effect is writing to the
    // clipboard.
    await navigator.clipboard.writeText(shareLinkFor(giftList.shareToken));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <Card component="li" withBorder radius="lg" shadow="md" p="lg" style={{ listStyle: "none" }}>
      <Stack gap="sm" h="100%">
        <Badge color={STATUS_BADGE_COLOR[status]} variant="light" w="fit-content">
          {STATUS_LABEL[status]}
        </Badge>
        <Title order={3} size="h4">
          {giftList.name}
        </Title>
        <Text size="sm" c="var(--gl-text-muted)">
          {giftList.items.length} {giftList.items.length === 1 ? "item" : "items"} · expires{" "}
          {formatCalendarDate(giftList.expiresAt)}
        </Text>
        <Group gap="xs" mt="auto">
          <Button component={Link} to={`/lists/${giftList.listId}`} variant="light" size="xs">
            Manage
          </Button>
          <Button variant="outline" color="gray" size="xs" onClick={() => void handleShare()}>
            {copied ? "Copied!" : "Share"}
          </Button>
        </Group>
      </Stack>
    </Card>
  );
}

export default function DashboardPage() {
  const { session } = useAuth();
  const accessToken = session?.accessToken ?? "";
  const navigate = useNavigate();

  const { state, refetch } = useMyGiftLists(accessToken);
  const giftListsClient = useMemo(
    () => createGiftListsClient(accessToken),
    [accessToken],
  );

  const [isCreating, setIsCreating] = useState(false);
  const [name, setName] = useState("");
  // `DatePickerInput`'s own value shape (`DateStringValue | null`, "YYYY-MM-DD") — see
  // `parseExpiryDate`'s doc comment for why that needs no `Date`-vs-string conversion step here.
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const closeCreateForm = useCallback(() => {
    if (isSubmitting) {
      return;
    }
    setIsCreating(false);
  }, [isSubmitting]);

  const handleCreate = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setCreateError(null);

      // Validated here, before the RPC, not just left to the server (batch-15 review item 4): an
      // empty/unparseable expiry produces an Invalid Date, and `timestampFromDate` throws for one
      // rather than sending a value the server could reject with its own gateway.missing_expiry —
      // that throw used to surface as this page's generic "Something went wrong" instead. Reusing
      // the server's own wording (MISSING_EXPIRY_MESSAGE) keeps the two cases indistinguishable to
      // the user, which is the point: from where they're standing, both mean "you need to pick one".
      const expiryDate = parseExpiryDate(expiresAt ?? "");
      if (expiryDate === null) {
        setCreateError(MISSING_EXPIRY_MESSAGE);
        return;
      }

      // Same idea as the empty/unparseable guard above, for the other ordinary path GL-72's
      // ticket found: nothing stops a user picking a day that was valid when chosen but stops
      // being valid by the time they submit — see isExpiryDateNotInFuture's doc comment for why
      // this stays reachable even with `minDate` steering the picker away from past days in the
      // first place.
      if (isExpiryDateNotInFuture(expiryDate, new Date())) {
        setCreateError(PAST_EXPIRY_MESSAGE);
        return;
      }

      setIsSubmitting(true);
      try {
        const response = await giftListsClient.createGiftList({
          name,
          expiresAt: timestampFromDate(expiryDate),
        });
        // CreateGiftList is fire-and-forget (giftlists.proto's own remarks, GL-71): this listId
        // is Gateway-generated and returned before GiftLists' handler has necessarily even run,
        // let alone before the read model has caught up. Navigating straight there — rather than
        // e.g. splicing an optimistic entry into this page's own list — is deliberate: the
        // destination page's useGiftList is what actually absorbs that gap with bounded retries
        // (see that file's header for the rule this whole feature follows), and it is also where
        // the honest "we can't tell yet" state for the still-open GL-72 (a rejected command is
        // never reported back here) belongs, not here. `justCreated` router state is how the
        // destination page knows to actually engage that ladder rather than treat a first-read
        // NOT_FOUND as immediate fact — see useGiftList's own doc comment, rule 2.
        navigate(`/lists/${response.listId}`, { state: { justCreated: true } });
      } catch (reason) {
        setCreateError(describeGiftListsCommandError(reason).message);
        setIsSubmitting(false);
      }
    },
    [giftListsClient, name, expiresAt, navigate],
  );

  if (!session) {
    // RequireAuth guards this route; this only renders for an instant if the session is cleared
    // (e.g. a manual logout) while this page is still mounted.
    return null;
  }

  return (
    <>
      <TopBar />
      <Page>
        <Group justify="space-between" align="flex-start" mb="xl">
          <div>
            <Title order={1} size="h2">
              My gift lists
            </Title>
            <Text c="var(--gl-text-muted)" size="sm">
              Create a list, share the link, and let people surprise you.
            </Text>
          </div>
          <Button onClick={() => setIsCreating(true)}>+ New list</Button>
        </Group>

        <Modal opened={isCreating} onClose={closeCreateForm} title="Create a new list">
          <Box
            component="form"
            onSubmit={(event) => void handleCreate(event)}
            noValidate
          >
            <Stack gap="md">
              <TextInput
                label="List name"
                name="name"
                type="text"
                required
                withAsterisk={false}
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
              <DatePickerInput
                label="Expires"
                placeholder="Pick a date"
                required
                withAsterisk={false}
                valueFormat="L"
                // UTC's tomorrow, not today (GL-82 review) and not the browser's local day
                // (GL-82) — see isExpiryDateNotInFuture's doc comment for why today is a
                // guaranteed-failing choice server-side, so `minDate` (inclusive) must not
                // advertise it as legal, and why UTC is the calendar this and parseExpiryDate
                // agree on. Recomputed on every render rather than memoized: the modal can sit
                // open for a while, and a stale `minDate` from before midnight UTC would let a
                // now-past day stay selectable underneath the picker.
                minDate={utcDateStringPlusDays(new Date(), 1)}
                value={expiresAt}
                onChange={setExpiresAt}
              />
              {createError && (
                <Text role="alert" c="danger" size="sm">
                  {createError}
                </Text>
              )}
              <Group justify="flex-end" mt="xs">
                <Button
                  type="button"
                  variant="default"
                  onClick={closeCreateForm}
                  disabled={isSubmitting}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={isSubmitting}>
                  {isSubmitting ? "Creating…" : "Create list"}
                </Button>
              </Group>
            </Stack>
          </Box>
        </Modal>

        {state.status === "loading" && (
          <Group gap="sm">
            <Loader size="sm" />
            <Text c="var(--gl-text-muted)">Loading your gift lists…</Text>
          </Group>
        )}

        {state.status === "error" && (
          <Stack gap="sm" align="flex-start">
            <Text role="alert" c="danger">
              {state.info.message}
            </Text>
            <Button variant="light" onClick={refetch}>
              Try again
            </Button>
          </Stack>
        )}

        {state.status === "ready" && state.giftLists.length === 0 && (
          // The dashed "+ New list" card from mockups/dashboard.html, repurposed as the empty
          // state: this page has exactly one "+ New list" control (the header button above) —
          // duplicating it in here as its own button would give two elements the same accessible
          // name for no functional gain, so this card is the mockup's dashed-border treatment
          // around the existing "no lists yet" message rather than a second, separate trigger.
          <Card
            withBorder
            radius="lg"
            p="xl"
            style={{ borderStyle: "dashed" }}
          >
            <Text ta="center" c="var(--gl-text-muted)">
              You don&apos;t have any gift lists yet.
            </Text>
          </Card>
        )}

        {state.status === "ready" && state.giftLists.length > 0 && (
          <SimpleGrid
            component="ul"
            cols={{ base: 1, sm: 2, lg: 3 }}
            spacing="lg"
            style={{ listStyle: "none", padding: 0, margin: 0 }}
          >
            {state.giftLists.map((giftList) => (
              <GiftListCard key={giftList.listId} giftList={giftList} />
            ))}
          </SimpleGrid>
        )}
      </Page>
    </>
  );
}
