import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import { CssVarsProvider, useColorScheme } from "@mui/joy/styles";
import { ThemeProvider } from "@mui/material";
import { createAppTheme } from "@/theme";
import type { PaletteMode } from "@mui/material";

const STORAGE_KEY = "paimon-live:color-scheme";

// ── 专业调色板（蓝灰色系 — 适合桌面应用）─────────────────────────
const LIGHT_PALETTE = {
	primary: {
		50: "#EBF5FF", 100: "#D6EBFF", 200: "#ADD6FF", 300: "#85C2FF", 400: "#5CADFF",
		500: "#0B6EF5", 600: "#0A5AD4", 700: "#0846B3", 800: "#063391", 900: "#042070",
		mainChannel: "11 110 245", lightChannel: "173 214 255", darkChannel: "8 70 179",
	},
	neutral: {
		50: "#F5F7FA", 100: "#E8ECF4", 200: "#D1D9E9", 300: "#BBC5DD", 400: "#9FAFCA",
		500: "#7E8DB5", 600: "#636E9C", 700: "#4A5280", 800: "#323865", 900: "#1A1F4A",
		mainChannel: "99 107 116", lightChannel: "221 231 238", darkChannel: "50 56 62",
	},
	background: {
		body: "#FFFFFF", surface: "#F5F7FA", popup: "#FFFFFF",
		level1: "#F5F7FA", level2: "#E8ECF4", level3: "#D1D9E9",
	},
	text: {
		primary: "#1A1A1A", secondary: "#555555", tertiary: "#888888", icon: "#636E9C",
	},
};

const DARK_PALETTE = {
	primary: {
		50: "#EBF5FF", 100: "#D6EBFF", 200: "#ADD6FF", 300: "#85C2FF", 400: "#5CADFF",
		500: "#4D9FFF", 600: "#3D8FEF", 700: "#2E7FDF", 800: "#1F6FCF", 900: "#105FBF",
		mainChannel: "77 159 255", lightChannel: "173 214 255", darkChannel: "30 100 190",
	},
	neutral: {
		50: "#1C1F27", 100: "#232730", 200: "#2A303C", 300: "#343B4A", 400: "#454E60",
		500: "#5A6478", 600: "#6E7A90", 700: "#828AA6", 800: "#9DA5BA", 900: "#BEC1CC",
		mainChannel: "159 166 173", lightChannel: "221 231 238", darkChannel: "50 56 62",
	},
	background: {
		body: "#0F1117", surface: "#1C1F27", popup: "#1C1F27",
		level1: "#1C1F27", level2: "#232730", level3: "#2A303C",
	},
	text: {
		primary: "#E8EAF0", secondary: "#9A9BB0", tertiary: "#6E7A90", icon: "#9DA5BA",
	},
};

interface ColorSchemeContextValue {
	mode: PaletteMode;
	setMode: (mode: PaletteMode) => void;
}

const ColorSchemeContext = createContext<ColorSchemeContextValue>({
	mode: "dark",
	setMode: () => {},
});

export function useThemeMode() {
	return useContext(ColorSchemeContext);
}

// ── 内部：实际管理 color scheme（必须在 CssVarsProvider 内调用）──
function useColorSchemeManager() {
	const { mode: joyMode, setMode: setJoyMode } = useColorScheme();
	const [mode, setModeState] = useState<PaletteMode>(() => {
		const saved = localStorage.getItem(STORAGE_KEY);
		return (saved === "light" || saved === "dark") ? saved : "dark";
	});

	useEffect(() => {
		if (joyMode === "light" || joyMode === "dark") {
			setModeState(joyMode);
			localStorage.setItem(STORAGE_KEY, joyMode);
		}
	}, [joyMode]);

	const setMode = useCallback((newMode: PaletteMode) => {
		setModeState(newMode);
		localStorage.setItem(STORAGE_KEY, newMode);
		setJoyMode(newMode);
	}, [setJoyMode]);

	return { mode, setMode };
}

// ── 顶层组件 ──────────────────────────────────────────────────────
export function JoyThemeProvider({ children }: { children: React.ReactNode }) {
	return (
		<CssVarsProvider
			theme={{
				colorSchemes: {
					light: { palette: LIGHT_PALETTE },
					dark: { palette: DARK_PALETTE },
				},
			}}
			colorSchemeSelector="data-joy-color-scheme"
			defaultMode="dark"
		>
			<InnerThemeProvider>{children}</InnerThemeProvider>
		</CssVarsProvider>
	);
}

// ── 内部：可调用 useColorScheme 的层级 ───────────────────────────
function InnerThemeProvider({ children }: { children: React.ReactNode }) {
	const { mode, setMode } = useColorSchemeManager();

	return (
		<ColorSchemeContext.Provider value={{ mode, setMode }}>
			<ThemeProvider theme={createAppTheme(mode)}>
				{children}
			</ThemeProvider>
		</ColorSchemeContext.Provider>
	);
}
