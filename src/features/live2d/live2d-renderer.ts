import { createLogger } from "@/services/logger";

const log = createLogger("live2d-renderer");

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyModel = any;

const LIP_SYNC_CONFIG = {
	smoothing: 0.3,
	volumeThreshold: 0.01,
	amplification: 3.0,
	mouthParam: "ParamMouthOpenY",
};

export interface Live2DRendererOptions {
	canvas: HTMLCanvasElement;
	width: number;
	height: number;
	modelPath: string;
	scale?: number;
	autoFit?: boolean;
}

export interface ModelInfo {
	/** 模型显示名 */
	name: string;
	/** model3.json 的路径（相对于 public） */
	path: string;
}

/**
 * Live2D 渲染核心——不依赖 React，可被多个窗口独立实例化。
 *
 * 控制语义：
 * - Expression：通过 model.expression(name) 驱动，使用模型自带 .exp3.json
 * - Motion：通过 model.motion(group, index) 驱动
 * - 口型：通过 beforeModelUpdate 钩子用 setParameterValueById 写入 ParamMouthOpenY
 *
 * DPI：canvas backing store 按 devicePixelRatio 缩放，CSS 保持逻辑尺寸
 */
export class Live2DRenderer {
	private app: import("pixi.js").Application | null = null;
	private model: AnyModel = null;
	private destroyed = false;
	private autoFit = false;
	private dpr = 1;

	// 口型平滑
	private mouthTarget = 0;
	private mouthCurrent = 0;
	private lipSyncHandler: (() => void) | null = null;

	async init(options: Live2DRendererOptions): Promise<void> {
		if (this.destroyed) return;

		this.autoFit = options.autoFit ?? false;
		this.dpr = Math.max(1, window.devicePixelRatio || 1);

		const PIXI = await import("pixi.js");
		const { Live2DModel } = await import("pixi-live2d-display/cubism4");

		if (this.destroyed) return;

		const reg = (Live2DModel as unknown as Record<string, (...args: unknown[]) => void>).registerTicker;
		if (reg) reg(PIXI.Ticker);

		// DPI: 用 resolution + autoDensity 让 PIXI 自动处理物理/逻辑像素
		options.canvas.style.width = `${options.width}px`;
		options.canvas.style.height = `${options.height}px`;

		this.app = new PIXI.Application({
			view: options.canvas,
			width: options.width,
			height: options.height,
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

		this.setupLipSyncHandler();

		log.info(`model loaded (DPR=${this.dpr})`);
	}

	/**
	 * 返回模型自带的表情列表（从 model3.json 的 Expressions 中读取）
	 */
	getExpressionNames(): string[] {
		if (!this.model) return [];
		try {
			const settings = this.model.internalModel?.settings;
			if (!settings) return [];
			// Cubism4ModelSettings.expressions 是 { Name, File }[] 或 undefined
			const expDefs: Array<{ Name?: string; File?: string }> | undefined = settings.expressions;
			if (!expDefs) return [];
			return expDefs.map((e: { Name?: string; File?: string }) => e.Name || "").filter(Boolean);
		} catch {
			return [];
		}
	}

	/**
	 * 返回模型自带的 motion 组名列表
	 */
	getMotionGroups(): string[] {
		if (!this.model) return [];
		try {
			const settings = this.model.internalModel?.settings;
			if (!settings?.motions) return [];
			return Object.keys(settings.motions);
		} catch {
			return [];
		}
	}

	/**
	 * 切换表情——使用 pixi-live2d-display 内建 API
	 */
	async setExpression(name: string): Promise<boolean> {
		if (!this.model) return false;
		try {
			const ok = await this.model.expression(name);
			log.info(`expression → ${name} (${ok ? "ok" : "fail"})`);
			return ok;
		} catch (err) {
			// 部分模型 name 不含后缀，尝试加后缀
			if (!name.endsWith(".exp3.json")) {
				try {
					const ok = await this.model.expression(`${name}.exp3.json`);
					log.info(`expression → ${name}.exp3.json (${ok ? "ok" : "fail"})`);
					return ok;
				} catch { /* */ }
			}
			log.warn(`expression fail: ${name}`, err);
			return false;
		}
	}

	/**
	 * 重置表情为默认（无表情覆盖）
	 */
	resetExpression() {
		if (!this.model) return;
		try {
			const exprMgr = this.model.internalModel?.motionManager?.expressionManager;
			if (exprMgr) {
				exprMgr.resetExpression();
				log.info("expression reset");
			}
		} catch { /* */ }
	}

	/**
	 * 设置口型目标值（0-1），由 beforeModelUpdate 钩子平滑应用
	 */
	setMouthOpenY(value: number) {
		this.mouthTarget = Math.max(0, Math.min(1, value));
	}

	resize(width: number, height: number) {
		if (!this.app || !this.model) return;
		this.dpr = Math.max(1, window.devicePixelRatio || 1);
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
			log.info(`motion → ${group}[${index}]`);
		} catch { /* */ }
	}

	destroy() {
		this.destroyed = true;
		if (this.lipSyncHandler && this.model) {
			try {
				this.model.internalModel?.off("beforeModelUpdate", this.lipSyncHandler);
			} catch { /* */ }
		}
		this.lipSyncHandler = null;
		this.model = null;
		if (this.app) {
			try { this.app.destroy(true); } catch { /* */ }
			this.app = null;
		}
	}

	/**
	 * 在 beforeModelUpdate 事件中写入口型参数。
	 * 这个时机在 motion 系统处理之前，通过 setParameterValueById 写入参数，
	 * 配合模型配置中的 LipSync 组保证口型优先级。
	 */
	private setupLipSyncHandler() {
		if (!this.model) return;

		const handler = () => {
			if (!this.model) return;

			// 平滑插值
			this.mouthCurrent += (this.mouthTarget - this.mouthCurrent) * LIP_SYNC_CONFIG.smoothing;

			// 阈值以下归零
			if (this.mouthCurrent < LIP_SYNC_CONFIG.volumeThreshold) {
				this.mouthCurrent = 0;
			}

			try {
				const coreModel = this.model.internalModel?.coreModel;
				if (coreModel?.setParameterValueById) {
					coreModel.setParameterValueById(LIP_SYNC_CONFIG.mouthParam, this.mouthCurrent, 1.0);
				}
			} catch { /* */ }
		};

		this.lipSyncHandler = handler;
		this.model.internalModel.on("beforeModelUpdate", handler);
	}

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
}
