import React, { createContext, useCallback, useContext, useMemo, useState } from "react";
import { getConfig, updateConfig } from "@/services/config";

export type AppLocale = "zh" | "en";

interface I18nContextValue {
	locale: AppLocale;
	setLocale: (locale: AppLocale) => void;
	t: (zhText: string, enText?: string) => string;
}

const I18nContext = createContext<I18nContextValue>({
	locale: "zh",
	setLocale: () => {},
	t: (zhText, enText) => enText ?? zhText,
});

export function useI18n() {
	return useContext(I18nContext);
}

export function I18nProvider({ children }: { children: React.ReactNode }) {
	const [localeState, setLocaleState] = useState<AppLocale>(() => {
		return getConfig().locale ?? "zh";
	});

	const setLocale = useCallback((locale: AppLocale) => {
		setLocaleState(locale);
		void updateConfig({ locale });
	}, []);

	const t = useCallback((zhText: string, enText?: string) => {
		if (localeState === "zh") return zhText;
		return enText ?? zhText;
	}, [localeState]);

	const value = useMemo(() => ({
		locale: localeState,
		setLocale,
		t,
	}), [localeState, setLocale, t]);

	return (
		<I18nContext.Provider value={value}>
			{children}
		</I18nContext.Provider>
	);
}
