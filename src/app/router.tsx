import { createBrowserRouter, Navigate } from "react-router-dom";

import LogInPage from "../identity/pages/LogInPage";
import SignUpPage from "../identity/pages/SignUpPage";
import RequireAuth from "../identity/auth/RequireAuth";
import DashboardPage from "../giftlists/pages/DashboardPage";
import ListDetailOwnerPage from "../giftlists/pages/ListDetailOwnerPage";
import SharedListPage from "../sharing/pages/SharedListPage";
import ShareOwnerInterstitialPage from "../sharing/pages/ShareOwnerInterstitialPage";

// One route per mockup screen (mockups/index.html lists all six). `/login` and `/signup` stay
// public; every other app route is wrapped in RequireAuth (GL-19) and redirects to `/login` when
// there is no in-memory session or the session has expired. `/share/:shareToken` also stays
// public — it's the anonymous guest view reached via an opaque link, not an app route.
// `owner-preview` is guarded too, but RequireAuth only proves *someone* is signed in — it is
// authentication, not authorization. It does not prove the signed-in user owns this particular
// share token; any signed-in user can currently render this page for any token. Harmless today
// (ShareOwnerInterstitialPage is a stub, and which view a viewer actually gets is decided
// server-side by the Gateway's `ViewGiftList(viewer)` use case, see that page's own doc comment)
// — a later batch must not lean on this guard as if it were ownership.
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
  { path: "/share/:shareToken", element: <SharedListPage /> },
  {
    path: "/share/:shareToken/owner-preview",
    element: (
      <RequireAuth>
        <ShareOwnerInterstitialPage />
      </RequireAuth>
    ),
  },
]);
