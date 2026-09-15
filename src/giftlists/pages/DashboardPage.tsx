/**
 * Mockup: mockups/dashboard.html (screen 3 of 6)
 *
 * "My gift lists" — the owner's list of lists, backed by the real `myGiftLists` GraphQL query
 * (GL-23) for reads and the real grpc-web `CreateGiftList` command (GL-71) for creating one
 * (GL-24). No reservation UI anywhere on this page — it doesn't exist yet (Phase 4), and even
 * once it does, an owner's own dashboard/list-detail views never surface reservation state at all
 * (ARCHITECTURE.md "Reservation privacy").
 */
import { useCallback, useId, useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";

import { useAuth } from "../../identity/auth/useAuth";
import { useMyGiftLists } from "../hooks/useMyGiftLists";
import { createGiftListsClient } from "../api/giftListsClient";
import {
  describeGiftListsCommandError,
  MISSING_EXPIRY_MESSAGE,
  PAST_EXPIRY_MESSAGE,
} from "../api/giftListsErrors";
import type { GiftListProjection } from "../api/giftListQueries";

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

/**
 * Parses the `<input type="date">` value ("YYYY-MM-DD") as UTC midnight of that calendar day, not
 * local midnight (batch-15 review item 4): `new Date("2026-01-01T00:00:00")` — no zone suffix — is
 * local time, so a caller at a positive UTC offset got the *previous* UTC day once serialized.
 * Appending "Z" pins it to the date the user actually picked regardless of their timezone.
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
 * The calendar day `date` falls on, expressed in UTC as "YYYY-MM-DD" — the same shape an
 * `<input type="date">` produces and `parseExpiryDate` consumes. Used by the date input's `min`,
 * by `utcDateStringPlusDays` (min is tomorrow, not today — see that function), and by
 * `isExpiryDateNotInFuture`'s "today" so all three agree with each other and with
 * `parseExpiryDate`'s own UTC-midnight convention (GL-82).
 */
function utcDateString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * `date`, `days` UTC calendar days later, as "YYYY-MM-DD" — used to set the date input's `min` to
 * tomorrow rather than today (GL-82 review): `min` is inclusive, so `min` = today would advertise
 * today as the earliest *legal* choice when it is in fact a guaranteed-failing one (see
 * `isExpiryDateNotInFuture`'s doc comment for the arithmetic).
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
    // Copy-only, never a clickable link (ARCHITECTURE.md "Reservation privacy"): opening a list's own share link
    // while signed in as its owner is the documented way to see which items are reserved and
    // spoil the surprise for yourself. This button's only effect is writing to the clipboard.
    await navigator.clipboard.writeText(shareLinkFor(giftList.shareToken));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <li>
      <span>{STATUS_LABEL[status]}</span>
      <h3>{giftList.name}</h3>
      <p>
        {giftList.items.length}{" "}
        {giftList.items.length === 1 ? "item" : "items"} · expires{" "}
        {new Date(giftList.expiresAt).toLocaleDateString()}
      </p>
      <Link to={`/lists/${giftList.listId}`}>Manage</Link>
      <button type="button" onClick={() => void handleShare()}>
        {copied ? "Copied!" : "Share"}
      </button>
    </li>
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

  const nameId = useId();
  const expiresAtId = useId();

  const [isCreating, setIsCreating] = useState(false);
  const [name, setName] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

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
      const expiryDate = parseExpiryDate(expiresAt);
      if (expiryDate === null) {
        setCreateError(MISSING_EXPIRY_MESSAGE);
        return;
      }

      // Same idea as the empty/unparseable guard above, for the other ordinary path GL-72's
      // ticket found: nothing about `type="date" required` stops a user picking yesterday — or
      // today, which is just as guaranteed to fail, only invisibly (see
      // isExpiryDateNotInFuture's doc comment) — and the resulting command sails past the Gateway
      // (GL-71 checks only `ExpiresAt is null`) and is rejected invisibly, deep inside GiftLists,
      // leaving this page's destination stuck "unresolved" forever. `min` below steers the picker
      // away from both in the first place; this check catches a permissive browser or a
      // hand-edited value that gets here anyway.
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
    <main>
      <h1>My gift lists</h1>
      <p>Create a list, share the link, and let people surprise you.</p>

      {isCreating ? (
        <form onSubmit={(event) => void handleCreate(event)} noValidate>
          <div>
            <label htmlFor={nameId}>List name</label>
            <input
              id={nameId}
              name="name"
              type="text"
              required
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div>
            <label htmlFor={expiresAtId}>Expires</label>
            <input
              id={expiresAtId}
              name="expiresAt"
              type="date"
              required
              // UTC's tomorrow, not today (GL-82 review) and not the browser's local day
              // (GL-82) — see isExpiryDateNotInFuture's doc comment for why today is a
              // guaranteed-failing choice server-side, so `min` (inclusive) must not advertise it
              // as legal, and why UTC is the calendar this and parseExpiryDate agree on.
              // Recomputed on every render rather than memoized: the form can sit open for a
              // while, and a stale `min` from before midnight UTC would let a now-past day stay
              // selectable underneath the picker.
              min={utcDateStringPlusDays(new Date(), 1)}
              value={expiresAt}
              onChange={(event) => setExpiresAt(event.target.value)}
            />
          </div>
          {createError && <p role="alert">{createError}</p>}
          <button type="submit" disabled={isSubmitting}>
            {isSubmitting ? "Creating…" : "Create list"}
          </button>
          <button
            type="button"
            onClick={() => setIsCreating(false)}
            disabled={isSubmitting}
          >
            Cancel
          </button>
        </form>
      ) : (
        <button type="button" onClick={() => setIsCreating(true)}>
          + New list
        </button>
      )}

      {state.status === "loading" && <p>Loading your gift lists…</p>}

      {state.status === "error" && (
        <div>
          <p role="alert">{state.info.message}</p>
          <button type="button" onClick={refetch}>
            Try again
          </button>
        </div>
      )}

      {state.status === "ready" && state.giftLists.length === 0 && (
        <p>You don&apos;t have any gift lists yet.</p>
      )}

      {state.status === "ready" && state.giftLists.length > 0 && (
        <ul>
          {state.giftLists.map((giftList) => (
            <GiftListCard key={giftList.listId} giftList={giftList} />
          ))}
        </ul>
      )}
    </main>
  );
}
