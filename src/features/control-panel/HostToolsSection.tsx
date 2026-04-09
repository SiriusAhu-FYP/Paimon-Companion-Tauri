import { useCallback, useMemo, useState } from "react";
import {
	Alert,
	Box,
	Button,
	CircularProgress,
	Stack,
	TextField,
	Typography,
} from "@mui/material";
import MicIcon from "@mui/icons-material/Mic";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import CancelIcon from "@mui/icons-material/Cancel";
import { HelpTooltip } from "@/components";
import { useI18n } from "@/contexts/I18nProvider";
import { listWindows } from "@/services/system";
import { createLogger } from "@/services/logger";
import type {
	FunctionalRuntimeState,
	FunctionalTarget,
	HostMouseAction,
	HostMouseButton,
	HostWindowInfo,
} from "@/types";
import { InfoLine, PanelCard, SectionHeader } from "./panel-shell";

const log = createLogger("host-tools-section");
const WINDOW_LIST_PREVIEW_LIMIT = 40;

export function HostToolsSection(props: {
	functionalState: FunctionalRuntimeState;
	setTarget: (target: FunctionalTarget | null) => void;
	runCapture: (target?: FunctionalTarget) => Promise<unknown>;
	runFocus: (target?: FunctionalTarget) => Promise<unknown>;
	runKey: (key: string, target?: FunctionalTarget) => Promise<unknown>;
	runMouse: (
		options: { action?: HostMouseAction; button?: HostMouseButton; x?: number; y?: number },
		target?: FunctionalTarget,
	) => Promise<unknown>;
}) {
	const { t } = useI18n();
	const [micStatus, setMicStatus] = useState<"idle" | "ok" | "denied" | "error">("idle");
	const [windowsLoading, setWindowsLoading] = useState(false);
	const [windowList, setWindowList] = useState<HostWindowInfo[]>([]);
	const [windowListError, setWindowListError] = useState<string | null>(null);
	const [windowQuery, setWindowQuery] = useState("");
	const [manualKey, setManualKey] = useState("Enter");

	const functionalError =
		props.functionalState.safetyBlockedReason
		?? (props.functionalState.latestTask?.status === "failed" ? props.functionalState.latestTask.error : null);

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
			].join(" ").toLowerCase();

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
			const message = err instanceof Error ? err.message : String(err);
			log.error("mic test failed", message);
			setMicStatus(message.includes("denied") || message.includes("NotAllowed") ? "denied" : "error");
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
		props.setTarget({ handle: windowInfo.handle, title: windowInfo.title });
		log.info("selected functional target", {
			handle: windowInfo.handle,
			title: windowInfo.title,
		});
	}, [props]);

	const handleFocusWindow = useCallback(async (windowInfo: HostWindowInfo) => {
		const target = { handle: windowInfo.handle, title: windowInfo.title };
		props.setTarget(target);

		try {
			await props.runFocus(target);
		} catch (err) {
			log.error("failed to focus window", err);
		}
	}, [props]);

	const handleCaptureWindow = useCallback(async (windowInfo: HostWindowInfo) => {
		const target = { handle: windowInfo.handle, title: windowInfo.title };
		props.setTarget(target);

		try {
			await props.runCapture(target);
		} catch (err) {
			log.error("failed to capture window", err);
		}
	}, [props]);

	const handleSendKey = useCallback(async (key: string) => {
		if (!props.functionalState.selectedTarget || !key.trim()) return;

		try {
			await props.runKey(key.trim(), props.functionalState.selectedTarget);
		} catch (err) {
			log.error("failed to send key", err);
		}
	}, [props]);

	const handleMouseClickCenter = useCallback(async () => {
		if (!props.functionalState.selectedTarget) return;

		try {
			await props.runMouse({ action: "click", button: "left" }, props.functionalState.selectedTarget);
		} catch (err) {
			log.error("failed to send mouse", err);
		}
	}, [props]);

	return (
		<PanelCard compact>
			<SectionHeader
				title={t("宿主工具", "Host Tools")}
				right={<HelpTooltip title={t("测试麦克风、窗口发现和基础输入能力。", "Test microphone, window discovery, and basic input capabilities.")} />}
			/>

			<Stack direction="row" spacing={0.5} alignItems="center">
				<Button variant="outlined" size="small" onClick={handleMicTest} startIcon={<MicIcon />}>
					{t("麦克风", "Microphone")}
				</Button>
				{micStatus === "ok" && <CheckCircleIcon color="success" sx={{ fontSize: 14 }} />}
				{micStatus !== "idle" && micStatus !== "ok" && <CancelIcon color="error" sx={{ fontSize: 14 }} />}
				<Button variant="outlined" size="small" onClick={handleListWindows} disabled={windowsLoading}>
					{windowsLoading ? t("枚举中...", "Listing...") : t("枚举窗口", "List Windows")}
				</Button>
				<InfoLine>
					{windowList.length > 0 ? `${filteredWindowList.length} / ${windowList.length}` : t("未获取", "Not loaded")}
				</InfoLine>
			</Stack>

			{windowList.length > 0 && (
				<Stack direction="row" spacing={0.5} alignItems="center" sx={{ mt: 0.75 }}>
					<TextField
						size="small"
						fullWidth
						value={windowQuery}
						onChange={(event) => setWindowQuery(event.target.value)}
						placeholder={t("搜索标题 / 进程 / 类名 / PID", "Search title / process / class / PID")}
					/>
					<Button size="small" variant="text" onClick={() => setWindowQuery("")} disabled={!windowQuery.trim()}>
						{t("清空", "Clear")}
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
							<PanelCard key={windowInfo.handle} compact>
								<Typography variant="caption" sx={{ display: "block", color: "text.primary" }}>
									{windowInfo.title}
								</Typography>
								<InfoLine>
									PID {windowInfo.processId} · {windowInfo.processName || "unknown"} · {windowInfo.className}
								</InfoLine>
								<InfoLine mb={0.5}>
									{windowInfo.visible ? t("可见", "visible") : t("隐藏", "hidden")} · {windowInfo.minimized ? t("最小化", "minimized") : t("正常", "normal")}
								</InfoLine>
								<Stack direction="row" justifyContent="flex-end" spacing={0.25} sx={{ flexWrap: "wrap" }}>
									<Button
										size="small"
										variant={props.functionalState.selectedTarget?.handle === windowInfo.handle ? "contained" : "text"}
										onClick={() => selectWindowTarget(windowInfo)}
										sx={{ minWidth: 0, fontSize: 11, px: 0.5 }}
									>
										{t("目标", "Target")}
									</Button>
									<Button
										size="small"
										variant="text"
										onClick={() => handleFocusWindow(windowInfo)}
										disabled={props.functionalState.activeTaskId !== null}
										sx={{ minWidth: 0, fontSize: 11, px: 0.5 }}
									>
										{t("聚焦", "Focus")}
									</Button>
									<Button
										size="small"
										variant="text"
										onClick={() => handleCaptureWindow(windowInfo)}
										disabled={props.functionalState.activeTaskId !== null}
										sx={{ minWidth: 0, fontSize: 11, px: 0.5 }}
									>
										{t("截图", "Capture")}
									</Button>
								</Stack>
							</PanelCard>
						))}
					</Stack>
					{filteredWindowList.length > WINDOW_LIST_PREVIEW_LIMIT && (
						<InfoLine>
							{t("仅展示前", "Showing only the first")} {WINDOW_LIST_PREVIEW_LIMIT} {t("条，请继续搜索。", "results. Refine the search.")}
						</InfoLine>
					)}
					{filteredWindowList.length === 0 && (
						<InfoLine>
							{t("没有匹配结果。", "No matching results.")}
						</InfoLine>
					)}
				</Box>
			)}

			{props.functionalState.activeTaskId && (
				<Stack direction="row" spacing={0.5} alignItems="center" sx={{ mt: 0.75 }}>
					<CircularProgress size={12} />
					<InfoLine>
						{t("执行中", "Running")}：{props.functionalState.latestTask?.name ?? t("功能任务", "Functional task")}
					</InfoLine>
				</Stack>
			)}

			{props.functionalState.selectedTarget && (
				<PanelCard compact>
					<InfoLine mb={0.5}>
						{t("当前目标", "Current Target")}：{props.functionalState.selectedTarget.title || props.functionalState.selectedTarget.handle}
					</InfoLine>
					<Stack direction="row" spacing={0.5} sx={{ mb: 0.5, flexWrap: "wrap" }}>
						<Button size="small" variant="outlined" onClick={() => props.runFocus(props.functionalState.selectedTarget ?? undefined)} disabled={props.functionalState.activeTaskId !== null}>
							{t("聚焦", "Focus")}
						</Button>
						<Button size="small" variant="outlined" onClick={() => props.runCapture(props.functionalState.selectedTarget ?? undefined)} disabled={props.functionalState.activeTaskId !== null}>
							{t("截图", "Capture")}
						</Button>
						<Button size="small" variant="outlined" onClick={handleMouseClickCenter} disabled={props.functionalState.activeTaskId !== null}>
							{t("点击中心", "Click Center")}
						</Button>
						<Button size="small" variant="outlined" onClick={() => handleSendKey("Enter")} disabled={props.functionalState.activeTaskId !== null}>
							Enter
						</Button>
						<Button size="small" variant="outlined" onClick={() => handleSendKey("Space")} disabled={props.functionalState.activeTaskId !== null}>
							Space
						</Button>
					</Stack>
					<Stack direction="row" spacing={0.5} sx={{ mb: 0.5, flexWrap: "wrap" }}>
						<Button size="small" variant="text" onClick={() => handleSendKey("Up")} disabled={props.functionalState.activeTaskId !== null}>Up</Button>
						<Button size="small" variant="text" onClick={() => handleSendKey("Down")} disabled={props.functionalState.activeTaskId !== null}>Down</Button>
						<Button size="small" variant="text" onClick={() => handleSendKey("Left")} disabled={props.functionalState.activeTaskId !== null}>Left</Button>
						<Button size="small" variant="text" onClick={() => handleSendKey("Right")} disabled={props.functionalState.activeTaskId !== null}>Right</Button>
					</Stack>
					<Stack direction="row" spacing={0.5}>
						<TextField
							size="small"
							fullWidth
							value={manualKey}
							onChange={(event) => setManualKey(event.target.value)}
							placeholder="Enter / Up / a"
						/>
						<Button
							size="small"
							variant="contained"
							onClick={() => handleSendKey(manualKey)}
							disabled={!manualKey.trim() || props.functionalState.activeTaskId !== null}
						>
							{t("发送", "Send")}
						</Button>
					</Stack>
				</PanelCard>
			)}
		</PanelCard>
	);
}
