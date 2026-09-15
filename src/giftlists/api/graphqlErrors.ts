/**
 * Maps a failed `graphqlRequest` call onto a specific, user-facing message — the GraphQL-read
 * counterpart of identity/api/authErrors.ts's `describeAuthError`, following the same rule: branch
 * on the stable application code first (`extensions.errorCode`, e.g. "gateway.forbidden"), fall
 * back to the coarser category (`extensions.code`, e.g. "FORBIDDEN") only for a code this file
 * doesn't recognise yet.
 */
import { GraphQlRequestError, GraphQlTransportError } from "./graphqlClient";

export type GiftListReadErrorKind =
  | "not-found"
  | "forbidden"
  | "unauthenticated"
  | "unavailable"
  | "unknown";

export interface GiftListReadErrorInfo {
  kind: GiftListReadErrorKind;
  message: string;
}

const KNOWN_ERROR_CODES: Readonly<
  Record<string, GiftListReadErrorInfo>
> = {
  "gateway.not_found": {
    kind: "not-found",
    message: "No gift list exists with this id.",
  },
  "gateway.forbidden": {
    kind: "forbidden",
    message: "You do not own this gift list.",
  },
  "gateway.unauthenticated": {
    kind: "unauthenticated",
    message: "Please log in again.",
  },
};

export function describeGiftListReadError(
  reason: unknown,
): GiftListReadErrorInfo {
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
    // least NOT_FOUND/FORBIDDEN/UNAUTHENTICATED still route somewhere sensible.
    const category = reason.errors[0]?.extensions?.code;
    switch (category) {
      case "NOT_FOUND":
        return { kind: "not-found", message: reason.message };
      case "FORBIDDEN":
        return { kind: "forbidden", message: reason.message };
      case "UNAUTHENTICATED":
        return { kind: "unauthenticated", message: "Please log in again." };
      default:
        return { kind: "unknown", message: reason.message };
    }
  }

  if (reason instanceof GraphQlTransportError) {
    return {
      kind: "unavailable",
      message:
        "GiftList is temporarily unavailable. Please try again shortly.",
    };
  }

  return {
    kind: "unknown",
    message: "Something went wrong. Please try again.",
  };
}
