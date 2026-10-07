import { describe, expect, it } from "vitest";
import { trimLikeGiftLists } from "./trimLikeGiftLists";

describe("trimLikeGiftLists", () => {
  it("trimLikeGiftLists_ShouldStripLeadingAndTrailingAsciiWhitespace_WhenPresent", () => {
    // Arrange
    const value = " \t Birthday \r\n";

    // Act
    const result = trimLikeGiftLists(value);

    // Assert
    expect(result).toBe("Birthday");
  });

  it("trimLikeGiftLists_ShouldStripNextLineCharacterAtEitherEnd_WhenPresent", () => {
    // Arrange
    const value = "\u0085Birthday\u0085";

    // Act
    const result = trimLikeGiftLists(value);

    // Assert
    expect(result).toBe("Birthday");
  });

  it("trimLikeGiftLists_ShouldKeepInnerWhitespaceAndNextLineCharacter_WhenTrimming", () => {
    // Arrange
    const value = " Birthday  \u0085 List ";

    // Act
    const result = trimLikeGiftLists(value);

    // Assert
    expect(result).toBe("Birthday  \u0085 List");
  });

  it("trimLikeGiftLists_ShouldReturnEmptyString_WhenOnlyWhitespaceAndNextLineCharacters", () => {
    // Arrange
    const value = " \u0085 \t";

    // Act
    const result = trimLikeGiftLists(value);

    // Assert
    expect(result).toBe("");
  });

  it("trimLikeGiftLists_ShouldReturnValueUnchanged_WhenAlreadyTrimmed", () => {
    // Arrange
    const value = "Birthday List";

    // Act
    const result = trimLikeGiftLists(value);

    // Assert
    expect(result).toBe("Birthday List");
  });
});
