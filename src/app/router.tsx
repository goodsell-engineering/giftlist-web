import { createBrowserRouter, Navigate } from "react-router-dom";

import LogInPage from "../identity/pages/LogInPage";
import SignUpPage from "../identity/pages/SignUpPage";
import RequireAuth from "../identity/auth/RequireAuth";
import DashboardPage from "../giftlists/pages/DashboardPage";
import ListDetailOwnerPage from "../giftlists/pages/ListDetailOwnerPage";
import ShareTokenPage from "../sharing/pages/ShareTokenPage";

// One route per mockup screen (mockups/index.html lists all six — the guest view and the owner's
// spoiler interstitial are both reached through the one `/share/:shareToken` URL, not two
// separate routes; see ShareTokenPage's own doc comment). `/login` and `/signup` stay public;
// every other app route is wrapped in RequireAuth (GL-19) and redirects to `/login` when there is
// no in-memory session or the session has expired. `/share/:shareToken` stays public too — it's
// reached via an opaque link that a signed-out guest must be able to open, and ShareTokenPage
// itself is what decides, client-side, whether the *current* visitor also happens to be signed in
// as the list's owner (GL-39).
// Data loaders for the guarded pages remain out of scope here.
export const router = createBrowserRouter([
  { path: "/", element: <Navigate to="/dashboard" replace /> },
  { path: "/signup", element: <SignUpPage /> },
  { path: "/login", element: <LogInPage /> },
  {
    path: "/dashboard",
    element: (
      <RequireAuth>
        <DashboardPage />
      </RequireAuth>
    ),
  },
  {
    path: "/lists/:listId",
    element: (
      <RequireAuth>
        <ListDetailOwnerPage />
      </RequireAuth>
    ),
  },
  { path: "/share/:shareToken", element: <ShareTokenPage /> },
]);
