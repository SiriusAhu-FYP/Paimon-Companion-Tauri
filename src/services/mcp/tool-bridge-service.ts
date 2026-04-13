import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { ServiceContainer } from "@/services";
import { executeSemanticAction } from "@/services/games/semantic-action-runtime";
import { getSemanticGameManifest, listSemanticGames } from "@/services/games/semantic-game-registry";
import { createLogger } from "@/services/logger";
import type { FunctionalTarget } from "@/types";
import { isTauriEnvironment } from "@/utils/window-sync";

const log = createLogger("mcp-bridge");

interface McpToolRequestPayload {
	requestId: string;
	toolName: string;
	args: Record<string, unknown>;
}

interface McpBridgeResponse {
	requestId: string;
	ok: boolean;
	result?: unknown;
	error?: string;
}

async function reply(response: McpBridgeResponse) {
	await invoke("mcp_bridge_respond", { response });
}

function resolveTarget(
	services: ServiceContainer,
	args: Record<string, unknown>,
): FunctionalTarget | null {
	const targetHandle = typeof args.targetHandle === "string" ? args.targetHandle.trim() : "";
	const targetTitle = typeof args.targetTitle === "string" ? args.targetTitle.trim() : "";
	if (targetHandle && targetTitle) {
		return { handle: targetHandle, title: targetTitle };
	}
	return services.orchestrator.getState().selectedTarget;
}

export async function dispatchTool(
	services: ServiceContainer,
	toolName: string,
	args: Record<string, unknown>,
) {
	switch (toolName) {
		case "companion.set_emotion": {
			const emotion = typeof args.emotion === "string" ? args.emotion.trim() : "";
			if (!emotion) {
				throw new Error("companion.set_emotion requires a non-empty emotion");
			}
			services.affect.applyEmotion({
				emotion: resolveCompanionEmotion(emotion),
				source: "mcp",
				reason: "mcp-set-emotion",
				holdForSpeech: true,
			});
			return {
				applied: true,
				emotion,
				state: services.character.getState(),
				affectState: services.affect.getState(),
			};
		}
		case "companion.reset_emotion": {
			services.affect.reset({
				source: "mcp",
				reason: "mcp-reset-emotion",
			});
			return {
				applied: true,
				emotion: "neutral",
				state: services.character.getState(),
				affectState: services.affect.getState(),
			};
		}
		case "companion.get_state": {
			return {
				state: services.character.getState(),
				affectState: services.affect.getState(),
			};
		}
		case "game.list_actions": {
			const requestedGameId = typeof args.gameId === "string" ? args.gameId.trim() : "";
			if (!requestedGameId) {
				return {
					games: listSemanticGames().map(({ gameId, displayName }) => {
						const manifest = getSemanticGameManifest(gameId);
						return {
							gameId,
							displayName,
							defaultActionOrder: [...manifest.defaultActionOrder],
							actions: manifest.actions.map((action) => ({
								id: action.id,
								label: action.label,
								description: action.description,
							})),
						};
					}),
				};
			}

			if (requestedGameId !== "2048" && requestedGameId !== "sokoban") {
				throw new Error(`unknown semantic game: ${requestedGameId}`);
			}
			const manifest = getSemanticGameManifest(requestedGameId);
			return {
				gameId: manifest.gameId,
				displayName: manifest.displayName,
				defaultActionOrder: [...manifest.defaultActionOrder],
				actions: manifest.actions.map((action) => ({
					id: action.id,
					label: action.label,
					description: action.description,
				})),
			};
		}
		case "game.perform_action": {
			const gameId = typeof args.gameId === "string" ? args.gameId.trim() : "";
			const actionId = typeof args.actionId === "string" ? args.actionId.trim() : "";
			if ((gameId !== "2048" && gameId !== "sokoban") || !actionId) {
				throw new Error("game.perform_action requires a known gameId and actionId");
			}

			const target = resolveTarget(services, args);
			if (!target) {
				throw new Error("game.perform_action requires a selected target window");
			}

			const manifest = getSemanticGameManifest(gameId);
			const action = manifest.actions.find((entry) => entry.id === actionId);
			if (!action) {
				throw new Error(`unknown action ${actionId} for game ${gameId}`);
			}

			services.orchestrator.setTarget(target);
			const execution = await executeSemanticAction(services.orchestrator, target, action);
			return {
				gameId,
				actionId: execution.actionId,
				label: execution.label,
				target,
				taskIds: execution.taskIds,
				beforeSnapshotAvailable: execution.beforeSnapshotAvailable,
				afterSnapshotAvailable: execution.afterSnapshotAvailable,
			};
		}
		default:
			throw new Error(`unsupported MCP tool: ${toolName}`);
	}
}

function resolveCompanionEmotion(value: string): "neutral" | "happy" | "angry" | "sad" | "delighted" | "alarmed" | "dazed" {
	switch (value) {
		case "happy":
		case "angry":
		case "sad":
		case "delighted":
		case "alarmed":
		case "dazed":
		case "neutral":
			return value;
		default:
			throw new Error(`unsupported companion emotion: ${value}`);
	}
}

export async function initMcpToolBridge(services: ServiceContainer): Promise<() => void> {
	if (!isTauriEnvironment()) {
		return () => {};
	}

	const unlisten = await listen<McpToolRequestPayload>("mcp://tool-request", async (event) => {
		const payload = event.payload;
		try {
			const result = await dispatchTool(services, payload.toolName, payload.args ?? {});
			await reply({
				requestId: payload.requestId,
				ok: true,
				result,
			});
			log.info("tool request completed", { tool: payload.toolName });
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			await reply({
				requestId: payload.requestId,
				ok: false,
				error: message,
			});
			services.bus.emit("system:error", {
				module: "mcp-bridge",
				error: `${payload.toolName} failed: ${message}`,
			});
			log.error("tool request failed", { tool: payload.toolName, error: message });
		}
	});

	await invoke("mcp_bridge_ready");
	log.info("frontend MCP bridge ready");

	return () => {
		unlisten();
	};
}
