import React from "react";
import ReactDOM from "react-dom/client";
import { loadConfig, getConfig } from "@/services/config";
import { initServices } from "@/services";
import { mockCharacterInit, exposeMockTools } from "@/utils/mock";
import { broadcastState, broadcastControl, onControlCommand } from "@/utils/window-sync";
import { windowLabel } from "@/utils/window-label";
import { DEFAULT_MODEL } from "@/features/live2d";
import { initMcpToolBridge } from "@/services/mcp/tool-bridge-service";
import { setLocalMcpEventBus } from "@/services/mcp/local-mcp-client";
import { ThemeModeProvider } from "./contexts/JoyThemeProvider";
import { I18nProvider } from "./contexts/I18nProvider";
import App from "./App";
import "./App.css";

async function bootstrap() {
	await loadConfig();

	const services = initServices();
	setLocalMcpEventBus(services.bus);

	if (windowLabel === "main") {
		await services.character.refreshCatalogFromPublic();
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
		services.bus.on("character:motion", (payload) => {
			broadcastControl({ type: "set-motion", motionGroup: payload.motionGroup, index: payload.index });
		});

		onControlCommand((cmd) => {
			if (cmd.type === "request-state") {
				broadcastFullState();
				services.character.replayPresentation();
			}
		});

		const charCfg = getConfig().character;
		const savedId = charCfg.activeProfileId?.trim() ?? "";
		const fromCard = savedId ? services.character.findProfileById(savedId) : undefined;
		if (fromCard) {
			services.character.loadFromProfile(fromCard);
		} else {
			mockCharacterInit(services.character);
		}
		services.character.setExpressionIdleTimeoutSeconds(charCfg.expressionIdleTimeoutSeconds);
		services.character.setActiveModel(DEFAULT_MODEL.path);
		services.character.replayPresentation();
		exposeMockTools(services.bus, services.character, services.runtime);

		await initMcpToolBridge(services);

		const paimonTools = (window as unknown as Record<string, Record<string, unknown>>).__paimon;
		if (paimonTools) {
			paimonTools.pipeline = (text?: string) => services.pipeline.run(text ?? "你好，派蒙！");
		}
	}

	ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
		<React.StrictMode>
			<ThemeModeProvider>
				<I18nProvider>
					<App />
				</I18nProvider>
			</ThemeModeProvider>
		</React.StrictMode>,
	);
}

bootstrap();
