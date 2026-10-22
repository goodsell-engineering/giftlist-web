import { describe, expect, it } from "vitest";

import { render, screen } from "../test/render";
import { elementsWithExactTextContent } from "../test/textContent";
import { PriorityBadge } from "./PriorityBadge";

describe("PriorityBadge", () => {
  it("PriorityBadge_ShouldHaveTextContentPriorityColonLevelName_AndShowNoDigit", () => {
    // Arrange
    const { container } = render(<PriorityBadge priority={4} />);

    // Act
    const matches = elementsWithExactTextContent(
      container,
      "Priority: Really want",
    );

    // Assert
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].textContent).not.toMatch(/\d/);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
