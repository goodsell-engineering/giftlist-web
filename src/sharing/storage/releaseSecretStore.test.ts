import { afterEach, describe, expect, it, vi } from "vitest";

import { hasReleaseSecret, saveReleaseSecret } from "./releaseSecretStore";

describe("releaseSecretStore", () => {
  afterEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it("HasReleaseSecret_ShouldReturnFalse_WhenNothingHasBeenSaved", () => {
    // Arrange — nothing.

    // Act
    const result = hasReleaseSecret("share-token-1", "item-1");

    // Assert
    expect(result).toBe(false);
  });

  it("HasReleaseSecret_ShouldReturnTrue_WhenSaveReleaseSecretWasCalledForTheSameShareTokenAndItem", () => {
    // Arrange
    saveReleaseSecret("share-token-1", "item-1", "secret-abc");

    // Act
    const result = hasReleaseSecret("share-token-1", "item-1");

    // Assert
    expect(result).toBe(true);
  });

  it("HasReleaseSecret_ShouldReturnFalse_WhenTheSecretWasSavedForADifferentShareToken", () => {
    // Arrange — keyed on (shareToken, itemId), not itemId alone: item ids are not guaranteed
    // unique across lists.
    saveReleaseSecret("share-token-1", "item-1", "secret-abc");

    // Act
    const result = hasReleaseSecret("share-token-2", "item-1");

    // Assert
    expect(result).toBe(false);
  });

  it("HasReleaseSecret_ShouldReturnFalse_WhenTheSecretWasSavedForADifferentItem", () => {
    // Arrange
    saveReleaseSecret("share-token-1", "item-1", "secret-abc");

    // Act
    const result = hasReleaseSecret("share-token-1", "item-2");

    // Assert
    expect(result).toBe(false);
  });

  it("SaveReleaseSecret_ShouldWriteOnlyToLocalStorage_NeverToNetworkOrConsole", () => {
    // Arrange — ARCHITECTURE.md "Nobody can see *who* reserved": `releaseSecret` travels only to
    // this browser's localStorage. `fetch` and every console method are spied on so a call to
    // either would fail this test — the strongest assertion this file can make about "never sent,
    // never logged" from the browser side alone.
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem");

    // Act
    saveReleaseSecret("share-token-1", "item-1", "super-secret-value");

    // Assert
    expect(setItemSpy).toHaveBeenCalledWith(
      "giftlist:reservation:share-token-1:item-1",
      "super-secret-value",
    );
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(logSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("HasReleaseSecret_ShouldReturnFalse_WhenLocalStorageThrows", () => {
    // Arrange — private browsing / a locked-down embed / a full quota. Reserving itself must not
    // depend on this succeeding (this file's own header), so a throw here degrades to "this
    // browser doesn't remember" rather than propagating.
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("blocked");
    });

    // Act
    const result = hasReleaseSecret("share-token-1", "item-1");

    // Assert
    expect(result).toBe(false);
  });

  it("SaveReleaseSecret_ShouldNotThrow_WhenLocalStorageThrows", () => {
    // Arrange
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("blocked");
    });

    // Act
    const act = () => saveReleaseSecret("share-token-1", "item-1", "secret");

    // Assert
    expect(act).not.toThrow();
  });
});
