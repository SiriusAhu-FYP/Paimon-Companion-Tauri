import { useCallback, useState } from "react";
import { Divider } from "@mui/material";
import {
	useRuntime,
	useCompanionRuntime,
	useCompanionMode,
	useDebugCaptureState,
	useFunctional,
	useUnifiedRuntime,
} from "@/hooks";
import { useI18n } from "@/contexts/I18nProvider";
import { getServices } from "@/services";
import { createLogger } from "@/services/logger";
import { chooseWindowByKeywords } from "@/services/games/game-utils";
import { listWindows } from "@/services/system";
import type { HostWindowInfo } from "@/types";
import { PanelRoot } from "./panel-shell";
import {
	DebugCaptureCard,
	InteractionModeCard,
	RuntimeStateCard,
} from "./control-panel-cards";

const log = createLogger("control-panel");

export function ControlPanel() {
	const { t } = useI18n();
	const { mode, stop, resume } = useRuntime();
	const companionMode = useCompanionMode();
	const { state: companionRuntimeState, start: startCompanionRuntime, stop: stopCompanionRuntime } = useCompanionRuntime();
	const { state: unifiedState, stopDelegationLoop, submitDelegationTaskInstruction, runModePreflight } = useUnifiedRuntime();
	const { state: functionalState, setTarget, runFocus } = useFunctional();
	const debugCapture = useDebugCaptureState();
	const [delegationTaskText, setDelegationTaskText] = useState(() =>
		t("请根据当前页面完成目标：例如打开最新的 README 并总结重点。", "Complete a goal on the current page, for example open the latest README and summarize key points."),
	);
	const [windowList, setWindowList] = useState<HostWindowInfo[]>([]);
	const [windowsLoading, setWindowsLoading] = useState(false);
	const companionRunning = companionRuntimeState.running;
	const delegationRunning = unifiedState.loopActive || unifiedState.activeRunId !== null;

	const startCompanionInteraction = useCallback(async () => {
		const target = await runModePreflight("companion");
		await startCompanionRuntime(target);
	}, [runModePreflight, startCompanionRuntime]);

	const stopInteractionForMode = useCallback((modeToStop: "companion" | "delegated") => {
		if (modeToStop === "delegated") {
			stopDelegationLoop("control-panel-stop");
			return;
		}
		stopCompanionRuntime();
	}, [stopCompanionRuntime, stopDelegationLoop]);

	const handleExecuteDelegationTask = useCallback(async () => {
		const text = delegationTaskText.trim();
		if (!text) {
			return;
		}
		await submitDelegationTaskInstruction(text);
	}, [delegationTaskText, submitDelegationTaskInstruction]);

	const handleModeChange = useCallback(async (nextMode: "companion" | "delegated") => {
		const currentMode = companionMode.mode;
		if (currentMode === nextMode) {
			return;
		}
		const shouldStopCurrent = currentMode === "delegated" ? delegationRunning : companionRunning;
		if (shouldStopCurrent) {
			stopInteractionForMode(currentMode);
		}
		getServices().companionMode.setMode(nextMode, "control-panel-toggle", "manual");
	}, [companionMode.mode, companionRunning, delegationRunning, stopInteractionForMode]);

	const handleStartCompanion = useCallback(async () => {
		try {
			await startCompanionInteraction();
		} catch (err) {
			log.error("failed to start companion interaction", err);
		}
	}, [startCompanionInteraction]);

	const handleExecuteDelegationTaskSafe = useCallback(async () => {
		try {
			await handleExecuteDelegationTask();
		} catch (err) {
			log.error("failed to execute delegation task", err);
		}
	}, [handleExecuteDelegationTask]);

	const handleFocusFirefox = useCallback(async () => {
		setWindowsLoading(true);
		try {
			const windows = await listWindows();
			setWindowList(windows);
			const candidate = chooseWindowByKeywords(windows, {
				keywords: ["firefox", "mozilla firefox"],
				processKeywords: ["firefox"],
				visibleBonus: 2,
				normalBonus: 2,
			});
			if (!candidate) {
				throw new Error("未检测到 Firefox 窗口，请确认浏览器已打开且可见。");
			}
			const target = { handle: candidate.handle, title: candidate.title };
			setTarget(target);
			await runFocus(target, { applyDelegatedViewport: true });
		} catch (err) {
			log.error("failed to focus firefox from control panel", err);
		} finally {
			setWindowsLoading(false);
		}
	}, [runFocus, setTarget]);

	const handleEnumerateWindows = useCallback(async () => {
		setWindowsLoading(true);
		try {
			const windows = await listWindows();
			setWindowList(windows);
		} finally {
			setWindowsLoading(false);
		}
	}, []);

	const handleFocusWindowFromList = useCallback(async (windowInfo: HostWindowInfo) => {
		const target = { handle: windowInfo.handle, title: windowInfo.title };
		setTarget(target);
		await runFocus(target, { applyDelegatedViewport: true });
	}, [runFocus, setTarget]);

	const handleToggleDebugCapture = useCallback(async () => {
		const { debugCapture: debugCaptureService } = getServices();
		await debugCaptureService.setEnabled(!debugCapture.enabled);
	}, [debugCapture.enabled]);

	return (
		<PanelRoot title={t("陪伴面板", "Companion Panel")}>
			<RuntimeStateCard mode={mode} onStop={stop} onResume={resume} />

			<Divider />

			<DebugCaptureCard state={debugCapture} onToggle={handleToggleDebugCapture} />

			<Divider />

			<InteractionModeCard
				mode={companionMode.mode}
				onModeChange={(nextMode) => { void handleModeChange(nextMode); }}
				companionRunning={companionRunning}
				delegationRunning={delegationRunning}
				delegationTaskText={delegationTaskText}
				delegationTaskPlaceholder={t("输入托管任务说明（由托管模式连续执行）", "Describe a Delegation Mode task to execute continuously")}
				windowList={windowList}
				windowsLoading={windowsLoading}
				selectedTargetHandle={functionalState.selectedTarget?.handle ?? null}
				onDelegationTaskTextChange={setDelegationTaskText}
				onStartCompanion={handleStartCompanion}
				onStopCompanion={() => stopInteractionForMode("companion")}
				onExecuteDelegationTask={handleExecuteDelegationTaskSafe}
				onStopDelegationTask={() => stopInteractionForMode("delegated")}
				onFocusFirefox={handleFocusFirefox}
				onEnumerateWindows={handleEnumerateWindows}
				onFocusWindowFromList={handleFocusWindowFromList}
			/>
		</PanelRoot>
	);
}
