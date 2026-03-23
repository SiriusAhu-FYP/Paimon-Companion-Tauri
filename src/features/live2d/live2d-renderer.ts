import { createLogger } from "@/services/logger";

const log = createLogger("live2d-renderer");

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyModel = any;

// 情绪 → Cubism 参数覆盖映射（Hiyori 模型无 Expressions 文件，用参数直接驱动）
const EMOTION_PARAMS: Record<string, Record<string, number>> = {
	neutral: {},
	happy: {
		ParamMouthForm: 1,
		ParamEyeLSmile: 1,
		ParamEyeRSmile: 1,
	},
	sad: {
		ParamEyeLOpen: 0.35,
		ParamEyeROpen: 0.35,
		ParamMouthForm: -0.6,
		ParamBrowLY: -0.6,
		ParamBrowRY: -0.6,
	},
	angry: {
		ParamBrowLY: -1,
		ParamBrowRY: -1,
		ParamEyeLOpen: 0.6,
		ParamEyeROpen: 0.6,
		ParamMouthForm: -0.4,
		ParamAngleZ: -5,
	},
	surprised: {
		ParamEyeLOpen: 1.3,
		ParamEyeROpen: 1.3,
		ParamMouthOpenY: 0.6,
		ParamBrowLY: 0.8,
		ParamBrowRY: 0.8,
	},
};

export interface Live2DRendererOptions {
	canvas: HTMLCanvasElement;
	width: number;
	height: number;
	modelPath: string;
	/** 模型初始缩放（若不指定，会自动 fit） */
	scale?: number;
	/** 自动 fit：根据窗口大小计算缩放，使模型完整显示 */
	autoFit?: boolean;
}

/**
 * Live2D 渲染核心——不依赖 React，可被多个窗口独立实例化。
 * 管理 PIXI Application + Live2D 模型的生命周期、表情参数覆盖和口型驱动。
 */
export class Live2DRenderer {
	private app: import("pixi.js").Application | null = null;
	private model: AnyModel = null;
	private currentEmotion = "neutral";
	private mouthOpenY = 0;
	private destroyed = false;
	private autoFit = false;

	async init(options: Live2DRendererOptions): Promise<void> {
		if (this.destroyed) return;

		this.autoFit = options.autoFit ?? false;

		const PIXI = await import("pixi.js");
		const { Live2DModel } = await import("pixi-live2d-display/cubism4");

		if (this.destroyed) return;

		const reg = (Live2DModel as unknown as Record<string, (...args: unknown[]) => void>).registerTicker;
		if (reg) reg(PIXI.Ticker);

		this.app = new PIXI.Application({
			view: options.canvas,
			width: options.width,
			height: options.height,
			backgroundAlpha: 0,
			autoStart: true,
		});

		const model = await Live2DModel.from(options.modelPath);
		if (this.destroyed) {
			model.destroy();
			return;
		}

		this.app.stage.addChild(model as unknown as import("pixi.js").DisplayObject);
		this.model = model;

		if (this.autoFit) {
			this.fitModel(options.width, options.height);
		} else {
			const scale = options.scale ?? 0.15;
			model.scale.set(scale);
			model.anchor.set(0.5, 0.5);
			model.x = options.width / 2;
			model.y = options.height * 0.6;
		}

		// 每帧施加情绪参数覆盖 + 口型覆盖
		this.app.ticker.add(() => {
			if (!this.model) return;
			if (this.currentEmotion !== "neutral") {
				this.applyEmotionParams(this.currentEmotion);
			}
			if (this.mouthOpenY > 0.01) {
				this.applyParam("ParamMouthOpenY", this.mouthOpenY);
			}
		});

		log.info("model loaded");
	}

	getCurrentEmotion(): string {
		return this.currentEmotion;
	}

	setEmotion(emotion: string) {
		if (emotion === this.currentEmotion) return;
		this.currentEmotion = emotion;
		if (!this.model) return;

		try {
			if (emotion === "happy" || emotion === "surprised") {
				this.model.motion("TapBody", 0);
			} else if (emotion !== "neutral") {
				this.model.motion("Idle", Math.floor(Math.random() * 9));
			}
		} catch { /* motion 播放失败不阻塞 */ }

		log.info(`expression: ${emotion}`);
	}

	setMouthOpenY(value: number) {
		this.mouthOpenY = Math.max(0, Math.min(1, value));
	}

	/** 调整渲染器尺寸，autoFit 模式下会重新计算模型缩放和位置 */
	resize(width: number, height: number) {
		if (!this.app || !this.model) return;
		this.app.renderer.resize(width, height);

		if (this.autoFit) {
			this.fitModel(width, height);
		} else {
			this.model.x = width / 2;
			this.model.y = height * 0.6;
		}
	}

	playMotion(group: string, index: number) {
		if (!this.model) return;
		try {
			this.model.motion(group, index);
		} catch { /* */ }
	}

	destroy() {
		this.destroyed = true;
		this.model = null;
		if (this.app) {
			try { this.app.destroy(true); } catch { /* */ }
			this.app = null;
		}
	}

	/**
	 * 根据画布尺寸自动计算模型缩放和位置，确保模型完整可见。
	 * Hiyori 模型原始尺寸约 2400×4500 像素（cubism 坐标），
	 * 采用 contain 策略，给顶部/底部留出一定 padding。
	 */
	private fitModel(canvasW: number, canvasH: number) {
		if (!this.model) return;

		// 模型原始绘制尺寸（pixi-live2d-display 的 width/height 属性）
		const modelW = this.model.width / (this.model.scale?.x || 1);
		const modelH = this.model.height / (this.model.scale?.y || 1);

		if (modelW <= 0 || modelH <= 0) {
			// fallback：无法获取模型真实尺寸时用默认缩放
			this.model.scale.set(0.15);
			this.model.anchor.set(0.5, 0.5);
			this.model.x = canvasW / 2;
			this.model.y = canvasH * 0.6;
			return;
		}

		const padding = 0.05;
		const availableW = canvasW * (1 - padding * 2);
		const availableH = canvasH * (1 - padding * 2);

		const scaleX = availableW / modelW;
		const scaleY = availableH / modelH;
		const scale = Math.min(scaleX, scaleY);

		this.model.scale.set(scale);
		this.model.anchor.set(0.5, 0.5);
		this.model.x = canvasW / 2;
		// 垂直居中偏下一点（人物重心通常偏上）
		this.model.y = canvasH * 0.52;
	}

	private applyEmotionParams(emotion: string) {
		const overrides = EMOTION_PARAMS[emotion] ?? {};
		try {
			const coreModel = this.model?.internalModel?.coreModel;
			if (!coreModel) return;
			const rawModel = coreModel._model;
			if (!rawModel?.parameters) return;
			const { ids, values, count } = rawModel.parameters;
			for (let i = 0; i < count; i++) {
				if (ids[i] in overrides) {
					values[i] = overrides[ids[i]];
				}
			}
		} catch { /* */ }
	}

	private applyParam(paramId: string, value: number) {
		try {
			const coreModel = this.model?.internalModel?.coreModel;
			if (!coreModel) return;
			const rawModel = coreModel._model;
			if (!rawModel?.parameters) return;
			const { ids, values, count } = rawModel.parameters;
			for (let i = 0; i < count; i++) {
				if (ids[i] === paramId) {
					values[i] = value;
					break;
				}
			}
		} catch { /* */ }
	}
}
