import type { ModelInfo } from "./live2d-renderer";

/**
 * 可用模型注册表。
 * path 相对于 public 目录，Vite 会将其作为静态资源服务。
 */
export const MODEL_REGISTRY: ModelInfo[] = [
	{
		name: "英伦兔兔",
		path: "/Resources/Commercial_models/英伦兔兔/英伦兔兔.model3.json",
	},
];

export const DEFAULT_MODEL = MODEL_REGISTRY[0]; // 英伦兔兔
