import type { Dispatch, SetStateAction } from "react";
import { Button, Stack, TextField, Typography } from "@mui/material";
import { HelpTooltip } from "@/components";
import { useI18n } from "@/contexts/I18nProvider";
import type { AppConfig } from "@/services/config";
import { PanelCard } from "./panel-shell";

type AffectStateLike = {
	currentEmotion: string;
	intensity: number;
	presentationEmotion: string;
	residualEmotion: string;
	residualIntensity: number;
	lastSource: string | null;
	lastReason: string | null;
};

type ProactiveStateLike = {
	isBusy: boolean;
	pendingSource: string | null;
	pendingPreview: string | null;
	lastDecision: string;
	lastSkipReason: string | null;
	lastEmittedSource: string | null;
};

type DelegationRecordLike = {
	sourceGame: string | null;
	verificationResult: { success: boolean };
	executionSummary: string;
	analysisSource: string | null;
	decisionSummary: string | null;
	plannedActions: string[];
	attemptedActions: string[];
	nextStepHint: string | null;
	followUpSummary: string | null;
};

export function LiveStateCard(props: {
	emotion: string;
	emotionReason: string | null;
	emotionSource: string | null;
	isSpeaking: boolean;
}) {
	const { t } = useI18n();

	return (
		<PanelCard>
			<Typography variant="caption" color="text.secondary" fontWeight={600} sx={{ mb: 0.5, display: "block" }}>
				{t("即时状态", "Live State")}
			</Typography>
			<Stack spacing={0.25}>
				<Typography variant="body2">{t("当前表情", "Current Emotion")}：{props.emotion}</Typography>
				<Typography variant="body2">{t("情绪来源", "Emotion Source")}：{props.emotionSource ?? t("无", "None")}</Typography>
				<Typography variant="body2">{t("情绪原因", "Emotion Reason")}：{props.emotionReason ?? t("无", "None")}</Typography>
				<Typography variant="body2">{t("说话中", "Speaking")}：{props.isSpeaking ? t("是", "Yes") : t("否", "No")}</Typography>
			</Stack>
		</PanelCard>
	);
}

export function RelationalTuningCard(props: {
	config: AppConfig;
	affect: AffectStateLike;
	onExpressionTimeoutChange: (rawValue: string) => void;
	onPersistExpressionTimeout: () => Promise<void>;
	onProactiveSilenceChange: (rawValue: string) => void;
	onPersistProactiveSilence: () => Promise<void>;
}) {
	const { t } = useI18n();

	return (
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
					value={props.config.character.expressionIdleTimeoutSeconds}
					onChange={(event) => props.onExpressionTimeoutChange(event.target.value)}
					onBlur={() => { void props.onPersistExpressionTimeout(); }}
					inputProps={{ min: 5, max: 600, step: 5 }}
					sx={{ flex: 1 }}
				/>
				<TextField
					size="small"
					type="number"
					label={t("主动静默窗口(秒)", "Proactive Silence Window (s)")}
					value={props.config.companionRuntime.proactiveRuntimeSummarySilenceSeconds}
					onChange={(event) => props.onProactiveSilenceChange(event.target.value)}
					onBlur={() => { void props.onPersistProactiveSilence(); }}
					inputProps={{ min: 5, max: 600, step: 5 }}
					sx={{ flex: 1 }}
				/>
			</Stack>
			<Stack spacing={0.25}>
				<Typography variant="body2">{t("当前情感", "Current Emotion")}：{props.affect.currentEmotion} ({props.affect.intensity.toFixed(2)})</Typography>
				<Typography variant="body2">{t("表现情感", "Presentation Emotion")}：{props.affect.presentationEmotion}</Typography>
				<Typography variant="body2">{t("残留情感", "Residual Emotion")}：{props.affect.residualEmotion} ({props.affect.residualIntensity.toFixed(2)})</Typography>
				<Typography variant="body2">{t("最近来源", "Latest Source")}：{props.affect.lastSource}</Typography>
				<Typography variant="body2">{t("最近原因", "Latest Reason")}：{props.affect.lastReason}</Typography>
			</Stack>
		</PanelCard>
	);
}

export function ProactiveDebugCard(props: {
	currentMode: string;
	preferredMode: string;
	proactive: ProactiveStateLike;
}) {
	const { t } = useI18n();

	return (
		<PanelCard>
			<Typography variant="caption" color="text.secondary" fontWeight={600} sx={{ mb: 0.5, display: "block" }}>
				{t("Proactive Debug", "Proactive Debug")}
			</Typography>
			<Stack spacing={0.25}>
				<Typography variant="body2">{t("当前模式", "Current Mode")}：{props.currentMode}</Typography>
				<Typography variant="body2">{t("用户偏好", "Preferred Mode")}：{props.preferredMode}</Typography>
				<Typography variant="body2">{t("系统忙碌", "System Busy")}：{props.proactive.isBusy ? t("是", "Yes") : t("否", "No")}</Typography>
				<Typography variant="body2">{t("待处理来源", "Pending Source")}：{props.proactive.pendingSource ?? t("无", "None")}</Typography>
				<Typography variant="body2">{t("待处理预览", "Pending Preview")}：{props.proactive.pendingPreview ?? t("无", "None")}</Typography>
				<Typography variant="body2">{t("最近决策", "Latest Decision")}：{props.proactive.lastDecision}</Typography>
				<Typography variant="body2">{t("最近跳过原因", "Latest Skip Reason")}：{props.proactive.lastSkipReason ?? t("无", "None")}</Typography>
				<Typography variant="body2">{t("最近主动来源", "Latest Proactive Source")}：{props.proactive.lastEmittedSource ?? t("无", "None")}</Typography>
			</Stack>
		</PanelCard>
	);
}

export function DelegationMemoryCard(props: {
	latestRecord: DelegationRecordLike | null;
	recentCount: number;
}) {
	const { t } = useI18n();

	return (
		<PanelCard>
			<Typography variant="caption" color="text.secondary" fontWeight={600} sx={{ mb: 0.5, display: "block" }}>
				{t("Delegation Memory", "Delegation Memory")}
			</Typography>
			{props.latestRecord ? (
				<Stack spacing={0.35}>
					<Typography variant="body2">{t("最近游戏", "Latest Game")}：{props.latestRecord.sourceGame ?? t("无", "None")}</Typography>
					<Typography variant="body2">{t("验证结果", "Verification Result")}：{props.latestRecord.verificationResult.success ? t("成功", "Success") : t("失败", "Failed")}</Typography>
					<Typography variant="body2">{t("执行总结", "Execution Summary")}：{props.latestRecord.executionSummary}</Typography>
					<Typography variant="body2">{t("决策来源", "Decision Source")}：{props.latestRecord.analysisSource ?? t("无", "None")}</Typography>
					<Typography variant="body2">{t("决策摘要", "Decision Summary")}：{props.latestRecord.decisionSummary ?? t("无", "None")}</Typography>
					<Typography variant="body2">{t("计划动作", "Planned Actions")}：{props.latestRecord.plannedActions.length ? props.latestRecord.plannedActions.join(" -> ") : t("无", "None")}</Typography>
					<Typography variant="body2">{t("尝试动作", "Attempted Actions")}：{props.latestRecord.attemptedActions.length ? props.latestRecord.attemptedActions.join(" -> ") : t("无", "None")}</Typography>
					<Typography variant="body2">{t("下一步线索", "Next Step Hint")}：{props.latestRecord.nextStepHint ?? t("无", "None")}</Typography>
					<Typography variant="body2">{t("最近跟进", "Latest Follow-up")}：{props.latestRecord.followUpSummary || t("无", "None")}</Typography>
					<Typography variant="body2">{t("最近条数", "Recent Count")}：{props.recentCount}</Typography>
				</Stack>
			) : (
				<Typography variant="body2">{t("尚无托管记录", "No delegated records yet")}</Typography>
			)}
		</PanelCard>
	);
}

export function PromptLabCard(props: {
	config: AppConfig;
	onUpdateCharacter: (patch: Partial<AppConfig["character"]>) => void;
	onSetConfig: Dispatch<SetStateAction<AppConfig>>;
	onPersistCharacter: () => Promise<void>;
}) {
	const { t } = useI18n();

	return (
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
					value={props.config.character.customPersona}
					onChange={(event) => props.onUpdateCharacter({ customPersona: event.target.value })}
					onBlur={() => { void props.onPersistCharacter(); }}
				/>

				<Button
					size="small"
					variant={props.config.character.behaviorConstraints.enabled ? "contained" : "outlined"}
					color={props.config.character.behaviorConstraints.enabled ? "primary" : "inherit"}
					onClick={() => {
						const next = !props.config.character.behaviorConstraints.enabled;
						props.onSetConfig((current) => ({
							...current,
							character: {
								...current.character,
								behaviorConstraints: { ...current.character.behaviorConstraints, enabled: next },
							},
						}));
						void props.onPersistCharacter();
					}}
					sx={{ alignSelf: "flex-start" }}
				>
					{props.config.character.behaviorConstraints.enabled ? t("关闭行为约束", "Disable Constraints") : t("开启行为约束", "Enable Constraints")}
				</Button>

				{props.config.character.behaviorConstraints.enabled && (
					<>
						<TextField
							size="small"
							type="number"
							label={t("最大回复字数", "Max Reply Length")}
							value={props.config.character.behaviorConstraints.maxReplyLength}
							onChange={(event) => {
								const value = Math.max(20, Math.min(500, Number(event.target.value) || 150));
								props.onSetConfig((current) => ({
									...current,
									character: {
										...current.character,
										behaviorConstraints: { ...current.character.behaviorConstraints, maxReplyLength: value },
									},
								}));
							}}
							onBlur={() => { void props.onPersistCharacter(); }}
							inputProps={{ min: 20, max: 500, step: 10 }}
						/>
						<TextField
							size="small"
							fullWidth
							multiline
							minRows={2}
							maxRows={4}
							label={t("自定义追加规则", "Custom Extra Rules")}
							value={props.config.character.behaviorConstraints.customRules}
							onChange={(event) => {
								props.onSetConfig((current) => ({
									...current,
									character: {
										...current.character,
										behaviorConstraints: { ...current.character.behaviorConstraints, customRules: event.target.value },
									},
								}));
							}}
							onBlur={() => { void props.onPersistCharacter(); }}
						/>
					</>
				)}
			</Stack>
		</PanelCard>
	);
}
