import React from "react";
import ReactDOM from "react-dom/client";
import { ThemeProvider, CssBaseline } from "@mui/material";
import { initServices } from "@/services";
import { mockCharacterInit, exposeMockTools } from "@/utils/mock";
import { broadcastState, broadcastControl, onControlCommand } from "@/utils/window-sync";
import { windowLabel } from "@/utils/window-label";
import theme from "./theme";
import App from "./App";
import "./App.css";

const services = initServices();

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
	services.bus.on("character:expression", (payload) => {
		broadcastFullState(payload.emotion);
		broadcastControl({ type: "set-expression", expressionName: payload.expressionName });
	});

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
		<ThemeProvider theme={theme}>
			<CssBaseline />
			<App />
		</ThemeProvider>
	</React.StrictMode>,
);
