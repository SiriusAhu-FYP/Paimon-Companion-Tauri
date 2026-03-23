import { useState, useRef, useEffect } from "react";
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

	// 滚动到最新消息
	useEffect(() => {
		messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
	}, [messages]);

	// 流式 chunk → 逐字追加到当前 AI 回复
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

	// 也监听旧的 asr-result，用于 mock pipeline 或未来 ASR 接入
	useEventBus("audio:asr-result", (payload) => {
		setMessages((prev) => [
			...prev,
			{ role: "user", content: payload.text, timestamp: Date.now() },
		]);
	});

	const handleSend = async () => {
		const text = inputText.trim();
		if (!text) return;
		if (status !== "idle") return;

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
		<section className="chat-panel">
			<h2>对话</h2>
			<div className="chat-messages">
				{messages.length === 0 ? (
					<p className="chat-empty">输入文本开始对话</p>
				) : (
					messages.map((msg, i) => (
						<div key={i} className={`chat-message chat-${msg.role}`}>
							<span className="chat-role">
								{msg.role === "user" ? "用户" : "AI"}
							</span>
							<span className="chat-content">
								{msg.content}
								{msg.streaming && <span className="chat-cursor">▌</span>}
							</span>
						</div>
					))
				)}
				<div ref={messagesEndRef} />
			</div>

			{status !== "idle" && (
				<div className="chat-status">
					{status === "thinking" && "AI 正在思考..."}
					{status === "speaking" && "正在播放语音..."}
				</div>
			)}

			<div className="chat-input-area">
				<input
					type="text"
					className="chat-input"
					placeholder={status === "idle" ? "输入消息，按 Enter 发送..." : "等待回复中..."}
					value={inputText}
					onChange={(e) => setInputText(e.target.value)}
					onKeyDown={handleKeyDown}
					disabled={status !== "idle"}
				/>
				<button
					className="chat-send-btn"
					onClick={handleSend}
					disabled={status !== "idle" || !inputText.trim()}
				>
					发送
				</button>
			</div>
		</section>
	);
}
