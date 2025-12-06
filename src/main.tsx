import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import App from "./App";
import Passport from "./Passport";
import Settings from "./Settings";
import Onboarding from "./Onboarding";
import "./App.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<App />} />
        <Route path="/passport.html" element={<Passport />} />
        <Route path="/settings.html" element={<Settings />} />
        <Route path="/onboarding.html" element={<Onboarding />} />
        {/* Fallback for clean URLs if we decide to switch */}
        <Route path="/passport" element={<Passport />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/onboarding" element={<Onboarding />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>,
);
