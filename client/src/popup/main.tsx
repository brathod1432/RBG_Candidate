// client/src/popup/main.tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";

const rootEl = document.getElementById("root");
if (rootEl === null) {
  throw new Error("popup root element missing");
}

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
