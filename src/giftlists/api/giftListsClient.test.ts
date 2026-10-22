import { AddGiftItemRequestSchema, GiftListsService } from "@giftlist/gateway-client";
import { describe, expect, it } from "vitest";

describe("giftListsClient", () => {
  it("giftListsClient_ShouldExposeChangeGiftItemPriorityAndAddGiftItemPriority_WhenPinnedToGatewayClient040", () => {
    // Arrange
    const addGiftItemFields = AddGiftItemRequestSchema.fields.map((field) => field.localName);

    // Act
    const methods = Object.keys(GiftListsService.method);

    // Assert
    expect(methods).toContain("changeGiftItemPriority");
    expect(addGiftItemFields).toContain("priority");
  });
});
