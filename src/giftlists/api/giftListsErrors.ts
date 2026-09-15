/**
 * Maps a failed grpc-web call from {@link createGiftListsClient} onto a specific, user-facing
 * message — the GiftLists-command counterpart of identity/api/authErrors.ts's
 * `describeAuthError`, following the same rule (branch on the stable `giftlist-error-code`
 * trailer first, the gRPC status only as a fallback) for the same reason: the status alone is
 * many-to-one (CONVENTIONS.md "Errors").
 *
 * Deliberately narrow: every RPC on GiftListsService is fire-and-forget (giftlists.proto's own
 * remarks) and only ever fails *before* the command reaches the bus — a missing/invalid id, a
 * missing expiry, or an expired/absent token (`RequireAuthorization()`). A failure the GiftLists
 * service itself raises later (e.g. a business-rule rejection) is never reported back through
 * this RPC at all; see the GL-72 comment on `useGiftList`'s polling logic for how that residual is
 * handled once the read model — not this call — is the one telling the truth.
 */
import { Code, ConnectError } from "@connectrpc/connect";

const ERROR_CODE_TRAILER = "giftlist-error-code";

export type GiftListsCommandErrorKind =
  | "invalid-id"
  | "missing-expiry"
  | "unauthenticated"
  | "unavailable"
  | "unknown";

export interface GiftListsCommandErrorInfo {
  kind: GiftListsCommandErrorKind;
  message: string;
}

/**
 * Exported so DashboardPage's own client-side guard (batch-15 review item 4: an unparseable
 * expiry must never reach `timestampFromDate` — it throws for one) can show the exact wording the
 * server would have produced for the case that *does* still reach it, rather than a second string
 * that could quietly drift from this one.
 */
export const MISSING_EXPIRY_MESSAGE = "Choose an expiry date for this list.";

/**
 * Exported for the same reason as {@link MISSING_EXPIRY_MESSAGE} — DashboardPage's client-side
 * guard needs the wording — but this one has no server-side counterpart to mirror (GL-82). The
 * Gateway only ever checks `ExpiresAt is null` (GL-71); a past-but-non-null expiry sails through
 * it, gets accepted with a `200 OK`, and is only rejected later, invisibly, by GiftLists' own
 * domain validator — the residual GL-72 documented and explicitly declined to close by duplicating
 * that business rule into this adapter. This message exists purely so the ordinary path (a user
 * picking yesterday in the date picker) never reaches that residual at all; it is not, and must
 * not become, a stand-in for a `gateway.*` error code.
 */
export const PAST_EXPIRY_MESSAGE =
  "Choose an expiry date in the future — that one has already passed.";

const KNOWN_ERROR_CODES: Readonly<
  Record<string, GiftListsCommandErrorInfo>
> = {
  "gateway.invalid_id": {
    kind: "invalid-id",
    message: "That list or item could not be identified. Please retry.",
  },
  "gateway.missing_expiry": {
    kind: "missing-expiry",
    message: MISSING_EXPIRY_MESSAGE,
  },
};

export function describeGiftListsCommandError(
  reason: unknown,
): GiftListsCommandErrorInfo {
  const error = ConnectError.from(reason);
  const giftlistErrorCode = error.metadata.get(ERROR_CODE_TRAILER);

  const known = giftlistErrorCode
    ? KNOWN_ERROR_CODES[giftlistErrorCode]
    : undefined;
  if (known) {
    return known;
  }

  switch (error.code) {
    case Code.Unauthenticated:
      return { kind: "unauthenticated", message: "Please log in again." };

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
