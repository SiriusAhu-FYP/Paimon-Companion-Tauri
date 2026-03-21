import React from "react";
import ReactDOM from "react-dom/client";
import { initServices } from "@/services";
import { mockCharacterInit, exposeMockTools } from "@/utils/mock";
import App from "./App";
import "./App.css";

const services = initServices();

// 开发环境：加载 mock 角色，暴露调试工具到 window.__paimon
mockCharacterInit(services.character);
exposeMockTools(services.bus, services.character, services.externalInput);

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
	<React.StrictMode>
		<App />
	</React.StrictMode>,
);
