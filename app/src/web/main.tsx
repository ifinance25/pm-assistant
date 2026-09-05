import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import "./styles/tokens.css";
import "./styles/shell.css";

const root = document.getElementById("root");
if (!root) {
  throw new Error("нет корневого элемента");
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
