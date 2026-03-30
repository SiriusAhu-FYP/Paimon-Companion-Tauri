import { Tooltip, IconButton, type TooltipProps } from "@mui/material";
import HelpOutlineIcon from "@mui/icons-material/HelpOutline";
import type { ReactNode } from "react";

interface HelpTooltipProps {
	title: ReactNode;
	/** 多行模式下 Tooltip 宽度更大，适合较长说明 */
	multiline?: boolean;
}

export function HelpTooltip({ title, multiline }: HelpTooltipProps) {
	const slotProps: TooltipProps["slotProps"] = multiline
		? { tooltip: { sx: { maxWidth: 320, fontSize: 11, lineHeight: 1.6, whiteSpace: "pre-line" } } }
		: undefined;

	return (
		<Tooltip title={title} slotProps={slotProps}>
			<IconButton size="small" sx={{ p: 0, ml: 0.5, opacity: 0.5 }}>
				<HelpOutlineIcon sx={{ fontSize: 14 }} />
			</IconButton>
		</Tooltip>
	);
}
