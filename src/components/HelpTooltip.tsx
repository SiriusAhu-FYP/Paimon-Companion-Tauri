import { Tooltip, IconButton } from "@mui/material";
import HelpOutlineIcon from "@mui/icons-material/HelpOutline";

interface HelpTooltipProps {
	title: string;
}

export function HelpTooltip({ title }: HelpTooltipProps) {
	return (
		<Tooltip title={title}>
			<IconButton size="small" sx={{ p: 0, ml: 0.5, opacity: 0.5 }}>
				<HelpOutlineIcon sx={{ fontSize: 14 }} />
			</IconButton>
		</Tooltip>
	);
}
