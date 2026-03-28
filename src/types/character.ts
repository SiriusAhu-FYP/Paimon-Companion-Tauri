// 角色状态与运行时档案（与 SillyTavern 等外部格式解耦）

export type CharacterProfileSource = "sillytavern-v2" | "manual" | "custom";

/** 内部归一化角色档案，供 LLM system prompt 与 CharacterService 使用 */
export interface CharacterProfile {
	id: string;
	name: string;
	persona: string;
	scenario: string;
	firstMessage: string;
	messageExamples: string;
	systemPrompt: string;
	defaultEmotion: string;
	expressionMap: Record<string, string>;
	source: CharacterProfileSource;
	sourceFile?: string;
}

export interface CharacterState {
	characterId: string;
	emotion: string;
	isSpeaking: boolean;
	activeModel: string | null;
}
