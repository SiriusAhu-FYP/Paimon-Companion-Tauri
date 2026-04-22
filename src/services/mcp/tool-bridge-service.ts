import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { ServiceContainer } from "@/services";
import { getConfig } from "@/services/config";
import { executeSemanticAction } from "@/services/games/semantic-action-runtime";
import { getSemanticGameManifest, listSemanticGames } from "@/services/games/semantic-game-registry";
import { createLogger } from "@/services/logger";
import { listWindows } from "@/services/system";
import { requestOpenAICompatibleVision } from "@/services/vlm";
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
	const selectedTarget = services.orchestrator.getState().selectedTarget;
	if (targetHandle) {
		return {
			handle: targetHandle,
			title: targetTitle || selectedTarget?.title || targetHandle,
		};
	}
	if (targetTitle && selectedTarget) {
		return {
			handle: selectedTarget.handle,
			title: targetTitle,
		};
	}
	return selectedTarget;
}

function resolveHostMouseAction(value: unknown): "move" | "down" | "up" | "click" {
	if (value === "move" || value === "down" || value === "up" || value === "click") {
		return value;
	}
	return "click";
}

function resolveHostMouseButton(value: unknown): "left" | "right" | "middle" {
	if (value === "left" || value === "right" || value === "middle") {
		return value;
	}
	return "left";
}

function toFiniteNumber(value: unknown): number | null {
	if (typeof value !== "number" || !Number.isFinite(value)) {
		return null;
	}
	return value;
}

function toUnitNumber(value: unknown): number | null {
	const numeric = toFiniteNumber(value);
	if (numeric === null || numeric < 0 || numeric > 1) {
		return null;
	}
	return numeric;
}

function denormalizeCoordinate(unitValue: number, size: number): number {
	const max = Math.max(1, size) - 1;
	return Math.max(0, Math.min(max, Math.round(unitValue * max)));
}

async function resolveMouseCoordinateArgs(
	services: ServiceContainer,
	target: FunctionalTarget,
	args: Record<string, unknown>,
): Promise<{ x: number | undefined; y: number | undefined; resolvedFrom: "pixel" | "normalized" | "default" }> {
	const x = toFiniteNumber(args.x);
	const y = toFiniteNumber(args.y);
	if (x !== null || y !== null) {
		return {
			x: x === null ? undefined : Math.round(x),
			y: y === null ? undefined : Math.round(y),
			resolvedFrom: "pixel",
		};
	}

	const xNorm = toUnitNumber(args.xNorm);
	const yNorm = toUnitNumber(args.yNorm);
	if (xNorm === null || yNorm === null) {
		return { x: undefined, y: undefined, resolvedFrom: "default" };
	}

	const captureTask = await services.orchestrator.runCaptureTask(target);
	const snapshot = captureTask.afterSnapshot ?? captureTask.beforeSnapshot;
	if (!snapshot) {
		throw new Error("host.send_mouse could not resolve normalized coordinates: capture unavailable");
	}
	return {
		x: denormalizeCoordinate(xNorm, snapshot.width),
		y: denormalizeCoordinate(yNorm, snapshot.height),
		resolvedFrom: "normalized",
	};
}

interface LocatorConsensusSample {
	index: number;
	leftNorm: number;
	topNorm: number;
	rightNorm: number;
	bottomNorm: number;
	centerXNorm: number;
	centerYNorm: number;
	confidence: number;
	reason: string;
	width: number;
	height: number;
}

function toIntegerInRange(value: unknown, min: number, max: number, fallback: number): number {
	if (typeof value !== "number" || !Number.isFinite(value)) {
		return fallback;
	}
	const normalized = Math.floor(value);
	if (normalized < min) {
		return min;
	}
	if (normalized > max) {
		return max;
	}
	return normalized;
}

function normalizeCoordinateCandidate(value: unknown, size: number): number | null {
	const numeric = toFiniteNumber(value);
	if (numeric === null) {
		return null;
	}
	if (numeric >= 0 && numeric <= 1) {
		return numeric;
	}
	if (size <= 1) {
		return null;
	}
	const normalized = numeric / (size - 1);
	if (normalized < 0 || normalized > 1) {
		return null;
	}
	return normalized;
}

function normalizeConfidence(value: unknown): number {
	const numeric = toFiniteNumber(value);
	if (numeric === null) {
		return 0.5;
	}
	return Math.max(0, Math.min(1, numeric));
}

function parseJsonObject(rawText: string): Record<string, unknown> {
	const trimmed = rawText.trim();
	if (!trimmed) {
		return {};
	}
	try {
		const parsed = JSON.parse(trimmed);
		return parsed && typeof parsed === "object" && !Array.isArray(parsed)
			? parsed as Record<string, unknown>
			: {};
	} catch {
		const start = trimmed.indexOf("{");
		const end = trimmed.lastIndexOf("}");
		if (start >= 0 && end > start) {
			try {
				const parsed = JSON.parse(trimmed.slice(start, end + 1));
				return parsed && typeof parsed === "object" && !Array.isArray(parsed)
					? parsed as Record<string, unknown>
					: {};
			} catch {
				return {};
			}
		}
		return {};
	}
}

function toMedian(values: number[]): number {
	if (!values.length) {
		return 0;
	}
	const sorted = [...values].sort((a, b) => a - b);
	const middle = Math.floor(sorted.length / 2);
	if (sorted.length % 2 === 0) {
		return (sorted[middle - 1] + sorted[middle]) / 2;
	}
	return sorted[middle] ?? 0;
}

function average(values: readonly number[]): number {
	if (!values.length) {
		return 0;
	}
	return values.reduce((sum, item) => sum + item, 0) / values.length;
}

function parseLocatorConsensusSample(input: {
	content: string;
	width: number;
	height: number;
	index: number;
}): LocatorConsensusSample | null {
	const payload = parseJsonObject(input.content);
	const found = payload.found;
	if (typeof found === "boolean" && !found) {
		return null;
	}

	const leftNorm = normalizeCoordinateCandidate(payload.leftNorm ?? payload.x1 ?? payload.left, input.width);
	const topNorm = normalizeCoordinateCandidate(payload.topNorm ?? payload.y1 ?? payload.top, input.height);
	const rightNorm = normalizeCoordinateCandidate(payload.rightNorm ?? payload.x2 ?? payload.right, input.width);
	const bottomNorm = normalizeCoordinateCandidate(payload.bottomNorm ?? payload.y2 ?? payload.bottom, input.height);

	let centerXNorm = normalizeCoordinateCandidate(payload.xNorm ?? payload.centerXNorm ?? payload.x, input.width);
	let centerYNorm = normalizeCoordinateCandidate(payload.yNorm ?? payload.centerYNorm ?? payload.y, input.height);

	const hasBox = leftNorm !== null && topNorm !== null && rightNorm !== null && bottomNorm !== null;
	if (hasBox && leftNorm <= rightNorm && topNorm <= bottomNorm) {
		centerXNorm = centerXNorm ?? (leftNorm + rightNorm) / 2;
		centerYNorm = centerYNorm ?? (topNorm + bottomNorm) / 2;
	}
	if (centerXNorm === null || centerYNorm === null) {
		return null;
	}

	const normalizedLeft = hasBox && leftNorm <= rightNorm ? leftNorm : centerXNorm;
	const normalizedTop = hasBox && topNorm <= bottomNorm ? topNorm : centerYNorm;
	const normalizedRight = hasBox && leftNorm <= rightNorm ? rightNorm : centerXNorm;
	const normalizedBottom = hasBox && topNorm <= bottomNorm ? bottomNorm : centerYNorm;

	return {
		index: input.index,
		leftNorm: normalizedLeft,
		topNorm: normalizedTop,
		rightNorm: normalizedRight,
		bottomNorm: normalizedBottom,
		centerXNorm,
		centerYNorm,
		confidence: normalizeConfidence(payload.confidence),
		reason: typeof payload.reason === "string" ? payload.reason.trim() : "",
		width: input.width,
		height: input.height,
	};
}

function evaluateLocatorConsensus(samples: readonly LocatorConsensusSample[]) {
	if (!samples.length) {
		return null;
	}
	const medianX = toMedian(samples.map((sample) => sample.centerXNorm));
	const medianY = toMedian(samples.map((sample) => sample.centerYNorm));
	const areas = samples.map((sample) =>
		Math.max(0, sample.rightNorm - sample.leftNorm) * Math.max(0, sample.bottomNorm - sample.topNorm)
	);
	const medianArea = toMedian(areas);
	const distances = samples.map((sample) => Math.hypot(sample.centerXNorm - medianX, sample.centerYNorm - medianY));
	const medianDistance = toMedian(distances);
	const distanceThreshold = Math.max(0.06, medianDistance * 2.5);

	const tagged = samples.map((sample, index) => {
		const distance = distances[index] ?? 0;
		const area = areas[index] ?? 0;
		const areaRatio = medianArea > 0 ? area / medianArea : 1;
		const outlierByDistance = distance > distanceThreshold;
		const outlierByArea = areaRatio > 2.8 || areaRatio < 0.35;
		const isOutlier = samples.length >= 3 && (outlierByDistance || outlierByArea);
		return {
			sample,
			distance,
			area,
			isOutlier,
		};
	});

	let used = tagged.filter((item) => !item.isOutlier);
	if (!used.length) {
		used = [...tagged].sort((a, b) => a.distance - b.distance).slice(0, 1);
	}

	return {
		centerXNorm: average(used.map((item) => item.sample.centerXNorm)),
		centerYNorm: average(used.map((item) => item.sample.centerYNorm)),
		leftNorm: average(used.map((item) => item.sample.leftNorm)),
		topNorm: average(used.map((item) => item.sample.topNorm)),
		rightNorm: average(used.map((item) => item.sample.rightNorm)),
		bottomNorm: average(used.map((item) => item.sample.bottomNorm)),
		confidence: average(used.map((item) => item.sample.confidence)),
		distanceThreshold,
		used,
		rejected: tagged.filter((item) => item.isOutlier),
	};
}

function buildLocatorConsensusSystemPrompt(): string {
	return [
		"You are a robust UI locator that returns one bounding box for the requested element.",
		"Return strict JSON only.",
		"Schema: {\"found\": boolean, \"leftNorm\": number, \"topNorm\": number, \"rightNorm\": number, \"bottomNorm\": number, \"confidence\": number, \"reason\": string}.",
		"All normalized coordinates must be in [0,1] and satisfy leftNorm<=rightNorm, topNorm<=bottomNorm.",
		"If not found, return {\"found\": false, \"reason\": \"...\"}.",
	].join("\n");
}

function buildLocatorConsensusUserPrompt(input: {
	target: FunctionalTarget;
	locatorHint: string;
	taskGoal: string;
	sampleIndex: number;
	sampleCount: number;
}): string {
	return [
		`target: ${input.target.title} (${input.target.handle})`,
		`locatorHint: ${input.locatorHint}`,
		`taskGoal: ${input.taskGoal || "(none)"}`,
		`sample: ${input.sampleIndex + 1}/${input.sampleCount}`,
	].join("\n");
}

async function sleep(ms: number): Promise<void> {
	await new Promise<void>((resolve) => {
		setTimeout(resolve, ms);
	});
}

async function resolveLocatorConsensus(
	services: ServiceContainer,
	target: FunctionalTarget,
	args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
	const locatorHint = typeof args.locatorHint === "string" ? args.locatorHint.trim() : "";
	if (!locatorHint) {
		throw new Error("host.resolve_locator_consensus requires locatorHint");
	}
	const sampleCount = toIntegerInRange(args.samples, 2, 8, 4);
	const taskGoal = typeof args.taskGoal === "string" ? args.taskGoal.trim() : "";

	services.orchestrator.setTarget(target);
	const runtimeConfig = getConfig().companionRuntime;
	const samples: LocatorConsensusSample[] = [];
	const sampleErrors: string[] = [];

	for (let index = 0; index < sampleCount; index += 1) {
		try {
			const captureRecord = await services.orchestrator.runCaptureTask(target);
			const snapshot = captureRecord.afterSnapshot ?? captureRecord.beforeSnapshot;
			if (!snapshot) {
				sampleErrors.push(`sample-${index + 1}: capture unavailable`);
				continue;
			}
			const content = await requestOpenAICompatibleVision({
				client: {
					baseUrl: runtimeConfig.localVisionBaseUrl,
					model: runtimeConfig.localVisionModel,
				},
				systemPrompt: buildLocatorConsensusSystemPrompt(),
				userPrompt: buildLocatorConsensusUserPrompt({
					target,
					locatorHint,
					taskGoal,
					sampleIndex: index,
					sampleCount,
				}),
				imageDataUrl: snapshot.dataUrl,
				maxTokens: 280,
				temperature: 0.15,
				timeoutMs: 20_000,
				jsonResponse: true,
			});
			const sample = parseLocatorConsensusSample({
				content,
				width: snapshot.width,
				height: snapshot.height,
				index,
			});
			if (sample) {
				samples.push(sample);
			} else {
				sampleErrors.push(`sample-${index + 1}: locator returned not-found/invalid`);
			}
		} catch (error) {
			sampleErrors.push(`sample-${index + 1}: ${error instanceof Error ? error.message : String(error)}`);
		}
		if (index < sampleCount - 1) {
			await sleep(120);
		}
	}

	const consensus = evaluateLocatorConsensus(samples);
	if (!consensus) {
		return {
			found: false,
			reason: sampleErrors.length
				? `no valid locator sample: ${sampleErrors[sampleErrors.length - 1]}`
				: "no valid locator sample",
			requestedSamples: sampleCount,
			validSamples: 0,
			usedSamples: 0,
			rejectedSamples: 0,
			sampleErrors,
		};
	}

	const usedSnapshot = consensus.used[consensus.used.length - 1]?.sample ?? samples[samples.length - 1];
	const width = usedSnapshot?.width ?? 1;
	const height = usedSnapshot?.height ?? 1;

	return {
		found: true,
		reason: `consensus from ${consensus.used.length}/${samples.length} samples`,
		requestedSamples: sampleCount,
		validSamples: samples.length,
		usedSamples: consensus.used.length,
		rejectedSamples: consensus.rejected.length,
		distanceThreshold: consensus.distanceThreshold,
		confidence: Math.max(0, Math.min(1, consensus.confidence)),
		center: {
			xNorm: Math.max(0, Math.min(1, consensus.centerXNorm)),
			yNorm: Math.max(0, Math.min(1, consensus.centerYNorm)),
			x: denormalizeCoordinate(Math.max(0, Math.min(1, consensus.centerXNorm)), width),
			y: denormalizeCoordinate(Math.max(0, Math.min(1, consensus.centerYNorm)), height),
		},
		boundingBox: {
			leftNorm: Math.max(0, Math.min(1, consensus.leftNorm)),
			topNorm: Math.max(0, Math.min(1, consensus.topNorm)),
			rightNorm: Math.max(0, Math.min(1, consensus.rightNorm)),
			bottomNorm: Math.max(0, Math.min(1, consensus.bottomNorm)),
		},
		samples: samples.map((sample) => {
			const tagged = consensus.rejected.find((item) => item.sample.index === sample.index);
			return {
				index: sample.index,
				confidence: sample.confidence,
				centerXNorm: sample.centerXNorm,
				centerYNorm: sample.centerYNorm,
				leftNorm: sample.leftNorm,
				topNorm: sample.topNorm,
				rightNorm: sample.rightNorm,
				bottomNorm: sample.bottomNorm,
				isOutlier: Boolean(tagged),
				reason: sample.reason,
			};
		}),
		sampleErrors,
	};
}

function toSingleCharKeyToken(ch: string): string | null {
	if (ch === " ") {
		return "Space";
	}
	if (ch.length !== 1) {
		return null;
	}
	const code = ch.charCodeAt(0);
	if (code < 32 || code > 126) {
		return null;
	}
	return ch;
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
			const execution = await executeSemanticAction(
				services.orchestrator,
				target,
				action,
				{
					loadGuardPolicy: manifest.loadGuardPolicy ?? "auto",
				},
			);
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
		case "host.list_windows": {
			const query = typeof args.query === "string" ? args.query.trim().toLowerCase() : "";
			const rawLimit = typeof args.limit === "number" ? args.limit : Number.NaN;
			const limit = Number.isFinite(rawLimit)
				? Math.max(1, Math.min(200, Math.floor(rawLimit)))
				: 20;
			const windows = await listWindows();
			const filtered = query
				? windows.filter((windowInfo) => {
					const haystack = [
						windowInfo.title,
						windowInfo.processName,
						windowInfo.className,
						windowInfo.handle,
						String(windowInfo.processId),
					].join(" ").toLowerCase();
					return haystack.includes(query);
				})
				: windows;
			return {
				total: windows.length,
				returned: Math.min(filtered.length, limit),
				windows: filtered.slice(0, limit),
			};
		}
		case "host.focus_window": {
			const target = resolveTarget(services, args);
			if (!target) {
				throw new Error("host.focus_window requires a selected target window or explicit targetHandle");
			}
			const applyDelegatedViewport = typeof args.applyDelegatedViewport === "boolean"
				? args.applyDelegatedViewport
				: true;
			services.orchestrator.setTarget(target);
			await services.orchestrator.runFocusTask(target, { applyDelegatedViewport });
			return { target, focused: true, applyDelegatedViewport };
		}
		case "host.capture_window": {
			const target = resolveTarget(services, args);
			if (!target) {
				throw new Error("host.capture_window requires a selected target window or explicit targetHandle");
			}
			services.orchestrator.setTarget(target);
			const record = await services.orchestrator.runCaptureTask(target);
			return {
				target,
				taskId: record.id,
				captured: record.status === "completed",
				width: record.afterSnapshot?.width ?? null,
				height: record.afterSnapshot?.height ?? null,
			};
		}
		case "host.resolve_locator_consensus": {
			const target = resolveTarget(services, args);
			if (!target) {
				throw new Error("host.resolve_locator_consensus requires a selected target window or explicit targetHandle");
			}
			return resolveLocatorConsensus(services, target, args);
		}
		case "host.send_key": {
			const key = typeof args.key === "string" ? args.key.trim() : "";
			if (!key) {
				throw new Error("host.send_key requires a non-empty key");
			}
			const target = resolveTarget(services, args);
			if (!target) {
				throw new Error("host.send_key requires a selected target window or explicit targetHandle");
			}
			services.orchestrator.setTarget(target);
			const record = await services.orchestrator.runSendKeyTask(key, target);
			return {
				target,
				key,
				taskId: record.id,
				sent: record.status === "completed",
			};
		}
		case "host.send_mouse": {
			const target = resolveTarget(services, args);
			if (!target) {
				throw new Error("host.send_mouse requires a selected target window or explicit targetHandle");
			}
			const coordinate = await resolveMouseCoordinateArgs(services, target, args);
			const x = coordinate.x;
			const y = coordinate.y;
			const action = resolveHostMouseAction(args.action);
			const button = resolveHostMouseButton(args.button);
			services.orchestrator.setTarget(target);
			const record = await services.orchestrator.runSendMouseTask({ action, button, x, y }, target);
			return {
				target,
				action,
				button,
				x: x ?? null,
				y: y ?? null,
				resolvedFrom: coordinate.resolvedFrom,
				taskId: record.id,
				sent: record.status === "completed",
			};
		}
		case "host.paste_text": {
			const text = typeof args.text === "string" ? args.text : "";
			if (!text.trim()) {
				throw new Error("host.paste_text requires a non-empty text");
			}
			const target = resolveTarget(services, args);
			if (!target) {
				throw new Error("host.paste_text requires a selected target window or explicit targetHandle");
			}
			services.orchestrator.setTarget(target);

			try {
				const record = await services.orchestrator.runSendTextTask(text, target);
				return {
					target,
					mode: "paste",
					taskId: record.id,
					sent: record.status === "completed",
					length: text.length,
				};
			} catch (pasteError) {
				log.warn("host.paste_text fallback to send_key", {
					error: pasteError instanceof Error ? pasteError.message : String(pasteError),
					length: text.length,
				});
				const sentKeys: string[] = [];
				for (const ch of text) {
					const token = toSingleCharKeyToken(ch);
					if (!token) {
						throw new Error(`host.paste_text fallback failed: unsupported character "${ch}"`);
					}
					await services.orchestrator.runSendKeyTask(token, target);
					sentKeys.push(token);
				}
				return {
					target,
					mode: "fallback-send-key",
					sent: true,
					length: text.length,
					keyCount: sentKeys.length,
				};
			}
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
