export interface HostWindowInfo {
	handle: string;
	title: string;
	className: string;
	processId: number;
	visible: boolean;
	minimized: boolean;
}

export interface HostWindowCapture {
	handle: string;
	width: number;
	height: number;
	pngBase64: string;
}

export type HostMouseButton = "left" | "right" | "middle";
export type HostMouseAction = "move" | "down" | "up" | "click";
