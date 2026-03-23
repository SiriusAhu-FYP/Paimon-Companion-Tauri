import { useRef, useEffect, useCallback } from "react";
import { Box, Typography } from "@mui/material";
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
 */
export function StageSlot({ visible, mode, displayMode, onRectChange }: StageSlotProps) {
	const slotRef = useRef<HTMLDivElement>(null);

	const reportRect = useCallback(() => {
		if (slotRef.current && onRectChange) {
			onRectChange(slotRef.current.getBoundingClientRect());
		}
	}, [onRectChange]);

	useEffect(() => {
		reportRect();
		window.addEventListener("resize", reportRect);
		return () => window.removeEventListener("resize", reportRect);
	}, [reportRect]);

	const isDocked = mode === "docked";
	const isActive = isDocked && visible;
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
				border: isActive && !isClean ? "1px solid" : "1px dashed",
				borderColor: isActive && !isClean ? "primary.main" : "secondary.main",
				borderRadius: 0,
				transition: "border-color 0.2s, background 0.2s",
				...(isActive && !isClean && {
					bgcolor: "rgba(233, 69, 96, 0.03)",
				}),
			}}
		>
			{isDocked && visible ? (
				<Typography variant="caption" sx={{ color: "text.disabled", userSelect: "none" }}>
					Stage 覆盖此区域
				</Typography>
			) : isDocked && !visible ? (
				<Typography variant="caption" sx={{ color: "text.disabled", userSelect: "none" }}>
					启动 Stage 显示模型
				</Typography>
			) : (
				<Typography variant="caption" sx={{ color: "text.disabled", userSelect: "none" }}>
					浮动模式 — 独立窗口
				</Typography>
			)}
		</Box>
	);
}
