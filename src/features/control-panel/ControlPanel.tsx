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
import { useRuntime, useCharacter } from "@/hooks";
import { HelpTooltip } from "@/components";
import { getServices } from "@/services";
import { type AppConfig, DEFAULT_CONFIG, loadConfig, updateConfig, getConfig } from "@/services/config";
import {
	captureWindow,
	focusWindow,
	listWindows,
	sendHostKey,
	sendHostMouse,
} from "@/services/system";
import { mockVoicePipeline, MOCK_CHARACTER_PROFILE } from "@/utils/mock";
import type { CharacterProfile, HostWindowCapture, HostWindowInfo } from "@/types";
import { createLogger } from "@/services/logger";

const log = createLogger("control-panel");

export function ControlPanel() {
	const { mode, stop, resume } = useRuntime();
	const { emotion, isSpeaking } = useCharacter();

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
	const [captureLoadingHandle, setCaptureLoadingHandle] = useState<string | null>(null);
	const [capturePreview, setCapturePreview] = useState<HostWindowCapture | null>(null);
	const [capturePreviewTitle, setCapturePreviewTitle] = useState("");
	const [captureError, setCaptureError] = useState<string | null>(null);
	const [selectedWindowHandle, setSelectedWindowHandle] = useState<string | null>(null);
	const [selectedWindowTitle, setSelectedWindowTitle] = useState("");
	const [manualKey, setManualKey] = useState("Enter");
	const [hostActionLoading, setHostActionLoading] = useState<string | null>(null);
	const [hostActionError, setHostActionError] = useState<string | null>(null);

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
		setCaptureError(null);
		setHostActionError(null);

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
		setSelectedWindowHandle(windowInfo.handle);
		setSelectedWindowTitle(windowInfo.title);
		setHostActionError(null);
	}, []);

	const handleFocusWindow = useCallback(async (windowInfo: HostWindowInfo) => {
		setHostActionLoading(`focus:${windowInfo.handle}`);
		setHostActionError(null);

		try {
			await focusWindow(windowInfo.handle);
			selectWindowTarget(windowInfo);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			setHostActionError(message);
			log.error("failed to focus window", err);
		} finally {
			setHostActionLoading(null);
		}
	}, [selectWindowTarget]);

	const handleCaptureWindow = useCallback(async (windowInfo: HostWindowInfo) => {
		setCaptureLoadingHandle(windowInfo.handle);
		setCaptureError(null);

		try {
			const capture = await captureWindow(windowInfo.handle);
			setCapturePreview(capture);
			setCapturePreviewTitle(windowInfo.title);
			selectWindowTarget(windowInfo);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			setCaptureError(message);
			log.error("failed to capture window", err);
		} finally {
			setCaptureLoadingHandle(null);
		}
	}, [selectWindowTarget]);

	const handleSendKey = useCallback(async (key: string) => {
		if (!selectedWindowHandle) return;

		setHostActionLoading(`key:${key}`);
		setHostActionError(null);

		try {
			await sendHostKey(selectedWindowHandle, key);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			setHostActionError(message);
			log.error("failed to send key", err);
		} finally {
			setHostActionLoading(null);
		}
	}, [selectedWindowHandle]);

	const handleMouseClickCenter = useCallback(async () => {
		if (!selectedWindowHandle) return;

		setHostActionLoading("mouse:center-click");
		setHostActionError(null);

		try {
			await sendHostMouse(selectedWindowHandle, { action: "click", button: "left" });
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			setHostActionError(message);
			log.error("failed to send mouse", err);
		} finally {
			setHostActionLoading(null);
		}
	}, [selectedWindowHandle]);

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

				{captureError && (
					<Alert severity="error" sx={{ mt: 0.75, py: 0 }}>
						{captureError}
					</Alert>
				)}

				{hostActionError && (
					<Alert severity="error" sx={{ mt: 0.75, py: 0 }}>
						{hostActionError}
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
											variant={selectedWindowHandle === windowInfo.handle ? "contained" : "text"}
											onClick={() => selectWindowTarget(windowInfo)}
											sx={{ minWidth: 0, fontSize: 11, px: 0.5 }}
										>
											目标
										</Button>
										<Button
											size="small"
											variant="text"
											onClick={() => handleFocusWindow(windowInfo)}
											disabled={hostActionLoading === `focus:${windowInfo.handle}`}
											sx={{ minWidth: 0, fontSize: 11, px: 0.5 }}
										>
											{hostActionLoading === `focus:${windowInfo.handle}` ? "聚焦中..." : "聚焦"}
										</Button>
										<Button
											size="small"
											variant="text"
											onClick={() => handleCaptureWindow(windowInfo)}
											disabled={captureLoadingHandle === windowInfo.handle}
											sx={{ minWidth: 0, fontSize: 11, px: 0.5 }}
										>
											{captureLoadingHandle === windowInfo.handle ? "截图中..." : "截图"}
										</Button>
									</Stack>
								</Box>
							))}
						</Stack>
					</Box>
				)}

				{(captureLoadingHandle || hostActionLoading) && (
					<Stack direction="row" spacing={0.5} alignItems="center" sx={{ mt: 0.75 }}>
						<CircularProgress size={12} />
						<Typography variant="caption" color="text.secondary">
							{captureLoadingHandle ? "正在抓取窗口图像..." : "正在发送宿主操作..."}
						</Typography>
					</Stack>
				)}

				{capturePreview && (
					<Box sx={{ mt: 0.75 }}>
						<Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.5 }}>
							截图预览：{capturePreviewTitle} · {capturePreview.width}x{capturePreview.height}
						</Typography>
						<Box
							component="img"
							src={`data:image/png;base64,${capturePreview.pngBase64}`}
							alt={capturePreviewTitle || "window capture"}
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

				{selectedWindowHandle && (
					<Box sx={{ mt: 0.75, p: 0.75, border: "1px solid", borderColor: "divider", borderRadius: 1 }}>
						<Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.5 }}>
							当前目标：{selectedWindowTitle || selectedWindowHandle}
						</Typography>
						<Stack direction="row" spacing={0.5} sx={{ mb: 0.5, flexWrap: "wrap" }}>
							<Button size="small" variant="outlined" onClick={() => handleFocusWindow({
								handle: selectedWindowHandle,
								title: selectedWindowTitle,
								className: "",
								processId: 0,
								visible: true,
								minimized: false,
							})}>
								聚焦目标
							</Button>
							<Button size="small" variant="outlined" onClick={handleMouseClickCenter}>
								点击中心
							</Button>
							<Button size="small" variant="outlined" onClick={() => handleSendKey("Enter")}>
								发送 Enter
							</Button>
							<Button size="small" variant="outlined" onClick={() => handleSendKey("Space")}>
								发送 Space
							</Button>
						</Stack>
						<Stack direction="row" spacing={0.5} sx={{ mb: 0.5, flexWrap: "wrap" }}>
							<Button size="small" variant="text" onClick={() => handleSendKey("Up")}>Up</Button>
							<Button size="small" variant="text" onClick={() => handleSendKey("Down")}>Down</Button>
							<Button size="small" variant="text" onClick={() => handleSendKey("Left")}>Left</Button>
							<Button size="small" variant="text" onClick={() => handleSendKey("Right")}>Right</Button>
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
								onClick={() => handleSendKey(manualKey.trim())}
								disabled={!manualKey.trim()}
							>
								发送
							</Button>
						</Stack>
					</Box>
				)}
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
