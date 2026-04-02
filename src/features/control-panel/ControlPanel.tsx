import { useState, useEffect, useCallback } from "react";
import {
	Box, Button, Typography, Stack, Chip, Divider,
	Select, MenuItem, TextField,
	CircularProgress,
	Alert,
	type SelectChangeEvent,
} from "@mui/material";
import StopIcon from "@mui/icons-material/Stop";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import MicIcon from "@mui/icons-material/Mic";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import CancelIcon from "@mui/icons-material/Cancel";
import { useRuntime, useCharacter, useFunctional, useGame2048, useEvaluation } from "@/hooks";
import { HelpTooltip } from "@/components";
import { getServices } from "@/services";
import { type AppConfig, DEFAULT_CONFIG, loadConfig, updateConfig, getConfig } from "@/services/config";
import { listWindows } from "@/services/system";
import { mockVoicePipeline, MOCK_CHARACTER_PROFILE } from "@/utils/mock";
import type { CharacterProfile, HostWindowInfo } from "@/types";
import { createLogger } from "@/services/logger";

const log = createLogger("control-panel");

export function ControlPanel() {
	const { mode, stop, resume } = useRuntime();
	const { emotion, isSpeaking } = useCharacter();
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
	const { state: evaluationState, runCase } = useEvaluation();

	// ── 角色切换 ──
	const [profiles, setProfiles] = useState<CharacterProfile[]>([]);
	const [selectedId, setSelectedId] = useState<string>("__manual__");

	useEffect(() => {
		const { character } = getServices();
		const available = character.getAvailableProfiles();
		setProfiles([...available]);

		const current = character.getProfile();
		setSelectedId(current?.id ?? "__manual__");
	}, []);

	const handleCharacterSwitch = useCallback(async (e: SelectChangeEvent<string>) => {
		const id = e.target.value;
		const { character, llm } = getServices();

		if (id === "__manual__") {
			character.loadFromProfile(MOCK_CHARACTER_PROFILE);
			setSelectedId(MOCK_CHARACTER_PROFILE.id);
			llm.clearHistory();
			await updateConfig({ character: { ...getConfig().character, activeProfileId: "" } });
			log.info("switched to manual/default character");
			return;
		}

		const profile = character.findProfileById(id);
		if (!profile) return;

		character.loadFromProfile(profile);
		setSelectedId(profile.id);
		llm.clearHistory();

		await updateConfig({ character: { ...getConfig().character, activeProfileId: profile.id } });
		log.info(`switched to character: ${profile.name} (${profile.id})`);
	}, []);

	// ── 角色设置 & 输出行为约束（从 SettingsPanel 迁入） ──
	const [config, setConfig] = useState<AppConfig>(DEFAULT_CONFIG);

	useEffect(() => {
		let cancelled = false;
		(async () => {
			const loaded = await loadConfig();
			if (cancelled) return;
			setConfig(loaded);
		})();
		return () => { cancelled = true; };
	}, []);

	const updateCharacter = useCallback((patch: Partial<AppConfig["character"]>) => {
		setConfig((c) => ({ ...c, character: { ...c.character, ...patch } }));
	}, []);

	// ── 上下文注入 ──
	const [referenceText, setReferenceText] = useState("");
	const [taskContextText, setTaskContextText] = useState("");

	const handleAddReference = useCallback(() => {
		const text = referenceText.trim();
		if (!text) return;
		const { knowledge } = getServices();
		knowledge.addLiveContext({ id: `reference-${Date.now()}`, content: text, priority: 1, expiresAt: null });
		setReferenceText("");
		log.info("reference context added");
	}, [referenceText]);

	const handleAddTaskContext = useCallback(() => {
		const text = taskContextText.trim();
		if (!text) return;
		const { knowledge } = getServices();
		knowledge.addLiveContext({ id: `task-${Date.now()}`, content: text, priority: 10, expiresAt: null });
		setTaskContextText("");
		log.info("task context added");
	}, [taskContextText]);

	const handleClearContext = useCallback(() => {
		const { knowledge } = getServices();
		knowledge.clearLiveContext();
		log.info("manual context cleared");
	}, []);

	// ── Mock 测试 ──
	const handleMockPipeline = async () => {
		const { bus, runtime } = getServices();
		await mockVoicePipeline(bus, runtime);
	};

	const [micStatus, setMicStatus] = useState<"idle" | "ok" | "denied" | "error">("idle");
	const [windowsLoading, setWindowsLoading] = useState(false);
	const [windowList, setWindowList] = useState<HostWindowInfo[]>([]);
	const [windowListError, setWindowListError] = useState<string | null>(null);
	const [manualKey, setManualKey] = useState("Enter");

	const functionalError =
		functionalState.safetyBlockedReason
		?? (functionalState.latestTask?.status === "failed" ? functionalState.latestTask.error : null);
	const game2048Error = game2048State.lastRun?.status === "failed" ? game2048State.lastRun.error : null;
	const evaluationError = evaluationState.latestResult?.status === "failed" ? evaluationState.latestResult.summary : null;

	const handleMicTest = async () => {
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

			stream.getTracks().forEach((t) => t.stop());
			ctx.close();
			setMicStatus("ok");
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			log.error("mic test failed", msg);
			setMicStatus(msg.includes("denied") || msg.includes("NotAllowed") ? "denied" : "error");
		}
	};

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

	return (
		<Box sx={{ p: 1.5, display: "flex", flexDirection: "column", gap: 1 }}>
			<Typography variant="subtitle2" sx={{ color: "primary.main", fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5 }}>
				控制面板
			</Typography>

			{/* 运行状态 */}
			<Box sx={{
				bgcolor: "background.paper", borderRadius: 1, p: 1,
				...(mode === "stopped" && { border: "1px solid", borderColor: "error.main", bgcolor: "error.dark" }),
			}}>
				<Stack direction="row" alignItems="center" sx={{ mb: 0.5 }}>
					<Typography variant="caption" color="text.secondary" fontWeight={600}>运行状态</Typography>
					<HelpTooltip title="急停：立即停止所有活动；恢复：回到自动模式" />
				</Stack>
				<Stack direction="row" spacing={0.5} alignItems="center" sx={{ mb: 0.5 }}>
					<Typography variant="body2">
						模式：<strong>{mode}</strong>
					</Typography>
					{mode === "stopped" && (
						<Chip label="STOPPED" size="small" color="error" sx={{ height: 18, fontSize: 10 }} />
					)}
				</Stack>
				<Stack direction="row" spacing={0.5}>
					<Button variant="outlined" size="small" onClick={stop} disabled={mode === "stopped"} startIcon={<StopIcon />} color="error">
						急停
					</Button>
					<Button variant="outlined" size="small" onClick={resume} disabled={mode === "auto"} startIcon={<PlayArrowIcon />}>
						恢复
					</Button>
				</Stack>
			</Box>

			<Divider />

			{/* 角色切换 */}
			<Box sx={{ bgcolor: "background.paper", borderRadius: 1, p: 1 }}>
				<Typography variant="caption" color="text.secondary" fontWeight={600} sx={{ mb: 0.5, display: "block" }}>
					当前读取：{profiles.find((p) => p.id === selectedId)?.name ?? "手动人设"}
				</Typography>
				<Select
					size="small" fullWidth
					value={selectedId}
					onChange={handleCharacterSwitch}
					displayEmpty
					sx={{ fontSize: 13, mb: 0.5 }}
				>
					<MenuItem value="__manual__">
						<em>手动人设</em>
					</MenuItem>
					{profiles.map((p) => (
						<MenuItem key={p.id} value={p.id}>{p.name}</MenuItem>
					))}
				</Select>
				<Typography variant="body2">情绪：{emotion}</Typography>
				<Typography variant="body2">说话中：{isSpeaking ? "是" : "否"}</Typography>
			</Box>

			<Divider />

			{/* 角色设置 */}
			<Box sx={{ bgcolor: "background.paper", borderRadius: 1, p: 1, display: "flex", flexDirection: "column", gap: 0.75 }}>
				<Stack direction="row" alignItems="center" spacing={0.5}>
					<Typography variant="caption" color="text.secondary" fontWeight={600} sx={{ fontSize: 11 }}>自定义人设</Typography>
					<HelpTooltip title="仅在未选择角色卡时生效，优先级最低。角色卡内设定 > 自定义人设。" />
				</Stack>
				<TextField
					size="small" fullWidth multiline minRows={3} maxRows={6}
					value={config.character.customPersona}
					onChange={(e) => updateCharacter({ customPersona: e.target.value })}
					onBlur={() => updateConfig({ character: { ...config.character } })}
				/>
			</Box>

			<Divider />

			{/* 输出行为约束 */}
			<Box sx={{ bgcolor: "background.paper", borderRadius: 1, p: 1, display: "flex", flexDirection: "column", gap: 0.75 }}>
				<Stack direction="row" alignItems="center" spacing={0.5}>
					<Typography variant="caption" color="text.secondary" fontWeight={600} sx={{ fontSize: 11 }}>输出行为约束</Typography>
					<HelpTooltip title="在 system prompt 最前面注入行为规则，优先级高于角色卡设定。约束回复格式与风格，不覆盖角色个性。" />
				</Stack>
				<Stack direction="row" spacing={1} alignItems="center">
					<Typography variant="caption" sx={{ fontSize: 11 }}>启用约束</Typography>
					<Button size="small"
						variant={config.character.behaviorConstraints.enabled ? "contained" : "outlined"}
						color={config.character.behaviorConstraints.enabled ? "primary" : "inherit"}
						onClick={() => {
							const next = !config.character.behaviorConstraints.enabled;
							setConfig((c) => ({ ...c, character: { ...c.character, behaviorConstraints: { ...c.character.behaviorConstraints, enabled: next } } }));
							updateConfig({ character: { ...config.character, behaviorConstraints: { ...config.character.behaviorConstraints, enabled: next } } });
						}}
						sx={{ minWidth: 60, fontSize: 11 }}>
						{config.character.behaviorConstraints.enabled ? "已启用" : "未启用"}
					</Button>
				</Stack>
				{config.character.behaviorConstraints.enabled && (
					<>
						<Stack direction="row" alignItems="center" spacing={0.5}>
							<Typography variant="caption" color="text.secondary" sx={{ fontSize: 11 }}>最大回复字数</Typography>
							<HelpTooltip title="LLM 单次回复的建议字数上限。实际输出可能略有浮动。" />
						</Stack>
						<TextField
							size="small" type="number" sx={{ width: 120 }}
							value={config.character.behaviorConstraints.maxReplyLength}
							onChange={(e) => {
								const v = Math.max(20, Math.min(500, Number(e.target.value) || 150));
								setConfig((c) => ({ ...c, character: { ...c.character, behaviorConstraints: { ...c.character.behaviorConstraints, maxReplyLength: v } } }));
							}}
							onBlur={() => updateConfig({ character: { ...config.character } })}
							inputProps={{ min: 20, max: 500, step: 10 }}
						/>
						<Stack direction="row" alignItems="center" spacing={0.5}>
							<Typography variant="caption" color="text.secondary" sx={{ fontSize: 11 }}>自定义追加规则</Typography>
							<HelpTooltip title="追加的自定义行为约束文本，会拼入约束段落末尾。" />
						</Stack>
						<TextField
							size="small" fullWidth multiline minRows={2} maxRows={4}
							placeholder="例：每句话结尾加上「哦」"
							value={config.character.behaviorConstraints.customRules}
							onChange={(e) => {
								setConfig((c) => ({ ...c, character: { ...c.character, behaviorConstraints: { ...c.character.behaviorConstraints, customRules: e.target.value } } }));
							}}
							onBlur={() => updateConfig({ character: { ...config.character } })}
						/>
					</>
				)}
			</Box>

			<Divider />

			{/* 上下文注入 */}
			<Box sx={{ bgcolor: "background.paper", borderRadius: 1, p: 1 }}>
				<Stack direction="row" alignItems="center" sx={{ mb: 0.5 }}>
					<Typography variant="caption" color="text.secondary" fontWeight={600}>上下文注入</Typography>
					<HelpTooltip title="将参考信息或任务上下文注入 LLM 上下文，影响当前回复内容。" />
				</Stack>

				<Typography variant="caption" color="text.secondary" sx={{ fontSize: 10, display: "block", mb: 0.5 }}>
					参考信息
				</Typography>
				<Stack direction="row" spacing={0.5} sx={{ mb: 0.75 }}>
					<TextField
						size="small" fullWidth multiline maxRows={3}
						placeholder="例：当前画面里右上角有派蒙菜单提示"
						value={referenceText}
						onChange={(e) => setReferenceText(e.target.value)}
						sx={{ "& .MuiInputBase-input": { fontSize: 12 } }}
					/>
					<Button variant="outlined" size="small" onClick={handleAddReference} disabled={!referenceText.trim()} sx={{ minWidth: 48 }}>
						注入
					</Button>
				</Stack>

				<Typography variant="caption" color="text.secondary" sx={{ fontSize: 10, display: "block", mb: 0.5 }}>
					任务上下文
				</Typography>
				<Stack direction="row" spacing={0.5} sx={{ mb: 0.75 }}>
					<TextField
						size="small" fullWidth multiline maxRows={3}
						placeholder="例：当前目标是判断 2048 下一步方向"
						value={taskContextText}
						onChange={(e) => setTaskContextText(e.target.value)}
						sx={{ "& .MuiInputBase-input": { fontSize: 12 } }}
					/>
					<Button variant="outlined" size="small" onClick={handleAddTaskContext} disabled={!taskContextText.trim()} sx={{ minWidth: 48 }}>
						注入
					</Button>
				</Stack>

				<Button variant="text" size="small" color="warning" onClick={handleClearContext} sx={{ fontSize: 11 }}>
					清空手动上下文
				</Button>
			</Box>

			<Divider />

			{/* Spike 验证 */}
			<Box>
				<Stack direction="row" alignItems="center" sx={{ mb: 0.5 }}>
					<Typography variant="caption" color="text.secondary" fontWeight={600}>Spike 验证</Typography>
					<HelpTooltip title="测试麦克风硬件是否可用" />
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
						{windowList.length > 0 ? `${windowList.length} 个窗口` : "尚未获取窗口列表"}
					</Typography>
				</Stack>

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
					<Box sx={{ mt: 0.75, maxHeight: 180, overflowY: "auto", pr: 0.5 }}>
						<Stack spacing={0.5}>
							{windowList.slice(0, 12).map((windowInfo) => (
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
										PID {windowInfo.processId} · {windowInfo.className} · {windowInfo.visible ? "visible" : "hidden"} · {windowInfo.minimized ? "minimized" : "normal"}
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

				{functionalState.latestSnapshot && (
					<Box sx={{ mt: 0.75 }}>
						<Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.5 }}>
							截图预览：{functionalState.latestSnapshot.targetTitle} · {functionalState.latestSnapshot.width}x{functionalState.latestSnapshot.height}
						</Typography>
						<Box
							component="img"
							src={functionalState.latestSnapshot.dataUrl}
							alt={functionalState.latestSnapshot.targetTitle || "window capture"}
							sx={{
								width: "100%",
								maxHeight: 180,
								objectFit: "contain",
								bgcolor: "background.paper",
								borderRadius: 1,
								border: "1px solid",
								borderColor: "divider",
							}}
						/>
					</Box>
				)}

				{functionalState.selectedTarget && (
					<Box sx={{ mt: 0.75, p: 0.75, border: "1px solid", borderColor: "divider", borderRadius: 1 }}>
						<Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.5 }}>
							当前目标：{functionalState.selectedTarget.title || functionalState.selectedTarget.handle}
						</Typography>
						<Stack direction="row" spacing={0.5} sx={{ mb: 0.5, flexWrap: "wrap" }}>
							<Button
								size="small"
								variant="outlined"
								onClick={() => runFocus(functionalState.selectedTarget ?? undefined)}
								disabled={functionalState.activeTaskId !== null}
							>
								聚焦目标
							</Button>
							<Button
								size="small"
								variant="outlined"
								onClick={() => runCapture(functionalState.selectedTarget ?? undefined)}
								disabled={functionalState.activeTaskId !== null}
							>
								截图目标
							</Button>
							<Button
								size="small"
								variant="outlined"
								onClick={handleMouseClickCenter}
								disabled={functionalState.activeTaskId !== null}
							>
								点击中心
							</Button>
							<Button
								size="small"
								variant="outlined"
								onClick={() => handleSendKey("Enter")}
								disabled={functionalState.activeTaskId !== null}
							>
								发送 Enter
							</Button>
							<Button
								size="small"
								variant="outlined"
								onClick={() => handleSendKey("Space")}
								disabled={functionalState.activeTaskId !== null}
							>
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
								onChange={(e) => setManualKey(e.target.value)}
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

				{functionalState.latestTask && (
					<Box sx={{ mt: 0.75, p: 0.75, border: "1px solid", borderColor: "divider", borderRadius: 1 }}>
						<Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 0.5 }}>
							<Typography variant="caption" color="text.secondary">
								最近任务：{functionalState.latestTask.name}
							</Typography>
							<Chip
								label={functionalState.latestTask.status}
								size="small"
								color={functionalState.latestTask.status === "completed" ? "success" : functionalState.latestTask.status === "failed" ? "error" : "warning"}
								sx={{ height: 18, fontSize: 10 }}
							/>
						</Stack>
						<Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.5 }}>
							{functionalState.latestTask.summary}
						</Typography>
						{functionalState.latestTask.logs.slice(-3).map((entry) => (
							<Typography key={`${functionalState.latestTask?.id}-${entry.timestamp}-${entry.message}`} variant="caption" sx={{ display: "block", fontSize: 10 }}>
								[{new Date(entry.timestamp).toLocaleTimeString()}] {entry.level}: {entry.message}
							</Typography>
						))}
					</Box>
				)}

				{functionalState.taskHistory.length > 0 && (
					<Box sx={{ mt: 0.75 }}>
						<Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 0.5 }}>
							<Typography variant="caption" color="text.secondary" fontWeight={600}>
								任务历史
							</Typography>
							<Button size="small" variant="text" onClick={clearHistory} sx={{ minWidth: 0, fontSize: 11 }}>
								清空记录
							</Button>
						</Stack>
						<Stack spacing={0.5}>
							{functionalState.taskHistory.slice(0, 5).map((task) => (
								<Box
									key={task.id}
									sx={{
										bgcolor: "background.paper",
										borderRadius: 1,
										p: 0.75,
										border: "1px solid",
										borderColor: "divider",
									}}
								>
									<Stack direction="row" justifyContent="space-between" alignItems="center">
										<Typography variant="caption" sx={{ color: "text.primary" }}>
											{task.name}
										</Typography>
										<Typography variant="caption" color="text.secondary" sx={{ fontSize: 10 }}>
											{new Date(task.startedAt).toLocaleTimeString()}
										</Typography>
									</Stack>
									<Typography variant="caption" color="text.secondary" sx={{ display: "block", fontSize: 10 }}>
										{task.summary}
									</Typography>
								</Box>
							))}
						</Stack>
					</Box>
				)}

				<Box sx={{ mt: 1, p: 0.75, border: "1px solid", borderColor: "divider", borderRadius: 1 }}>
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
						<Button
							size="small"
							variant="outlined"
							onClick={handleDetect2048Target}
							disabled={functionalState.activeTaskId !== null || game2048State.activeRunId !== null}
						>
							自动检测 2048 窗口
						</Button>
						<Button
							size="small"
							variant="contained"
							onClick={handleRun2048Step}
							disabled={functionalState.activeTaskId !== null || game2048State.activeRunId !== null}
						>
							运行 2048 单步
						</Button>
					</Stack>
					{game2048State.detectionSummary && (
						<Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.5 }}>
							检测：{game2048State.detectionSummary}
						</Typography>
					)}
					{game2048State.detectedTarget && (
						<Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.5 }}>
							候选目标：{game2048State.detectedTarget.title}
						</Typography>
					)}
					{game2048Error && (
						<Alert severity="error" sx={{ mb: 0.75, py: 0 }}>
							{game2048Error}
						</Alert>
					)}
					{game2048State.lastRun && (
						<>
							<Typography variant="caption" sx={{ display: "block", color: "text.primary", mb: 0.25 }}>
								结果：{game2048State.lastRun.summary}
							</Typography>
							<Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.25 }}>
								分析源：{game2048State.lastRun.analysis.source}
							</Typography>
							<Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.25 }}>
								推理：{game2048State.lastRun.analysis.reasoning}
							</Typography>
							<Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.5 }}>
								反馈：{game2048State.lastRun.companionText}
							</Typography>
							<Stack direction="row" spacing={0.5} sx={{ mb: 0.5, flexWrap: "wrap" }}>
								{game2048State.lastRun.analysis.preferredMoves.map((move) => (
									<Chip key={`pref-${move}`} label={move} size="small" variant="outlined" sx={{ height: 18, fontSize: 10 }} />
								))}
							</Stack>
							<Stack spacing={0.5}>
								{game2048State.lastRun.attempts.map((attempt) => (
									<Typography key={`${game2048State.lastRun?.id}-${attempt.move}`} variant="caption" color="text.secondary" sx={{ display: "block", fontSize: 10 }}>
										{attempt.move}: {attempt.changed ? "changed" : "no change"} ({(attempt.changeRatio * 100).toFixed(1)}%)
									</Typography>
								))}
							</Stack>
						</>
					)}
				</Box>

				<Box sx={{ mt: 1, p: 0.75, border: "1px solid", borderColor: "divider", borderRadius: 1 }}>
					<Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 0.5 }}>
						<Typography variant="caption" color="text.secondary" fontWeight={600}>
							2048 评测 Harness
						</Typography>
						<Chip
							label={evaluationState.activeCaseId ? "评测中" : "就绪"}
							size="small"
							color={evaluationState.activeCaseId ? "warning" : "default"}
							sx={{ height: 18, fontSize: 10 }}
						/>
					</Stack>
					<Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.5 }}>
						固定 case 会重复运行 2048 单步，并聚合成功率、动作有效率和延迟。
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
									{definition.description} · {definition.iterations} 次
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
					{evaluationState.latestResult && (
						<Box sx={{ p: 0.75, border: "1px solid", borderColor: "divider", borderRadius: 1 }}>
							<Typography variant="caption" sx={{ display: "block", color: "text.primary", mb: 0.25 }}>
								最近评测：{evaluationState.latestResult.caseName}
							</Typography>
							<Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.5 }}>
								{evaluationState.latestResult.summary}
							</Typography>
							<Typography variant="caption" color="text.secondary" sx={{ display: "block", fontSize: 10 }}>
								成功率：{(evaluationState.latestResult.metrics.successRate * 100).toFixed(0)}%
							</Typography>
							<Typography variant="caption" color="text.secondary" sx={{ display: "block", fontSize: 10 }}>
								动作有效率：{(evaluationState.latestResult.metrics.actionValidityRate * 100).toFixed(0)}%
							</Typography>
							<Typography variant="caption" color="text.secondary" sx={{ display: "block", fontSize: 10, mb: 0.5 }}>
								平均延迟：{evaluationState.latestResult.metrics.averageLatencyMs.toFixed(0)}ms · 中位延迟：{evaluationState.latestResult.metrics.medianLatencyMs.toFixed(0)}ms
							</Typography>
							<Stack spacing={0.25}>
								{evaluationState.latestResult.runs.map((run) => (
									<Typography key={`${evaluationState.latestResult?.caseId}-${run.index}`} variant="caption" color="text.secondary" sx={{ display: "block", fontSize: 10 }}>
										Run {run.index}: {run.status} · {run.summary} · {run.latencyMs}ms
									</Typography>
								))}
							</Stack>
						</Box>
					)}
				</Box>
			</Box>

			<Divider />

			{/* Mock 测试 */}
			<Box>
				<Stack direction="row" alignItems="center" sx={{ mb: 0.5 }}>
					<Typography variant="caption" color="text.secondary" fontWeight={600}>Mock 测试</Typography>
					<HelpTooltip title="模拟语音链路（含口型同步）" />
				</Stack>
				<Stack direction="row" spacing={0.5}>
					<Button variant="outlined" size="small" onClick={handleMockPipeline}>
						模拟语音链路
					</Button>
				</Stack>
			</Box>
		</Box>
	);
}
