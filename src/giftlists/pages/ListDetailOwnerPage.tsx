/**
 * Mockup: mockups/list-detail-owner.html (screen 4 of 6)
 *
 * The owner's view of a single list — rename, add/remove items, delete the list, the copy-only
 * share link — backed by the real `giftList(id)` GraphQL query (GL-23) for reads and the real
 * grpc-web RenameGiftList/DeleteGiftList/AddGiftItem/RemoveGiftItem commands (GL-71) for writes
 * (GL-24).
 *
 * Every write below follows useGiftList's own rule for "the write may not be visible yet" (see
 * that file's header) rather than inventing a page-local answer: `confirmChange`/`confirmDeleted`
 * keep the relevant busy indicator active until the read model actually reflects the change (or
 * a bounded ladder is exhausted), so this page never goes quiet the instant a fire-and-forget RPC
 * returns and calls that success.
 *
 * Not present here, on purpose:
 * - Reservation state, in any form. Privacy rule (ARCHITECTURE.md "Reservation privacy"): the owner's List Detail
 *   view never queries or renders it. There is no toggle, no "advanced" mode, no debug flag — do
 *   not add one later.
 * - An "edit expiry" control the mockup shows: giftlists.proto has exactly five commands
 *   (CreateGiftList/RenameGiftList/DeleteGiftList/AddGiftItem/RemoveGiftItem) and none of them
 *   changes an existing list's expiry. Building that control would mean inventing a command that
 *   doesn't exist on the wire, so it's left out rather than wired to nothing — the detail card
 *   below therefore only gets a "Rename" button, not the "Rename"/"Edit expiry" pair the mockup
 *   draws (GL-123, this restyle: rendering only, not a licence to invent a sixth command).
 *
 * Restyled onto Mantine (GL-123) — labels, error copy, the confirm-then-settle behaviour and the
 * privacy guarantees above are all unchanged from before this story; only the markup changed.
 * `ListDetail*`-prefixed helpers below are local to this file on purpose, not shared with
 * DashboardPage's own (differently-named) equivalents (GL-122, same batch) — the two pages
 * duplicate a small amount of status/label logic rather than reach into each other's internals.
 */
import {
  useCallback,
  useId,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import {
  Alert,
  Anchor,
  Badge,
  Box,
  Button,
  Center,
  Code,
  Collapse,
  Group,
  Loader,
  Paper,
  Stack,
  Text,
  TextInput,
  Title,
} from "@mantine/core";

import { useAuth } from "../../identity/auth/useAuth";
import { useGiftList } from "../hooks/useGiftList";
import { createGiftListsClient } from "../api/giftListsClient";
import { describeGiftListsCommandError } from "../api/giftListsErrors";
import { TopBar, TopBarUserMenu } from "../../ui/TopBar";
import { Page } from "../../ui/Page";
import { formatCalendarDate } from "../../ui/dates";

/** Never returned as, or rendered inside, an `<a>` — see the share box below. */
function shareLinkFor(shareToken: string): string {
  return `${window.location.origin}/share/${shareToken}`;
}

/**
 * `GiftItemUrl`'s own bound (`giftlists/src/GiftLists.Domain/GiftLists/GiftItemUrl.cs`,
 * `MaxLength`) — checked here too so an over-length value is rejected in the field rather than
 * reaching the grpc-web call at all.
 */
const GIFT_ITEM_URL_MAX_LENGTH = 2048;

/**
 * GL-78, review round 3 — this is deliberately NOT an attempt to mirror
 * `GiftItemUrl.IsAbsoluteHttpUrl` (`Uri.TryCreate(value, UriKind.Absolute, ...)` + a scheme
 * check) exactly. Rounds 1 and 2 tried that, using `new URL(...)` + a `protocol` check, and each
 * round a differential run against a real .NET `Uri.TryCreate` found more inputs where WHATWG's
 * parser (deliberately, by spec) *repairs* something `Uri` refuses — round 1 found 2, round 2
 * found 3 more while fixing those, round 3's differential run found a further 6:
 *
 *   "http://evil.com\@good.com", "http://good.com\@evil.com", "http://evil.com\.good.com",
 *   "http://a\b" — a backslash anywhere in the authority is a path separator to WHATWG, not to
 *   `Uri`;
 *   "http://exam%70le.com" — WHATWG percent-decodes host characters before validating them;
 *   "http://foo@bar@example.com" — WHATWG takes the last "@" as the userinfo/host boundary and
 *   ignores the earlier one.
 *
 * Three rounds of "found one more, patch it" is itself the finding: `new URL` and `Uri` are two
 * independently-specified engines that will keep disagreeing on exotic input, and chasing each
 * disagreement as it's discovered has no defined end. So this function gives up on exact parity
 * and instead accepts a **conservative, strictly narrower** subset of what the domain accepts —
 * by construction, every remaining gap between this and `GiftItemUrl` then lands in the direction
 * that is actually safe:
 *
 *   - This rejects something the domain would accept → the owner sees an inline message next to
 *     the field and can react to it. Visible, recoverable, mildly annoying.
 *   - This accepts something the domain would reject → the command goes out fire-and-forget
 *     anyway, the item silently never appears, and no explanation ever arrives. This is the
 *     entire defect GL-78 exists to close, and it is the outcome this function is written to
 *     make structurally impossible rather than merely unlikely.
 *
 * So: match `https?://`, then a host made *only* of dot-separated alphanumeric-and-hyphen labels
 * (no leading/trailing/doubled dots, no backslash — the four backslash divergences above are all
 * a backslash appearing inside or right after the authority), then an optional `:port`, then an
 * optional `/`, `?`, or `#` followed by anything that isn't whitespace. A backslash is left legal
 * in the path/query/fragment deliberately, not by oversight: checked against a real
 * `Uri.TryCreate` (GL-78 review round 3), .NET itself accepts one there
 * ("https://good.com/\evil.com" is a valid absolute URI to `Uri`) — excluding it there too would
 * be an unmotivated extra restriction with no confirmed divergence behind it, exactly the kind of
 * unaudited complexity this rewrite is trying to get away from. No delegation to `new URL`/`Uri`
 * at all for the authority — a browser or .NET's own repair behaviour never gets a chance to run.
 * This is deliberately narrower than what `GiftItemUrl` accepts in at least the following ways —
 * "at least" because this list is what differential runs against a real `Uri.TryCreate` have
 * turned up across GL-78 review rounds 3 and 4 so far, not a claim that it is exhaustive:
 *
 *   - Non-ASCII/IDN hostnames typed as literal Unicode (e.g. "http://例え.jp") are rejected here
 *     though `Uri` accepts them. A punycode-encoded form ("http://xn--...") is plain ASCII and is
 *     still accepted — this only drops raw Unicode in the host, not IDN itself.
 *   - IPv6 literals ("https://[::1]/") are rejected here though `Uri` accepts them — the bracket
 *     / colon syntax isn't in the label grammar above at all. (An IPv4 literal like
 *     "https://192.168.1.1/" is unaffected: its dotted digits already satisfy the ordinary label
 *     grammar, so it is accepted with no special-casing.)
 *   - A trailing-dot FQDN ("http://example.com.") is rejected here though `Uri` accepts it — the
 *     grammar requires the last label to end in an alphanumeric character.
 *   - An underscore in a host label ("http://ex_ample.com/") is rejected here though `Uri`
 *     accepts it — the label class above is alphanumeric-and-hyphen only.
 *   - Userinfo in the authority ("http://user:pass@example.com/") is rejected here though `Uri`
 *     accepts it — there is no userinfo production in the grammar above at all, only host, port,
 *     and path/query/fragment.
 *   - A host label over 63 characters is rejected here though `Uri` accepts it — the label class
 *     above caps each label at 63 characters (the DNS label limit), which is shorter than what
 *     `Uri` itself enforces.
 *
 * All of these are exotic enough that a real gift-item link is never going to need them — an
 * owner pasting a product page URL is not going to hit any of them — so trading them away for a
 * validator simple enough to actually audit (rather than one more differential patch, indefinitely)
 * is the right side of that trade. If one of them turns out to matter in practice, the fix is to
 * loosen this grammar deliberately and re-run the differential check, not to reach for `new URL`
 * again.
 */
const GIFT_ITEM_URL_PATTERN =
  /^https?:\/\/(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)(?:\.(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?))*(?::(?<port>[0-9]{1,5}))?(?:[/?#][^\s]*)?$/i;

/**
 * GL-78 review round 4: the pattern's port group, `[0-9]{1,5}`, is a *digit-count* bound, not a
 * *value* bound — it happily matches "99999" or "65536", both five digits. A differential run
 * against a real `Uri.TryCreate` found exactly this gap: `Uri` caps a port at 65535 (the actual
 * maximum a TCP port number can be), so "http://example.com:65536" and "http://example.com:99999"
 * were accepted here while the domain rejects them — precisely the silent-vanish direction this
 * guard exists to make impossible, contradicting this file's own claim about that direction until
 * this round. Checked numerically here, after the regex match, rather than folded into the regex
 * itself (an alternation bounding 0-65535 digit-by-digit is legal but not something a future
 * reader can audit at a glance — the whole point of moving to a regex in round 3 was auditability).
 */
const GIFT_ITEM_URL_MAX_PORT = 65535;

/** Matches `GiftItemUrl.IsValid`'s shape: a blank value is valid (the field is optional), and
 * "must be http/https" is not a rule about the absence of a value. See `GIFT_ITEM_URL_PATTERN`'s
 * own comment for what this deliberately does and doesn't accept, and why. */
function isAcceptableGiftItemUrl(trimmedValue: string): boolean {
  if (trimmedValue === "") {
    return true;
  }
  if (trimmedValue.length > GIFT_ITEM_URL_MAX_LENGTH) {
    return false;
  }
  const match = GIFT_ITEM_URL_PATTERN.exec(trimmedValue);
  if (!match) {
    return false;
  }
  const port = match.groups?.port;
  if (port !== undefined && Number(port) > GIFT_ITEM_URL_MAX_PORT) {
    return false;
  }
  return true;
}

/**
 * GL-78: rejects rather than "helpfully" prepending "https://" to what the owner typed. Rewriting
 * the field's contents without asking would submit a value the owner never actually typed or
 * confirmed — a different, more surprising product choice than telling them synchronously what's
 * wrong with what they typed, in the field, so they can fix it themselves. This form guard is a
 * UX affordance, not an authority (the domain rule is still the only authority and the server
 * still rejects), so it should behave like one: point at the problem, don't silently rewrite it.
 */
const ITEM_URL_INVALID_MESSAGE =
  "Enter a full link starting with http:// or https:// (for example, https://example.com), or leave this blank.";

/** Set by DashboardPage's `navigate(..., { state })` on the create-and-navigate flow only. */
interface LocationState {
  justCreated?: boolean;
}

const CHANGE_NOT_YET_VISIBLE_MESSAGE =
  "That change hasn't shown up yet. It may still be processing — try refreshing in a moment.";

type ListDetailStatus = "active" | "expiring-soon" | "expired";

const LIST_DETAIL_EXPIRY_WARNING_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/** Mirrors DashboardPage's own status computation (both mockups/dashboard.html and
 * mockups/list-detail-owner.html agree on the same three states/thresholds) — duplicated locally
 * rather than imported, since DashboardPage doesn't export it and this file must not reach into a
 * sibling page's internals (GL-122 owns that file in the same batch). */
function listDetailStatus(expiresAt: string): ListDetailStatus {
  const msRemaining = new Date(expiresAt).getTime() - Date.now();
  if (msRemaining <= 0) {
    return "expired";
  }
  return msRemaining <= LIST_DETAIL_EXPIRY_WARNING_WINDOW_MS
    ? "expiring-soon"
    : "active";
}

const LIST_DETAIL_STATUS_LABEL: Record<ListDetailStatus, string> = {
  active: "Active",
  "expiring-soon": "Expiring soon",
  expired: "Expired",
};

/** `success`/`yellow`/`danger` per the mockup's `.badge-active`/`.badge-soon`/`.badge-expired` —
 * "yellow" is Mantine's own built-in scale (GL-123 spec) rather than a fourth hand-tuned theme
 * colour for a single warning badge. */
const LIST_DETAIL_STATUS_COLOR: Record<ListDetailStatus, string> = {
  active: "success",
  "expiring-soon": "yellow",
  expired: "danger",
};

/** The item row's thumb tile. mockups/list-detail-owner.html hand-picks an emoji per item
 * ("🎧", "📚", "☕"); `GiftItemProjection` carries no icon/category field to choose one from, so
 * the item's own first initial is the only data-driven fallback available here. */
function itemThumbLabel(name: string): string {
  return name.trim().charAt(0).toUpperCase() || "?";
}

/**
 * The TopBar + Page chrome shared by every branch below (loading, forbidden, not-found, error,
 * unresolved and ready) — built once here so all of them get the same "← My lists" link and
 * avatar rather than each branch inventing its own header.
 *
 * `displayName` is `session.userId` (`AuthSession` doesn't carry a real display name yet — see
 * `TopBarUserMenu`'s own doc comment) rather than something friendlier; this page can't invent
 * data the session doesn't have.
 */
function ListDetailChrome({
  userId,
  children,
}: {
  userId: string;
  children: ReactNode;
}) {
  return (
    <>
      <TopBar
        right={
          <Group gap={20}>
            <Anchor
              component={Link}
              to="/dashboard"
              size="sm"
              c="var(--gl-text-muted)"
            >
              ← My lists
            </Anchor>
            <TopBarUserMenu displayName={userId} />
          </Group>
        }
      />
      <Page>{children}</Page>
    </>
  );
}

export default function ListDetailOwnerPage() {
  const { listId } = useParams<{ listId: string }>();
  const { session } = useAuth();
  const accessToken = session?.accessToken ?? "";
  const navigate = useNavigate();
  const location = useLocation();

  // See useGiftList's own doc comment, rule 2: only the create-and-navigate flow has a real reason
  // to expect a first-read NOT_FOUND to clear up on its own — every other arrival (a bookmark, a
  // mistyped id, the back button onto a list just deleted) gets an immediate, unambiguous answer.
  const justCreated = Boolean((location.state as LocationState | null)?.justCreated);

  const { state, refetch, confirmChange, confirmDeleted } = useGiftList(
    accessToken,
    listId ?? "",
    { retryOnNotFound: justCreated },
  );
  const giftListsClient = useMemo(
    () => createGiftListsClient(accessToken),
    [accessToken],
  );

  const nameId = useId();
  const itemNameId = useId();
  const itemUrlId = useId();
  const itemUrlErrorId = useId();

  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [renameError, setRenameError] = useState<string | null>(null);
  const [isSavingRename, setIsSavingRename] = useState(false);

  const [itemName, setItemName] = useState("");
  const [itemUrl, setItemUrl] = useState("");
  const [addItemError, setAddItemError] = useState<string | null>(null);
  const [itemUrlError, setItemUrlError] = useState<string | null>(null);
  const [isAddingItem, setIsAddingItem] = useState(false);

  const [removingItemId, setRemovingItemId] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);

  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Shared across rename/add-item/remove-item: whichever of them last failed to confirm sets this,
  // and the next attempt (of any of the three) clears it — one honest, non-blocking notice rather
  // than three near-identical banners.
  const [changeConfirmationWarning, setChangeConfirmationWarning] = useState<
    string | null
  >(null);

  const [copied, setCopied] = useState(false);

  const startRename = useCallback((currentName: string) => {
    setRenameValue(currentName);
    setRenameError(null);
    setIsRenaming(true);
  }, []);

  const handleRename = useCallback(
    async (event: FormEvent<HTMLFormElement>, id: string) => {
      event.preventDefault();
      setRenameError(null);
      setChangeConfirmationWarning(null);
      setIsSavingRename(true);
      try {
        const newName = renameValue;
        await giftListsClient.renameGiftList({ listId: id, name: newName });
        setIsRenaming(false);
        // RenameGiftList is fire-and-forget too (giftlists.proto) — confirmChange keeps this
        // form's busy state active until the read model actually reflects the new name, or says
        // plainly that it hasn't, rather than declaring success the instant the RPC returns
        // (useGiftList's own doc comment, rule 3).
        const confirmed = await confirmChange((list) => list.name === newName);
        if (!confirmed) {
          setChangeConfirmationWarning(CHANGE_NOT_YET_VISIBLE_MESSAGE);
        }
      } catch (reason) {
        setRenameError(describeGiftListsCommandError(reason).message);
      } finally {
        setIsSavingRename(false);
      }
    },
    [giftListsClient, renameValue, confirmChange],
  );

  const handleAddItem = useCallback(
    async (event: FormEvent<HTMLFormElement>, id: string) => {
      event.preventDefault();
      setAddItemError(null);
      setItemUrlError(null);
      setChangeConfirmationWarning(null);

      // Validated here, before the grpc-web call — same idea as DashboardPage's parseExpiryDate
      // guard (batch-15 review item 4: check client-side before the RPC rather than let the
      // server's rejection go unreported) but not a mirror of it: DashboardPage surfaces its
      // error via a form-level `<p role="alert">` with no `aria-invalid`/`aria-describedby`
      // wiring, while this field gets its own `itemUrlError` tied to the input via both — a
      // second, better-wired pattern, not a copy of the first. Closes GL-78. GiftItemUrl accepts
      // absolute http/https only,
      // but that rule is enforced only inside GiftLists' fire-and-forget Rebus handler
      // (AddGiftItemValidator), which the GL-72 decision means never reports back to this RPC —
      // so a scheme-less value like "example.com" used to reach AddGiftItem, get an itemId back,
      // and then just never appear, with no explanation ever arriving. Checking the identical
      // accepted set here turns that into a synchronous, in-field message instead, without
      // reopening GL-72's declined option of duplicating the domain rule server-side in the
      // Gateway adapter — this stays a client-only UX guard; the server still has the only
      // authority and still rejects.
      //
      // isAcceptableGiftItemUrl's own comment is the source of truth for what this deliberately
      // does and doesn't accept, and why (review round 3: a conservative subset of the domain's
      // accepted set, not an attempted exact mirror of it — exact mirroring turned out to have no
      // defined end after two rounds of "differential run finds another disagreement, patch it").
      const trimmedUrl = itemUrl.trim();
      if (!isAcceptableGiftItemUrl(trimmedUrl)) {
        setItemUrlError(ITEM_URL_INVALID_MESSAGE);
        return;
      }

      setIsAddingItem(true);
      try {
        const response = await giftListsClient.addGiftItem({
          listId: id,
          name: itemName,
          url: trimmedUrl === "" ? undefined : trimmedUrl,
        });
        setItemName("");
        setItemUrl("");
        const confirmed = await confirmChange((list) =>
          list.items.some((item) => item.itemId === response.itemId),
        );
        if (!confirmed) {
          setChangeConfirmationWarning(CHANGE_NOT_YET_VISIBLE_MESSAGE);
        }
      } catch (reason) {
        setAddItemError(describeGiftListsCommandError(reason).message);
      } finally {
        setIsAddingItem(false);
      }
    },
    [giftListsClient, itemName, itemUrl, confirmChange],
  );

  const handleRemoveItem = useCallback(
    async (id: string, itemId: string) => {
      setRemoveError(null);
      setChangeConfirmationWarning(null);
      setRemovingItemId(itemId);
      try {
        await giftListsClient.removeGiftItem({ listId: id, itemId });
        const confirmed = await confirmChange(
          (list) => !list.items.some((item) => item.itemId === itemId),
        );
        if (!confirmed) {
          setChangeConfirmationWarning(CHANGE_NOT_YET_VISIBLE_MESSAGE);
        }
      } catch (reason) {
        setRemoveError(describeGiftListsCommandError(reason).message);
      } finally {
        setRemovingItemId(null);
      }
    },
    [giftListsClient, confirmChange],
  );

  const handleDelete = useCallback(
    async (id: string) => {
      setDeleteError(null);
      setIsDeleting(true);
      try {
        await giftListsClient.deleteGiftList({ listId: id });
        // Only navigate once the deletion is actually confirmed gone from the read model
        // (useGiftList's own doc comment, rule 4) — otherwise the dashboard's own myGiftLists
        // read could still show this list a moment later, which is exactly the "stale data shown
        // as settled" outcome this whole fix exists to prevent.
        const confirmed = await confirmDeleted();
        if (confirmed) {
          navigate("/dashboard");
          return;
        }
        setDeleteError(
          "This hasn't been confirmed yet. It may still be processing — try again in a moment.",
        );
      } catch (reason) {
        setDeleteError(describeGiftListsCommandError(reason).message);
      } finally {
        setIsDeleting(false);
      }
    },
    [giftListsClient, navigate, confirmDeleted],
  );

  const handleShare = useCallback(async (shareToken: string) => {
    // Copy-only, never a clickable link (ARCHITECTURE.md "Reservation privacy", this page's own doc comment above).
    await navigator.clipboard.writeText(shareLinkFor(shareToken));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, []);

  if (!session || !listId) {
    // RequireAuth guards this route, and the router only ever matches here with a :listId param —
    // both defensive, not reachable in normal operation.
    return null;
  }

  if (state.status === "loading" || state.status === "pending") {
    return (
      <ListDetailChrome userId={session.userId}>
        <Center py={64}>
          <Group gap="sm">
            <Loader size="sm" />
            <Text c="var(--gl-text-muted)">Loading your gift list…</Text>
          </Group>
        </Center>
      </ListDetailChrome>
    );
  }

  if (state.status === "forbidden") {
    return (
      <ListDetailChrome userId={session.userId}>
        <Alert role="alert" color="danger" mb="md">
          You do not own this gift list.
        </Alert>
        <Anchor component={Link} to="/dashboard" size="sm">
          ← My lists
        </Anchor>
      </ListDetailChrome>
    );
  }

  if (state.status === "not-found") {
    // An ordinary, unambiguous NOT_FOUND — this page wasn't reached via the create-and-navigate
    // flow, so there is no reason to think the read model is still catching up (useGiftList's own
    // doc comment, rule 2). No GL-72-shaped hedging belongs here.
    return (
      <ListDetailChrome userId={session.userId}>
        <Alert role="alert" color="danger" mb="md">
          This list doesn&apos;t exist.
        </Alert>
        <Anchor component={Link} to="/dashboard" size="sm">
          ← My lists
        </Anchor>
      </ListDetailChrome>
    );
  }

  if (state.status === "error") {
    return (
      <ListDetailChrome userId={session.userId}>
        <Alert role="alert" color="danger" mb="md">
          {state.info.message}
        </Alert>
        <Group gap="md">
          <Button type="button" variant="outline" onClick={refetch}>
            Try again
          </Button>
          <Anchor component={Link} to="/dashboard" size="sm">
            ← My lists
          </Anchor>
        </Group>
      </ListDetailChrome>
    );
  }

  if (state.status === "unresolved") {
    return (
      <ListDetailChrome userId={session.userId}>
        {/* GL-72 is open: every GiftLists command is fire-and-forget, so a command GiftLists
            later rejects is never reported back to the browser, which by then already holds a
            "successful" response for a list that may never exist — this message says so rather
            than guessing "not found" or "still loading". The ticket number itself stays out of
            the user-facing text (batch-15 review item 2) — it identifies nothing to the person
            reading it. */}
        <Alert role="alert" color="yellow" mb="md">
          We can&apos;t find this list yet. It may still be processing, or the
          request that created it may not have gone through — we can&apos;t
          tell those two apart yet.
        </Alert>
        <Group gap="md">
          <Button type="button" variant="outline" onClick={refetch}>
            Check again
          </Button>
          <Anchor component={Link} to="/dashboard" size="sm">
            ← My lists
          </Anchor>
        </Group>
      </ListDetailChrome>
    );
  }

  const { giftList } = state;
  const status = listDetailStatus(giftList.expiresAt);

  return (
    <ListDetailChrome userId={session.userId}>
      <Paper radius="lg" shadow="md" withBorder p="xl" mb="lg">
        <Group justify="space-between" align="flex-start" wrap="wrap" gap="md">
          <Box>
            <Badge color={LIST_DETAIL_STATUS_COLOR[status]} variant="light" tt="none">
              ● {LIST_DETAIL_STATUS_LABEL[status]}
            </Badge>
            <Title order={2} mt={8} mb={4}>
              {giftList.name}
            </Title>
            <Text size="sm" c="var(--gl-text-muted)">
              Expires {formatCalendarDate(giftList.expiresAt)}
            </Text>
          </Box>
          <Button
            type="button"
            variant="outline"
            color="gray"
            size="sm"
            onClick={() => startRename(giftList.name)}
          >
            Rename
          </Button>
        </Group>

        <Collapse expanded={isRenaming}>
          <Box
            component="form"
            onSubmit={(event) => void handleRename(event, giftList.listId)}
            noValidate
            mt="md"
          >
            <Stack gap="sm">
              <TextInput
                id={nameId}
                label="List name"
                required
                withAsterisk={false}
                value={renameValue}
                onChange={(event) => setRenameValue(event.target.value)}
              />
              {renameError && (
                <Text role="alert" size="sm" c="danger">
                  {renameError}
                </Text>
              )}
              <Group gap={8}>
                <Button type="submit" size="sm" disabled={isSavingRename}>
                  {isSavingRename ? "Saving…" : "Save"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  color="gray"
                  size="sm"
                  onClick={() => setIsRenaming(false)}
                  disabled={isSavingRename}
                >
                  Cancel
                </Button>
              </Group>
            </Stack>
          </Box>
        </Collapse>

        {/*
          Copy-only, never a clickable <a> — opening this link yourself, signed in as the owner, is
          the documented way to see which items are reserved and spoil your own surprise
          (ARCHITECTURE.md "Reservation privacy"). Do not make this a link, even for convenience.
        */}
        <Group
          mt="md"
          gap={8}
          wrap="nowrap"
          style={{
            padding: "10px 14px",
            background: "var(--mantine-color-primary-0)",
            border: "1px dashed var(--mantine-color-primary-2)",
            borderRadius: 10,
          }}
        >
          <Code
            style={{
              flex: 1,
              background: "transparent",
              color: "var(--mantine-color-primary-7)",
              overflowX: "auto",
              whiteSpace: "nowrap",
            }}
          >
            {shareLinkFor(giftList.shareToken)}
          </Code>
          <Button
            type="button"
            variant="light"
            size="xs"
            onClick={() => void handleShare(giftList.shareToken)}
          >
            {copied ? "Copied!" : "Copy link"}
          </Button>
        </Group>

        <Box
          mt="md"
          style={{
            fontSize: "0.85rem",
            color: "var(--gl-text-muted)",
            background: "var(--mantine-color-body)",
            border: "1px solid var(--gl-border)",
            borderRadius: 10,
            padding: "10px 14px",
          }}
        >
          <Text component="span" fw={600} c="var(--gl-text)">
            Heads up:
          </Text>{" "}
          this page will never show you which items have been reserved —
          that&apos;s by design, so the surprise stays intact. The link above
          is copy-only on purpose: opening it yourself would show you
          what&apos;s been claimed and spoil it.
          <br />
          <br />
          <Text component="span" fw={600} c="var(--gl-text)">
            Who
          </Text>{" "}
          reserved something is never visible to anyone, anywhere — we
          don&apos;t record it at all.
        </Box>
      </Paper>

      {changeConfirmationWarning && (
        <Alert role="status" color="yellow" mb="lg">
          {changeConfirmationWarning}
        </Alert>
      )}

      <Paper radius="lg" shadow="md" withBorder p="xl" mb="lg">
        <Title order={3} mb="md">
          Items
        </Title>
        {giftList.items.length === 0 && (
          <Text size="sm" c="var(--gl-text-muted)">
            No items yet — add the first one below.
          </Text>
        )}
        <Box component="ul" style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {giftList.items.map((item) => (
            <Box
              component="li"
              key={item.itemId}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 14,
                padding: "14px 0",
                borderBottom: "1px solid var(--gl-border)",
              }}
            >
              <Center
                w={44}
                h={44}
                style={{
                  borderRadius: 10,
                  background: "var(--mantine-color-accent-0)",
                  fontSize: "1.2rem",
                  flexShrink: 0,
                }}
              >
                {itemThumbLabel(item.name)}
              </Center>
              <Box style={{ flex: 1, minWidth: 0 }}>
                <Text fw={600} size="sm">
                  {item.name}
                </Text>
                {item.description && (
                  <Text size="xs" c="var(--gl-text-muted)" mt={2}>
                    {item.description}
                  </Text>
                )}
                {item.url && (
                  <Anchor href={item.url} target="_blank" rel="noreferrer" size="xs">
                    {item.url}
                  </Anchor>
                )}
              </Box>
              <Button
                type="button"
                variant="outline"
                color="danger"
                size="xs"
                onClick={() => void handleRemoveItem(giftList.listId, item.itemId)}
                disabled={removingItemId === item.itemId}
              >
                {removingItemId === item.itemId ? "Removing…" : "Remove"}
              </Button>
            </Box>
          ))}
        </Box>
        {removeError && (
          <Text role="alert" size="sm" c="danger" mt="sm">
            {removeError}
          </Text>
        )}

        <Box
          component="form"
          onSubmit={(event) => void handleAddItem(event, giftList.listId)}
          noValidate
          mt="md"
          pt="md"
          style={{ borderTop: "1px solid var(--gl-border)" }}
        >
          <Group align="flex-end" gap={8} wrap="wrap">
            <TextInput
              id={itemNameId}
              label="Item name"
              required
              withAsterisk={false}
              style={{ flex: 1, minWidth: 180 }}
              value={itemName}
              onChange={(event) => setItemName(event.target.value)}
            />
            <TextInput
              id={itemUrlId}
              label="Link (optional)"
              style={{ flex: 1, minWidth: 180 }}
              value={itemUrl}
              onChange={(event) => setItemUrl(event.target.value)}
              aria-invalid={itemUrlError ? true : undefined}
              aria-describedby={itemUrlError ? itemUrlErrorId : undefined}
            />
            <Button type="submit" size="sm" disabled={isAddingItem}>
              {isAddingItem ? "Adding…" : "Add item"}
            </Button>
          </Group>
          {itemUrlError && (
            <Text role="alert" id={itemUrlErrorId} size="xs" c="danger" mt={6}>
              {itemUrlError}
            </Text>
          )}
          {addItemError && (
            <Text role="alert" size="sm" c="danger" mt={6}>
              {addItemError}
            </Text>
          )}
        </Box>
      </Paper>

      <Paper
        radius="lg"
        withBorder
        p="lg"
        style={{
          borderColor: "var(--mantine-color-danger-1)",
          background: "#fffafa",
        }}
      >
        <Title order={4} c="danger" mb={6}>
          Delete this list
        </Title>
        <Text size="sm" c="var(--gl-text-muted)" mb="md">
          This removes the list and its share link permanently. Reservations
          already made are not affected for guests who reserved, but the list
          can no longer be viewed.
        </Text>
        {deleteError && (
          <Text role="alert" size="sm" c="danger" mb="sm">
            {deleteError}
          </Text>
        )}
        <Button
          type="button"
          variant="outline"
          color="danger"
          size="sm"
          onClick={() => void handleDelete(giftList.listId)}
          disabled={isDeleting}
        >
          {isDeleting ? "Deleting…" : "Delete list"}
        </Button>
      </Paper>
    </ListDetailChrome>
  );
}
