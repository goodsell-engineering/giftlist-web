import { describe, expect, it } from "vitest";

import { priorityLevelName } from "./priorityLevels";

describe("priorityLevelName", () => {
  it.each([
    [1, "Nice to have"],
    [2, "Would like"],
    [3, "Want"],
    [4, "Really want"],
    [5, "Would love"],
  ])(
    "PriorityLevelName_ShouldReturnTheLevelName_ForEachValueFrom1To5 (%i)",
    (value, name) => {
      // Act
      const result = priorityLevelName(value);

      // Assert
      expect(result).toBe(name);
    },
  );

  it.each([0, -3])(
    "PriorityLevelName_ShouldClampToNiceToHave_WhenTheValueIsBelow1 (%i)",
    (value) => {
      // Act
      const result = priorityLevelName(value);

      // Assert
      expect(result).toBe("Nice to have");
    },
  );

  it.each([6, 99])(
    "PriorityLevelName_ShouldClampToWouldLove_WhenTheValueIsAbove5 (%i)",
    (value) => {
      // Act
      const result = priorityLevelName(value);

      // Assert
      expect(result).toBe("Would love");
    },
  );

  it.each([Number.NaN, undefined as unknown as number])(
    "PriorityLevelName_ShouldReadAsWant_WhenTheValueIsNotAFiniteNumber (%s)",
    (value) => {
      // Act
      const result = priorityLevelName(value);

      // Assert
      expect(result).toBe("Want");
    },
  );
});
