import { describe, expect, it } from "vitest";

import { render, screen } from "../test/render";
import { AuthCard } from "./AuthCard";

describe("AuthCard", () => {
  it("AuthCard_ShouldRenderItsChildren_WhenGivenAnyChildren", () => {
    // Arrange — no arrangement beyond the children themselves.

    // Act
    render(
      <AuthCard>
        <h1>Welcome back</h1>
      </AuthCard>,
    );

    // Assert
    expect(
      screen.getByRole("heading", { name: "Welcome back" }),
    ).toBeInTheDocument();
  });
});
