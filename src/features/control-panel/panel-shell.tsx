import { Box, Chip, Stack, Typography, type ChipProps } from "@mui/material";
import type { ReactNode } from "react";

export function PanelRoot(props: {
	title: string;
	children: ReactNode;
}) {
	return (
		<Box sx={{ p: 1.5, display: "flex", flexDirection: "column", gap: 1 }}>
			<Typography
				variant="subtitle2"
				sx={{ color: "primary.main", fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5 }}
			>
				{props.title}
			</Typography>
			{props.children}
		</Box>
	);
}

export function PanelCard(props: {
	children: ReactNode;
	compact?: boolean;
}) {
	return (
		<Box
			sx={{
				bgcolor: "background.paper",
				borderRadius: 1,
				border: "1px solid",
				borderColor: "divider",
				p: props.compact ? 0.75 : 1,
			}}
		>
			{props.children}
		</Box>
	);
}

export function SectionHeader(props: {
	title: string;
	right?: ReactNode;
	subtitle?: string;
}) {
	return (
		<Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: props.subtitle ? 0.25 : 0.5 }}>
			<Box>
				<Typography variant="caption" color="text.secondary" fontWeight={700}>
					{props.title}
				</Typography>
				{props.subtitle ? (
					<Typography variant="caption" color="text.secondary" sx={{ display: "block", fontSize: 10 }}>
						{props.subtitle}
					</Typography>
				) : null}
			</Box>
			{props.right}
		</Stack>
	);
}

export function SectionStatusChip(props: {
	label: string;
	color?: ChipProps["color"];
	variant?: ChipProps["variant"];
}) {
	return (
		<Chip
			label={props.label}
			size="small"
			color={props.color ?? "default"}
			variant={props.variant ?? "filled"}
			sx={{ height: 18, fontSize: 10 }}
		/>
	);
}

export function InfoLine(props: {
	children: ReactNode;
	mb?: number;
}) {
	return (
		<Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: props.mb ?? 0, fontSize: 10 }}>
			{props.children}
		</Typography>
	);
}
