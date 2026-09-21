/**
 * The GL-32 `sharedGiftList(token)` GraphQL query, for the anonymous guest view (GL-33).
 *
 * Its own field set and its own TypeScript type — deliberately not a reuse of
 * `giftlists/api/giftListQueries.ts`'s `GIFT_LIST_FIELDS`/`GiftListProjection`. That type selects
 * `ownerId`, `shareToken` and `createdAt`; `SharedGiftListView` (the Gateway's actual response
 * type, `Gateway.Application/GiftLists/ViewGiftList/SharedGiftListView.cs`) has no field for any
 * of the three — omitted by construction, not hidden at the resolver, per that type's own doc
 * comment. Selecting a field the schema doesn't have fails the query outright, so widening the
 * owner type to serve both surfaces would either break this query or (worse, if the schema ever
 * grew those fields back for some other reason) start leaking them here silently. `items` is its
 * own type, `SharedGiftItem` — since GL-38 the guest's item carries `reserved` (a plain boolean,
 * and the only reservation fact this system ever surfaces to anyone,
 * `Gateway.Application/GiftLists/ViewGiftList/SharedGiftItemView.cs`'s own doc comment), which
 * `GiftItemProjection` (the owner type) must never grow — so the two stay separate types rather
 * than one reused across both surfaces, and this file keeps no import-time dependency on the
 * owner query module at all.
 */
import { graphqlRequestAnonymous } from "../../giftlists/api/graphqlClient";

export interface SharedGiftItem {
  itemId: string;
  name: string;
  description: string | null;
  url: string | null;
  /**
   * The only reservation fact this system ever surfaces to anyone (ARCHITECTURE.md "Nobody can
   * see *who* reserved": "the guest view returns `reserved: boolean` per item and nothing more").
   * Never a timestamp, never an id, never anything that could correlate two reservations to one
   * person — see `SharedGiftItemView`'s own doc comment on the Gateway side for the whole list of
   * what this field will never grow.
   */
  reserved: boolean;
}

export interface SharedGiftListView {
  listId: string;
  name: string;
  /** ISO-8601, HotChocolate's default `DateTime` scalar serialization. Present so the client can
   * render list state (expired-but-visible, ARCHITECTURE.md "Auth & sharing") — GL-42 is the
   * ticket that actually renders the expired banner and disables reserving from this field. */
  expiresAt: string;
  items: SharedGiftItem[];
}

const SHARED_GIFT_LIST_QUERY = `
  query($token: String!) {
    sharedGiftList(token: $token) {
      listId
      name
      expiresAt
      items { itemId name description url reserved }
    }
  }
`;

export async function fetchSharedGiftList(
  shareToken: string,
): Promise<SharedGiftListView> {
  const data = await graphqlRequestAnonymous<{
    sharedGiftList: SharedGiftListView;
  }>(SHARED_GIFT_LIST_QUERY, { token: shareToken });
  return data.sharedGiftList;
}
