import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

// Mantine's stylesheets, imported exactly once, here — and before "./index.css" so this app's own
// (now near-empty, see that file) stylesheet would win a specificity tie were one ever needed.
import "@mantine/core/styles.css";
import "@mantine/dates/styles.css";
import "./index.css";

import App from "./app/App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
