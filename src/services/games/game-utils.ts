import type { OrchestratorService } from "@/services/orchestrator";
import type {
	FunctionalTarget,
	HostWindowInfo,
	PerceptionSnapshot,
} from "@/types";

interface WindowMatchOptions {
	keywords: readonly string[];
	processKeywords?: readonly string[];
	visibleBonus?: number;
	normalBonus?: number;
}

interface SnapshotChangeOptions {
	sampleSize?: number;
	cropScale?: number;
}

export function chooseWindowByKeywords(
	windows: HostWindowInfo[],
	options: WindowMatchOptions,
): HostWindowInfo | null {
	const candidates = windows
		.filter((windowInfo) => windowInfo.visible && !windowInfo.minimized)
		.map((windowInfo) => ({
			windowInfo,
			score: scoreWindow(windowInfo, options),
		}))
		.filter((candidate) => candidate.score > 0)
		.sort((left, right) => right.score - left.score);

	return candidates[0]?.windowInfo ?? null;
}

export async function ensureReferenceSnapshot(
	orchestrator: OrchestratorService,
	target: FunctionalTarget,
	errorMessage: string,
): Promise<PerceptionSnapshot> {
	const state = orchestrator.getState();
	if (state.latestSnapshot && state.latestSnapshot.targetHandle === target.handle) {
		return state.latestSnapshot;
	}

	const captureTask = await orchestrator.runCaptureTask(target);
	if (!captureTask.afterSnapshot) {
		throw new Error(errorMessage);
	}

	return captureTask.afterSnapshot;
}

export async function estimateSnapshotChange(
	beforeSnapshot: PerceptionSnapshot,
	afterSnapshot: PerceptionSnapshot,
	options: SnapshotChangeOptions = {},
): Promise<number> {
	if (beforeSnapshot.width !== afterSnapshot.width || beforeSnapshot.height !== afterSnapshot.height) {
		return 1;
	}

	const sampleSize = options.sampleSize ?? 48;
	const cropScale = options.cropScale ?? 0.75;
	const beforeData = await sampleSnapshot(beforeSnapshot.dataUrl, sampleSize, cropScale);
	const afterData = await sampleSnapshot(afterSnapshot.dataUrl, sampleSize, cropScale);
	const pixelCount = beforeData.width * beforeData.height;
	let totalDiff = 0;

	for (let index = 0; index < beforeData.data.length; index += 4) {
		const beforeLuma = luma(beforeData.data[index], beforeData.data[index + 1], beforeData.data[index + 2]);
		const afterLuma = luma(afterData.data[index], afterData.data[index + 1], afterData.data[index + 2]);
		totalDiff += Math.abs(beforeLuma - afterLuma);
	}

	return totalDiff / (pixelCount * 255);
}

export function extractJsonObject(content: string): string {
	const start = content.indexOf("{");
	const end = content.lastIndexOf("}");
	if (start === -1 || end === -1 || end <= start) {
		throw new Error("no JSON object found in model response");
	}

	return content.slice(start, end + 1);
}

export function normalizeCompatibleOpenAIBaseUrl(raw: string): string {
	let url = raw.replace(/\/+$/, "");
	if (!url.endsWith("/v1")) {
		url += "/v1";
	}
	return url;
}

function scoreWindow(windowInfo: HostWindowInfo, options: WindowMatchOptions): number {
	const title = windowInfo.title.toLowerCase();
	let score = 0;

	for (const keyword of options.keywords) {
		if (title.includes(keyword.toLowerCase())) {
			score += 10;
		}
	}

	for (const keyword of options.processKeywords ?? []) {
		if (title.includes(keyword.toLowerCase())) {
			score += 2;
		}
	}

	if (windowInfo.visible) {
		score += options.visibleBonus ?? 1;
	}
	if (!windowInfo.minimized) {
		score += options.normalBonus ?? 1;
	}

	return score;
}

async function sampleSnapshot(
	dataUrl: string,
	sampleSize: number,
	cropScale: number,
): Promise<ImageData> {
	const image = await loadImage(dataUrl);
	const canvas = document.createElement("canvas");
	const context = canvas.getContext("2d");

	if (!context) {
		throw new Error("2d canvas context unavailable");
	}

	canvas.width = sampleSize;
	canvas.height = sampleSize;

	const cropWidth = image.width * cropScale;
	const cropHeight = image.height * cropScale;
	const cropX = (image.width - cropWidth) / 2;
	const cropY = (image.height - cropHeight) / 2;

	context.drawImage(
		image,
		cropX,
		cropY,
		cropWidth,
		cropHeight,
		0,
		0,
		canvas.width,
		canvas.height,
	);

	return context.getImageData(0, 0, canvas.width, canvas.height);
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
	return new Promise((resolve, reject) => {
		const image = new Image();
		image.onload = () => resolve(image);
		image.onerror = () => reject(new Error("failed to decode snapshot image"));
		image.src = dataUrl;
	});
}

function luma(r: number, g: number, b: number): number {
	return (r * 0.2126) + (g * 0.7152) + (b * 0.0722);
}
