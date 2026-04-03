import { useState, useEffect, useCallback } from "react";
import {
	Box, Button, Typography, Stack, Chip, Divider,
	Select, MenuItem, TextField,
	type SelectChangeEvent,
} from "@mui/material";
import StopIcon from "@mui/icons-material/Stop";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import { useRuntime, useCharacter } from "@/hooks";
import { HelpTooltip } from "@/components";
import { getServices } from "@/services";
import { type AppConfig, DEFAULT_CONFIG, loadConfig, updateConfig, getConfig } from "@/services/config";
import { mockVoicePipeline, MOCK_CHARACTER_PROFILE } from "@/utils/mock";
import type { CharacterProfile } from "@/types";
import { createLogger } from "@/services/logger";

const log = createLogger("control-panel");

function normalizeSelectedCharacterId(currentId: string | null, available: readonly CharacterProfile[]): string {
	if (!currentId || currentId === MOCK_CHARACTER_PROFILE.id) {
		return "__manual__";
	}

	return available.some((profile) => profile.id === currentId) ? currentId : "__manual__";
}

export function ControlPanel() {
	const { mode, stop, resume } = useRuntime();
	const { emotion, isSpeaking } = useCharacter();

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

	return (
		<Box sx={{ p: 1.5, display: "flex", flexDirection: "column", gap: 1 }}>
			<Typography variant="subtitle2" sx={{ color: "primary.main", fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5 }}>
				控制面板
			</Typography>

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

			<Box sx={{ bgcolor: "background.paper", borderRadius: 1, p: 1 }}>
				<Typography variant="caption" color="text.secondary" fontWeight={600} sx={{ mb: 0.5, display: "block" }}>
					当前读取：{selectedId === "__manual__" ? "手动人设" : profiles.find((profile) => profile.id === selectedId)?.name ?? "手动人设"}
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
						<em>手动人设</em>
					</MenuItem>
					{profiles.map((profile) => (
						<MenuItem key={profile.id} value={profile.id}>{profile.name}</MenuItem>
					))}
				</Select>
				<Typography variant="body2">情绪：{emotion}</Typography>
				<Typography variant="body2">说话中：{isSpeaking ? "是" : "否"}</Typography>
			</Box>

			<Divider />

			<Box sx={{ bgcolor: "background.paper", borderRadius: 1, p: 1, display: "flex", flexDirection: "column", gap: 0.75 }}>
				<Stack direction="row" alignItems="center" spacing={0.5}>
					<Typography variant="caption" color="text.secondary" fontWeight={600} sx={{ fontSize: 11 }}>自定义人设</Typography>
					<HelpTooltip title="仅在未选择角色卡时生效，优先级最低。角色卡内设定 > 自定义人设。" />
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

			<Divider />

			<Box sx={{ bgcolor: "background.paper", borderRadius: 1, p: 1, display: "flex", flexDirection: "column", gap: 0.75 }}>
				<Stack direction="row" alignItems="center" spacing={0.5}>
					<Typography variant="caption" color="text.secondary" fontWeight={600} sx={{ fontSize: 11 }}>输出行为约束</Typography>
					<HelpTooltip title="在 system prompt 最前面注入行为规则，优先级高于角色卡设定。约束回复格式与风格，不覆盖角色个性。" />
				</Stack>
				<Stack direction="row" spacing={1} alignItems="center">
					<Typography variant="caption" sx={{ fontSize: 11 }}>启用约束</Typography>
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
							<Typography variant="caption" color="text.secondary" sx={{ fontSize: 11 }}>自定义追加规则</Typography>
							<HelpTooltip title="追加的自定义行为约束文本，会拼入约束段落末尾。" />
						</Stack>
						<TextField
							size="small"
							fullWidth
							multiline
							minRows={2}
							maxRows={4}
							placeholder="例：每句话结尾加上「哦」"
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

			<Divider />

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
						size="small"
						fullWidth
						multiline
						maxRows={3}
						placeholder="例：当前画面里右上角有派蒙菜单提示"
						value={referenceText}
						onChange={(event) => setReferenceText(event.target.value)}
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
						size="small"
						fullWidth
						multiline
						maxRows={3}
						placeholder="例：当前目标是判断 2048 下一步方向"
						value={taskContextText}
						onChange={(event) => setTaskContextText(event.target.value)}
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
