import { useState } from "react";
import {
	Box,
	Button,
	Chip,
	Collapse,
	MenuItem,
	Paper,
	Select,
	Stack,
	TextField,
	type SelectChangeEvent,
	Typography,
} from "@mui/material";
import StopIcon from "@mui/icons-material/Stop";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import { useI18n } from "@/contexts/I18nProvider";
import type { CharacterProfile, HostWindowInfo } from "@/types";
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
	onModeChange: (nextMode: "companion" | "delegated") => void;
	companionRunning: boolean;
	delegationRunning: boolean;
	delegationTaskText: string;
	delegationTaskPlaceholder: string;
	windowList: HostWindowInfo[];
	windowsLoading: boolean;
	selectedTargetHandle: string | null;
	onDelegationTaskTextChange: (text: string) => void;
	onStartCompanion: () => Promise<void>;
	onStopCompanion: () => void;
	onExecuteDelegationTask: () => Promise<void>;
	onStopDelegationTask: () => void;
	onFocusFirefox: () => Promise<void>;
	onEnumerateWindows: () => Promise<void>;
	onFocusWindowFromList: (windowInfo: HostWindowInfo) => Promise<void>;
}) {
	const { t } = useI18n();
	const [windowListExpanded, setWindowListExpanded] = useState(false);
	const [windowQuery, setWindowQuery] = useState("");
	const delegationButtonsDisabled = props.delegationRunning || props.windowsLoading;
	const filteredWindowList = props.windowList.filter((windowInfo) => {
		const query = windowQuery.trim().toLowerCase();
		if (!query) {
			return true;
		}
		const haystack = [
			windowInfo.title,
			windowInfo.processName,
			windowInfo.className,
			windowInfo.handle,
			String(windowInfo.processId),
		].join(" ").toLowerCase();
		return haystack.includes(query);
	});

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
					{t("陪伴模式", "Companion Mode")}
				</Button>
				<Button
					variant={props.mode === "delegated" ? "contained" : "outlined"}
					size="small"
					onClick={() => props.onModeChange("delegated")}
				>
					{t("托管模式", "Delegation Mode")}
				</Button>
			</Stack>

			<Stack spacing={0.75} sx={{ mb: 0.75 }}>
				{props.mode === "companion" ? (
					<Stack direction="row" spacing={0.75}>
						{props.companionRunning ? (
							<Button
								variant="outlined"
								size="small"
								color="error"
								onClick={props.onStopCompanion}
								startIcon={<StopIcon />}
							>
								{t("停止", "Stop")}
							</Button>
						) : (
							<Button
								variant="contained"
								size="small"
								onClick={() => { void props.onStartCompanion(); }}
								startIcon={<PlayArrowIcon />}
							>
								{t("启动", "Start")}
							</Button>
						)}
					</Stack>
				) : (
					<>
						<TextField
							size="small"
							fullWidth
							value={props.delegationTaskText}
							onChange={(event) => props.onDelegationTaskTextChange(event.target.value)}
							placeholder={props.delegationTaskPlaceholder}
							disabled={props.delegationRunning}
							sx={{ "& .MuiInputBase-input": { fontSize: 12 } }}
						/>
						<Stack direction="row" spacing={0.5} sx={{ flexWrap: "wrap", rowGap: 0.5 }}>
							{props.delegationRunning ? (
								<Button
									variant="outlined"
									size="small"
									color="error"
									onClick={props.onStopDelegationTask}
									startIcon={<StopIcon />}
								>
									{t("停止任务", "Stop Task")}
								</Button>
							) : (
								<Button
									variant="contained"
									size="small"
									onClick={() => { void props.onExecuteDelegationTask(); }}
									disabled={!props.delegationTaskText.trim()}
									startIcon={<PlayArrowIcon />}
								>
									{t("执行任务", "Execute Task")}
								</Button>
							)}
						</Stack>
					</>
				)}
			</Stack>

			<Stack spacing={0.75}>
				<Stack direction="row" spacing={0.5} sx={{ flexWrap: "wrap", rowGap: 0.5 }}>
					<Button
						variant="outlined"
						size="small"
						onClick={() => { void props.onFocusFirefox(); }}
						disabled={delegationButtonsDisabled}
					>
						{t("聚焦 Firefox", "Focus Firefox")}
					</Button>
					<Button
						variant="text"
						size="small"
						onClick={() => { void props.onEnumerateWindows().then(() => setWindowListExpanded(true)); }}
						disabled={delegationButtonsDisabled}
					>
						{props.windowsLoading
							? t("枚举中...", "Enumerating...")
							: t("枚举窗口并聚焦", "Enumerate Window & Focus")}
					</Button>
					<Button
						variant="text"
						size="small"
						onClick={() => setWindowListExpanded((prev) => !prev)}
						disabled={props.windowList.length === 0}
					>
						{windowListExpanded ? t("收起列表", "Collapse List") : t("展开列表", "Expand List")}
					</Button>
					<Typography variant="caption" color="text.secondary" sx={{ alignSelf: "center" }}>
						{props.windowList.length ? `${filteredWindowList.length}/${props.windowList.length}` : t("未枚举", "Not listed")}
					</Typography>
				</Stack>
				<Collapse in={windowListExpanded} unmountOnExit>
					<Stack spacing={0.5} sx={{ maxHeight: 180, overflowY: "auto", pr: 0.5 }}>
						{props.windowList.length > 0 ? (
							<>
								<TextField
									size="small"
									value={windowQuery}
									onChange={(event) => setWindowQuery(event.target.value)}
									placeholder={t("过滤标题 / 进程 / PID", "Filter by title / process / PID")}
								/>
								{filteredWindowList.map((windowInfo) => (
									<Paper
										key={windowInfo.handle}
										variant="outlined"
										sx={{ p: 0.5, bgcolor: "background.default" }}
									>
										<Typography variant="caption" sx={{ display: "block" }}>
											{windowInfo.title}
										</Typography>
										<Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
											{windowInfo.processName || "unknown"} · PID {windowInfo.processId}
										</Typography>
										<Stack direction="row" justifyContent="space-between" alignItems="center">
											<Typography variant="caption" color="text.secondary">
												{windowInfo.handle}
											</Typography>
											<Button
												size="small"
												variant={props.selectedTargetHandle === windowInfo.handle ? "contained" : "outlined"}
												onClick={() => { void props.onFocusWindowFromList(windowInfo); }}
												disabled={delegationButtonsDisabled}
											>
												{t("聚焦", "Focus")}
											</Button>
										</Stack>
									</Paper>
								))}
								{filteredWindowList.length === 0 && (
									<Typography variant="caption" color="text.secondary">
										{t("没有匹配窗口。", "No windows matched.")}
									</Typography>
								)}
							</>
						) : (
							<Typography variant="caption" color="text.secondary">
								{t("还没有窗口列表，请先枚举。", "Window list is empty. Enumerate first.")}
							</Typography>
						)}
					</Stack>
				</Collapse>
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
				{t("最近托管记录", "Latest Delegation Record")}
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
					{t("尚无托管记录", "No delegation records yet")}
				</Typography>
			)}
		</PanelCard>
	);
}
