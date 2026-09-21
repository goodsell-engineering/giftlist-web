/**
 * A minimal, hand-rolled `graphql-transport-ws` client for the Gateway's one subscription field,
 * `sharedGiftListChanged(token)` (GL-38) — the WebSocket counterpart of
 * `giftlists/api/graphqlClient.ts`'s `graphqlRequestAnonymous`, following that file's own stated
 * design decision not to take on a GraphQL client library: one subscription exists, so a client
 * library and its transport adapter would be more machinery than the four message types this
 * protocol actually needs (`connection_init`/`connection_ack`, `subscribe`, `next`/`error`/
 * `complete`) — the same reasoning `Gateway.IntegrationTests/Support/GraphQlSubscriptionClient.cs`
 * gives for hand-rolling the server-side test double of this exact protocol.
 *
 * Anonymous, like `graphqlRequestAnonymous` — no `Authorization` header or init payload is ever
 * sent, because the share token carried as the subscription's own `token` variable is the whole
 * credential (ARCHITECTURE.md "Auth & sharing"), exactly as it is for the query.
 *
 * `createWebSocket` is an injectable seam, not an implementation detail: jsdom's `WebSocket`
 * cannot open a real socket in a test environment, so every test in
 * `sharedGiftListSubscription.test.ts` supplies a fake one instead of touching the network — the
 * same reason `giftListsClient.ts`/`authClient.ts` inject a `transport` rather than reaching for a
 * module-level real one directly in a way nothing could ever substitute.
 */
import {
  GraphQlRequestError,
  type GraphQlError,
} from "../../giftlists/api/graphqlClient";
import {
  describeSharedGiftListReadError,
  type SharedGiftListReadErrorInfo,
} from "./sharedGiftListErrors";
import type { SharedGiftListView } from "./sharedGiftListQueries";

const gatewayUrl = import.meta.env.VITE_GATEWAY_URL ?? "http://localhost:8080";
// `graphqlRequestAnonymous` builds `${gatewayUrl}/graphql` over http(s); WebSocket needs the same
// path over ws(s) instead — a plain prefix swap, since `gatewayUrl` never carries a scheme other
// than http/https (see graphqlClient.ts's own doc comment on where that value comes from).
const graphqlWebSocketUrl = `${gatewayUrl.replace(/^http/, "ws")}/graphql`;

const SUBSCRIPTION_PROTOCOL = "graphql-transport-ws";

// The one operation id this client ever sends — one subscription per socket, never multiplexed,
// so there is nothing an id needs to disambiguate.
const SUBSCRIPTION_ID = "1";

const SHARED_GIFT_LIST_CHANGED_SUBSCRIPTION = `
  subscription($token: String!) {
    sharedGiftListChanged(token: $token) {
      listId
      name
      expiresAt
      items { itemId name description url reserved }
    }
  }
`;

export interface SharedGiftListChangedHandlers {
  onData: (view: SharedGiftListView) => void;
  onError: (info: SharedGiftListReadErrorInfo) => void;
}

export interface SharedGiftListSubscription {
  close: () => void;
}

type WebSocketFactory = (url: string, protocols: string[]) => WebSocket;

const defaultWebSocketFactory: WebSocketFactory = (url, protocols) =>
  new WebSocket(url, protocols);

interface ProtocolMessage {
  type: string;
  id?: string;
  payload?: unknown;
}

function send(socket: WebSocket, message: ProtocolMessage): void {
  socket.send(JSON.stringify(message));
}

/**
 * Opens one `sharedGiftListChanged(token)` subscription and calls `handlers.onData` with the
 * pushed guest view every time the server sends one, until `close()` is called. Never throws —
 * every failure this protocol can produce (a bad token at subscribe time, a dropped socket) is
 * reported through `handlers.onError` instead, the same `SharedGiftListReadErrorInfo` shape the
 * query's own `describeSharedGiftListReadError` produces, so a caller does not need a second error
 * vocabulary for the live channel.
 */
export function subscribeToSharedGiftListChanged(
  shareToken: string,
  handlers: SharedGiftListChangedHandlers,
  createWebSocket: WebSocketFactory = defaultWebSocketFactory,
): SharedGiftListSubscription {
  let closed = false;
  const socket = createWebSocket(graphqlWebSocketUrl, [SUBSCRIPTION_PROTOCOL]);

  socket.addEventListener("open", () => {
    send(socket, { type: "connection_init" });
  });

  socket.addEventListener("message", (event) => {
    if (closed) {
      return;
    }

    let message: ProtocolMessage;
    try {
      message = JSON.parse(event.data as string) as ProtocolMessage;
    } catch {
      // Not a frame this protocol recognises — ignored rather than crashing a live channel over
      // one malformed message.
      return;
    }

    switch (message.type) {
      case "connection_ack": {
        send(socket, {
          id: SUBSCRIPTION_ID,
          type: "subscribe",
          payload: {
            query: SHARED_GIFT_LIST_CHANGED_SUBSCRIPTION,
            variables: { token: shareToken },
          },
        });
        return;
      }

      case "next": {
        const payload = message.payload as
          | { data?: { sharedGiftListChanged?: SharedGiftListView }; errors?: GraphQlError[] }
          | undefined;
        if (payload?.data?.sharedGiftListChanged) {
          handlers.onData(payload.data.sharedGiftListChanged);
          return;
        }
        if (payload?.errors && payload.errors.length > 0) {
          handlers.onError(
            describeSharedGiftListReadError(new GraphQlRequestError(payload.errors)),
          );
        }
        return;
      }

      case "error": {
        const errors = (message.payload as GraphQlError[] | undefined) ?? [];
        handlers.onError(
          describeSharedGiftListReadError(new GraphQlRequestError(errors)),
        );
        return;
      }

      case "complete":
      default:
        return;
    }
  });

  socket.addEventListener("error", () => {
    // A transport-level failure (the socket never connected, or dropped mid-stream) carries no
    // GraphQL error payload for this mapper to read a code out of — reported the same way
    // graphqlRequestAnonymous's own transport failures are, via the "unavailable" kind, rather
    // than left silent.
    handlers.onError({
      kind: "unavailable",
      message: "GiftList is temporarily unavailable. Please try again shortly.",
    });
  });

  return {
    close: () => {
      closed = true;
      if (
        socket.readyState === WebSocket.OPEN ||
        socket.readyState === WebSocket.CONNECTING
      ) {
        socket.close();
      }
    },
  };
}
