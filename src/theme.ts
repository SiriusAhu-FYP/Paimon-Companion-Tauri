import { createTheme } from "@mui/material/styles";

const theme = createTheme({
	palette: {
		mode: "dark",
		primary: { main: "#e94560" },
		secondary: { main: "#0f3460" },
		background: {
			default: "#1a1a2e",
			paper: "#16213e",
		},
		text: {
			primary: "#e0e0e0",
			secondary: "#999",
		},
		success: { main: "#4caf50" },
		error: { main: "#e94560" },
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

export default theme;
