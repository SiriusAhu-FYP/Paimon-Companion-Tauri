import { createTheme } from "@mui/material/styles";
import type { PaletteMode } from "@mui/material";

// ── 调色板 ────────────────────────────────────────────────────────
const palette = {
	dark: {
		primary: "#4D9FFF",
		secondary: "#2D3748",
		bgDefault: "#0F1117",
		bgPaper: "#1C1F27",
		textPrimary: "#E8EAF0",
		textSecondary: "#9A9BB0",
		success: "#3ECF8E",
		error: "#F87171",
		divider: "rgba(255,255,255,0.08)",
	},
	light: {
		primary: "#2563EB",
		secondary: "#E2E8F0",
		bgDefault: "#F3F5F8",
		bgPaper: "#FFFFFF",
		textPrimary: "#1F2937",
		textSecondary: "#475569",
		success: "#2E7D32",
		error: "#BE123C",
		divider: "rgba(71,85,105,0.22)",
	},
} as const;

export function createAppTheme(mode: PaletteMode) {
	const p = palette[mode];
	return createTheme({
		palette: {
			mode,
			primary: { main: p.primary },
			secondary: { main: p.secondary },
			background: { default: p.bgDefault, paper: p.bgPaper },
			text: { primary: p.textPrimary, secondary: p.textSecondary },
			success: { main: p.success },
			error: { main: p.error },
			divider: p.divider,
		},
		typography: {
			fontFamily: "Inter, Avenir, Helvetica, Arial, sans-serif",
			fontSize: 13,
		},
		shape: { borderRadius: 6 },
		components: {
			MuiCssBaseline: {
				styleOverrides: {
					body: {
						backgroundColor: p.bgDefault,
						color: p.textPrimary,
					},
				},
			},
			MuiButton: {
				defaultProps: { size: "small", disableElevation: true },
				styleOverrides: {
					root: { textTransform: "none", fontSize: 12 },
				},
			},
			MuiIconButton: {
				defaultProps: { size: "small" },
			},
			MuiTooltip: {
				defaultProps: { arrow: true, enterDelay: 400 },
				styleOverrides: {
					tooltip: { fontSize: 12 },
				},
			},
			MuiPaper: {
				styleOverrides: {
					root: { backgroundImage: "none" },
				},
			},
			MuiSelect: {
				styleOverrides: {
					root: {
						fontSize: 13,
					},
				},
			},
			MuiOutlinedInput: {
				styleOverrides: {
					root: {
						fontSize: 13,
					},
				},
			},
		},
	});
}
