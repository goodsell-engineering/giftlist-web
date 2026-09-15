import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import RequireAuth from "./RequireAuth";
import { AuthContext, type AuthContextValue } from "./authContext";

function renderWithSession(session: AuthContextValue["session"]) {
  const value: AuthContextValue = {
    session,
    signUp: async () => {},
    logIn: async () => {},
    logOut: () => {},
  };

  return render(
    <AuthContext.Provider value={value}>
      <MemoryRouter initialEntries={["/dashboard"]}>
        <Routes>
          <Route path="/login" element={<div>Log in page</div>} />
          <Route
            path="/dashboard"
            element={
              <RequireAuth>
                <div>Protected dashboard</div>
              </RequireAuth>
            }
          />
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
  );
}

describe("RequireAuth", () => {
  it("RequireAuth_ShouldRedirectToLogin_WhenThereIsNoSession", () => {
    // Arrange — no arrangement beyond the null session itself.

    // Act
    renderWithSession(null);

    // Assert
    expect(screen.getByText("Log in page")).toBeInTheDocument();
    expect(screen.queryByText("Protected dashboard")).not.toBeInTheDocument();
  });

  it("RequireAuth_ShouldRenderChildren_WhenASessionExists", () => {
    // Arrange
    const session = {
      userId: "user-1",
      accessToken: "token",
      accessTokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
    };

    // Act
    renderWithSession(session);

    // Assert
    expect(screen.getByText("Protected dashboard")).toBeInTheDocument();
    expect(screen.queryByText("Log in page")).not.toBeInTheDocument();
  });

  it("RequireAuth_ShouldRedirectToLogin_WhenTheSessionHasExpired", () => {
    // Arrange — GL-19 review: accessTokenExpiresAt was stored but never checked, so an expired
    // session used to render the protected route anyway. This is the test that would have caught
    // that: it fails if the expiry comparison in RequireAuth is removed.
    const session = {
      userId: "user-1",
      accessToken: "token",
      accessTokenExpiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
    };

    // Act
    renderWithSession(session);

    // Assert
    expect(screen.getByText("Log in page")).toBeInTheDocument();
    expect(screen.queryByText("Protected dashboard")).not.toBeInTheDocument();
  });
});
