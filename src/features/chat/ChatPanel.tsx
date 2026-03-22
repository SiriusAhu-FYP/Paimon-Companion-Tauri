import { useState } from "react";
import { useEventBus } from "@/hooks";

interface ChatMessage {
	role: "user" | "assistant" | "system";
	content: string;
	timestamp: number;
}

export function ChatPanel() {
	const [messages, setMessages] = useState<ChatMessage[]>([]);

	useEventBus("audio:asr-result", (payload) => {
		setMessages((prev) => [
			...prev,
			{ role: "user", content: payload.text, timestamp: Date.now() },
		]);
	});

	useEventBus("llm:response-end", (payload) => {
		setMessages((prev) => [
			...prev,
			{ role: "assistant", content: payload.fullText, timestamp: Date.now() },
		]);
	});

	return (
		<section className="chat-panel">
			<h2>对话</h2>
			<div className="chat-messages">
				{messages.length === 0 ? (
					<p className="chat-empty">暂无对话记录</p>
				) : (
					messages.map((msg, i) => (
						<div key={i} className={`chat-message chat-${msg.role}`}>
							<span className="chat-role">
								{msg.role === "user" ? "用户" : "AI"}
							</span>
							<span className="chat-content">{msg.content}</span>
						</div>
					))
				)}
			</div>
		</section>
	);
}
