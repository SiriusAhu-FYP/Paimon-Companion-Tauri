import { Box, Button, Chip, MenuItem, Paper, Select, Stack, type SelectChangeEvent, Typography } from "@mui/material";
import StopIcon from "@mui/icons-material/Stop";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import { useI18n } from "@/contexts/I18nProvider";
import type { CharacterProfile } from "@/types";
import { PanelCard } from "./panel-shell";

type DebugCaptureStateLike = {
	enabled: boolean;
	sessionId: string | null;
	sessionDirectory: string | null;
	capturedEventCount: number;
	capturedImageCount: number;
	lastError: string | null;
};

type LatestDelegatedRecordLike = {
	sourceGame: string | null;
	verificationResult: { success: boolean; error?: string | null };
	executionSummary: string;
	analysisSource: string | null;
	decisionSummary: string | null;
	plannedActions: string[];
	attemptedActions: string[];
	nextStepHint: string | null;
};

export function RuntimeStateCard(props: {
	mode: string;
	onStop: () => void;
	onResume: () => void;
}) {
	const { t } = useI18n();

	return (
		<PanelCard>
			<Stack direction="row" alignItems="center" spacing={0.5} sx={{ mb: 0.5 }}>
				<Typography variant="caption" color="text.secondary" fontWeight={600}>
					{t("运行状态", "Runtime State")}
				</Typography>
				{props.mode === "stopped" && (
					<Chip label="STOPPED" size="small" color="error" sx={{ height: 18, fontSize: 10 }} />
				)}
			</Stack>
			<Typography variant="body2" sx={{ mb: 0.75 }}>
				{t("模式", "Mode")}：<strong>{props.mode}</strong>
			</Typography>
			<Stack direction="row" spacing={0.5}>
				<Button
					variant="outlined"
					size="small"
					onClick={props.onStop}
					disabled={props.mode === "stopped"}
					startIcon={<StopIcon />}
					color="error"
				>
					{t("急停", "Stop")}
				</Button>
				<Button
					variant="outlined"
					size="small"
					onClick={props.onResume}
					disabled={props.mode === "auto"}
					startIcon={<PlayArrowIcon />}
				>
					{t("恢复", "Resume")}
				</Button>
			</Stack>
		</PanelCard>
	);
}

export function InteractionModeCard(props: {
	mode: "companion" | "delegated";
	preferredMode: "companion" | "delegated";
	lastReason: string;
	onModeChange: (nextMode: "companion" | "delegated") => void;
}) {
	const { t } = useI18n();

	return (
		<PanelCard>
			<Typography variant="caption" color="text.secondary" fontWeight={600} sx={{ mb: 0.75, display: "block" }}>
				{t("交互模式", "Interaction Mode")}
			</Typography>
			<Stack direction="row" spacing={0.75} sx={{ mb: 0.75 }}>
				<Button
					variant={props.mode === "companion" ? "contained" : "outlined"}
					size="small"
					onClick={() => props.onModeChange("companion")}
				>
					{t("陪伴", "Companion")}
				</Button>
				<Button
					variant={props.mode === "delegated" ? "contained" : "outlined"}
					size="small"
					onClick={() => props.onModeChange("delegated")}
				>
					{t("托管", "Delegated")}
				</Button>
			</Stack>
			<Stack spacing={0.25}>
				<Typography variant="body2">{t("当前模式", "Current Mode")}：{props.mode}</Typography>
				<Typography variant="body2">{t("用户偏好", "Preferred Mode")}：{props.preferredMode}</Typography>
				<Typography variant="body2">{t("最近切换", "Latest Reason")}：{props.lastReason}</Typography>
			</Stack>
		</PanelCard>
	);
}

export function CharacterSwitcherCard(props: {
	selectedId: string;
	profiles: CharacterProfile[];
	currentProfileName: string;
	emotion: string;
	isSpeaking: boolean;
	onChange: (event: SelectChangeEvent<string>) => Promise<void>;
}) {
	const { t } = useI18n();

	return (
		<PanelCard>
			<Typography variant="caption" color="text.secondary" fontWeight={600} sx={{ mb: 0.5, display: "block" }}>
				{t("当前角色", "Current Character")}：{props.currentProfileName}
			</Typography>
			<Select
				size="small"
				fullWidth
				value={props.selectedId}
				onChange={(event) => { void props.onChange(event); }}
				displayEmpty
				sx={{ fontSize: 13, mb: 1 }}
			>
				<MenuItem value="__manual__">
					<em>{t("手动人设", "Manual Persona")}</em>
				</MenuItem>
				{props.profiles.map((profile) => (
					<MenuItem key={profile.id} value={profile.id}>
						{profile.name}
					</MenuItem>
				))}
			</Select>

			<Box sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}>
				<Typography variant="body2">{t("当前表情", "Current Emotion")}：{props.emotion}</Typography>
				<Typography variant="body2">{t("语音状态", "Speech State")}：{props.isSpeaking ? t("说话中", "Speaking") : t("空闲", "Idle")}</Typography>
			</Box>
		</PanelCard>
	);
}

export function DebugCaptureCard(props: {
	state: DebugCaptureStateLike;
	onToggle: () => Promise<void>;
}) {
	const { t } = useI18n();

	return (
		<PanelCard>
			<Typography variant="caption" color="text.secondary" fontWeight={600} sx={{ mb: 0.5, display: "block" }}>
				{t("日志记录", "Debug Capture")}
			</Typography>
			<Button
				variant={props.state.enabled ? "contained" : "outlined"}
				size="small"
				color={props.state.enabled ? "warning" : "inherit"}
				onClick={() => { void props.onToggle(); }}
				sx={{ alignSelf: "flex-start", mb: 1 }}
			>
				{props.state.enabled ? t("停止日志写入", "Stop Capture") : t("开始日志写入", "Start Capture")}
			</Button>
			<Stack spacing={0.25}>
				<Typography variant="body2">{t("当前会话", "Current Session")}：{props.state.sessionId ?? t("无", "None")}</Typography>
				<Typography variant="body2">{t("写入目录", "Capture Directory")}：{props.state.sessionDirectory ?? t("无", "None")}</Typography>
				<Typography variant="body2">{t("已记录事件", "Captured Events")}：{props.state.capturedEventCount}</Typography>
				<Typography variant="body2">{t("已记录图片", "Captured Images")}：{props.state.capturedImageCount}</Typography>
				<Typography variant="body2">{t("最近错误", "Last Error")}：{props.state.lastError ?? t("无", "None")}</Typography>
			</Stack>
		</PanelCard>
	);
}

export function LatestDelegatedRecordCard(props: {
	record: LatestDelegatedRecordLike | null;
}) {
	const { t } = useI18n();

	return (
		<PanelCard>
			<Typography variant="caption" color="text.secondary" fontWeight={600} sx={{ mb: 0.5, display: "block" }}>
				{t("最近托管记录", "Latest Delegated Record")}
			</Typography>
			{props.record ? (
				<Stack spacing={0.5}>
					<Stack direction="row" spacing={0.5}>
						<Chip
							label={props.record.verificationResult.success ? t("成功", "Success") : t("失败", "Failed")}
							size="small"
							color={props.record.verificationResult.success ? "success" : "error"}
							sx={{ height: 18, fontSize: 10 }}
						/>
						<Chip
							label={props.record.sourceGame ?? "—"}
							size="small"
							variant="outlined"
							sx={{ height: 18, fontSize: 10 }}
						/>
					</Stack>
					<Typography variant="body2">{t("执行结果", "Execution Summary")}：{props.record.executionSummary}</Typography>
					<Typography variant="body2">{t("决策来源", "Decision Source")}：{props.record.analysisSource ?? t("无", "None")}</Typography>
					<Typography variant="body2">{t("决策摘要", "Decision Summary")}：{props.record.decisionSummary ?? t("无", "None")}</Typography>
					<Typography variant="body2">{t("计划动作", "Planned Actions")}：{props.record.plannedActions.length ? props.record.plannedActions.join(" -> ") : t("无", "None")}</Typography>
					<Typography variant="body2">{t("尝试动作", "Attempted Actions")}：{props.record.attemptedActions.length ? props.record.attemptedActions.join(" -> ") : t("无", "None")}</Typography>
					<Typography variant="body2">{t("下一步线索", "Next Step Hint")}：{props.record.nextStepHint ?? t("无", "None")}</Typography>
					{props.record.verificationResult.error ? (
						<Paper variant="outlined" sx={{ p: 0.75, bgcolor: "background.default" }}>
							<Typography variant="caption" color="error.main">
								{props.record.verificationResult.error}
							</Typography>
						</Paper>
					) : null}
				</Stack>
			) : (
				<Typography variant="body2" color="text.secondary">
					{t("尚无托管记录", "No delegated records yet")}
				</Typography>
			)}
		</PanelCard>
	);
}
