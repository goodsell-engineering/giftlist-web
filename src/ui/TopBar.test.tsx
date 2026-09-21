import { describe, expect, it } from "vitest";

import { render, screen } from "../test/render";
import { TopBar, TopBarUserMenu } from "./TopBar";

describe("TopBar", () => {
  it("TopBar_ShouldRenderTheBrand_Always", () => {
    // Arrange — no arrangement beyond the default, slot-less render itself.

    // Act
    render(<TopBar />);

    // Assert
    expect(screen.getByText("GiftList")).toBeInTheDocument();
  });

  it("TopBar_ShouldRenderTheRightSlot_WhenOneIsProvided", () => {
    // Arrange — no arrangement beyond the `right` slot's own content.

    // Act
    render(<TopBar right={<TopBarUserMenu displayName="Ada Lovelace" />} />);

    // Assert
    expect(screen.getByText("Ada Lovelace")).toBeInTheDocument();
    expect(screen.getByText("AL")).toBeInTheDocument();
  });
});

describe("TopBarUserMenu", () => {
  it("TopBarUserMenu_ShouldRenderInitialsFromFirstAndLastWord_WhenGivenAMultiWordName", () => {
    // Arrange — no arrangement beyond the multi-word display name itself.

    // Act
    render(<TopBarUserMenu displayName="Ada Lovelace" />);

    // Assert
    expect(screen.getByText("AL")).toBeInTheDocument();
  });

  it("TopBarUserMenu_ShouldRenderASingleInitial_WhenGivenASingleWordName", () => {
    // Arrange — no arrangement beyond the single-word display name itself.

    // Act
    render(<TopBarUserMenu displayName="Ada" />);

    // Assert
    expect(screen.getByText("A")).toBeInTheDocument();
  });
});
