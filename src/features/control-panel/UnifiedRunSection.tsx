import { Alert, Button, FormControlLabel, Stack, Switch, TextField } from "@mui/material";
import { useState } from "react";
import type { UnifiedRuntimeState } from "@/types";
import { useI18n } from "@/contexts/I18nProvider";
import { useCompanionMode } from "@/hooks";
import { InfoLine, PanelCard, SectionHeader, SectionStatusChip } from "./panel-shell";

export function UnifiedRunSection(props: {
	unifiedState: UnifiedRuntimeState;
	onRunUnifiedGame: () => Promise<unknown>;
	onQuickTarget2048: () => Promise<unknown>;
	onQuickTargetSokoban: () => Promise<unknown>;
	onSubmitVoiceText: (text: string) => Promise<unknown>;
	onSetSpeechEnabled: (enabled: boolean) => void;
	onSetVoiceInputEnabled: (enabled: boolean) => void;
	busy: boolean;
}) {
	const { t } = useI18n();
	const companionMode = useCompanionMode();
	const [voiceText, setVoiceText] = useState(() => t("帮我看一下下一步", "Help me review the next step"));
	const [error, setError] = useState<string | null>(null);

	return (
		<PanelCard compact>
			<SectionHeader
				title={t("统一运行", "Unified Run")}
				subtitle={t("陪伴表达、表情和功能动作走同一条链", "Companion speech, emotion, and functional actions share one path")}
				right={(
					<SectionStatusChip
						label={props.unifiedState.activeRunId ? props.unifiedState.phase : t("就绪", "Ready")}
						color={props.unifiedState.activeRunId ? "warning" : "default"}
					/>
				)}
			/>

			<Stack direction="row" spacing={0.5} sx={{ mb: 0.75, flexWrap: "wrap" }}>
				<Button
					size="small"
					variant="outlined"
					onClick={async () => {
						setError(null);
						try {
							await props.onQuickTarget2048();
						} catch (err) {
							setError(err instanceof Error ? err.message : String(err));
						}
					}}
					disabled={props.busy}
				>
					{t("选中 2048 窗口", "Target 2048")}
				</Button>
				<Button
					size="small"
					variant="outlined"
					onClick={async () => {
						setError(null);
						try {
							await props.onQuickTargetSokoban();
						} catch (err) {
							setError(err instanceof Error ? err.message : String(err));
						}
					}}
					disabled={props.busy}
				>
					{t("选中推箱子窗口", "Target Sokoban")}
				</Button>
				<Button
					size="small"
					variant="contained"
					onClick={async () => {
						setError(null);
						try {
							await props.onRunUnifiedGame();
						} catch (err) {
							setError(err instanceof Error ? err.message : String(err));
						}
					}}
					disabled={props.busy}
				>
					{t("运行当前游戏一轮", "Run Current Game Round")}
				</Button>
			</Stack>

			<Stack direction="row" spacing={1} sx={{ mb: 0.75, flexWrap: "wrap", rowGap: 0.5 }}>
				<FormControlLabel
					control={(
						<Switch
							size="small"
							checked={props.unifiedState.speechEnabled}
							onChange={(_, checked) => props.onSetSpeechEnabled(checked)}
						/>
					)}
					label={t("自动播报", "Auto speech")}
				/>
				<FormControlLabel
					control={(
						<Switch
							size="small"
							checked={props.unifiedState.voiceInputEnabled}
							onChange={(_, checked) => props.onSetVoiceInputEnabled(checked)}
						/>
					)}
					label={t("语音入口", "Voice input")}
				/>
			</Stack>

			<Stack direction="row" spacing={0.5} sx={{ mb: 0.75 }}>
				<TextField
					size="small"
					fullWidth
					value={voiceText}
					onChange={(event) => setVoiceText(event.target.value)}
					placeholder={t("模拟语音输入，例如：帮我看一下下一步（只分析）", "Simulated voice input, e.g. help me review the next move (analysis only)")}
					sx={{ "& .MuiInputBase-input": { fontSize: 12 } }}
				/>
				<Button
					size="small"
					variant="outlined"
					disabled={props.busy || !voiceText.trim()}
					onClick={async () => {
						setError(null);
						try {
							await props.onSubmitVoiceText(voiceText);
						} catch (err) {
							setError(err instanceof Error ? err.message : String(err));
						}
					}}
				>
					{t("提交", "Submit")}
				</Button>
			</Stack>

			{error && (
				<Alert severity="error" sx={{ mb: 0.75, py: 0 }}>
					{error}
				</Alert>
			)}

			<InfoLine>{t("阶段", "Phase")}：{props.unifiedState.phase}</InfoLine>
			<InfoLine>{t("当前模式", "Current Mode")}：{companionMode.mode}</InfoLine>
			<InfoLine>{t("最近语音", "Latest Voice")}：{props.unifiedState.lastVoiceInput ?? "—"}</InfoLine>
			<InfoLine>{t("最近命令", "Latest Command")}：{props.unifiedState.lastCommand ?? "—"}</InfoLine>
			<InfoLine>{t("最近播报", "Latest Speech")}：{props.unifiedState.lastCompanionText ?? "—"}</InfoLine>
			<InfoLine>
				{t("最近统一结果", "Latest Unified Result")}：{props.unifiedState.lastRun?.summary ?? t("尚未执行", "Not run yet")}
			</InfoLine>
		</PanelCard>
	);
}
