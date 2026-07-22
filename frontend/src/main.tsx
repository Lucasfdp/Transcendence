import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./app/App";
import { installFrontendPerformanceProfiler } from "./shared/frontend-performance-profiler";
import "./styles/tailwind-base.css";
import "./styles/modules/index.css";
import "./styles/tailwind-utilities.css";

installFrontendPerformanceProfiler();

ReactDOM.createRoot(document.getElementById("root")!).render(
	<React.StrictMode>
		<App />
	</React.StrictMode>,
);
