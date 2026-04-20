import { useState, useEffect, useCallback } from "react";
import {
	Box,
	Button,
	Divider,
	Stack,
	TextField,
	Typography,
} from "@mui/material";
import { useAffectState, useCharacter, useCompanionMode, useDelegationMemory, useProactiveState } from "@/hooks";
import { HelpTooltip } from "@/components";
import { useI18n } from "@/contexts/I18nProvider";
import { getServices } from "@/services";
import { type AppConfig, DEFAULT_CONFIG, loadConfig, updateConfig } from "@/services/config";
import { PanelCard } from "./panel-shell";

export function CompanionWorkbenchPanel() {
	const { t } = useI18n();
	const { emotion, emotionReason, emotionSource, isSpeaking } = useCharacter();
	const affect = useAffectState();
	const companionMode = useCompanionMode();
	const delegationMemory = useDelegationMemory();
	const proactive = useProactiveState();
	const [config, setConfig] = useState<AppConfig>(DEFAULT_CONFIG);

	useEffect(() => {
		let cancelled = false;
		(async () => {
			const loaded = await loadConfig();
			if (!cancelled) {
				setConfig(loaded);
			}
		})();
		return () => {
			cancelled = true;
		};
	}, []);

	const updateCharacter = useCallback((patch: Partial<AppConfig["character"]>) => {
		setConfig((current) => ({ ...current, character: { ...current.character, ...patch } }));
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

	const handleProactiveSilenceChange = useCallback((rawValue: string) => {
		const parsed = Number(rawValue);
		const nextValue = Number.isFinite(parsed)
			? Math.max(5, Math.min(600, Math.round(parsed)))
			: DEFAULT_CONFIG.companionRuntime.proactiveRuntimeSummarySilenceSeconds;

		setConfig((current) => ({
			...current,
			companionRuntime: {
				...current.companionRuntime,
				proactiveRuntimeSummarySilenceSeconds: nextValue,
			},
		}));
	}, []);

	const persistProactiveSilence = useCallback(async () => {
		const { proactiveCompanion } = getServices();
		proactiveCompanion.setRuntimeSummarySilenceSeconds(config.companionRuntime.proactiveRuntimeSummarySilenceSeconds);
		await updateConfig({ companionRuntime: { ...config.companionRuntime } });
	}, [config.companionRuntime]);

	return (
		<Box sx={{ p: 1.5, display: "flex", flexDirection: "column", gap: 1 }}>
			<PanelCard>
				<Typography variant="caption" color="text.secondary" fontWeight={600} sx={{ mb: 0.5, display: "block" }}>
					{t("即时状态", "Live State")}
				</Typography>
				<Stack spacing={0.25}>
					<Typography variant="body2">{t("当前表情", "Current Emotion")}：{emotion}</Typography>
					<Typography variant="body2">{t("情绪来源", "Emotion Source")}：{emotionSource ?? t("无", "None")}</Typography>
					<Typography variant="body2">{t("情绪原因", "Emotion Reason")}：{emotionReason ?? t("无", "None")}</Typography>
					<Typography variant="body2">{t("说话中", "Speaking")}：{isSpeaking ? t("是", "Yes") : t("否", "No")}</Typography>
				</Stack>
			</PanelCard>

			<Divider />

			<PanelCard>
				<Stack direction="row" alignItems="center" spacing={0.5} sx={{ mb: 0.5 }}>
					<Typography variant="caption" color="text.secondary" fontWeight={600}>
						{t("情感调参", "Relational Tuning")}
					</Typography>
					<HelpTooltip title={t("这些设置会影响 relational core 的衰减与主动发言节奏。", "These settings tune relational-core decay and proactive timing.")} />
				</Stack>
				<Stack direction="row" spacing={1} sx={{ mb: 1 }}>
					<TextField
						size="small"
						type="number"
						label={t("情感衰减窗口(秒)", "Affect Decay Window (s)")}
						value={config.character.expressionIdleTimeoutSeconds}
						onChange={(event) => handleExpressionTimeoutChange(event.target.value)}
						onBlur={persistExpressionTimeout}
						inputProps={{ min: 5, max: 600, step: 5 }}
						sx={{ flex: 1 }}
					/>
					<TextField
						size="small"
						type="number"
						label={t("主动静默窗口(秒)", "Proactive Silence Window (s)")}
						value={config.companionRuntime.proactiveRuntimeSummarySilenceSeconds}
						onChange={(event) => handleProactiveSilenceChange(event.target.value)}
						onBlur={persistProactiveSilence}
						inputProps={{ min: 5, max: 600, step: 5 }}
						sx={{ flex: 1 }}
					/>
				</Stack>
				<Stack spacing={0.25}>
					<Typography variant="body2">{t("当前情感", "Current Emotion")}：{affect.currentEmotion} ({affect.intensity.toFixed(2)})</Typography>
					<Typography variant="body2">{t("表现情感", "Presentation Emotion")}：{affect.presentationEmotion}</Typography>
					<Typography variant="body2">{t("残留情感", "Residual Emotion")}：{affect.residualEmotion} ({affect.residualIntensity.toFixed(2)})</Typography>
					<Typography variant="body2">{t("最近来源", "Latest Source")}：{affect.lastSource}</Typography>
					<Typography variant="body2">{t("最近原因", "Latest Reason")}：{affect.lastReason}</Typography>
				</Stack>
			</PanelCard>

			<Divider />

			<PanelCard>
				<Typography variant="caption" color="text.secondary" fontWeight={600} sx={{ mb: 0.5, display: "block" }}>
					{t("Proactive Debug", "Proactive Debug")}
				</Typography>
				<Stack spacing={0.25}>
					<Typography variant="body2">{t("当前模式", "Current Mode")}：{companionMode.mode}</Typography>
					<Typography variant="body2">{t("用户偏好", "Preferred Mode")}：{companionMode.preferredMode}</Typography>
					<Typography variant="body2">{t("系统忙碌", "System Busy")}：{proactive.isBusy ? t("是", "Yes") : t("否", "No")}</Typography>
					<Typography variant="body2">{t("待处理来源", "Pending Source")}：{proactive.pendingSource ?? t("无", "None")}</Typography>
					<Typography variant="body2">{t("待处理预览", "Pending Preview")}：{proactive.pendingPreview ?? t("无", "None")}</Typography>
					<Typography variant="body2">{t("最近决策", "Latest Decision")}：{proactive.lastDecision}</Typography>
					<Typography variant="body2">{t("最近跳过原因", "Latest Skip Reason")}：{proactive.lastSkipReason ?? t("无", "None")}</Typography>
					<Typography variant="body2">{t("最近主动来源", "Latest Proactive Source")}：{proactive.lastEmittedSource ?? t("无", "None")}</Typography>
				</Stack>
			</PanelCard>

			<Divider />

			<PanelCard>
				<Typography variant="caption" color="text.secondary" fontWeight={600} sx={{ mb: 0.5, display: "block" }}>
					{t("Delegation Memory", "Delegation Memory")}
				</Typography>
				{delegationMemory.latestRecord ? (
					<Stack spacing={0.35}>
						<Typography variant="body2">{t("最近游戏", "Latest Game")}：{delegationMemory.latestRecord.sourceGame ?? t("无", "None")}</Typography>
						<Typography variant="body2">{t("验证结果", "Verification Result")}：{delegationMemory.latestRecord.verificationResult.success ? t("成功", "Success") : t("失败", "Failed")}</Typography>
						<Typography variant="body2">{t("执行总结", "Execution Summary")}：{delegationMemory.latestRecord.executionSummary}</Typography>
						<Typography variant="body2">{t("决策来源", "Decision Source")}：{delegationMemory.latestRecord.analysisSource ?? t("无", "None")}</Typography>
						<Typography variant="body2">{t("决策摘要", "Decision Summary")}：{delegationMemory.latestRecord.decisionSummary ?? t("无", "None")}</Typography>
						<Typography variant="body2">{t("计划动作", "Planned Actions")}：{delegationMemory.latestRecord.plannedActions.length ? delegationMemory.latestRecord.plannedActions.join(" -> ") : t("无", "None")}</Typography>
						<Typography variant="body2">{t("尝试动作", "Attempted Actions")}：{delegationMemory.latestRecord.attemptedActions.length ? delegationMemory.latestRecord.attemptedActions.join(" -> ") : t("无", "None")}</Typography>
						<Typography variant="body2">{t("下一步线索", "Next Step Hint")}：{delegationMemory.latestRecord.nextStepHint ?? t("无", "None")}</Typography>
						<Typography variant="body2">{t("最近跟进", "Latest Follow-up")}：{delegationMemory.latestRecord.followUpSummary || t("无", "None")}</Typography>
						<Typography variant="body2">{t("最近条数", "Recent Count")}：{delegationMemory.recentRecords.length}</Typography>
					</Stack>
				) : (
					<Typography variant="body2">{t("尚无托管记录", "No delegated records yet")}</Typography>
				)}
			</PanelCard>

			<Divider />

			<PanelCard>
				<Typography variant="caption" color="text.secondary" fontWeight={600} sx={{ mb: 0.5, display: "block" }}>
					{t("Prompt Lab", "Prompt Lab")}
				</Typography>
				<Stack spacing={0.75}>
					<TextField
						size="small"
						fullWidth
						multiline
						minRows={3}
						maxRows={6}
						label={t("自定义人设", "Custom Persona")}
						value={config.character.customPersona}
						onChange={(event) => updateCharacter({ customPersona: event.target.value })}
						onBlur={() => updateConfig({ character: { ...config.character } })}
					/>

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
							void updateConfig({
								character: {
									...config.character,
									behaviorConstraints: { ...config.character.behaviorConstraints, enabled: next },
								},
							});
						}}
						sx={{ alignSelf: "flex-start" }}
					>
						{config.character.behaviorConstraints.enabled ? t("关闭行为约束", "Disable Constraints") : t("开启行为约束", "Enable Constraints")}
					</Button>

					{config.character.behaviorConstraints.enabled && (
						<>
							<TextField
								size="small"
								type="number"
								label={t("最大回复字数", "Max Reply Length")}
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
							<TextField
								size="small"
								fullWidth
								multiline
								minRows={2}
								maxRows={4}
								label={t("自定义追加规则", "Custom Extra Rules")}
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
				</Stack>
			</PanelCard>
		</Box>
	);
}
