import { useRef, useEffect, useCallback } from "react";
import { Box } from "@mui/material";
import type { StageDisplayMode } from "@/utils/window-sync";

interface StageSlotProps {
	visible: boolean;
	mode: "docked" | "floating";
	displayMode: StageDisplayMode;
	onRectChange?: (rect: DOMRect) => void;
}

/**
 * 模型贴靠区域——Stage 窗口 docked 时覆盖此区域。
 * 自身不渲染 Live2D，仅作为定位目标和视觉占位。
 * 使用 ResizeObserver 精确追踪尺寸变化（包括兄弟元素变化导致的 flex 重排）。
 */
export function StageSlot({ visible, mode, displayMode, onRectChange }: StageSlotProps) {
	const slotRef = useRef<HTMLDivElement>(null);

	const reportRect = useCallback(() => {
		if (slotRef.current && onRectChange) {
			onRectChange(slotRef.current.getBoundingClientRect());
		}
	}, [onRectChange]);

	useEffect(() => {
		const el = slotRef.current;
		if (!el) return;

		reportRect();

		const ro = new ResizeObserver(() => {
			reportRect();
		});
		ro.observe(el);

		// 窗口 resize 也需要重新计算（位置可能变化但尺寸不变）
		window.addEventListener("resize", reportRect);

		return () => {
			ro.disconnect();
			window.removeEventListener("resize", reportRect);
		};
	}, [reportRect]);

	const isDocked = mode === "docked";
	const isClean = displayMode === "clean";

	return (
		<Box
			ref={slotRef}
			sx={{
				height: "100%",
				display: "flex",
				alignItems: "center",
				justifyContent: "center",
				bgcolor: "#0d1b2a",
				border: isDocked && visible && isClean ? "none" : isDocked && visible ? "1px solid" : "1px dashed",
				borderColor: isDocked && visible ? "primary.main" : "secondary.main",
				borderRadius: 0,
				transition: "border-color 0.2s, background 0.2s",
			}}
		/>
	);
}
