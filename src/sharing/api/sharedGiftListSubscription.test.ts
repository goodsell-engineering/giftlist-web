import { describe, expect, it, vi } from "vitest";

import { subscribeToSharedGiftListChanged } from "./sharedGiftListSubscription";
import type { SharedGiftListView } from "./sharedGiftListQueries";

type Listener = (event: { data?: string }) => void;

/**
 * A fake `WebSocket` — jsdom's real one cannot open an actual connection (there is no server in a
 * unit test), so every test here drives this instead, exactly the seam
 * `sharedGiftListSubscription.ts`'s own header explains `createWebSocket` exists for.
 */
class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readyState = FakeWebSocket.CONNECTING;
  sent: unknown[] = [];
  closeCalls = 0;
  private readonly listeners = new Map<string, Listener[]>();

  addEventListener(type: string, handler: Listener) {
    const list = this.listeners.get(type) ?? [];
    list.push(handler);
    this.listeners.set(type, list);
  }

  send(data: string) {
    this.sent.push(JSON.parse(data));
  }

  close() {
    this.closeCalls += 1;
    this.readyState = FakeWebSocket.CLOSED;
  }

  // Test helpers, not part of the WebSocket interface — drive the fake from "outside".
  emitOpen() {
    this.readyState = FakeWebSocket.OPEN;
    this.dispatch("open", {});
  }

  emitMessage(payload: unknown) {
    this.dispatch("message", { data: JSON.stringify(payload) });
  }

  emitRawMessage(data: string) {
    this.dispatch("message", { data });
  }

  emitError() {
    this.dispatch("error", {});
  }

  private dispatch(type: string, event: { data?: string }) {
    for (const handler of this.listeners.get(type) ?? []) {
      handler(event);
    }
  }
}

function createHarness() {
  const socket = new FakeWebSocket();
  const factory = vi.fn().mockReturnValue(socket as unknown as WebSocket);
  const onData = vi.fn();
  const onError = vi.fn();
  const subscription = subscribeToSharedGiftListChanged(
    "share-token-1",
    { onData, onError },
    factory,
  );
  return { socket, factory, onData, onError, subscription };
}

function aSharedGiftListView(
  overrides: Partial<SharedGiftListView> = {},
): SharedGiftListView {
  return {
    listId: "list-1",
    name: "Birthday Wishlist",
    expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    items: [],
    ...overrides,
  };
}

describe("subscribeToSharedGiftListChanged", () => {
  it("SubscribeToSharedGiftListChanged_ShouldConnectWithTheGraphQlTransportWsSubprotocol", () => {
    // Arrange / Act
    const { factory } = createHarness();

    // Assert — the exact subprotocol HotChocolate's MapGraphQL speaks
    // (Gateway.IntegrationTests/Support/GraphQlSubscriptionClient.cs's own precedent).
    expect(factory).toHaveBeenCalledWith(
      expect.stringMatching(/\/graphql$/),
      ["graphql-transport-ws"],
    );
  });

  it("SubscribeToSharedGiftListChanged_ShouldSendConnectionInit_WhenTheSocketOpens", () => {
    // Arrange
    const { socket } = createHarness();

    // Act
    socket.emitOpen();

    // Assert
    expect(socket.sent).toEqual([{ type: "connection_init" }]);
  });

  it("SubscribeToSharedGiftListChanged_ShouldSendSubscribeWithTheShareToken_AfterConnectionAck", () => {
    // Arrange
    const { socket } = createHarness();
    socket.emitOpen();

    // Act
    socket.emitMessage({ type: "connection_ack" });

    // Assert
    const subscribeMessage = socket.sent[1] as {
      id: string;
      type: string;
      payload: { query: string; variables: { token: string } };
    };
    expect(subscribeMessage.type).toBe("subscribe");
    expect(subscribeMessage.payload.variables).toEqual({
      token: "share-token-1",
    });
    expect(subscribeMessage.payload.query).toContain("sharedGiftListChanged");
  });

  it("SubscribeToSharedGiftListChanged_ShouldCallOnData_WhenANextMessageCarriesTheGuestView", () => {
    // Arrange
    const { socket, onData } = createHarness();
    socket.emitOpen();
    socket.emitMessage({ type: "connection_ack" });
    const view = aSharedGiftListView({
      items: [
        {
          itemId: "item-1",
          name: "Headphones",
          description: null,
          url: null,
          reserved: true,
        },
      ],
    });

    // Act
    socket.emitMessage({
      type: "next",
      id: "1",
      payload: { data: { sharedGiftListChanged: view } },
    });

    // Assert
    expect(onData).toHaveBeenCalledWith(view);
  });

  it("SubscribeToSharedGiftListChanged_ShouldCallOnErrorWithInvalidToken_WhenTheSubscribeTimeErrorCarriesThatCode", () => {
    // Arrange — SharedGiftListSubscriptionTests' own server-side precedent: a malformed token
    // fails at subscribe time with `gateway.invalid_share_token`, delivered as a top-level
    // `error` message.
    const { socket, onError } = createHarness();
    socket.emitOpen();

    // Act
    socket.emitMessage({
      type: "error",
      id: "1",
      payload: [
        {
          message: "A share token must be 21 alphanumeric characters.",
          extensions: { code: "BAD_USER_INPUT", errorCode: "gateway.invalid_share_token" },
        },
      ],
    });

    // Assert
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "invalid-token" }),
    );
  });

  it("SubscribeToSharedGiftListChanged_ShouldCallOnErrorWithNotFound_WhenANextMessageCarriesErrorsAndNoData", () => {
    // Arrange
    const { socket, onError } = createHarness();
    socket.emitOpen();
    socket.emitMessage({ type: "connection_ack" });

    // Act
    socket.emitMessage({
      type: "next",
      id: "1",
      payload: {
        errors: [
          {
            message: "No gift list exists for this token.",
            extensions: { code: "NOT_FOUND", errorCode: "gateway.not_found" },
          },
        ],
      },
    });

    // Assert
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "not-found" }),
    );
  });

  it("SubscribeToSharedGiftListChanged_ShouldCallOnErrorWithUnavailable_WhenTheSocketReportsATransportError", () => {
    // Arrange
    const { socket, onError } = createHarness();

    // Act
    socket.emitError();

    // Assert
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "unavailable" }),
    );
  });

  it("SubscribeToSharedGiftListChanged_ShouldIgnoreAMalformedMessage_RatherThanThrow", () => {
    // Arrange
    const { socket, onData, onError } = createHarness();
    socket.emitOpen();

    // Act
    const act = () => socket.emitRawMessage("not json");

    // Assert
    expect(act).not.toThrow();
    expect(onData).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it("SubscribeToSharedGiftListChanged_ShouldCloseTheSocket_WhenCloseIsCalled", () => {
    // Arrange
    const { socket, subscription } = createHarness();
    socket.emitOpen();

    // Act
    subscription.close();

    // Assert
    expect(socket.closeCalls).toBe(1);
  });

  it("SubscribeToSharedGiftListChanged_ShouldStopCallingOnData_AfterCloseIsCalled", () => {
    // Arrange — race-safety at the socket layer: a message that was already in flight when
    // `close()` ran must not update state for a component that has since unmounted.
    const { socket, onData, subscription } = createHarness();
    socket.emitOpen();
    socket.emitMessage({ type: "connection_ack" });

    // Act
    subscription.close();
    socket.emitMessage({
      type: "next",
      id: "1",
      payload: { data: { sharedGiftListChanged: aSharedGiftListView() } },
    });

    // Assert
    expect(onData).not.toHaveBeenCalled();
  });
});
