/**
 * A well-formed share token for tests (GL-110) — 21 base62 characters
 * (`[0-9A-Za-z]{21}`), exactly the shape `ShareTokenFormat.IsValid`
 * (gateway/src/Gateway.Application/GiftLists/ShareTokenFormat.cs) requires and the Gateway's own
 * boundary guard rejects anything else against, on every surface that carries one — the anonymous
 * GraphQL query and subscription, and the grpc-web `ReserveGift` RPC.
 *
 * Fixtures across this codebase used to fabricate their own token literals instead —
 * `"share-token-1"`/`"share-token-2"` (17/13 characters, with a hyphen the real alphabet doesn't
 * have) and a one-off 20-character `"kQ7v-2xR9mZpL3wYbT1s"` — which happened to work only because
 * every test here mocks the transport the token would actually be validated against. A test that
 * ever stops mocking that boundary (an integration-style test against a real Gateway, e.g.) would
 * fail on the fixture, not the code under test. This is the one place that shape is stated, so it
 * can't drift between files the way the two fabricated literals already had.
 *
 * Two overloads share this one token by default rather than each hand-rolling a *different*
 * fabricated string — callers that specifically need two distinct tokens (e.g. proving a secret
 * saved under one token is not visible under another) pass a `suffix` to vary the value while
 * keeping the same valid shape.
 */
const BASE_TOKEN = "kQ7v2xR9mZpL3wYbT1sA";

/**
 * Returns a 21-character base62 token. `suffix` (single base62 character, default `"1"`)
 * distinguishes one call's token from another's without ever needing a caller to invent its own
 * fabricated literal.
 */
export function aShareToken(suffix = "1"): string {
  return `${BASE_TOKEN}${suffix}`;
}
