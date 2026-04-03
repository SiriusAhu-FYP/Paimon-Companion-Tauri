import React from "react";
import ReactDOM from "react-dom/client";
import { loadConfig, getConfig } from "@/services/config";
import { initServices } from "@/services";
import { mockCharacterInit, exposeMockTools } from "@/utils/mock";
import { broadcastState, broadcastControl, onControlCommand } from "@/utils/window-sync";
import { windowLabel } from "@/utils/window-label";
import { ThemeModeProvider } from "./contexts/JoyThemeProvider";
import App from "./App";
import "./App.css";

async function bootstrap() {
	await loadConfig();

	const services = initServices();

	if (windowLabel === "main") {
		await services.character.refreshCatalogFromPublic();
		const charCfg = getConfig().character;
		const savedId = charCfg.activeProfileId?.trim() ?? "";
		const fromCard = savedId ? services.character.findProfileById(savedId) : undefined;
		if (fromCard) {
			services.character.loadFromProfile(fromCard);
		} else {
			mockCharacterInit(services.character);
		}
		exposeMockTools(services.bus, services.character, services.runtime);

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

		onControlCommand((cmd) => {
			if (cmd.type === "request-state") {
				broadcastFullState();
			}
		});

		const paimonTools = (window as unknown as Record<string, Record<string, unknown>>).__paimon;
		if (paimonTools) {
			paimonTools.pipeline = (text?: string) => services.pipeline.run(text ?? "你好，派蒙！");
		}
	}

	ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
		<React.StrictMode>
			<ThemeModeProvider>
				<App />
			</ThemeModeProvider>
		</React.StrictMode>,
	);
}

bootstrap();
