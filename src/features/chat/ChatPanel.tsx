import { useState, useRef, useEffect } from "react";
import { Box, Typography, TextField, Button, Paper } from "@mui/material";
import SendIcon from "@mui/icons-material/Send";
import { useEventBus } from "@/hooks";
import { getServices } from "@/services";
import { createLogger } from "@/services/logger";

const log = createLogger("chat-panel");

interface ChatMessage {
	role: "user" | "assistant" | "system";
	content: string;
	timestamp: number;
	streaming?: boolean;
}

export function ChatPanel() {
	const [messages, setMessages] = useState<ChatMessage[]>([]);
	const [inputText, setInputText] = useState("");
	const [status, setStatus] = useState<"idle" | "thinking" | "speaking">("idle");
	const messagesEndRef = useRef<HTMLDivElement>(null);
	const streamBufferRef = useRef("");

	useEffect(() => {
		messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
	}, [messages]);

	useEventBus("llm:request-start", () => {
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
		setMessages((prev) => {
			const copy = [...prev];
			const last = copy[copy.length - 1];
			if (last?.streaming) {
				copy[copy.length - 1] = { ...last, content: payload.fullText, streaming: false };
			}
			return copy;
		});
	});

	useEventBus("audio:tts-start", () => setStatus("speaking"));
	useEventBus("audio:tts-end", () => setStatus("idle"));

	useEventBus("audio:asr-result", (payload) => {
		setMessages((prev) => [
			...prev,
			{ role: "user", content: payload.text, timestamp: Date.now() },
		]);
	});

	const handleSend = async () => {
		const text = inputText.trim();
		if (!text || status !== "idle") return;

		setInputText("");
		setMessages((prev) => [
			...prev,
			{ role: "user", content: text, timestamp: Date.now() },
		]);

		try {
			const { pipeline } = getServices();
			await pipeline.run(text);
		} catch (err) {
			log.error("pipeline error", err);
		}
	};

	const handleKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === "Enter" && !e.shiftKey) {
			e.preventDefault();
			handleSend();
		}
	};

	return (
		<Box sx={{ display: "flex", flexDirection: "column", height: "100%", p: 1.5 }}>
			<Typography variant="subtitle2" sx={{ color: "primary.main", fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, mb: 1 }}>
				对话
			</Typography>

			{/* 消息列表 */}
			<Box sx={{ flex: 1, overflowY: "auto", minHeight: 0, display: "flex", flexDirection: "column", gap: 0.75 }}>
				{messages.length === 0 ? (
					<Typography variant="body2" color="text.disabled" sx={{ textAlign: "center", py: 3 }}>
						输入文本开始对话
					</Typography>
				) : (
					messages.map((msg, i) => (
						<Paper
							key={i}
							elevation={0}
							sx={{
								p: 1, borderRadius: 1,
								bgcolor: msg.role === "user" ? "background.paper" : "#1a2744",
								display: "flex", gap: 1,
							}}
						>
							<Typography variant="caption" sx={{ color: "primary.main", fontWeight: 600, minWidth: 32 }}>
								{msg.role === "user" ? "用户" : "AI"}
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
					{status === "thinking" && "AI 正在思考..."}
					{status === "speaking" && "正在播放语音..."}
				</Typography>
			)}

			{/* 输入区 */}
			<Box sx={{ display: "flex", gap: 0.75, pt: 1, borderTop: "1px solid", borderColor: "secondary.main", mt: 1 }}>
				<TextField
					size="small"
					fullWidth
					placeholder={status === "idle" ? "输入消息，按 Enter 发送..." : "等待回复中..."}
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
