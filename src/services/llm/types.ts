export interface ChatToolCall {
	id: string;
	name: string;
	arguments: string;
}

export type ChatMessage =
	| {
		role: "system" | "user";
		content: string;
	}
	| {
		role: "assistant";
		content: string;
		toolCalls?: ChatToolCall[];
	}
	| {
		role: "tool";
		content: string;
		toolCallId: string;
	};

export interface ToolDef {
	name: string;
	description: string;
	parameters: Record<string, unknown>;
}

export type LLMChunk =
	| { type: "delta"; text: string }
	| {
		type: "tool-call";
		id: string;
		name: string;
		args: Record<string, unknown>;
		rawArguments: string;
	}
	| { type: "done"; fullText: string };

export interface ILLMService {
	chat(messages: ChatMessage[], tools?: ToolDef[]): AsyncGenerator<LLMChunk>;
}
