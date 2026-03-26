import { createLogger } from "@/services/logger";
import type { CharacterProfile } from "@/types";
import { parseSillyTavernV2ToProfile } from "./card-parser";

const log = createLogger("character-cards");

/** 与 mock 角色一致的表情映射占位，导入卡暂无 L2D 映射时使用 */
export const DEFAULT_CARD_EXPRESSION_MAP: Record<string, string> = {
	neutral: "exp_neutral",
	happy: "exp_happy",
	sad: "exp_sad",
	angry: "exp_angry",
	surprised: "exp_surprised",
};

const MANIFEST_URL = "/cards/cards-manifest.json";

/**
 * 从 public/cards 拉取 manifest 并解析全部角色卡。
 */
export async function loadCharacterProfilesFromPublic(): Promise<CharacterProfile[]> {
	let filenames: string[];
	try {
		const res = await fetch(MANIFEST_URL);
		if (!res.ok) {
			log.warn("cards manifest fetch failed", { status: res.status });
			return [];
		}
		filenames = (await res.json()) as string[];
		if (!Array.isArray(filenames)) {
			log.warn("cards manifest is not an array");
			return [];
		}
	} catch (err) {
		log.warn("cards manifest error", err);
		return [];
	}

	const profiles: CharacterProfile[] = [];

	for (const file of filenames) {
		if (!file.endsWith(".json") || file === "cards-manifest.json") continue;
		try {
			const url = `/cards/${encodeURIComponent(file)}`;
			const res = await fetch(url);
			if (!res.ok) {
				log.warn("card fetch failed", { file, status: res.status });
				continue;
			}
			const raw: unknown = await res.json();
			const profile = parseSillyTavernV2ToProfile(raw, {
				sourceFile: file,
				defaultExpressionMap: DEFAULT_CARD_EXPRESSION_MAP,
			});
			profiles.push(profile);
			log.info("parsed character card", {
				file,
				id: profile.id,
				name: profile.name,
				personaChars: profile.persona.length,
				hasScenario: !!profile.scenario,
				hasSystemPrompt: !!profile.systemPrompt,
			});
		} catch (err) {
			log.warn("card parse failed", { file, err });
		}
	}

	return profiles;
}
