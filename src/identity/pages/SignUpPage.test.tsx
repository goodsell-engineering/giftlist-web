import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "../../test/render";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { Code, ConnectError } from "@connectrpc/connect";
import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";

import SignUpPage from "./SignUpPage";
import { AuthProvider } from "../auth/AuthProvider";
import { authClient } from "../api/authClient";
import { SignUpResponseSchema } from "@giftlist/gateway-client";

// The real client would fetch over the network — replaced so these tests exercise the page's
// wiring (which fields go where, which error becomes which message) without a server.
vi.mock("../api/authClient", () => ({
  authClient: {
    login: vi.fn(),
    signUp: vi.fn(),
  },
}));

const signUp = vi.mocked(authClient.signUp);

// A response the real Gateway would send: accessTokenExpiresAt is always set — omitting it here
// would throw (AuthProvider.toSession).
function validSignUpResponse() {
  return create(SignUpResponseSchema, {
    userId: "user-1",
    accessToken: "token-abc",
    accessTokenExpiresAt: timestampFromDate(
      new Date(Date.now() + 60 * 60 * 1000),
    ),
  });
}

function renderSignUpPage() {
  return render(
    <AuthProvider>
      <MemoryRouter initialEntries={["/signup"]}>
        <Routes>
          <Route path="/signup" element={<SignUpPage />} />
          <Route path="/dashboard" element={<div>Dashboard page</div>} />
        </Routes>
      </MemoryRouter>
    </AuthProvider>,
  );
}

async function fillForm(
  user: ReturnType<typeof userEvent.setup>,
  {
    name,
    email,
    password,
    confirm,
  }: { name: string; email: string; password: string; confirm: string },
) {
  await user.type(screen.getByLabelText("Name"), name);
  await user.type(screen.getByLabelText("Email"), email);
  await user.type(screen.getByLabelText("Password"), password);
  await user.type(screen.getByLabelText("Confirm password"), confirm);
}

describe("SignUpPage", () => {
  beforeEach(() => {
    signUp.mockReset();
  });

  it("SignUpPage_ShouldNavigateToDashboard_WhenSignUpSucceeds", async () => {
    // Arrange
    signUp.mockResolvedValue(validSignUpResponse());
    const user = userEvent.setup();
    renderSignUpPage();

    // Act
    await fillForm(user, {
      name: "Ada Lovelace",
      email: "ada@example.com",
      password: "correct horse battery staple",
      confirm: "correct horse battery staple",
    });
    await user.click(screen.getByRole("button", { name: "Create account" }));

    // Assert — the exact fields, not just "was called", is what would catch email/password/name
    // ending up in the wrong slot of the wire request.
    await waitFor(() =>
      expect(signUp).toHaveBeenCalledWith({
        email: "ada@example.com",
        password: "correct horse battery staple",
        displayName: "Ada Lovelace",
      }),
    );
    expect(await screen.findByText("Dashboard page")).toBeInTheDocument();
  });

  it("SignUpPage_ShouldShowAMismatchError_WhenPasswordsDontMatchAndShouldNotCallSignUp", async () => {
    // Arrange
    const user = userEvent.setup();
    renderSignUpPage();

    // Act
    await fillForm(user, {
      name: "Ada Lovelace",
      email: "ada@example.com",
      password: "correct horse battery staple",
      confirm: "something else entirely",
    });
    await user.click(screen.getByRole("button", { name: "Create account" }));

    // Assert
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Passwords don't match.",
    );
    expect(signUp).not.toHaveBeenCalled();
  });

  it("SignUpPage_ShouldShowEmailAlreadyRegisteredMessage_WhenSignUpFailsWithAborted", async () => {
    // Arrange — the real Gateway always sets the giftlist-error-code trailer
    // (ErrorToRpcExceptionMapper), so a realistic ABORTED carries it too.
    signUp.mockRejectedValue(
      new ConnectError(
        "A user with this email is already registered.",
        Code.Aborted,
        {
          "giftlist-error-code": "identity.email_already_registered",
        },
      ),
    );
    const user = userEvent.setup();
    renderSignUpPage();

    // Act
    await fillForm(user, {
      name: "Ada Lovelace",
      email: "ada@example.com",
      password: "correct horse battery staple",
      confirm: "correct horse battery staple",
    });
    await user.click(screen.getByRole("button", { name: "Create account" }));

    // Assert
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "That email is already registered. Try logging in instead.",
    );
    expect(screen.queryByText("Dashboard page")).not.toBeInTheDocument();
  });
});
