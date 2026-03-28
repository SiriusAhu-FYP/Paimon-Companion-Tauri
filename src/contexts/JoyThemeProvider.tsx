import React, { createContext, useContext, useState, useCallback, useMemo } from "react";
import { ThemeProvider, CssBaseline } from "@mui/material";
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

export function useThemeMode() {
	return useContext(ColorSchemeContext);
}

export function ThemeModeProvider({ children }: { children: React.ReactNode }) {
	const [mode, setModeState] = useState<PaletteMode>(() => {
		const saved = localStorage.getItem(STORAGE_KEY);
		return (saved === "light" || saved === "dark") ? saved : "dark";
	});

	const setMode = useCallback((newMode: PaletteMode) => {
		setModeState(newMode);
		localStorage.setItem(STORAGE_KEY, newMode);
	}, []);

	const theme = useMemo(() => createAppTheme(mode), [mode]);

	const contextValue = useMemo(() => ({ mode, setMode }), [mode, setMode]);

	return (
		<ColorSchemeContext.Provider value={contextValue}>
			<ThemeProvider theme={theme}>
				<CssBaseline />
				{children}
			</ThemeProvider>
		</ColorSchemeContext.Provider>
	);
}
