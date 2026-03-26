import { useState, useEffect, useCallback } from "react";
import {
	Box, Button, Typography, Stack, Chip, Divider,
	Select, MenuItem, TextField,
	type SelectChangeEvent,
} from "@mui/material";
import StopIcon from "@mui/icons-material/Stop";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import MicIcon from "@mui/icons-material/Mic";
import { useRuntime, useCharacter } from "@/hooks";
import { HelpTooltip } from "@/components";
import { getServices } from "@/services";
import { updateConfig, getConfig } from "@/services/config";
import { mockVoicePipeline, mockExternalEvents, MOCK_CHARACTER_PROFILE } from "@/utils/mock";
import type { CharacterProfile } from "@/types";
import { createLogger } from "@/services/logger";

const log = createLogger("control-panel");

export function ControlPanel() {
	const { mode, stop, resume } = useRuntime();
	const { emotion, isSpeaking } = useCharacter();

	// ── 角色切换 ──
	const [profiles, setProfiles] = useState<CharacterProfile[]>([]);
	const [selectedId, setSelectedId] = useState<string>("");

	useEffect(() => {
		const { character } = getServices();
		const available = character.getAvailableProfiles();
		setProfiles([...available]);

		const current = character.getProfile();
		setSelectedId(current?.id ?? "");
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

	// ── 上下文注入 ──
	const [productText, setProductText] = useState("");
	const [liveContextText, setLiveContextText] = useState("");

	const handleAddProduct = useCallback(() => {
		const text = productText.trim();
		if (!text) return;
		const { knowledge } = getServices();
		knowledge.addKnowledge({ id: `product-${Date.now()}`, content: text });
		setProductText("");
		log.info("product knowledge added");
	}, [productText]);

	const handleAddLiveContext = useCallback(() => {
		const text = liveContextText.trim();
		if (!text) return;
		const { knowledge } = getServices();
		knowledge.addLiveContext({ id: `live-${Date.now()}`, content: text, priority: 10, expiresAt: null });
		setLiveContextText("");
		log.info("live context added");
	}, [liveContextText]);

	const handleClearKnowledge = useCallback(() => {
		const { knowledge } = getServices();
		knowledge.clearLongTermKnowledge();
		knowledge.clearLiveContext();
		log.info("knowledge + live context cleared");
	}, []);

	// ── Mock 测试 ──
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

			{/* 角色切换 */}
			<Box sx={{ bgcolor: "background.paper", borderRadius: 1, p: 1 }}>
				<Typography variant="caption" color="text.secondary" fontWeight={600} sx={{ mb: 0.5, display: "block" }}>
					当前角色
				</Typography>
				<Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 0.5 }}>
					<Chip
						label={profiles.find((p) => p.id === selectedId)?.name ?? selectedId === "__manual__" ? "默认角色" : "未选择"}
						color="primary"
						size="small"
						variant="outlined"
						sx={{ fontWeight: 600 }}
					/>
				</Box>
				<Select
					size="small" fullWidth
					value={selectedId}
					onChange={handleCharacterSwitch}
					displayEmpty
					sx={{ fontSize: 13, mb: 0.5 }}
				>
					<MenuItem value="__manual__">
						<em>默认角色（手动人设）</em>
					</MenuItem>
					{profiles.map((p) => (
						<MenuItem key={p.id} value={p.id}>{p.name}</MenuItem>
					))}
				</Select>
				<Typography variant="body2">情绪：{emotion}</Typography>
				<Typography variant="body2">说话中：{isSpeaking ? "是" : "否"}</Typography>
			</Box>

			<Divider />

			{/* 上下文注入 */}
			<Box sx={{ bgcolor: "background.paper", borderRadius: 1, p: 1 }}>
				<Stack direction="row" alignItems="center" sx={{ mb: 0.5 }}>
					<Typography variant="caption" color="text.secondary" fontWeight={600}>上下文注入</Typography>
					<HelpTooltip title="将商品资料或运营口径注入 LLM 上下文，影响回复内容" />
				</Stack>

				<Typography variant="caption" color="text.secondary" sx={{ fontSize: 10, display: "block", mb: 0.5 }}>
					商品/资料
				</Typography>
				<Stack direction="row" spacing={0.5} sx={{ mb: 0.75 }}>
					<TextField
						size="small" fullWidth multiline maxRows={3}
						placeholder="例：原神周边摆件，限时8折"
						value={productText}
						onChange={(e) => setProductText(e.target.value)}
						sx={{ "& .MuiInputBase-input": { fontSize: 12 } }}
					/>
					<Button variant="outlined" size="small" onClick={handleAddProduct} disabled={!productText.trim()} sx={{ minWidth: 48 }}>
						注入
					</Button>
				</Stack>

				<Typography variant="caption" color="text.secondary" sx={{ fontSize: 10, display: "block", mb: 0.5 }}>
					运营口径 / 直播上下文
				</Typography>
				<Stack direction="row" spacing={0.5} sx={{ mb: 0.75 }}>
					<TextField
						size="small" fullWidth multiline maxRows={3}
						placeholder="例：当前是晚间互动环节"
						value={liveContextText}
						onChange={(e) => setLiveContextText(e.target.value)}
						sx={{ "& .MuiInputBase-input": { fontSize: 12 } }}
					/>
					<Button variant="outlined" size="small" onClick={handleAddLiveContext} disabled={!liveContextText.trim()} sx={{ minWidth: 48 }}>
						注入
					</Button>
				</Stack>

				<Button variant="text" size="small" color="warning" onClick={handleClearKnowledge} sx={{ fontSize: 11 }}>
					清空全部注入
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
