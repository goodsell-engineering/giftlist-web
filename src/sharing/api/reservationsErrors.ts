/**
 * Maps a failed `reservationsClient.reserveGift` call onto a specific, user-facing message — the
 * grpc-web counterpart of `sharedGiftListErrors.ts`'s `describeSharedGiftListReadError`, on the
 * same rule as every other error mapper in this codebase (CONVENTIONS.md "Errors"): branch on the
 * stable `giftlist-error-code` trailer first, the gRPC status only as a fallback
 * (`ErrorToRpcExceptionMapper`, identity/api/authErrors.ts's own precedent).
 *
 * `ReserveGift` can fail for reasons raised at two different places on the way to the Reservations
 * aggregate (`ReservationsGrpcService`'s own doc comment) — a malformed/unresolved share token or
 * item id at the Gateway (`gateway.*`), or one of Reservations' own eligibility checks once the
 * command actually reaches `ReserveGiftInteractor` (`reservation.*`) — but a caller here does not
 * need to know which hop raised a given code, only what it means, so both tables are merged into
 * one below.
 *
 * `already-reserved` is deliberately not treated as an ordinary error by any caller of this
 * function: losing the race to reserve a gift is a normal, expected outcome (this ticket's own
 * scope note), not a failure to show in a toast — `useReserveGift` branches on `kind ===
 * "already-reserved"` specifically to roll the optimistic UI back into a "someone just took this
 * one" state instead.
 *
 * `messaging.reply_timeout` (GL-42, folded from GL-40's own review) gets the same specific
 * treatment `identity/api/authErrors.ts` already gives it, for a reason that matters more here
 * than there: GL-41's decision on timed-out reserves is that a `ReplyTimeout` on `ReserveGift`
 * tells this browser nothing about whether the command actually committed — Reservations may have
 * saved the aggregate and only the *reply* got lost. Falling through to the generic `Unavailable`
 * branch below (as this file used to) renders "try again shortly", which invites exactly the retry
 * GL-41 warns about: if the first attempt *did* commit, the retry comes back
 * `reservation.already_reserved`, and — with nothing to distinguish it from an ordinary
 * lost-the-race — `useReserveGift` would render the guest's own earlier reservation as "someone
 * just took this one". The `reply-timeout` kind exists so `useReserveGift` can special-case it
 * instead: keep the optimistic "reserved-by-you" state (no button, no retry) until a live push
 * settles the question one way or the other.
 */
import { Code, ConnectError } from "@connectrpc/connect";

const ERROR_CODE_TRAILER = "giftlist-error-code";

// Mirrors RequestReplyErrors.ReplyTimeoutCode (buildingblocks/src/BuildingBlocks/Messaging/
// RequestReply/RequestReplyErrors.cs) — identity/api/authErrors.ts's own precedent for this exact
// constant.
const REPLY_TIMEOUT_CODE = "messaging.reply_timeout";

export type ReserveGiftErrorKind =
  | "already-reserved"
  | "not-found"
  | "expired"
  | "invalid-token"
  | "invalid-id"
  | "reply-timeout"
  | "unavailable"
  | "unknown";

export interface ReserveGiftErrorInfo {
  kind: ReserveGiftErrorKind;
  message: string;
}

const KNOWN_ERROR_CODES: Readonly<Record<string, ReserveGiftErrorInfo>> = {
  // Reservations.Application.Reservations.ReservationErrors — raised once the command reaches
  // ReserveGiftInteractor.
  "reservation.already_reserved": {
    kind: "already-reserved",
    message: "Someone just took this one.",
  },
  "reservation.giftlist_not_found": {
    kind: "not-found",
    message: "This list isn't available any more.",
  },
  "reservation.giftlist_deleted": {
    kind: "not-found",
    message: "This list isn't available any more.",
  },
  "reservation.giftlist_expired": {
    kind: "expired",
    message:
      "This gift list has expired and can no longer accept reservations.",
  },
  "reservation.giftitem_not_found": {
    kind: "not-found",
    message: "This gift isn't on the list any more.",
  },
  "reservation.invalid_id": {
    kind: "invalid-id",
    message: "That gift could not be identified. Please refresh and try again.",
  },
  // Gateway.Application.GiftLists.GiftListErrors — raised before the command ever reaches the
  // bus, at ReservationsGrpcService's own share-token/item-id parsing.
  "gateway.invalid_share_token": {
    kind: "invalid-token",
    message:
      "This link doesn't look right. Check that you copied the whole thing and try again.",
  },
  "gateway.not_found": {
    kind: "not-found",
    message: "This list isn't available any more.",
  },
  "gateway.invalid_id": {
    kind: "invalid-id",
    message: "That gift could not be identified. Please refresh and try again.",
  },
  [REPLY_TIMEOUT_CODE]: {
    kind: "reply-timeout",
    message:
      "This is taking longer than expected. Your reservation may have gone through " +
      "— we'll update this automatically once we know for sure.",
  },
};

export function describeReserveGiftError(
  reason: unknown,
): ReserveGiftErrorInfo {
  const error = ConnectError.from(reason);
  const giftlistErrorCode = error.metadata.get(ERROR_CODE_TRAILER);

  const known = giftlistErrorCode
    ? KNOWN_ERROR_CODES[giftlistErrorCode]
    : undefined;
  if (known) {
    return known;
  }

  switch (error.code) {
    case Code.Unavailable:
      return {
        kind: "unavailable",
        message:
          "GiftList is temporarily unavailable. Please try again shortly.",
      };

    default:
      return {
        kind: "unknown",
        message: "Something went wrong. Please try again.",
      };
  }
}
