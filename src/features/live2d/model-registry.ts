import type { ModelInfo } from "./live2d-renderer";

/**
 * 可用模型注册表。
 * path 相对于 public 目录，Vite 会将其作为静态资源服务。
 */
export const MODEL_REGISTRY: ModelInfo[] = [
	{
		name: "paimengVts",
		path: "/Resources/Commercial_models/paimengVts/3paimeng Vts.model3.json",
		forcedParameters: [
			{ id: "Param19", value: -1 },
		],
		expressionNames: [
			"按键1",
			"按键2",
			"按键3",
			"表情1",
			"表情2",
			"表情3",
			"表情4",
			"表情5",
			"表情6",
			"表情7",
			"表情8",
			"表情9",
			"鼠标L",
			"鼠标R",
		],
	},
];

export const DEFAULT_MODEL = MODEL_REGISTRY[0]; // paimengVts
