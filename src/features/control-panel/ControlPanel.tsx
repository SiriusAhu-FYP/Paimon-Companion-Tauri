import { useState, useEffect, useCallback } from "react";
import {
	Box, Button, Typography, Stack, Chip, Divider,
	Select, MenuItem, TextField,
	type SelectChangeEvent,
} from "@mui/material";
import StopIcon from "@mui/icons-material/Stop";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import { useRuntime, useCharacter, useAffectState } from "@/hooks";
import { HelpTooltip } from "@/components";
import { useI18n } from "@/contexts/I18nProvider";
import { getServices } from "@/services";
import { type AppConfig, DEFAULT_CONFIG, loadConfig, updateConfig, getConfig } from "@/services/config";
import { mockVoicePipeline, MOCK_CHARACTER_PROFILE } from "@/utils/mock";
import type { CharacterProfile } from "@/types";
import { createLogger } from "@/services/logger";
import { PanelCard, PanelRoot } from "./panel-shell";

const log = createLogger("control-panel");

function normalizeSelectedCharacterId(currentId: string | null, available: readonly CharacterProfile[]): string {
	if (!currentId || currentId === MOCK_CHARACTER_PROFILE.id) {
		return "__manual__";
	}

	return available.some((profile) => profile.id === currentId) ? currentId : "__manual__";
}

export function ControlPanel() {
	const { t } = useI18n();
	const { mode, stop, resume } = useRuntime();
	const { emotion, emotionReason, emotionSource, isSpeaking } = useCharacter();
	const affect = useAffectState();

	const [profiles, setProfiles] = useState<CharacterProfile[]>([]);
	const [selectedId, setSelectedId] = useState<string>("__manual__");
	const [config, setConfig] = useState<AppConfig>(DEFAULT_CONFIG);
	const [referenceText, setReferenceText] = useState("");
	const [taskContextText, setTaskContextText] = useState("");

	useEffect(() => {
		const { character } = getServices();
		const available = character.getAvailableProfiles();
		setProfiles([...available]);

		const current = character.getProfile();
		setSelectedId(normalizeSelectedCharacterId(current?.id ?? null, available));
	}, []);

	useEffect(() => {
		let cancelled = false;
		(async () => {
			const loaded = await loadConfig();
			if (cancelled) return;
			setConfig(loaded);
		})();
		return () => {
			cancelled = true;
		};
	}, []);

	const handleCharacterSwitch = useCallback(async (event: SelectChangeEvent<string>) => {
		const id = event.target.value;
		const { character, llm } = getServices();

		if (id === "__manual__") {
			character.loadFromProfile(MOCK_CHARACTER_PROFILE);
			setSelectedId("__manual__");
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

	const updateCharacter = useCallback((patch: Partial<AppConfig["character"]>) => {
		setConfig((current) => ({ ...current, character: { ...current.character, ...patch } }));
	}, []);

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

	const handleMockPipeline = useCallback(async () => {
		const { bus, runtime } = getServices();
		await mockVoicePipeline(bus, runtime);
	}, []);

	const handleExpressionTimeoutChange = useCallback((rawValue: string) => {
		const parsed = Number(rawValue);
		const nextValue = Number.isFinite(parsed)
			? Math.max(5, Math.min(600, Math.round(parsed)))
			: DEFAULT_CONFIG.character.expressionIdleTimeoutSeconds;

		setConfig((current) => ({
			...current,
			character: {
				...current.character,
				expressionIdleTimeoutSeconds: nextValue,
			},
		}));
	}, []);

	const persistExpressionTimeout = useCallback(async () => {
		const { character } = getServices();
		character.setExpressionIdleTimeoutSeconds(config.character.expressionIdleTimeoutSeconds);
		await updateConfig({ character: { ...config.character } });
	}, [config.character]);

	return (
		<PanelRoot title={t("控制面板", "Control Panel")}>
			<PanelCard>
				<Box sx={{
					...(mode === "stopped" && { border: "1px solid", borderColor: "error.main", bgcolor: "error.dark", borderRadius: 1, m: -1, p: 1 }),
				}}>
					<Stack direction="row" alignItems="center" sx={{ mb: 0.5 }}>
						<Typography variant="caption" color="text.secondary" fontWeight={600}>{t("运行状态", "Runtime State")}</Typography>
						<HelpTooltip title={t("急停：立即停止所有活动；恢复：回到自动模式", "Stop halts activity immediately; resume returns to auto mode.")} />
					</Stack>
					<Stack direction="row" spacing={0.5} alignItems="center" sx={{ mb: 0.5 }}>
						<Typography variant="body2">
							{t("模式", "Mode")}：<strong>{mode}</strong>
						</Typography>
						{mode === "stopped" && (
							<Chip label="STOPPED" size="small" color="error" sx={{ height: 18, fontSize: 10 }} />
						)}
					</Stack>
					<Stack direction="row" spacing={0.5}>
						<Button variant="outlined" size="small" onClick={stop} disabled={mode === "stopped"} startIcon={<StopIcon />} color="error">
							{t("急停", "Stop")}
						</Button>
						<Button variant="outlined" size="small" onClick={resume} disabled={mode === "auto"} startIcon={<PlayArrowIcon />}>
							{t("恢复", "Resume")}
						</Button>
					</Stack>
				</Box>
			</PanelCard>

			<Divider />

			<PanelCard>
				<Typography variant="caption" color="text.secondary" fontWeight={600} sx={{ mb: 0.5, display: "block" }}>
					{t("当前读取", "Current Profile")}：{selectedId === "__manual__" ? t("手动人设", "Manual Persona") : profiles.find((profile) => profile.id === selectedId)?.name ?? t("手动人设", "Manual Persona")}
				</Typography>
				<Select
					size="small"
					fullWidth
					value={selectedId}
					onChange={handleCharacterSwitch}
					displayEmpty
					sx={{ fontSize: 13, mb: 0.5 }}
				>
					<MenuItem value="__manual__">
						<em>{t("手动人设", "Manual Persona")}</em>
					</MenuItem>
					{profiles.map((profile) => (
						<MenuItem key={profile.id} value={profile.id}>{profile.name}</MenuItem>
					))}
				</Select>
				<Typography variant="body2">{t("情绪", "Emotion")}：{emotion}</Typography>
				<Typography variant="body2">{t("情绪来源", "Emotion Source")}：{emotionSource ?? t("无", "None")}</Typography>
				<Typography variant="body2">{t("情绪原因", "Emotion Reason")}：{emotionReason ?? t("无", "None")}</Typography>
				<Typography variant="body2">{t("说话中", "Speaking")}：{isSpeaking ? t("是", "Yes") : t("否", "No")}</Typography>
				<Stack direction="row" alignItems="center" spacing={0.5} sx={{ mt: 1 }}>
					<Typography variant="caption" color="text.secondary" fontWeight={600}>{t("情感衰减窗口", "Affect Decay Window")}</Typography>
					<HelpTooltip title={t("非 neutral 情感在没有新输入时，先经过一个窗口衰减到 carry，再经过一个窗口回到 neutral。默认 15 秒。", "A non-neutral affect first decays to carry after one idle window, then returns to neutral after another. Default is 15 seconds.")} />
				</Stack>
				<TextField
					size="small"
					type="number"
					sx={{ width: 140, mt: 0.5 }}
					value={config.character.expressionIdleTimeoutSeconds}
					placeholder="15"
					onChange={(event) => handleExpressionTimeoutChange(event.target.value)}
					onBlur={persistExpressionTimeout}
					inputProps={{ min: 5, max: 600, step: 5 }}
					helperText={t("默认 15 秒", "Default: 15 seconds")}
				/>
				<Stack spacing={0.25} sx={{ mt: 1 }}>
					<Typography variant="caption" color="text.secondary" fontWeight={600}>{t("Affect Core", "Affect Core")}</Typography>
					<Typography variant="body2">{t("当前情感", "Current Emotion")}：{affect.currentEmotion} ({affect.intensity.toFixed(2)})</Typography>
					<Typography variant="body2">{t("表现情感", "Presentation Emotion")}：{affect.presentationEmotion}</Typography>
					<Typography variant="body2">{t("Carry 情感", "Carry Emotion")}：{affect.carryEmotion} ({affect.carryIntensity.toFixed(2)})</Typography>
					<Typography variant="body2">{t("当前优先级", "Current Priority")}：{affect.priority}</Typography>
					<Typography variant="body2">{t("语音保持", "Speech Hold")}：{affect.isHeldForSpeech ? t("是", "Yes") : t("否", "No")}</Typography>
					<Typography variant="body2">{t("最近来源", "Latest Source")}：{affect.lastSource}</Typography>
					<Typography variant="body2">{t("最近原因", "Latest Reason")}：{affect.lastReason}</Typography>
					<Typography variant="body2">{t("更新时间", "Updated At")}：{new Date(affect.updatedAt).toLocaleTimeString()}</Typography>
				</Stack>
			</PanelCard>

			<Divider />

			<PanelCard>
				<Box sx={{ display: "flex", flexDirection: "column", gap: 0.75 }}>
					<Stack direction="row" alignItems="center" spacing={0.5}>
						<Typography variant="caption" color="text.secondary" fontWeight={600} sx={{ fontSize: 11 }}>{t("自定义人设", "Custom Persona")}</Typography>
						<HelpTooltip title={t("仅在未选择角色卡时生效，优先级最低。角色卡内设定 > 自定义人设。", "Only applies when no character card is selected. Lowest priority.")} />
					</Stack>
					<TextField
						size="small"
						fullWidth
						multiline
						minRows={3}
						maxRows={6}
						value={config.character.customPersona}
						onChange={(event) => updateCharacter({ customPersona: event.target.value })}
						onBlur={() => updateConfig({ character: { ...config.character } })}
					/>
				</Box>
			</PanelCard>

			<Divider />

			<PanelCard>
				<Box sx={{ display: "flex", flexDirection: "column", gap: 0.75 }}>
					<Stack direction="row" alignItems="center" spacing={0.5}>
						<Typography variant="caption" color="text.secondary" fontWeight={600} sx={{ fontSize: 11 }}>{t("输出行为约束", "Behavior Constraints")}</Typography>
						<HelpTooltip title={t("在 system prompt 最前面注入行为规则，优先级高于角色卡设定。约束回复格式与风格，不覆盖角色个性。", "Inject behavior rules at the start of the system prompt. Higher priority than card settings.")} />
					</Stack>
					<Stack direction="row" spacing={1} alignItems="center">
						<Typography variant="caption" sx={{ fontSize: 11 }}>{t("启用约束", "Enable Constraints")}</Typography>
						<Button
							size="small"
							variant={config.character.behaviorConstraints.enabled ? "contained" : "outlined"}
							color={config.character.behaviorConstraints.enabled ? "primary" : "inherit"}
							onClick={() => {
								const next = !config.character.behaviorConstraints.enabled;
								setConfig((current) => ({
									...current,
									character: {
										...current.character,
										behaviorConstraints: { ...current.character.behaviorConstraints, enabled: next },
									},
								}));
								updateConfig({
									character: {
										...config.character,
										behaviorConstraints: { ...config.character.behaviorConstraints, enabled: next },
									},
								});
							}}
							sx={{ minWidth: 60, fontSize: 11 }}
						>
							{config.character.behaviorConstraints.enabled ? t("已启用", "Enabled") : t("未启用", "Disabled")}
						</Button>
					</Stack>
					{config.character.behaviorConstraints.enabled && (
						<>
							<Stack direction="row" alignItems="center" spacing={0.5}>
								<Typography variant="caption" color="text.secondary" sx={{ fontSize: 11 }}>{t("最大回复字数", "Max Reply Length")}</Typography>
								<HelpTooltip title={t("LLM 单次回复的建议字数上限。实际输出可能略有浮动。", "Recommended upper bound for a single reply.")} />
							</Stack>
							<TextField
								size="small"
								type="number"
								sx={{ width: 120 }}
								value={config.character.behaviorConstraints.maxReplyLength}
								onChange={(event) => {
									const value = Math.max(20, Math.min(500, Number(event.target.value) || 150));
									setConfig((current) => ({
										...current,
										character: {
											...current.character,
											behaviorConstraints: { ...current.character.behaviorConstraints, maxReplyLength: value },
										},
									}));
								}}
								onBlur={() => updateConfig({ character: { ...config.character } })}
								inputProps={{ min: 20, max: 500, step: 10 }}
							/>
							<Stack direction="row" alignItems="center" spacing={0.5}>
								<Typography variant="caption" color="text.secondary" sx={{ fontSize: 11 }}>{t("自定义追加规则", "Custom Extra Rules")}</Typography>
								<HelpTooltip title={t("追加的自定义行为约束文本，会拼入约束段落末尾。", "Extra behavior rules appended to the constraint block.")} />
							</Stack>
							<TextField
								size="small"
								fullWidth
								multiline
								minRows={2}
								maxRows={4}
								placeholder={t("例：每句话结尾加上「哦」", "Example: end every sentence with 'oh'")}
								value={config.character.behaviorConstraints.customRules}
								onChange={(event) => {
									setConfig((current) => ({
										...current,
										character: {
											...current.character,
											behaviorConstraints: { ...current.character.behaviorConstraints, customRules: event.target.value },
										},
									}));
								}}
								onBlur={() => updateConfig({ character: { ...config.character } })}
							/>
						</>
					)}
				</Box>
			</PanelCard>

			<Divider />

			<PanelCard>
				<Stack direction="row" alignItems="center" sx={{ mb: 0.5 }}>
					<Typography variant="caption" color="text.secondary" fontWeight={600}>{t("上下文注入", "Context Injection")}</Typography>
					<HelpTooltip title={t("将参考信息或任务上下文注入 LLM 上下文，影响当前回复内容。", "Inject reference or task context into the LLM context.")} />
				</Stack>

				<Typography variant="caption" color="text.secondary" sx={{ fontSize: 10, display: "block", mb: 0.5 }}>
					{t("参考信息", "Reference Info")}
				</Typography>
				<Stack direction="row" spacing={0.5} sx={{ mb: 0.75 }}>
					<TextField
						size="small"
						fullWidth
						multiline
						maxRows={3}
						placeholder={t("例：当前画面里右上角有派蒙菜单提示", "Example: the top-right shows the Paimon menu hint")}
						value={referenceText}
						onChange={(event) => setReferenceText(event.target.value)}
						sx={{ "& .MuiInputBase-input": { fontSize: 12 } }}
					/>
					<Button variant="outlined" size="small" onClick={handleAddReference} disabled={!referenceText.trim()} sx={{ minWidth: 48 }}>
						{t("注入", "Inject")}
					</Button>
				</Stack>

				<Typography variant="caption" color="text.secondary" sx={{ fontSize: 10, display: "block", mb: 0.5 }}>
					{t("任务上下文", "Task Context")}
				</Typography>
				<Stack direction="row" spacing={0.5} sx={{ mb: 0.75 }}>
					<TextField
						size="small"
						fullWidth
						multiline
						maxRows={3}
						placeholder={t("例：当前目标是判断 2048 下一步方向", "Example: decide the next move for 2048")}
						value={taskContextText}
						onChange={(event) => setTaskContextText(event.target.value)}
						sx={{ "& .MuiInputBase-input": { fontSize: 12 } }}
					/>
					<Button variant="outlined" size="small" onClick={handleAddTaskContext} disabled={!taskContextText.trim()} sx={{ minWidth: 48 }}>
						{t("注入", "Inject")}
					</Button>
				</Stack>

				<Button variant="text" size="small" color="warning" onClick={handleClearContext} sx={{ fontSize: 11 }}>
					{t("清空手动上下文", "Clear Manual Context")}
				</Button>
			</PanelCard>

			<Divider />

			<Box>
				<Stack direction="row" alignItems="center" sx={{ mb: 0.5 }}>
					<Typography variant="caption" color="text.secondary" fontWeight={600}>{t("Mock 测试", "Mock Test")}</Typography>
					<HelpTooltip title={t("模拟语音链路（含口型同步）", "Simulate the voice pipeline including mouth sync.")} />
				</Stack>
				<Stack direction="row" spacing={0.5}>
					<Button variant="outlined" size="small" onClick={handleMockPipeline}>
						{t("模拟语音链路", "Simulate Voice Pipeline")}
					</Button>
				</Stack>
			</Box>
		</PanelRoot>
	);
}
