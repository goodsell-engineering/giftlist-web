import { describe, expect, it } from "vitest";

import { render, screen } from "../test/render";
import { LoadingScreen } from "./LoadingScreen";

describe("LoadingScreen", () => {
  it("LoadingScreen_ShouldRenderTheDefaultMessage_WhenNoneIsProvided", () => {
    // Arrange — no arrangement beyond the default render itself.

    // Act
    render(<LoadingScreen />);

    // Assert
    expect(screen.getByText("Loading…")).toBeInTheDocument();
  });

  it("LoadingScreen_ShouldRenderACustomMessage_WhenOneIsProvided", () => {
    // Arrange — no arrangement beyond the `message` prop itself.

    // Act
    render(<LoadingScreen message="Loading your gift lists…" />);

    // Assert
    expect(screen.getByText("Loading your gift lists…")).toBeInTheDocument();
    expect(screen.queryByText("Loading…")).not.toBeInTheDocument();
  });

  it("LoadingScreen_ShouldRenderTheBrandAndTopBarRightSlot_Always", () => {
    // Arrange — GL-42: two callers (`ShareTokenPage`'s "checking" branch and `SharedListPage`'s
    // own "loading" branch) render this component so their loading screens are indistinguishable
    // from one another; both depend on the same `TopBar` (brand + slot) being rendered underneath.
    const topBarRight = <span>Log in</span>;

    // Act
    render(<LoadingScreen topBarRight={topBarRight} />);

    // Assert
    expect(screen.getByText("GiftList")).toBeInTheDocument();
    expect(screen.getByText("Log in")).toBeInTheDocument();
  });
});
