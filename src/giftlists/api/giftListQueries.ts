/**
 * The two GL-23 GraphQL queries this SPA reads from, plus the shapes they return. Field
 * selections mirror gateway/tests/Gateway.IntegrationTests/Support/GiftListGraphQlQueries.cs
 * exactly (that file is the nearest thing this project has to a schema fixture) — deliberately no
 * `reserved`/`reservedBy`/similar field on `GiftItemProjection`: the owner's read model has no
 * such field to select (ARCHITECTURE.md "Reservation privacy", GiftItemProjection.cs's own doc comment), so there is
 * nothing here to accidentally wire up later.
 */
import { graphqlRequest } from "./graphqlClient";

export interface GiftItemProjection {
  itemId: string;
  name: string;
  description: string | null;
  url: string | null;
}

export interface GiftListProjection {
  listId: string;
  ownerId: string;
  name: string;
  /** ISO-8601, HotChocolate's default `DateTime` scalar serialization. */
  expiresAt: string;
  shareToken: string;
  /** ISO-8601, same scalar as expiresAt. */
  createdAt: string;
  items: GiftItemProjection[];
}

const GIFT_LIST_FIELDS = `
  listId
  ownerId
  name
  expiresAt
  shareToken
  createdAt
  items { itemId name description url }
`;

const MY_GIFT_LISTS_QUERY = `
  query {
    myGiftLists {
      ${GIFT_LIST_FIELDS}
    }
  }
`;

const GIFT_LIST_QUERY = `
  query($id: UUID!) {
    giftList(id: $id) {
      ${GIFT_LIST_FIELDS}
    }
  }
`;

export async function fetchMyGiftLists(
  accessToken: string,
): Promise<GiftListProjection[]> {
  const data = await graphqlRequest<{ myGiftLists: GiftListProjection[] }>(
    accessToken,
    MY_GIFT_LISTS_QUERY,
  );
  return data.myGiftLists;
}

export async function fetchGiftList(
  accessToken: string,
  id: string,
): Promise<GiftListProjection> {
  const data = await graphqlRequest<{ giftList: GiftListProjection }>(
    accessToken,
    GIFT_LIST_QUERY,
    { id },
  );
  return data.giftList;
}
