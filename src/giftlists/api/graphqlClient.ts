/**
 * A minimal, hand-rolled GraphQL request function for the Gateway's one `/graphql` endpoint
 * (GL-23's `myGiftLists`/`giftList(id)`, GL-32/GL-33's `sharedGiftList(token)`) — not a client
 * library.
 *
 * Design decision (GL-24): package.json deliberately gains no GraphQL client dependency (Apollo
 * Client, urql, graphql-request, ...). This SPA issues a small number of named, read-only queries
 * against one endpoint. It has no need for a normalized cache, generated hooks, or optimistic-
 * mutation machinery — mutations here are grpc-web commands, not GraphQL, so there is nothing for
 * a client library's mutation layer to do (see giftlists.proto's own header for why). A full
 * client would add real bundle weight and a second data-fetching idiom to a codebase that already
 * has one thin hand-written client per transport (identity/api/authClient.ts for grpc-web); this
 * file is the GraphQL-transport counterpart of that same pattern, not a second architecture.
 * There is also deliberately no subscription support here — subscriptions in this system are
 * share-token-scoped for the anonymous guest view (sharing/*), not something the owner-facing
 * pages this file serves ever use.
 *
 * If a write surface, or an actual caching/dedup requirement shows up later, revisit this
 * decision rather than growing this file into a bespoke client framework.
 *
 * Two entry points, one shared implementation (GL-33):
 *
 * - {@link graphqlRequest} — the owner-facing surface, always carries a real JWT.
 * - {@link graphqlRequestAnonymous} — `sharedGiftList(token)`'s guest surface. A guest has no
 *   access token at all, and `Authorization: Bearer ` (an empty-string token forced through the
 *   authenticated entry point) is not an absent header — it is a malformed one that a
 *   less-careful server might still try to parse, and the whole point of the sharing surface is
 *   that a well-formed share token is the entire credential (ARCHITECTURE.md "Auth & sharing").
 *   So this is a sibling function with its own signature (no `accessToken` parameter to forget to
 *   pass, or to be tempted to pass `""` to) rather than an optional parameter on
 *   {@link graphqlRequest} — an optional param a caller can omit by accident is exactly the kind
 *   of one-character mistake that would silently start sending `Authorization: Bearer undefined`
 *   for the owner-facing calls this file also serves. The two never share a call site, so nothing
 *   is lost by keeping them syntactically distinct.
 */
const gatewayUrl = import.meta.env.VITE_GATEWAY_URL ?? "http://localhost:8080";
const graphqlUrl = `${gatewayUrl}/graphql`;

export interface GraphQlErrorExtensions {
  /** HotChocolate's category code, e.g. "NOT_FOUND"/"FORBIDDEN" — ErrorKindTransportMapping.ToGraphQlCode. */
  code?: string;
  /** The stable, two-segment application code, e.g. "gateway.not_found" — ErrorToGraphQlErrorMapper.ErrorCodeExtensionKey. */
  errorCode?: string;
}

export interface GraphQlError {
  message: string;
  extensions?: GraphQlErrorExtensions;
}

/** Raised when the Gateway's response body carries a GraphQL `errors` array. */
export class GraphQlRequestError extends Error {
  readonly errors: GraphQlError[];

  constructor(errors: GraphQlError[]) {
    super(errors[0]?.message ?? "GraphQL request failed");
    this.errors = errors;
  }

  /** True if any error in the response carries the given `extensions.code` (e.g. "NOT_FOUND"). */
  hasCode(code: string): boolean {
    return this.errors.some((error) => error.extensions?.code === code);
  }
}

/** Raised when the HTTP call itself failed, before any GraphQL-shaped response existed at all. */
export class GraphQlTransportError extends Error {}

interface GraphQlResponseBody<TData> {
  data?: TData | null;
  errors?: GraphQlError[];
}

/**
 * Shared by both entry points below. `authorizationHeader` is the literal header value (already
 * `Bearer ...`) or `undefined` — `undefined` here is what actually omits the header from the
 * request, since `fetch`'s `headers` object only sends the keys it is given. Kept `POST` always:
 * GL-105 is retiring GET-with-an-operation on `/graphql` in this same batch because a token in a
 * URL is a leaked capability, and this function is the one place that decision could be
 * accidentally undone for either caller.
 */
async function executeGraphqlRequest<TData>(
  query: string,
  variables: Record<string, unknown> | undefined,
  authorizationHeader: string | undefined,
): Promise<TData> {
  let response: Response;
  try {
    response = await fetch(graphqlUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(authorizationHeader
          ? { Authorization: authorizationHeader }
          : {}),
      },
      body: JSON.stringify({ query, variables }),
    });
  } catch (cause) {
    throw new GraphQlTransportError("Could not reach GiftList.", {
      cause,
    });
  }

  // A GraphQL error response is still valid JSON with its own `errors` array — checked before
  // `response.ok` so a well-formed 4xx/5xx GraphQL error (HotChocolate can send either) surfaces
  // its actual code/message rather than the generic transport message below.
  let body: GraphQlResponseBody<TData>;
  try {
    body = (await response.json()) as GraphQlResponseBody<TData>;
  } catch (cause) {
    throw new GraphQlTransportError(
      `GiftList returned an unreadable response (HTTP ${response.status}).`,
      { cause },
    );
  }

  if (body.errors && body.errors.length > 0) {
    throw new GraphQlRequestError(body.errors);
  }

  if (!response.ok || body.data === undefined || body.data === null) {
    throw new GraphQlTransportError(
      `GiftList request failed (HTTP ${response.status}).`,
    );
  }

  return body.data;
}

/** The owner-facing entry point — always sends a real `Authorization: Bearer <accessToken>`. */
export async function graphqlRequest<TData>(
  accessToken: string,
  query: string,
  variables?: Record<string, unknown>,
): Promise<TData> {
  return executeGraphqlRequest<TData>(query, variables, `Bearer ${accessToken}`);
}

/**
 * The guest entry point — `sharedGiftList(token)` only. Sends no `Authorization` header at all;
 * see this file's header comment for why that is a sibling function rather than an optional
 * parameter on {@link graphqlRequest}.
 */
export async function graphqlRequestAnonymous<TData>(
  query: string,
  variables?: Record<string, unknown>,
): Promise<TData> {
  return executeGraphqlRequest<TData>(query, variables, undefined);
}
