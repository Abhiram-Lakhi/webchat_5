import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import "./styles.css";
import { AgentProvider } from "./agent/AgentProvider";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <AgentProvider>
        <App />
      </AgentProvider>
    </BrowserRouter>
  </React.StrictMode>
);
