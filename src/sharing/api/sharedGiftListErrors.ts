/**
 * Maps a failed `fetchSharedGiftList` call onto guest-facing copy — the shared-view counterpart
 * of `giftlists/api/graphqlErrors.ts`'s `describeGiftListReadError`, same rule (branch on the
 * stable `extensions.errorCode` first, fall back to the coarser `extensions.code` category), but
 * a separate table with its own wording rather than an extra branch bolted onto that file.
 *
 * `sharedGiftList(token)` fails two distinguishable ways
 * (`Gateway.Infrastructure/GiftLists/GraphQL/GiftListQueries.cs`'s own doc comment,
 * `Gateway.Application/GiftLists/GetSharedGiftList`):
 *
 * - `gateway.invalid_share_token` (`ErrorKind.Validation` → `BAD_USER_INPUT`) — the token is the
 *   wrong *shape*, rejected before any database round-trip.
 * - `gateway.not_found` (`ErrorKind.NotFound` → `NOT_FOUND`) — well-formed but resolves to
 *   nothing (deleted, or never existed).
 *
 * The token's shape is public — it appears in every share URL — so telling these two apart in the
 * copy is not a leak; a guest who mistyped or truncated a link benefits from being told that,
 * rather than being given the same "no list exists" message reused verbatim from the owner-facing
 * table (which reads oddly to a guest who just followed a link, and was written for a UUID path
 * parameter, not an opaque token).
 */
import {
  GraphQlRequestError,
  GraphQlTransportError,
} from "../../giftlists/api/graphqlClient";

export type SharedGiftListReadErrorKind =
  "invalid-token" | "not-found" | "unavailable" | "unknown";

export interface SharedGiftListReadErrorInfo {
  kind: SharedGiftListReadErrorKind;
  message: string;
}

const KNOWN_ERROR_CODES: Readonly<Record<string, SharedGiftListReadErrorInfo>> =
  {
    "gateway.invalid_share_token": {
      kind: "invalid-token",
      message:
        "This link doesn't look right. Check that you copied the whole thing and try again.",
    },
    "gateway.not_found": {
      kind: "not-found",
      message:
        "This list isn't available any more. The person who shared it may have deleted it.",
    },
  };

export function describeSharedGiftListReadError(
  reason: unknown,
): SharedGiftListReadErrorInfo {
  if (reason instanceof GraphQlRequestError) {
    for (const error of reason.errors) {
      const known = error.extensions?.errorCode
        ? KNOWN_ERROR_CODES[error.extensions.errorCode]
        : undefined;
      if (known) {
        return known;
      }
    }

    // No error carried a code this file recognises — fall back to the coarser category so at
    // least BAD_USER_INPUT/NOT_FOUND still route somewhere sensible.
    const category = reason.errors[0]?.extensions?.code;
    switch (category) {
      case "BAD_USER_INPUT":
        return KNOWN_ERROR_CODES["gateway.invalid_share_token"];
      case "NOT_FOUND":
        return KNOWN_ERROR_CODES["gateway.not_found"];
      default:
        return { kind: "unknown", message: reason.message };
    }
  }

  if (reason instanceof GraphQlTransportError) {
    return {
      kind: "unavailable",
      message: "GiftList is temporarily unavailable. Please try again shortly.",
    };
  }

  return {
    kind: "unknown",
    message: "Something went wrong. Please try again.",
  };
}
