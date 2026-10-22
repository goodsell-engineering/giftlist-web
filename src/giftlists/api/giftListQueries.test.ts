import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchGiftList } from "./giftListQueries";
import { graphqlRequest } from "./graphqlClient";

vi.mock("./graphqlClient", () => ({
  graphqlRequest: vi.fn(),
}));

const graphqlRequestMock = vi.mocked(graphqlRequest);

describe("fetchGiftList", () => {
  afterEach(() => {
    graphqlRequestMock.mockReset();
  });

  async function sentQuery(): Promise<string> {
    graphqlRequestMock.mockResolvedValue({ giftList: { items: [] } });
    await fetchGiftList("token", "list-1");
    return graphqlRequestMock.mock.calls[0][1];
  }

  it("FetchGiftList_ShouldSelectPriority_OnEveryItem", async () => {
    // Arrange / Act
    const query = await sentQuery();

    // Assert
    expect(query).toMatch(/items\s*\{[^}]*\bpriority\b[^}]*\}/);
  });

  it("FetchGiftList_ShouldNeverSelectReserved_OnAnyItem", async () => {
    // Arrange / Act
    const query = await sentQuery();

    // Assert — the owner's read model has no reservation field to select.
    expect(query).not.toMatch(/reserved/i);
  });
});
