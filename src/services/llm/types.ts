export interface ChatMessage {
	role: "system" | "user" | "assistant" | "tool";
	content: string;
}

export interface ToolDef {
	name: string;
	description: string;
	parameters: Record<string, unknown>;
}

export type LLMChunk =
	| { type: "delta"; text: string }
	| { type: "tool-call"; name: string; args: Record<string, unknown> }
	| { type: "done"; fullText: string };

export interface ILLMService {
	chat(messages: ChatMessage[], tools?: ToolDef[]): AsyncGenerator<LLMChunk>;
}
