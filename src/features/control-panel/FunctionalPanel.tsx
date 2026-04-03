import { useState, useCallback, useMemo } from "react";
import {
	Alert,
	Box,
	Button,
	CircularProgress,
	Chip,
	Stack,
	TextField,
	Typography,
} from "@mui/material";
import MicIcon from "@mui/icons-material/Mic";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import CancelIcon from "@mui/icons-material/Cancel";
import { useEvaluation, useFunctional, useGame2048, useStardew } from "@/hooks";
import { HelpTooltip } from "@/components";
import { listWindows } from "@/services/system";
import { FunctionalDebugPanel } from "./FunctionalDebugPanel";
import type { HostWindowInfo, StardewTaskId } from "@/types";
import { createLogger } from "@/services/logger";

const log = createLogger("functional-panel");
const WINDOW_LIST_PREVIEW_LIMIT = 40;

export function FunctionalPanel() {
	const {
		state: functionalState,
		setTarget,
		clearHistory,
		runCapture,
		runFocus,
		runKey,
		runMouse,
	} = useFunctional();
	const { state: game2048State, detectTarget, runSingleStep } = useGame2048();
	const {
		state: stardewState,
		detectTarget: detectStardewTarget,
		setSelectedTask: setSelectedStardewTask,
		runTask: runStardewTask,
	} = useStardew();
	const { state: evaluationState, runCase } = useEvaluation();

	const [micStatus, setMicStatus] = useState<"idle" | "ok" | "denied" | "error">("idle");
	const [windowsLoading, setWindowsLoading] = useState(false);
	const [windowList, setWindowList] = useState<HostWindowInfo[]>([]);
	const [windowListError, setWindowListError] = useState<string | null>(null);
	const [windowQuery, setWindowQuery] = useState("");
	const [manualKey, setManualKey] = useState("Enter");

	const functionalError =
		functionalState.safetyBlockedReason
		?? (functionalState.latestTask?.status === "failed" ? functionalState.latestTask.error : null);
	const game2048Error = game2048State.lastRun?.status === "failed" ? game2048State.lastRun.error : null;
	const stardewError = stardewState.lastRun?.status === "failed" ? stardewState.lastRun.error : null;
	const evaluationError = evaluationState.latestResult?.status === "failed" ? evaluationState.latestResult.summary : null;

	const filteredWindowList = useMemo(() => {
		const query = windowQuery.trim().toLowerCase();
		if (!query) {
			return windowList;
		}

		return windowList.filter((windowInfo) => {
			const haystack = [
				windowInfo.title,
				windowInfo.processName,
				windowInfo.className,
				windowInfo.handle,
				String(windowInfo.processId),
			]
				.join(" ")
				.toLowerCase();

			return haystack.includes(query);
		});
	}, [windowList, windowQuery]);

	const visibleWindowList = useMemo(
		() => filteredWindowList.slice(0, WINDOW_LIST_PREVIEW_LIMIT),
		[filteredWindowList],
	);

	const handleMicTest = useCallback(async () => {
		try {
			const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
			const ctx = new AudioContext();
			const source = ctx.createMediaStreamSource(stream);
			const analyser = ctx.createAnalyser();
			analyser.fftSize = 256;
			source.connect(analyser);

			const dataArray = new Uint8Array(analyser.frequencyBinCount);
			analyser.getByteFrequencyData(dataArray);
			const avg = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
			log.info(`mic test OK — avg volume: ${avg.toFixed(1)}`);

			stream.getTracks().forEach((track) => track.stop());
			ctx.close();
			setMicStatus("ok");
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			log.error("mic test failed", msg);
			setMicStatus(msg.includes("denied") || msg.includes("NotAllowed") ? "denied" : "error");
		}
	}, []);

	const handleListWindows = useCallback(async () => {
		setWindowsLoading(true);
		setWindowListError(null);

		try {
			const result = await listWindows();
			setWindowList(result);
			log.info("desktop windows refreshed", {
				count: result.length,
				top: result.slice(0, 5).map((windowInfo) => ({
					title: windowInfo.title,
					processId: windowInfo.processId,
				})),
			});
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			setWindowListError(message);
			log.error("failed to list desktop windows", err);
		} finally {
			setWindowsLoading(false);
		}
	}, []);

	const selectWindowTarget = useCallback((windowInfo: HostWindowInfo) => {
		setTarget({ handle: windowInfo.handle, title: windowInfo.title });
		log.info("selected functional target", {
			handle: windowInfo.handle,
			title: windowInfo.title,
		});
	}, [setTarget]);

	const handleFocusWindow = useCallback(async (windowInfo: HostWindowInfo) => {
		const target = { handle: windowInfo.handle, title: windowInfo.title };
		setTarget(target);

		try {
			await runFocus(target);
		} catch (err) {
			log.error("failed to focus window", err);
		}
	}, [runFocus, setTarget]);

	const handleCaptureWindow = useCallback(async (windowInfo: HostWindowInfo) => {
		const target = { handle: windowInfo.handle, title: windowInfo.title };
		setTarget(target);

		try {
			await runCapture(target);
		} catch (err) {
			log.error("failed to capture window", err);
		}
	}, [runCapture, setTarget]);

	const handleSendKey = useCallback(async (key: string) => {
		if (!functionalState.selectedTarget || !key.trim()) return;

		try {
			await runKey(key.trim(), functionalState.selectedTarget);
		} catch (err) {
			log.error("failed to send key", err);
		}
	}, [functionalState.selectedTarget, runKey]);

	const handleMouseClickCenter = useCallback(async () => {
		if (!functionalState.selectedTarget) return;

		try {
			await runMouse({ action: "click", button: "left" }, functionalState.selectedTarget);
		} catch (err) {
			log.error("failed to send mouse", err);
		}
	}, [functionalState.selectedTarget, runMouse]);

	const handleRun2048Step = useCallback(async () => {
		try {
			await runSingleStep(functionalState.selectedTarget ?? undefined);
		} catch (err) {
			log.error("failed to run 2048 single step", err);
		}
	}, [functionalState.selectedTarget, runSingleStep]);

	const handleDetect2048Target = useCallback(async () => {
		try {
			await detectTarget();
		} catch (err) {
			log.error("failed to detect 2048 target", err);
		}
	}, [detectTarget]);

	const handleRunEvaluationCase = useCallback(async (caseId: string) => {
		try {
			await runCase(caseId);
		} catch (err) {
			log.error("failed to run evaluation case", err);
		}
	}, [runCase]);

	const handleDetectStardewTarget = useCallback(async () => {
		try {
			await detectStardewTarget();
		} catch (err) {
			log.error("failed to detect Stardew target", err);
		}
	}, [detectStardewTarget]);

	const handleRunStardewTask = useCallback(async (taskId?: StardewTaskId) => {
		try {
			await runStardewTask(taskId, functionalState.selectedTarget ?? undefined);
		} catch (err) {
			log.error("failed to run Stardew task", err);
		}
	}, [functionalState.selectedTarget, runStardewTask]);

	return (
		<Box sx={{ p: 1.5, display: "flex", flexDirection: "column", gap: 1 }}>
			<Typography variant="subtitle2" sx={{ color: "primary.main", fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5 }}>
				功能实验
			</Typography>

			<Box>
				<Stack direction="row" alignItems="center" sx={{ mb: 0.5 }}>
					<Typography variant="caption" color="text.secondary" fontWeight={600}>Spike 验证</Typography>
					<HelpTooltip title="测试麦克风、窗口枚举和宿主输入能力。" />
				</Stack>
				<Stack direction="row" spacing={0.5} alignItems="center">
					<Button variant="outlined" size="small" onClick={handleMicTest} startIcon={<MicIcon />}>
						麦克风测试
					</Button>
					{micStatus === "ok" && <CheckCircleIcon color="success" sx={{ fontSize: 14 }} />}
					{micStatus === "denied" && <CancelIcon color="error" sx={{ fontSize: 14 }} />}
					{micStatus === "error" && <CancelIcon color="error" sx={{ fontSize: 14 }} />}
				</Stack>

				<Stack direction="row" spacing={0.5} alignItems="center" sx={{ mt: 0.75 }}>
					<Button variant="outlined" size="small" onClick={handleListWindows} disabled={windowsLoading}>
						{windowsLoading ? "枚举中..." : "枚举窗口"}
					</Button>
					<Typography variant="caption" color="text.secondary">
						{windowList.length > 0 ? `${filteredWindowList.length} / ${windowList.length} 个窗口` : "尚未获取窗口列表"}
					</Typography>
				</Stack>

				{windowList.length > 0 && (
					<Stack direction="row" spacing={0.5} alignItems="center" sx={{ mt: 0.75 }}>
						<TextField
							size="small"
							fullWidth
							value={windowQuery}
							onChange={(event) => setWindowQuery(event.target.value)}
							placeholder="搜索标题 / 进程名 / 类名，例如 原神、YuanShen、firefox"
						/>
						<Button size="small" variant="text" onClick={() => setWindowQuery("")} disabled={!windowQuery.trim()}>
							清空
						</Button>
					</Stack>
				)}

				{windowListError && (
					<Alert severity="error" sx={{ mt: 0.75, py: 0 }}>
						{windowListError}
					</Alert>
				)}

				{functionalError && (
					<Alert severity="error" sx={{ mt: 0.75, py: 0 }}>
						{functionalError}
					</Alert>
				)}

				{windowList.length > 0 && (
					<Box sx={{ mt: 0.75, maxHeight: 220, overflowY: "auto", pr: 0.5 }}>
						<Stack spacing={0.5}>
							{visibleWindowList.map((windowInfo) => (
								<Box
									key={windowInfo.handle}
									sx={{
										bgcolor: "background.paper",
										borderRadius: 1,
										p: 0.75,
										border: "1px solid",
										borderColor: "divider",
									}}
								>
									<Typography variant="caption" sx={{ display: "block", color: "text.primary" }}>
										{windowInfo.title}
									</Typography>
									<Typography variant="caption" color="text.secondary" sx={{ display: "block", fontSize: 10 }}>
										PID {windowInfo.processId} · {windowInfo.processName || "unknown"} · {windowInfo.className} · {windowInfo.visible ? "visible" : "hidden"} · {windowInfo.minimized ? "minimized" : "normal"}
									</Typography>
									<Stack direction="row" justifyContent="flex-end" spacing={0.25} sx={{ mt: 0.5, flexWrap: "wrap" }}>
										<Button
											size="small"
											variant={functionalState.selectedTarget?.handle === windowInfo.handle ? "contained" : "text"}
											onClick={() => selectWindowTarget(windowInfo)}
											sx={{ minWidth: 0, fontSize: 11, px: 0.5 }}
										>
											目标
										</Button>
										<Button
											size="small"
											variant="text"
											onClick={() => handleFocusWindow(windowInfo)}
											disabled={functionalState.activeTaskId !== null}
											sx={{ minWidth: 0, fontSize: 11, px: 0.5 }}
										>
											聚焦
										</Button>
										<Button
											size="small"
											variant="text"
											onClick={() => handleCaptureWindow(windowInfo)}
											disabled={functionalState.activeTaskId !== null}
											sx={{ minWidth: 0, fontSize: 11, px: 0.5 }}
										>
											截图
										</Button>
									</Stack>
								</Box>
							))}
						</Stack>
						{filteredWindowList.length > WINDOW_LIST_PREVIEW_LIMIT && (
							<Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.75 }}>
								当前仅展示前 {WINDOW_LIST_PREVIEW_LIMIT} 条，请继续搜索以缩小范围。
							</Typography>
						)}
						{filteredWindowList.length === 0 && (
							<Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.75 }}>
								没有匹配当前搜索词的窗口。
							</Typography>
						)}
					</Box>
				)}

				{functionalState.activeTaskId && (
					<Stack direction="row" spacing={0.5} alignItems="center" sx={{ mt: 0.75 }}>
						<CircularProgress size={12} />
						<Typography variant="caption" color="text.secondary">
							正在执行：{functionalState.latestTask?.name ?? "功能任务"}
						</Typography>
					</Stack>
				)}

				{functionalState.selectedTarget && (
					<Box sx={{ mt: 0.75, p: 0.75, border: "1px solid", borderColor: "divider", borderRadius: 1 }}>
						<Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.5 }}>
							当前目标：{functionalState.selectedTarget.title || functionalState.selectedTarget.handle}
						</Typography>
						<Stack direction="row" spacing={0.5} sx={{ mb: 0.5, flexWrap: "wrap" }}>
							<Button size="small" variant="outlined" onClick={() => runFocus(functionalState.selectedTarget ?? undefined)} disabled={functionalState.activeTaskId !== null}>
								聚焦目标
							</Button>
							<Button size="small" variant="outlined" onClick={() => runCapture(functionalState.selectedTarget ?? undefined)} disabled={functionalState.activeTaskId !== null}>
								截图目标
							</Button>
							<Button size="small" variant="outlined" onClick={handleMouseClickCenter} disabled={functionalState.activeTaskId !== null}>
								点击中心
							</Button>
							<Button size="small" variant="outlined" onClick={() => handleSendKey("Enter")} disabled={functionalState.activeTaskId !== null}>
								发送 Enter
							</Button>
							<Button size="small" variant="outlined" onClick={() => handleSendKey("Space")} disabled={functionalState.activeTaskId !== null}>
								发送 Space
							</Button>
						</Stack>
						<Stack direction="row" spacing={0.5} sx={{ mb: 0.5, flexWrap: "wrap" }}>
							<Button size="small" variant="text" onClick={() => handleSendKey("Up")} disabled={functionalState.activeTaskId !== null}>Up</Button>
							<Button size="small" variant="text" onClick={() => handleSendKey("Down")} disabled={functionalState.activeTaskId !== null}>Down</Button>
							<Button size="small" variant="text" onClick={() => handleSendKey("Left")} disabled={functionalState.activeTaskId !== null}>Left</Button>
							<Button size="small" variant="text" onClick={() => handleSendKey("Right")} disabled={functionalState.activeTaskId !== null}>Right</Button>
						</Stack>
						<Stack direction="row" spacing={0.5}>
							<TextField
								size="small"
								fullWidth
								value={manualKey}
								onChange={(event) => setManualKey(event.target.value)}
								placeholder="输入单键或命名键，如 Enter / Up / a"
							/>
							<Button
								size="small"
								variant="contained"
								onClick={() => handleSendKey(manualKey)}
								disabled={!manualKey.trim() || functionalState.activeTaskId !== null}
							>
								发送
							</Button>
						</Stack>
					</Box>
				)}
			</Box>

			<Box sx={{ p: 0.75, border: "1px solid", borderColor: "divider", borderRadius: 1 }}>
				<Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 0.5 }}>
					<Typography variant="caption" color="text.secondary" fontWeight={600}>
						2048 最小闭环
					</Typography>
					<Chip
						label={game2048State.activeRunId ? "运行中" : "待命"}
						size="small"
						color={game2048State.activeRunId ? "warning" : "default"}
						sx={{ height: 18, fontSize: 10 }}
					/>
				</Stack>
				<Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.5 }}>
					策略：{game2048State.lastRun?.analysis.strategy ?? "默认优先尝试 Up -> Left -> Right -> Down；如果当前 LLM 支持图像输入，会优先使用截图分析来排序候选方向。"}
				</Typography>
				<Stack direction="row" spacing={0.5} sx={{ mb: 0.75, flexWrap: "wrap" }}>
					<Button size="small" variant="outlined" onClick={handleDetect2048Target} disabled={functionalState.activeTaskId !== null || game2048State.activeRunId !== null}>
						自动检测 2048 窗口
					</Button>
					<Button size="small" variant="contained" onClick={handleRun2048Step} disabled={functionalState.activeTaskId !== null || game2048State.activeRunId !== null}>
						运行 2048 单步
					</Button>
				</Stack>
				{game2048State.detectionSummary && (
					<Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.5 }}>
						检测：{game2048State.detectionSummary}
					</Typography>
				)}
				<Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.5 }}>
					候选目标：{game2048State.detectedTarget?.title ?? "尚未检测"}
				</Typography>
				{game2048Error && (
					<Alert severity="error" sx={{ mb: 0.75, py: 0 }}>
						{game2048Error}
					</Alert>
				)}
				<Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.25 }}>
					最近结果：{game2048State.lastRun?.summary ?? "尚未执行"}
				</Typography>
				<Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
					分析源：{game2048State.lastRun?.analysis.source ?? "—"} · 尝试数：{game2048State.lastRun?.attempts.length ?? 0}
				</Typography>
			</Box>

			<Box sx={{ p: 0.75, border: "1px solid", borderColor: "divider", borderRadius: 1 }}>
				<Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 0.5 }}>
					<Typography variant="caption" color="text.secondary" fontWeight={600}>
						Stardew Valley 扩展
					</Typography>
					<Chip
						label={stardewState.activeRunId ? "运行中" : "待命"}
						size="small"
						color={stardewState.activeRunId ? "warning" : "default"}
						sx={{ height: 18, fontSize: 10 }}
					/>
				</Stack>
				<Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.5 }}>
					首批小任务：角色微移动、打开背包、关闭菜单。移动任务会优先使用截图分析来排序 `W/A/D/S`。
				</Typography>
				<Stack direction="row" spacing={0.5} sx={{ mb: 0.75, flexWrap: "wrap" }}>
					<Button size="small" variant="outlined" onClick={handleDetectStardewTarget} disabled={functionalState.activeTaskId !== null || stardewState.activeRunId !== null}>
						自动检测 Stardew
					</Button>
					{stardewState.availableTasks.map((task) => (
						<Button
							key={task.id}
							size="small"
							variant={stardewState.selectedTaskId === task.id ? "contained" : "outlined"}
							onClick={() => setSelectedStardewTask(task.id)}
							disabled={functionalState.activeTaskId !== null || stardewState.activeRunId !== null}
						>
							{task.name}
						</Button>
					))}
				</Stack>
				<Button size="small" variant="contained" onClick={() => handleRunStardewTask()} disabled={functionalState.activeTaskId !== null || stardewState.activeRunId !== null} sx={{ mb: 0.75 }}>
					运行 Stardew 小任务
				</Button>
				{stardewState.detectionSummary && (
					<Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.5 }}>
						检测：{stardewState.detectionSummary}
					</Typography>
				)}
				<Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.5 }}>
					候选目标：{stardewState.detectedTarget?.title ?? "尚未检测"}
				</Typography>
				{stardewError && (
					<Alert severity="error" sx={{ mb: 0.75, py: 0 }}>
						{stardewError}
					</Alert>
				)}
				<Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.25 }}>
					最近结果：{stardewState.lastRun?.summary ?? "尚未执行"}
				</Typography>
				<Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
					任务：{stardewState.lastRun?.taskId ?? stardewState.selectedTaskId} · 分析源：{stardewState.lastRun?.analysis.source ?? "—"} · 尝试数：{stardewState.lastRun?.attempts.length ?? 0}
				</Typography>
			</Box>

			<Box sx={{ p: 0.75, border: "1px solid", borderColor: "divider", borderRadius: 1 }}>
				<Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 0.5 }}>
					<Typography variant="caption" color="text.secondary" fontWeight={600}>
						Functional Evaluation Harness
					</Typography>
					<Chip
						label={evaluationState.activeCaseId ? "评测中" : "就绪"}
						size="small"
						color={evaluationState.activeCaseId ? "warning" : "default"}
						sx={{ height: 18, fontSize: 10 }}
					/>
				</Stack>
				<Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.5 }}>
					固定 case 会重复运行 2048 或 Stardew 小任务，并聚合成功率、动作有效率和延迟。
				</Typography>
				<Stack spacing={0.5} sx={{ mb: 0.75 }}>
					{evaluationState.availableCases.map((definition) => (
						<Box
							key={definition.id}
							sx={{
								bgcolor: "background.paper",
								borderRadius: 1,
								p: 0.75,
								border: "1px solid",
								borderColor: "divider",
							}}
						>
							<Typography variant="caption" sx={{ display: "block", color: "text.primary" }}>
								{definition.name}
							</Typography>
							<Typography variant="caption" color="text.secondary" sx={{ display: "block", fontSize: 10, mb: 0.5 }}>
								[{definition.game}] {definition.description} · {definition.iterations} 次
							</Typography>
							<Button
								size="small"
								variant="outlined"
								onClick={() => handleRunEvaluationCase(definition.id)}
								disabled={evaluationState.activeCaseId !== null || game2048State.activeRunId !== null || functionalState.activeTaskId !== null}
							>
								运行 Case
							</Button>
						</Box>
					))}
				</Stack>
				{evaluationError && (
					<Alert severity="error" sx={{ mb: 0.75, py: 0 }}>
						{evaluationError}
					</Alert>
				)}
				<Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.25 }}>
					最近评测：{evaluationState.latestResult?.caseName ?? "尚未执行"}
				</Typography>
				<Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
					成功率：{evaluationState.latestResult ? `${(evaluationState.latestResult.metrics.successRate * 100).toFixed(0)}%` : "—"} · 平均延迟：{evaluationState.latestResult ? `${evaluationState.latestResult.metrics.averageLatencyMs.toFixed(0)}ms` : "—"}
				</Typography>
			</Box>

			<FunctionalDebugPanel
				functionalState={functionalState}
				game2048State={game2048State}
				stardewState={stardewState}
				evaluationState={evaluationState}
				onClearTaskHistory={clearHistory}
			/>
		</Box>
	);
}
