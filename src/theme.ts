import { extendTheme } from "@mui/joy/styles";
import { createTheme } from "@mui/material/styles";
import type { PaletteMode } from "@mui/material";

// ── Joy UI Theme（CssVarsProvider 使用）──────────────────────────
export const joyTheme = extendTheme({
	fontFamily: {
		display: "Inter, Avenir, Helvetica, Arial, sans-serif",
		body: "Inter, Avenir, Helvetica, Arial, sans-serif",
	},

	components: {
		JoyButton: {
			styleOverrides: {
				root: { textTransform: "none" },
			},
		},
		JoyTooltip: {
			defaultProps: { arrow: true, enterDelay: 400 },
		},
	},
});

// ── MUI Theme（ThemeProvider 使用，与 Joy UI 共享同一 palette）──
export function createAppTheme(mode: PaletteMode) {
	return createTheme({
		palette: {
			mode,
			primary: {
				main: mode === "dark" ? "#4D9FFF" : "#0B6EF5",
			},
			secondary: {
				main: mode === "dark" ? "#2D3748" : "#E8ECF4",
			},
			background: {
				default: mode === "dark" ? "#0F1117" : "#F5F7FA",
				paper: mode === "dark" ? "#1C1F27" : "#FFFFFF",
			},
			text: {
				primary: mode === "dark" ? "#E8EAF0" : "#1A1A1A",
				secondary: mode === "dark" ? "#9A9BB0" : "#555555",
			},
			success: { main: mode === "dark" ? "#3ECF8E" : "#388E3C" },
			error: { main: mode === "dark" ? "#F87171" : "#C9274E" },
		},
		typography: {
			fontFamily: "Inter, Avenir, Helvetica, Arial, sans-serif",
			fontSize: 13,
		},
		shape: { borderRadius: 6 },
		components: {
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
		},
	});
}
