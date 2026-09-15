/**
 * A minimal, hand-rolled GraphQL request function for the Gateway's one `/graphql` endpoint
 * (GL-23's `myGiftLists`/`giftList(id)`) — not a client library.
 *
 * Design decision (GL-24): package.json deliberately gains no GraphQL client dependency (Apollo
 * Client, urql, graphql-request, ...). This SPA issues exactly two named, read-only queries
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
 * If a third query, a write surface, or an actual caching/dedup requirement shows up later,
 * revisit this decision rather than growing this file into a bespoke client framework.
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

export async function graphqlRequest<TData>(
  accessToken: string,
  query: string,
  variables?: Record<string, unknown>,
): Promise<TData> {
  let response: Response;
  try {
    response = await fetch(graphqlUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
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
