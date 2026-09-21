import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchSharedGiftList } from "./sharedGiftListQueries";
import { graphqlRequestAnonymous } from "../../giftlists/api/graphqlClient";

vi.mock("../../giftlists/api/graphqlClient", () => ({
  graphqlRequestAnonymous: vi.fn(),
}));

const graphqlRequestAnonymousMock = vi.mocked(graphqlRequestAnonymous);

describe("fetchSharedGiftList", () => {
  afterEach(() => {
    graphqlRequestAnonymousMock.mockReset();
  });

  it("FetchSharedGiftList_ShouldNeverSelectOwnerIdOrShareTokenOrCreatedAt_RegardlessOfWhatThePageRenders", async () => {
    // Arrange — SharedGiftListView (Gateway.Application/GiftLists/ViewGiftList) has no
    // ownerId/shareToken/createdAt field at all; a query that selects one fails against the real
    // schema outright. A test that only asserts the fields this page renders would pass just as
    // happily under a query that *also* selected one of these — this asserts the query text
    // itself instead, by name, so it fails the moment any of the three is added back.
    graphqlRequestAnonymousMock.mockResolvedValue({
      sharedGiftList: {
        listId: "list-1",
        name: "Birthday Wishlist",
        expiresAt: new Date().toISOString(),
        items: [],
      },
    });

    // Act
    await fetchSharedGiftList("share-token-1");

    // Assert
    const [query] = graphqlRequestAnonymousMock.mock.calls[0];
    expect(query).not.toMatch(/\bownerId\b/);
    expect(query).not.toMatch(/\bshareToken\b/);
    expect(query).not.toMatch(/\bcreatedAt\b/);
  });

  it("FetchSharedGiftList_ShouldSelectReserved_OnEveryItem", async () => {
    // Arrange — GL-40: the reserve buttons need to know which items are already taken. Asserted
    // by name, same reasoning as the previous test: a query that happened to omit `reserved`
    // would still satisfy any test that only checks the fields the page currently renders.
    graphqlRequestAnonymousMock.mockResolvedValue({
      sharedGiftList: {
        listId: "list-1",
        name: "Birthday Wishlist",
        expiresAt: new Date().toISOString(),
        items: [],
      },
    });

    // Act
    await fetchSharedGiftList("share-token-1");

    // Assert
    const [query] = graphqlRequestAnonymousMock.mock.calls[0];
    expect(query).toMatch(/\breserved\b/);
  });

  it("FetchSharedGiftList_ShouldCallTheAnonymousTransport_WithTheShareTokenAsAVariable", async () => {
    // Arrange — never the authenticated `graphqlRequest`; a guest holds no access token.
    graphqlRequestAnonymousMock.mockResolvedValue({
      sharedGiftList: {
        listId: "list-1",
        name: "Birthday Wishlist",
        expiresAt: new Date().toISOString(),
        items: [],
      },
    });

    // Act
    await fetchSharedGiftList("share-token-1");

    // Assert
    expect(graphqlRequestAnonymousMock).toHaveBeenCalledWith(
      expect.stringContaining("sharedGiftList"),
      { token: "share-token-1" },
    );
  });

  it("FetchSharedGiftList_ShouldReturnTheGiftListFromTheResponse_WhenTheRequestSucceeds", async () => {
    // Arrange
    const giftList = {
      listId: "list-1",
      name: "Birthday Wishlist",
      expiresAt: new Date().toISOString(),
      items: [
        {
          itemId: "item-1",
          name: "Headphones",
          description: null,
          url: null,
          reserved: false,
        },
      ],
    };
    graphqlRequestAnonymousMock.mockResolvedValue({ sharedGiftList: giftList });

    // Act
    const result = await fetchSharedGiftList("share-token-1");

    // Assert
    expect(result).toEqual(giftList);
  });
});
