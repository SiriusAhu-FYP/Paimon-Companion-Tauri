export { Game2048Service } from "./game-2048-service";
export {
	GAME_2048_DEFAULT_ACTION_ORDER,
	GAME_2048_PLUGIN,
	formatGame2048Action,
	getGame2048Action,
	listGame2048ActionDescriptions,
} from "./game-2048-plugin";
export type { Game2048ActionId } from "@/types";
export {
	formatSokobanAction,
	getSokobanAction,
	SOKOBAN_DEFAULT_ACTION_ORDER,
	SOKOBAN_PLUGIN,
} from "./sokoban-plugin";
export { getSemanticGameManifest, listSemanticGames } from "./semantic-game-registry";
export type { SokobanActionId } from "@/types";
export {
	defineFixedActionTaskTemplate,
	defineVisionActionTaskTemplate,
	type ActionTaskTemplate,
	type FixedActionTaskTemplate,
	type TemplateAnalysis,
	type VisionActionTaskTemplate,
} from "./task-templates";
