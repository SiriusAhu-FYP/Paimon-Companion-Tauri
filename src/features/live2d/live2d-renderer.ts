import { createLogger } from "@/services/logger";

const log = createLogger("live2d-renderer");

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyModel = any;

/**
 * 情绪 → Cubism 参数覆盖映射。
 * Hiyori 模型无独立 Expressions 文件，用参数直接驱动表情。
 * 这些参数在每帧渲染后写入，优先级高于 motion 系统。
 *
 * 注意：ParamMouthOpenY 不在此表中——口型由独立的高频通道 setMouthOpenY 控制，
 * 避免表情与口型争用。
 */
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
 *
 * 控制语义边界：
 * - Emotion（表情）：通过 setEmotion() 设置，每帧覆盖 Cubism 参数，不触发 motion。
 * - Motion（动作）：通过 playMotion() 独立控制，与表情互不干扰。
 * - MouthOpenY（口型）：通过 setMouthOpenY() 高频驱动，独立于表情和动作。
 *
 * DPI 适配：使用 devicePixelRatio 创建高分辨率 backing store，
 * canvas 的 CSS 尺寸保持逻辑像素，WebGL 按物理像素渲染。
 */
export class Live2DRenderer {
	private app: import("pixi.js").Application | null = null;
	private model: AnyModel = null;
	private currentEmotion = "neutral";
	private mouthOpenY = 0;
	private destroyed = false;
	private autoFit = false;
	private dpr = 1;

	async init(options: Live2DRendererOptions): Promise<void> {
		if (this.destroyed) return;

		this.autoFit = options.autoFit ?? false;
		this.dpr = Math.max(1, window.devicePixelRatio || 1);

		const physicalW = Math.round(options.width * this.dpr);
		const physicalH = Math.round(options.height * this.dpr);

		const PIXI = await import("pixi.js");
		const { Live2DModel } = await import("pixi-live2d-display/cubism4");

		if (this.destroyed) return;

		const reg = (Live2DModel as unknown as Record<string, (...args: unknown[]) => void>).registerTicker;
		if (reg) reg(PIXI.Ticker);

		// DPI: 以物理像素渲染，CSS 保持逻辑像素
		options.canvas.style.width = `${options.width}px`;
		options.canvas.style.height = `${options.height}px`;

		this.app = new PIXI.Application({
			view: options.canvas,
			width: physicalW,
			height: physicalH,
			backgroundAlpha: 0,
			autoStart: true,
			resolution: this.dpr,
			autoDensity: true,
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

		// 每帧施加情绪参数覆盖 + 口型覆盖（在 motion 系统之后写入，保证参数优先级）
		this.app.ticker.add(() => {
			if (!this.model) return;
			if (this.currentEmotion !== "neutral") {
				this.applyEmotionParams(this.currentEmotion);
			}
			// 口型始终覆盖（即使 mouthOpenY 为 0 也写入，确保复位）
			this.applyParam("ParamMouthOpenY", this.mouthOpenY);
		});

		log.info(`model loaded (DPR=${this.dpr}, physical=${physicalW}×${physicalH})`);
	}

	getCurrentEmotion(): string {
		return this.currentEmotion;
	}

	/**
	 * 设置模型情绪。仅更改每帧参数覆盖，不触发 motion。
	 * 这确保表情按钮语义清晰：点什么就显示什么。
	 */
	setEmotion(emotion: string) {
		if (emotion === this.currentEmotion) return;
		this.currentEmotion = emotion;
		log.info(`emotion → ${emotion}`);
	}

	setMouthOpenY(value: number) {
		this.mouthOpenY = Math.max(0, Math.min(1, value));
	}

	/** 调整渲染器尺寸，autoFit 模式下会重新计算模型缩放和位置 */
	resize(width: number, height: number) {
		if (!this.app || !this.model) return;

		this.dpr = Math.max(1, window.devicePixelRatio || 1);

		// PIXI renderer.resize 接受逻辑尺寸（autoDensity 会自动乘 resolution）
		this.app.renderer.resize(width, height);

		if (this.autoFit) {
			this.fitModel(width, height);
		} else {
			this.model.x = width / 2;
			this.model.y = height * 0.6;
		}
	}

	/** 独立的动作播放入口，不影响表情参数 */
	playMotion(group: string, index: number) {
		if (!this.model) return;
		try {
			this.model.motion(group, index);
			log.info(`motion → ${group}[${index}]`);
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
	 * 根据画布逻辑尺寸自动计算模型缩放和位置，确保模型完整可见。
	 * 采用 contain 策略，给顶部/底部留出一定 padding。
	 */
	private fitModel(canvasW: number, canvasH: number) {
		if (!this.model) return;

		const modelW = this.model.width / (this.model.scale?.x || 1);
		const modelH = this.model.height / (this.model.scale?.y || 1);

		if (modelW <= 0 || modelH <= 0) {
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
