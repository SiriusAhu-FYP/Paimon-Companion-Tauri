import React from "react";
import ReactDOM from "react-dom/client";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { initServices } from "@/services";
import { mockCharacterInit, exposeMockTools } from "@/utils/mock";
import { broadcastState, onControlCommand } from "@/utils/window-sync";
import App from "./App";
import "./App.css";

const services = initServices();

let windowLabel = "main";
const urlParams = new URLSearchParams(window.location.search);
const urlOverride = urlParams.get("window");
if (urlOverride === "stage") {
	windowLabel = "stage";
} else {
	try {
		windowLabel = getCurrentWindow().label;
	} catch {
		// 非 Tauri 环境（浏览器调试），默认 main
	}
}

if (windowLabel === "main") {
	mockCharacterInit(services.character);
	exposeMockTools(services.bus, services.character, services.externalInput, services.runtime);

	const broadcastFullState = (expressionEmotion?: string) => {
		const charState = services.character.getState();
		broadcastState({
			character: charState,
			runtimeMode: services.runtime.getMode(),
			timestamp: Date.now(),
			expressionEmotion: expressionEmotion ?? charState.emotion,
		});
	};

	services.bus.on("character:state-change", () => broadcastFullState());
	services.bus.on("runtime:mode-change", () => broadcastFullState());
	services.bus.on("character:expression", (payload) => broadcastFullState(payload.emotion));

	// 响应 Stage 的 request-state
	onControlCommand((cmd) => {
		if (cmd.type === "request-state") {
			broadcastFullState();
		}
	});

	// 挂载 pipeline 到 devtools
	const paimonTools = (window as unknown as Record<string, Record<string, unknown>>).__paimon;
	if (paimonTools) {
		paimonTools.pipeline = (text?: string) => services.pipeline.run(text ?? "你好，派蒙！");
	}
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
	<React.StrictMode>
		<App />
	</React.StrictMode>,
);
