import type { ILLMService, ChatMessage } from "@/services/llm/types";

/**
 * Consume an ILLMService.chat() AsyncGenerator and return the full text.
 * Properly handles delta/done chunks instead of treating the generator as a string.
 */
export async function consumeLLMStream(
	provider: ILLMService,
	messages: ChatMessage[],
): Promise<string> {
	let fullText = "";
	for await (const chunk of provider.chat(messages)) {
		switch (chunk.type) {
			case "delta":
				fullText += chunk.text;
				break;
			case "done":
				return chunk.fullText || fullText;
		}
	}
	return fullText.trim();
}
