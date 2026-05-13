export interface HostWindowInfo {
	handle: string;
	title: string;
	className: string;
	processId: number;
	processName: string;
	visible: boolean;
	minimized: boolean;
}

export interface HostWindowCapture {
	handle: string;
	width: number;
	height: number;
	pngBase64: string;
	captureMethod: string;
	qualityScore: number;
}

export interface HostFocusOptions {
	applyDelegatedViewport?: boolean;
}

export type HostMouseButton = "left" | "right" | "middle";
export type HostMouseAction = "move" | "down" | "up" | "click";
