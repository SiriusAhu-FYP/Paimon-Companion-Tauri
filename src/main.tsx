import React from "react";
import ReactDOM from "react-dom/client";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { initServices } from "@/services";
import { mockCharacterInit, exposeMockTools } from "@/utils/mock";
import { broadcastState } from "@/utils/window-sync";
import App from "./App";
import "./App.css";

const services = initServices();

let windowLabel = "main";
try {
	windowLabel = getCurrentWindow().label;
} catch {
	// 非 Tauri 环境（浏览器调试），默认 main
}

if (windowLabel === "main") {
	mockCharacterInit(services.character);
	exposeMockTools(services.bus, services.character, services.externalInput, services.runtime);

	// 主窗口：订阅状态变化并广播给 stage 窗口
	const broadcast = () => {
		broadcastState({
			character: services.character.getState(),
			runtimeMode: services.runtime.getMode(),
			timestamp: Date.now(),
		});
	};
	services.bus.on("character:state-change", broadcast);
	services.bus.on("runtime:mode-change", broadcast);
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
	<React.StrictMode>
		<App />
	</React.StrictMode>,
);
