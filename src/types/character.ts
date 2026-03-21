// 角色状态相关类型

export interface CharacterConfig {
	id: string;
	name: string;
	persona: string;
	defaultEmotion: string;
	expressionMap: Record<string, string>;
}

export interface CharacterState {
	characterId: string;
	emotion: string;
	isSpeaking: boolean;
	activeModel: string | null;
}
