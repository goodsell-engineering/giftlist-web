import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { Code, ConnectError } from "@connectrpc/connect";
import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";

import LogInPage from "./LogInPage";
import RequireAuth from "../auth/RequireAuth";
import { AuthProvider } from "../auth/AuthProvider";
import { authClient } from "../api/authClient";
import { LoginResponseSchema } from "@giftlist/gateway-client";

// The real client would fetch over the network — replaced so these tests exercise the page's
// wiring (which fields go where, which error becomes which message) without a server.
vi.mock("../api/authClient", () => ({
  authClient: {
    login: vi.fn(),
    signUp: vi.fn(),
  },
}));

const login = vi.mocked(authClient.login);

// A response the real Gateway would send: accessTokenExpiresAt is always set (see
// AuthProvider.test coverage in AuthProvider's own doc comment) — omitting it here would throw.
function validLoginResponse() {
  return create(LoginResponseSchema, {
    userId: "user-1",
    accessToken: "token-abc",
    accessTokenExpiresAt: timestampFromDate(
      new Date(Date.now() + 60 * 60 * 1000),
    ),
  });
}

function renderLogInPage(initialEntries: string[] = ["/login"]) {
  return render(
    <AuthProvider>
      <MemoryRouter initialEntries={initialEntries}>
        <Routes>
          <Route path="/login" element={<LogInPage />} />
          <Route path="/dashboard" element={<div>Dashboard page</div>} />
          <Route
            path="/lists/:listId"
            element={
              <RequireAuth>
                <div>Protected list page</div>
              </RequireAuth>
            }
          />
        </Routes>
      </MemoryRouter>
    </AuthProvider>,
  );
}

describe("LogInPage", () => {
  beforeEach(() => {
    login.mockReset();
  });

  it("LogInPage_ShouldNavigateToDashboard_WhenLoginSucceeds", async () => {
    // Arrange
    login.mockResolvedValue(validLoginResponse());
    const user = userEvent.setup();
    renderLogInPage();

    // Act
    await user.type(screen.getByLabelText("Email"), "ada@example.com");
    await user.type(
      screen.getByLabelText("Password"),
      "correct horse battery staple",
    );
    await user.click(screen.getByRole("button", { name: "Log in" }));

    // Assert — the exact call, not just "was called", is what would catch email/password swapped
    await waitFor(() =>
      expect(login).toHaveBeenCalledWith({
        email: "ada@example.com",
        password: "correct horse battery staple",
      }),
    );
    expect(await screen.findByText("Dashboard page")).toBeInTheDocument();
  });

  it("LogInPage_ShouldNavigateBackToTheGuardedRoute_WhenLoginSucceedsAfterARedirectFromThere", async () => {
    // Arrange — reproduces the real flow end to end: RequireAuth is the thing that puts
    // `location.state.from` on the way to /login (not something this test fabricates), so this
    // is the regression test for the GL-19 review finding: the early "already signed in" return
    // and the post-submit navigate() used to disagree about where "back" was, and the early
    // return always won, silently dropping the deep link.
    login.mockResolvedValue(validLoginResponse());
    const user = userEvent.setup();
    renderLogInPage(["/lists/abc123"]);
    expect(await screen.findByLabelText("Email")).toBeInTheDocument(); // confirms the redirect to /login happened

    // Act
    await user.type(screen.getByLabelText("Email"), "ada@example.com");
    await user.type(
      screen.getByLabelText("Password"),
      "correct horse battery staple",
    );
    await user.click(screen.getByRole("button", { name: "Log in" }));

    // Assert
    expect(await screen.findByText("Protected list page")).toBeInTheDocument();
    expect(screen.queryByText("Dashboard page")).not.toBeInTheDocument();
  });

  it("LogInPage_ShouldShowInvalidCredentialsMessage_WhenLoginFailsWithUnauthenticated", async () => {
    // Arrange — the real Gateway always sets the giftlist-error-code trailer
    // (ErrorToRpcExceptionMapper), so a realistic UNAUTHENTICATED carries it too.
    login.mockRejectedValue(
      new ConnectError(
        "Email or password is incorrect.",
        Code.Unauthenticated,
        {
          "giftlist-error-code": "identity.invalid_credentials",
        },
      ),
    );
    const user = userEvent.setup();
    renderLogInPage();

    // Act
    await user.type(screen.getByLabelText("Email"), "ada@example.com");
    await user.type(screen.getByLabelText("Password"), "wrong-password");
    await user.click(screen.getByRole("button", { name: "Log in" }));

    // Assert
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Email or password is incorrect. Check your details and try again.",
    );
    expect(screen.queryByText("Dashboard page")).not.toBeInTheDocument();
  });

  it("LogInPage_ShouldShowTheServerValidationMessage_WhenLoginFailsWithInvalidArgument", async () => {
    // Arrange — e.g. an empty password submitted with client-side `required` bypassed. The only
    // branch that renders a server-supplied string verbatim, so this pins that it actually reaches
    // the DOM unmodified.
    login.mockRejectedValue(
      new ConnectError("Enter your password.", Code.InvalidArgument, {
        "giftlist-error-code": "identity.password_required",
      }),
    );
    const user = userEvent.setup();
    renderLogInPage();

    // Act
    await user.type(screen.getByLabelText("Email"), "ada@example.com");
    await user.click(screen.getByRole("button", { name: "Log in" }));

    // Assert
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Enter your password.",
    );
    expect(screen.queryByText("Dashboard page")).not.toBeInTheDocument();
  });

  it("LogInPage_ShouldShowReplyTimeoutMessage_WhenLoginFailsWithUnavailableReplyTimeout", async () => {
    // Arrange — the case the phase criterion "reply timeout degrades gracefully rather than
    // hanging the UI" is about: the form must resolve to a message, not sit on a dead spinner.
    login.mockRejectedValue(
      new ConnectError("unavailable", Code.Unavailable, {
        "giftlist-error-code": "messaging.reply_timeout",
      }),
    );
    const user = userEvent.setup();
    renderLogInPage();

    // Act
    await user.type(screen.getByLabelText("Email"), "ada@example.com");
    await user.type(
      screen.getByLabelText("Password"),
      "correct horse battery staple",
    );
    await user.click(screen.getByRole("button", { name: "Log in" }));

    // Assert
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /still be processing/i,
    );
    expect(screen.getByRole("button", { name: "Log in" })).not.toBeDisabled();
  });
});
