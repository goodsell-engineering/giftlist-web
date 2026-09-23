import { afterEach, describe, expect, it, vi } from "vitest";

import { hasReleaseSecret, saveReleaseSecret } from "./releaseSecretStore";
import { aShareToken } from "../../test/shareTokens";

describe("releaseSecretStore", () => {
  afterEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it("HasReleaseSecret_ShouldReturnFalse_WhenNothingHasBeenSaved", () => {
    // Arrange — nothing.

    // Act
    const result = hasReleaseSecret(aShareToken(), "item-1");

    // Assert
    expect(result).toBe(false);
  });

  it("HasReleaseSecret_ShouldReturnTrue_WhenSaveReleaseSecretWasCalledForTheSameShareTokenAndItem", () => {
    // Arrange
    saveReleaseSecret(aShareToken(), "item-1", "secret-abc");

    // Act
    const result = hasReleaseSecret(aShareToken(), "item-1");

    // Assert
    expect(result).toBe(true);
  });

  it("HasReleaseSecret_ShouldReturnFalse_WhenTheSecretWasSavedForADifferentShareToken", () => {
    // Arrange — keyed on (shareToken, itemId), not itemId alone: item ids are not guaranteed
    // unique across lists.
    saveReleaseSecret(aShareToken(), "item-1", "secret-abc");

    // Act
    const result = hasReleaseSecret(aShareToken("2"), "item-1");

    // Assert
    expect(result).toBe(false);
  });

  it("HasReleaseSecret_ShouldReturnFalse_WhenTheSecretWasSavedForADifferentItem", () => {
    // Arrange
    saveReleaseSecret(aShareToken(), "item-1", "secret-abc");

    // Act
    const result = hasReleaseSecret(aShareToken(), "item-2");

    // Assert
    expect(result).toBe(false);
  });

  it("SaveReleaseSecret_ShouldWriteToLocalStorage_UnderTheShareTokenAndItemIdKey", () => {
    // Arrange — GL-119 (Batch review): this test used to also spy on `fetch` and every console
    // method, on the theory that doing so here proved `releaseSecret` is "never sent, never
    // logged". It doesn't: this function trivially cannot do either — a reviewer's mutation probe
    // (`console.log("secret", response.releaseSecret)` in `useReserveGift.ts`'s own success path,
    // *before* this function is ever called) left this test, and every other one of this repo's
    // sharing tests, green. That guarantee now lives in
    // `useReserveGift.test.ts` ("...ShouldNeverSendOrLogTheReleaseSecret..."), bracketing the path
    // where the secret first arrives off the wire. This test keeps only what this function can
    // actually prove: the exact key it writes.
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem");

    // Act
    saveReleaseSecret(aShareToken(), "item-1", "super-secret-value");

    // Assert
    expect(setItemSpy).toHaveBeenCalledWith(
      `giftlist:reservation:${aShareToken()}:item-1`,
      "super-secret-value",
    );
  });

  it("HasReleaseSecret_ShouldReturnFalse_WhenLocalStorageThrows", () => {
    // Arrange — private browsing / a locked-down embed / a full quota. Reserving itself must not
    // depend on this succeeding (this file's own header), so a throw here degrades to "this
    // browser doesn't remember" rather than propagating.
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("blocked");
    });

    // Act
    const result = hasReleaseSecret(aShareToken(), "item-1");

    // Assert
    expect(result).toBe(false);
  });

  it("SaveReleaseSecret_ShouldNotThrow_WhenLocalStorageThrows", () => {
    // Arrange
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("blocked");
    });

    // Act
    const act = () => saveReleaseSecret(aShareToken(), "item-1", "secret");

    // Assert
    expect(act).not.toThrow();
  });
});
