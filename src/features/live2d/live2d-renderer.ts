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

export type EyeMode = "fixed" | "follow-mouse" | "random-path";

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
	private canvasW = 0;
	private canvasH = 0;

	// 用户缩放倍率（叠加在 autoFit 计算的 baseScale 之上）
	private userZoom = 1;
	private baseScale = 1;

	// 口型平滑
	private mouthTarget = 0;
	private mouthCurrent = 0;
	private lipSyncHandler: (() => void) | null = null;

	// 眼神模式——默认 fixed，由外部通过 setEyeMode() 激活
	private eyeMode: EyeMode = "fixed";
	private randomEyeRafId = 0;
	private randomEyeStartTime = 0;

	async init(options: Live2DRendererOptions): Promise<void> {
		this.destroyed = false;

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

		// autoInteract: false 禁用库内部的自动鼠标跟随，由我们自己控制眼神
		const model = await Live2DModel.from(options.modelPath, { autoInteract: false });
		if (this.destroyed) {
			model.destroy();
			return;
		}

		this.app.stage.addChild(model as unknown as import("pixi.js").DisplayObject);
		this.model = model;
		this.canvasW = options.width;
		this.canvasH = options.height;
		this.userZoom = 1;

		if (this.autoFit) {
			this.fitModel(options.width, options.height);
		} else {
			const scale = options.scale ?? 0.15;
			this.baseScale = scale;
			model.scale.set(scale);
			model.anchor.set(0.5, 0.5);
			model.x = options.width / 2;
			model.y = options.height * 0.6;
		}

		this.setupLipSyncHandler();

		log.info(`model loaded (DPR=${this.dpr})`);
	}

	/**
	 * 在已有 app 的情况下切换模型，复用 PIXI.Application 避免 WebGL context 泄漏。
	 */
	async switchModel(modelPath: string): Promise<void> {
		if (!this.app || this.destroyed) return;

		// 清理旧模型
		this.stopRandomEye();
		if (this.lipSyncHandler && this.model) {
			try { this.model.internalModel?.off("beforeModelUpdate", this.lipSyncHandler); } catch { /* */ }
		}
		this.lipSyncHandler = null;
		if (this.model) {
			try {
				this.app.stage.removeChild(this.model);
				this.model.destroy();
			} catch { /* */ }
			this.model = null;
		}

		const { Live2DModel } = await import("pixi-live2d-display/cubism4");
		const model = await Live2DModel.from(modelPath, { autoInteract: false });
		if (this.destroyed || !this.app) {
			model.destroy();
			return;
		}

		this.app.stage.addChild(model as unknown as import("pixi.js").DisplayObject);
		this.model = model;
		this.userZoom = 1;

		if (this.autoFit) {
			this.fitModel(this.canvasW, this.canvasH);
		} else {
			model.scale.set(this.baseScale);
			model.anchor.set(0.5, 0.5);
			model.x = this.canvasW / 2;
			model.y = this.canvasH * 0.6;
		}

		this.setupLipSyncHandler();
		log.info(`model switched (DPR=${this.dpr})`);
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

	// ── 缩放控制 ──

	/**
	 * 应用滚轮缩放增量。delta > 0 放大，delta < 0 缩小。
	 */
	applyZoomDelta(delta: number) {
		if (!this.model) return;
		const step = delta > 0 ? 1.08 : 1 / 1.08;
		this.userZoom = Math.max(0.2, Math.min(5, this.userZoom * step));
		this.model.scale.set(this.baseScale * this.userZoom);
	}

	setZoom(zoom: number) {
		if (!this.model) return;
		this.userZoom = Math.max(0.2, Math.min(5, zoom));
		this.model.scale.set(this.baseScale * this.userZoom);
	}

	resetZoom() {
		this.setZoom(1);
	}

	getZoom(): number {
		return this.userZoom;
	}

	// ── 眼神模式 ──

	setEyeMode(mode: EyeMode) {
		this.stopRandomEye();
		this.eyeMode = mode;
		this.applyEyeMode();
	}

	getEyeMode(): EyeMode {
		return this.eyeMode;
	}

	/**
	 * 外部传入鼠标屏幕像素坐标，仅在 follow-mouse 模式下生效。
	 * pixi-live2d-display 的 model.focus() 接受屏幕像素坐标，内部自行转换。
	 */
	focusMouse(screenX: number, screenY: number) {
		if (this.eyeMode !== "follow-mouse" || !this.model) return;
		this.model.focus(screenX, screenY);
	}

	resize(width: number, height: number) {
		if (!this.app || !this.model) return;
		this.dpr = Math.max(1, window.devicePixelRatio || 1);
		this.canvasW = width;
		this.canvasH = height;
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
		this.stopRandomEye();
		if (this.lipSyncHandler && this.model) {
			try {
				this.model.internalModel?.off("beforeModelUpdate", this.lipSyncHandler);
			} catch { /* */ }
		}
		this.lipSyncHandler = null;
		if (this.model) {
			try { this.model.destroy(); } catch { /* */ }
			this.model = null;
		}
		if (this.app) {
			try { this.app.destroy(false, { children: true, texture: true, baseTexture: true }); } catch { /* */ }
			this.app = null;
		}
	}

	private applyEyeMode() {
		this.stopRandomEye();
		if (!this.model) return;

		switch (this.eyeMode) {
			case "fixed":
				// 看向 canvas 中心——即"面向摄像头"的默认位置
				this.model.focus(this.canvasW / 2, this.canvasH / 2, true);
				break;
			case "follow-mouse":
				break;
			case "random-path":
				this.startRandomEye();
				break;
		}
	}

	private startRandomEye() {
		this.randomEyeStartTime = performance.now();
		const tick = () => {
			if (this.destroyed || !this.model || this.eyeMode !== "random-path") return;
			const t = (performance.now() - this.randomEyeStartTime) / 1000;
			// 多频率正弦叠加，[-1, 1] 范围内产生自然注视偏移
			const nx = Math.sin(t * 0.3) * 0.4 + Math.sin(t * 0.7 + 1.2) * 0.25 + Math.sin(t * 1.3 + 3.7) * 0.1;
			const ny = Math.sin(t * 0.2 + 0.5) * 0.3 + Math.sin(t * 0.5 + 2.1) * 0.2 + Math.sin(t * 1.1 + 4.3) * 0.08;
			// 转换为像素坐标：中心 + 偏移 * 半宽/半高
			const cx = this.canvasW / 2;
			const cy = this.canvasH / 2;
			this.model.focus(cx + nx * cx, cy + ny * cy);
			this.randomEyeRafId = requestAnimationFrame(tick);
		};
		this.randomEyeRafId = requestAnimationFrame(tick);
	}

	private stopRandomEye() {
		if (this.randomEyeRafId) {
			cancelAnimationFrame(this.randomEyeRafId);
			this.randomEyeRafId = 0;
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
			this.baseScale = 0.15;
			this.model.scale.set(this.baseScale * this.userZoom);
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
		this.baseScale = Math.min(scaleX, scaleY);

		this.model.scale.set(this.baseScale * this.userZoom);
		this.model.anchor.set(0.5, 0.5);
		this.model.x = canvasW / 2;
		this.model.y = canvasH * 0.52;
	}
}
