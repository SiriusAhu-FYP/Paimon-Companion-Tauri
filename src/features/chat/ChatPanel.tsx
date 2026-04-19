import { useState, useRef, useEffect } from "react";
import { Alert, Box, Typography, TextField, Button, Paper, IconButton, Tooltip } from "@mui/material";
import SendIcon from "@mui/icons-material/Send";
import MicIcon from "@mui/icons-material/Mic";
import MicOffIcon from "@mui/icons-material/MicOff";
import GraphicEqIcon from "@mui/icons-material/GraphicEq";
import { useEventBus, useVoiceInput } from "@/hooks";
import { useI18n } from "@/contexts/I18nProvider";
import { getServices } from "@/services";
import { createLogger } from "@/services/logger";
import { PROACTIVE_NO_REPLY_SENTINEL } from "@/services/proactive-companion";
import { RebuildGate } from "@/features/knowledge";

const log = createLogger("chat-panel");

interface ChatMessage {
	role: "user" | "assistant" | "system";
	content: string;
	timestamp: number;
	streaming?: boolean;
}

export function ChatPanel() {
	const { t } = useI18n();
	const [messages, setMessages] = useState<ChatMessage[]>([]);
	const [inputText, setInputText] = useState("");
	const [status, setStatus] = useState<"idle" | "thinking" | "speaking">("idle");
	const messagesEndRef = useRef<HTMLDivElement>(null);
	const streamBufferRef = useRef("");
	const { state: voiceState, toggle: toggleVoice } = useVoiceInput();

	useEffect(() => {
		messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
	}, [messages]);

	useEventBus("llm:request-start", (payload) => {
		if (payload.source === "proactive-reply") {
			return;
		}
		setStatus("thinking");
		streamBufferRef.current = "";
		setMessages((prev) => [
			...prev,
			{ role: "assistant", content: "", timestamp: Date.now(), streaming: true },
		]);
	});

	useEventBus("llm:stream-chunk", (payload) => {
		streamBufferRef.current += payload.delta;
		const text = streamBufferRef.current;
		setMessages((prev) => {
			const copy = [...prev];
			const last = copy[copy.length - 1];
			if (last?.streaming) {
				copy[copy.length - 1] = { ...last, content: text };
			}
			return copy;
		});
	});

	useEventBus("llm:response-end", (payload) => {
		streamBufferRef.current = "";
		const isProactive = payload.source === "proactive-reply";
		const shouldSuppressMessage = payload.source === "proactive-reply" && payload.fullText.trim() === PROACTIVE_NO_REPLY_SENTINEL;
		setMessages((prev) => {
			const copy = [...prev];
			const last = copy[copy.length - 1];
			if (last?.streaming) {
				if (shouldSuppressMessage) {
					copy.pop();
					return copy;
				}
				const text = payload.fullText || t("[AI 未返回有效内容]", "[AI returned no usable content]");
				copy[copy.length - 1] = { ...last, content: text, streaming: false };
				return copy;
			}
			if (isProactive && !shouldSuppressMessage && payload.fullText.trim()) {
				copy.push({
					role: "assistant",
					content: payload.fullText,
					timestamp: Date.now(),
				});
			}
			return copy;
		});
		// proactive 决策是后台流程，不应该长时间占用前台输入态
		if (isProactive || !payload.fullText || shouldSuppressMessage) {
			setStatus("idle");
		}
	});

	useEventBus("llm:error", (payload) => {
		streamBufferRef.current = "";
		setMessages((prev) => {
			const copy = [...prev];
			const last = copy[copy.length - 1];
			if (last?.streaming) {
				copy[copy.length - 1] = { ...last, content: `${t("[错误]", "[Error]")} ${payload.error}`, streaming: false };
			}
			return copy;
		});
		setStatus("idle");
	});

	useEventBus("audio:tts-start", () => setStatus("speaking"));
	useEventBus("audio:tts-end", () => setStatus("idle"));

	useEventBus("audio:asr-result", (payload) => {
		setMessages((prev) => [
			...prev,
			{ role: "user", content: payload.text, timestamp: Date.now() },
		]);
	});

	const [showRebuildGate, setShowRebuildGate] = useState(false);
	const pendingSendRef = useRef<string | null>(null);

	const executeSend = async (text: string) => {
		setMessages((prev) => [
			...prev,
			{ role: "user", content: text, timestamp: Date.now() },
		]);

		try {
			const { pipeline } = getServices();
			await pipeline.run(text, { inputSource: "manual" });
		} catch (err) {
			log.error("pipeline error", err);
		}
	};

	const handleSend = async () => {
		const text = inputText.trim();
		if (!text || status !== "idle") return;

		// 门控检查：索引需要重建时拦截
		try {
			const { knowledge } = getServices();
			if (knowledge.getIndexStatus() === "needs_rebuild") {
				pendingSendRef.current = text;
				setShowRebuildGate(true);
				return;
			}
		} catch { /* services not ready */ }

		setInputText("");
		executeSend(text);
	};

	const handleKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === "Enter" && !e.shiftKey) {
			e.preventDefault();
			handleSend();
		}
	};

	const voiceLabelMap: Record<typeof voiceState.status, string> = {
		idle: t("语音输入未开启", "Voice input is off"),
		"requesting-permission": t("正在请求麦克风权限...", "Requesting microphone permission..."),
		listening: t("麦克风已开启，等待说话", "Microphone is on, waiting for speech"),
		recording: t("检测到说话，正在录音", "Speech detected, recording"),
		transcribing: t("正在识别语音", "Transcribing speech"),
		locked: voiceState.playbackLocked
			? t("播放 TTS 中，麦克风已锁定", "TTS is playing, microphone locked")
			: t("当前对话处理中，暂不接收新语音", "Conversation is busy, new voice input is paused"),
		error: voiceState.lastError ? `${t("语音输入错误", "Voice input error")}: ${voiceState.lastError}` : t("语音输入错误", "Voice input error"),
	};

	const voiceButtonIcon = (() => {
		switch (voiceState.status) {
			case "recording":
				return <GraphicEqIcon sx={{ fontSize: 18 }} />;
			case "idle":
			case "error":
				return <MicOffIcon sx={{ fontSize: 18 }} />;
			default:
				return <MicIcon sx={{ fontSize: 18 }} />;
		}
	})();

	const voiceButtonColor =
		voiceState.status === "recording"
			? "warning.main"
			: voiceState.enabled
				? "primary.main"
				: "text.secondary";

	const permissionLabelMap: Record<typeof voiceState.permission, string> = {
		unknown: t("未确认", "Unknown"),
		granted: t("已授予", "Granted"),
		denied: t("已拒绝", "Denied"),
	};

	const phaseLabelMap: Record<typeof voiceState.status, string> = {
		idle: t("未开启", "Off"),
		"requesting-permission": t("请求权限", "Requesting Permission"),
		listening: t("待机监听", "Listening"),
		recording: t("正在录音", "Recording"),
		transcribing: t("识别中", "Transcribing"),
		locked: t("已锁定", "Locked"),
		error: t("错误", "Error"),
	};
	const showVoiceDiagnostics = voiceState.status === "requesting-permission"
		|| voiceState.status === "recording"
		|| voiceState.status === "transcribing"
		|| voiceState.status === "locked"
		|| voiceState.status === "error"
		|| !!voiceState.lastError;

	return (
		<Box sx={{ display: "flex", flexDirection: "column", height: "100%", p: 1.5 }}>
			<Typography variant="subtitle2" sx={{ color: "primary.main", fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, mb: 1 }}>
				{t("对话", "Chat")}
			</Typography>

			{/* 消息列表 */}
			<Box sx={{ flex: 1, overflowY: "auto", minHeight: 0, display: "flex", flexDirection: "column", gap: 0.75 }}>
				{messages.length === 0 ? (
					<Typography variant="body2" color="text.disabled" sx={{ textAlign: "center", py: 3 }}>
						{t("输入文本开始对话", "Type a message to start chatting")}
					</Typography>
				) : (
					messages.map((msg, i) => (
						<Paper
							key={i}
							elevation={0}
							sx={{
								p: 1, borderRadius: 1,
								bgcolor: msg.role === "user" ? "background.paper" : "background.default",
								display: "flex", gap: 1,
							}}
						>
							<Typography variant="caption" sx={{ color: "primary.main", fontWeight: 600, minWidth: 32 }}>
								{msg.role === "user" ? t("用户", "User") : "AI"}
							</Typography>
							<Typography variant="body2" sx={{ flex: 1 }}>
								{msg.content}
								{msg.streaming && (
									<Box component="span" sx={{ color: "primary.main", animation: "blink 0.8s step-end infinite" }}>
										▌
									</Box>
								)}
							</Typography>
						</Paper>
					))
				)}
				<div ref={messagesEndRef} />
			</Box>

			{status !== "idle" && (
				<Typography variant="caption" sx={{ color: "primary.main", textAlign: "center", py: 0.5, animation: "pulse 1.5s ease-in-out infinite" }}>
					{status === "thinking" && t("AI 正在思考...", "AI is thinking...")}
					{status === "speaking" && t("正在播放语音...", "Playing speech...")}
				</Typography>
			)}

			{showVoiceDiagnostics && (
				<Box sx={{ py: 0.5 }}>
					<Paper
						elevation={0}
						sx={{
							p: 0.9,
							borderRadius: 1,
							bgcolor: "background.paper",
							border: "1px solid",
							borderColor: voiceState.status === "error" ? "error.main" : "divider",
							display: "flex",
							flexDirection: "column",
							gap: 0.5,
						}}
					>
						<Typography
							variant="caption"
							sx={{
								color: voiceState.status === "error" ? "error.main" : "text.secondary",
								fontWeight: 600,
							}}
						>
							{t("语音诊断", "Voice Diagnostics")}
						</Typography>
						<Typography variant="caption" sx={{ color: "text.secondary" }}>
							{t("状态", "Status")}：{phaseLabelMap[voiceState.status]} · Provider：{voiceState.providerLabel} · {t("权限", "Permission")}：{permissionLabelMap[voiceState.permission]}
						</Typography>
						<Typography variant="caption" sx={{ color: voiceState.status === "error" ? "error.main" : "text.secondary" }}>
							{voiceLabelMap[voiceState.status]}
						</Typography>
						{voiceState.lastTranscript && (
							<Alert severity="info" sx={{ py: 0, "& .MuiAlert-message": { py: 0.2 } }}>
								<Typography variant="caption">
									{t("最近识别", "Latest Transcript")}：{voiceState.lastTranscript}
								</Typography>
							</Alert>
						)}
						{voiceState.lastError && (
							<Alert severity="error" sx={{ py: 0, "& .MuiAlert-message": { py: 0.2 } }}>
								<Typography variant="caption">
									{t("最近错误", "Latest Error")}：{voiceState.lastError}
								</Typography>
							</Alert>
						)}
					</Paper>
				</Box>
			)}

			{showRebuildGate && (
				<Box sx={{ py: 1 }}>
					<RebuildGate
						onRebuilt={() => {
							setShowRebuildGate(false);
							if (pendingSendRef.current) {
								const text = pendingSendRef.current;
								pendingSendRef.current = null;
								setInputText("");
								executeSend(text);
							}
						}}
						onCancel={() => {
							setShowRebuildGate(false);
							pendingSendRef.current = null;
						}}
					/>
				</Box>
			)}

			{/* 输入区 */}
			<Box sx={{ display: "flex", gap: 0.75, pt: 1, borderTop: "1px solid", borderColor: "secondary.main", mt: 1 }}>
				<TextField
					size="small"
					fullWidth
					placeholder={status === "idle"
						? t("输入消息，按 Enter 发送...", "Type a message and press Enter...")
						: t("等待回复中...", "Waiting for reply...")}
					value={inputText}
					onChange={(e) => setInputText(e.target.value)}
					onKeyDown={handleKeyDown}
					disabled={status !== "idle"}
					sx={{
						"& .MuiOutlinedInput-root": {
							fontSize: 13,
						},
					}}
				/>
				<Tooltip title={voiceState.enabled ? t("关闭麦克风", "Turn off microphone") : t("开启麦克风", "Turn on microphone")}>
					<span>
						<IconButton
							size="small"
							onClick={() => { void toggleVoice(); }}
							sx={{
								border: "1px solid",
								borderColor: voiceState.enabled ? "primary.main" : "divider",
								color: voiceButtonColor,
							}}
						>
							{voiceButtonIcon}
						</IconButton>
					</span>
				</Tooltip>
				<Button
					variant="contained"
					size="small"
					onClick={handleSend}
					disabled={status !== "idle" || !inputText.trim()}
					sx={{ minWidth: 0, px: 1.5 }}
				>
					<SendIcon sx={{ fontSize: 16 }} />
				</Button>
			</Box>
		</Box>
	);
}
