import type { ModelInfo } from "./live2d-renderer";

/**
 * 可用模型注册表。
 * path 相对于 public 目录，Vite 会将其作为静态资源服务。
 */
export const MODEL_REGISTRY: ModelInfo[] = [
	{
		name: "paimengVts",
		path: "/Resources/Commercial_models/paimengVts/3paimeng Vts.model3.json",
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
			"水印",
		],
	},
	{
		name: "英伦兔兔",
		path: "/Resources/Commercial_models/英伦兔兔/英伦兔兔.model3.json",
	},
	{
		name: "Hiyori",
		path: "/Resources/Hiyori/Hiyori.model3.json",
	},
	{
		name: "Haru",
		path: "/Resources/Haru/Haru.model3.json",
	},
	{
		name: "Mao",
		path: "/Resources/Mao/Mao.model3.json",
	},
	{
		name: "Mark",
		path: "/Resources/Mark/Mark.model3.json",
	},
	{
		name: "Natori",
		path: "/Resources/Natori/Natori.model3.json",
	},
	{
		name: "Rice",
		path: "/Resources/Rice/Rice.model3.json",
	},
	{
		name: "Wanko",
		path: "/Resources/Wanko/Wanko.model3.json",
	},
];

export const DEFAULT_MODEL = MODEL_REGISTRY[0]; // paimengVts
