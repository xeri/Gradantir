import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "@fontsource/ibm-plex-mono/600.css";
import "@fontsource/ibm-plex-mono/700.css";
import "@fontsource/archivo/700.css";
import "@fontsource/archivo/800.css";
import "@fontsource/archivo/900.css";
// The derivation layer's typesetting. The stylesheet is small and the font
// files are only fetched once a glyph renders, so this stays cheap for anyone
// who never opens a derivation; the KaTeX engine itself is dynamic-imported.
import "katex/dist/katex.min.css";
import "./index.css";
import App from "./App";
import { Boundary } from "./components/Boundary";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Boundary>
      <App />
    </Boundary>
  </React.StrictMode>,
);
