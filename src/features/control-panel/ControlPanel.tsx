import { useState, useEffect } from "react";
import {
	Box, Button, Typography, Stack, Chip, Divider,
	Select, MenuItem, FormControl,
} from "@mui/material";
import type { SelectChangeEvent } from "@mui/material";
import StopIcon from "@mui/icons-material/Stop";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import MicIcon from "@mui/icons-material/Mic";
import { useRuntime, useCharacter } from "@/hooks";
import { HelpTooltip } from "@/components";
import { MODEL_REGISTRY, DEFAULT_MODEL } from "@/features/live2d";
import { broadcastControl, onControlCommand, type ControlCommand } from "@/utils/window-sync";
import { getServices } from "@/services";
import { mockVoicePipeline, mockExternalEvents } from "@/utils/mock";
import { createLogger } from "@/services/logger";

const log = createLogger("control-panel");

export function ControlPanel() {
	const { mode, stop, resume } = useRuntime();
	const { characterId, emotion, isSpeaking } = useCharacter();

	const [selectedModel, setSelectedModel] = useState(DEFAULT_MODEL.path);
	const [expressions, setExpressions] = useState<string[]>([]);

	// 监听 Stage 汇报的表情列表
	useEffect(() => {
		let cleanup: (() => void) | null = null;
		onControlCommand((cmd: ControlCommand) => {
			if (cmd.type === "report-expressions") {
				setExpressions(cmd.expressions);
				log.info(`received ${cmd.expressions.length} expressions from stage`);
			}
		}).then((unsub) => { cleanup = unsub; });
		return () => { cleanup?.(); };
	}, []);

	const handleModelChange = (event: SelectChangeEvent) => {
		const path = event.target.value;
		setSelectedModel(path);
		setExpressions([]);
		broadcastControl({ type: "set-model", modelPath: path });
	};

	const handleExpression = (name: string) => {
		broadcastControl({ type: "set-expression", expressionName: name });
	};

	const handleMockPipeline = async () => {
		const { bus, runtime } = getServices();
		await mockVoicePipeline(bus, runtime);
	};

	const handleMockExternal = () => {
		const { externalInput } = getServices();
		mockExternalEvents(externalInput);
	};

	const [micStatus, setMicStatus] = useState<"idle" | "ok" | "denied" | "error">("idle");
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

	return (
		<Box sx={{ p: 1.5, display: "flex", flexDirection: "column", gap: 1 }}>
			<Typography variant="subtitle2" sx={{ color: "primary.main", fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5 }}>
				控制面板
			</Typography>

			{/* 模型切换 */}
			<Box>
				<Stack direction="row" alignItems="center" sx={{ mb: 0.5 }}>
					<Typography variant="caption" color="text.secondary" fontWeight={600}>模型</Typography>
					<HelpTooltip title="切换 Live2D 模型。切换后 Stage 窗口会重新加载" />
				</Stack>
				<FormControl size="small" fullWidth>
					<Select
						value={selectedModel}
						onChange={handleModelChange}
						sx={{ fontSize: 12 }}
					>
						{MODEL_REGISTRY.map((m) => (
							<MenuItem key={m.path} value={m.path} sx={{ fontSize: 12 }}>
								{m.name}
							</MenuItem>
						))}
					</Select>
				</FormControl>
			</Box>

			<Divider />

			{/* 运行状态 */}
			<Box sx={{
				bgcolor: "background.paper", borderRadius: 1, p: 1,
				...(mode === "stopped" && { border: "1px solid", borderColor: "error.main", bgcolor: "#2a1020" }),
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

			{/* 角色状态 */}
			<Box sx={{ bgcolor: "background.paper", borderRadius: 1, p: 1 }}>
				<Typography variant="caption" color="text.secondary" fontWeight={600} sx={{ mb: 0.5, display: "block" }}>
					角色状态
				</Typography>
				<Typography variant="body2">角色：{characterId || "未加载"}</Typography>
				<Typography variant="body2">情绪：{emotion}</Typography>
				<Typography variant="body2">说话中：{isSpeaking ? "是" : "否"}</Typography>
			</Box>

			<Divider />

			{/* 表情切换——动态从模型读取 */}
			{expressions.length > 0 && (
				<>
					<Box>
						<Stack direction="row" alignItems="center" sx={{ mb: 0.5 }}>
							<Typography variant="caption" color="text.secondary" fontWeight={600}>表情</Typography>
							<HelpTooltip title="模型自带的表情文件。点击后 Stage 中的模型会切换表情" />
						</Stack>
						<Stack direction="row" flexWrap="wrap" gap={0.5}>
							{expressions.map((e) => (
								<Button
									key={e}
									size="small"
									variant="outlined"
									onClick={() => handleExpression(e)}
									sx={{ fontSize: 10, px: 1, py: 0.25, minWidth: 0, textTransform: "none" }}
								>
									{e}
								</Button>
							))}
						</Stack>
					</Box>
					<Divider />
				</>
			)}

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
					<Typography variant="caption" sx={{ fontSize: 11 }}>
						{micStatus === "ok" && "✅ 成功"}
						{micStatus === "denied" && "❌ 权限被拒绝"}
						{micStatus === "error" && "❌ 出错"}
					</Typography>
				</Stack>
			</Box>

			<Divider />

			{/* Mock 测试 */}
			<Box>
				<Stack direction="row" alignItems="center" sx={{ mb: 0.5 }}>
					<Typography variant="caption" color="text.secondary" fontWeight={600}>Mock 测试</Typography>
					<HelpTooltip title="模拟语音链路（含口型同步）和外部事件" />
				</Stack>
				<Stack direction="row" spacing={0.5}>
					<Button variant="outlined" size="small" onClick={handleMockPipeline}>
						模拟语音链路
					</Button>
					<Button variant="outlined" size="small" onClick={handleMockExternal}>
						模拟外部事件
					</Button>
				</Stack>
			</Box>
		</Box>
	);
}
