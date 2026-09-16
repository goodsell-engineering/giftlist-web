import { afterEach, describe, expect, it, vi } from "vitest";

import {
  graphqlRequest,
  graphqlRequestAnonymous,
  GraphQlRequestError,
  GraphQlTransportError,
} from "./graphqlClient";

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

describe("graphqlRequest / graphqlRequestAnonymous", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("GraphqlRequest_ShouldSendABearerAuthorizationHeader_WhenCalled", async () => {
    // Arrange — the owner-facing entry point must keep sending its real token.
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ data: { ok: true } }));
    vi.stubGlobal("fetch", fetchMock);

    // Act
    await graphqlRequest("token-abc", "query { ok }");

    // Assert
    const [, requestInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = requestInit.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer token-abc");
    expect(requestInit.method).toBe("POST");
  });

  it("GraphqlRequestAnonymous_ShouldSendNoAuthorizationHeaderAtAll_WhenCalled", async () => {
    // Arrange — GL-33: a guest has no access token, and an empty-string Bearer header is not
    // acceptable either. This is the one assertion that would fail if that regressed.
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ data: { ok: true } }));
    vi.stubGlobal("fetch", fetchMock);

    // Act
    await graphqlRequestAnonymous(
      'query { sharedGiftList(token: "t") { listId } }',
    );

    // Assert
    const [, requestInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = requestInit.headers as Record<string, string>;
    expect(headers).not.toHaveProperty("Authorization");
    expect(requestInit.method).toBe("POST");
  });

  it("GraphqlRequestAnonymous_ShouldThrowGraphQlRequestError_WhenTheResponseCarriesErrors", async () => {
    // Arrange
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        errors: [
          {
            message: "This link doesn't look right.",
            extensions: {
              code: "BAD_USER_INPUT",
              errorCode: "gateway.invalid_share_token",
            },
          },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    // Act
    const result = graphqlRequestAnonymous(
      'query { sharedGiftList(token: "t") { listId } }',
    );

    // Assert
    await expect(result).rejects.toBeInstanceOf(GraphQlRequestError);
  });

  it("GraphqlRequestAnonymous_ShouldThrowGraphQlTransportError_WhenFetchItselfFails", async () => {
    // Arrange
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("network down"));
    vi.stubGlobal("fetch", fetchMock);

    // Act
    const result = graphqlRequestAnonymous(
      'query { sharedGiftList(token: "t") { listId } }',
    );

    // Assert
    await expect(result).rejects.toBeInstanceOf(GraphQlTransportError);
  });
});
