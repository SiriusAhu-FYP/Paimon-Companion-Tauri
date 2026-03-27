import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import { CssVarsProvider, useColorScheme } from "@mui/joy/styles";
import { ThemeProvider } from "@mui/material";
import { createAppTheme } from "@/theme";
import type { PaletteMode } from "@mui/material";

const STORAGE_KEY = "paimon-live:color-scheme";

interface ColorSchemeContextValue {
	mode: PaletteMode;
	setMode: (mode: PaletteMode) => void;
}

const ColorSchemeContext = createContext<ColorSchemeContextValue>({
	mode: "dark",
	setMode: () => {},
});

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

export function useThemeMode() {
	return useContext(ColorSchemeContext);
}

export function JoyThemeProvider({ children }: { children: React.ReactNode }) {
	const { mode, setMode } = useColorSchemeManager();

	return (
		<ColorSchemeContext.Provider value={{ mode, setMode }}>
			<CssVarsProvider
				theme={{
					colorSchemes: {
						light: {
							palette: {
								primary: {
									main: "#0B6EF5",
								},
								background: {
									default: "#F5F7FA",
									paper: "#FFFFFF",
								},
								text: {
									primary: "#1A1A1A",
									secondary: "#555555",
								},
							},
						},
						dark: {
						palette: {
								primary: {
									main: "#4D9FFF",
								},
								background: {
									default: "#0F1117",
									paper: "#1C1F27",
								},
								text: {
									primary: "#E8EAF0",
									secondary: "#9A9BB0",
								},
							},
						},
					},
				}}
				colorSchemeSelector="data-joy-color-scheme"
				defaultMode="dark"
			>
				<ThemeProvider theme={createAppTheme(mode)}>
					{children}
				</ThemeProvider>
			</CssVarsProvider>
		</ColorSchemeContext.Provider>
	);
}
