import { useState, useEffect, useCallback } from "react";
import {
	Box,
	Divider,
} from "@mui/material";
import {
	useAffectState,
	useCharacter,
	useCompanionMode,
	useCompanionRuntime,
	useDelegationMemory,
	useFunctional,
	useProactiveState,
} from "@/hooks";
import { getServices } from "@/services";
import { type AppConfig, DEFAULT_CONFIG, loadConfig, updateConfig } from "@/services/config";
import { RuntimeSummaryCard } from "./RuntimeSummaryCard";
import {
	DelegationMemoryCard,
	LiveStateCard,
	ProactiveDebugCard,
	PromptLabCard,
	RelationalTuningCard,
} from "./companion-workbench-cards";

export function CompanionWorkbenchPanel() {
	const { emotion, emotionReason, emotionSource, isSpeaking } = useCharacter();
	const affect = useAffectState();
	const companionMode = useCompanionMode();
	const delegationMemory = useDelegationMemory();
	const proactive = useProactiveState();
	const { state: companionRuntimeState, start, stop, clearHistory, runSummaryNow } = useCompanionRuntime();
	const { state: functionalState } = useFunctional();
	const [config, setConfig] = useState<AppConfig>(DEFAULT_CONFIG);

	useEffect(() => {
		let cancelled = false;
		(async () => {
			const loaded = await loadConfig();
			if (!cancelled) {
				setConfig(loaded);
			}
		})();
		return () => {
			cancelled = true;
		};
	}, []);

	const updateCharacter = useCallback((patch: Partial<AppConfig["character"]>) => {
		setConfig((current) => ({ ...current, character: { ...current.character, ...patch } }));
	}, []);

	const handleExpressionTimeoutChange = useCallback((rawValue: string) => {
		const parsed = Number(rawValue);
		const nextValue = Number.isFinite(parsed)
			? Math.max(5, Math.min(600, Math.round(parsed)))
			: DEFAULT_CONFIG.character.expressionIdleTimeoutSeconds;

		setConfig((current) => ({
			...current,
			character: {
				...current.character,
				expressionIdleTimeoutSeconds: nextValue,
			},
		}));
	}, []);

	const persistExpressionTimeout = useCallback(async () => {
		const { character } = getServices();
		character.setExpressionIdleTimeoutSeconds(config.character.expressionIdleTimeoutSeconds);
		await updateConfig({ character: { ...config.character } });
	}, [config.character]);

	const handleProactiveSilenceChange = useCallback((rawValue: string) => {
		const parsed = Number(rawValue);
		const nextValue = Number.isFinite(parsed)
			? Math.max(5, Math.min(600, Math.round(parsed)))
			: DEFAULT_CONFIG.companionRuntime.proactiveRuntimeSummarySilenceSeconds;

		setConfig((current) => ({
			...current,
			companionRuntime: {
				...current.companionRuntime,
				proactiveRuntimeSummarySilenceSeconds: nextValue,
			},
		}));
	}, []);

	const persistProactiveSilence = useCallback(async () => {
		const { proactiveCompanion } = getServices();
		proactiveCompanion.setRuntimeSummarySilenceSeconds(config.companionRuntime.proactiveRuntimeSummarySilenceSeconds);
		await updateConfig({ companionRuntime: { ...config.companionRuntime } });
	}, [config.companionRuntime]);

	const persistCharacter = useCallback(async () => {
		await updateConfig({ character: { ...config.character } });
	}, [config.character]);

	return (
		<Box sx={{ p: 1.5, display: "flex", flexDirection: "column", gap: 1 }}>
			<RuntimeSummaryCard
				functionalState={functionalState}
				companionRuntimeState={companionRuntimeState}
				onStart={start}
				onStop={stop}
				onClearHistory={clearHistory}
				onRunSummaryNow={runSummaryNow}
			/>

			<LiveStateCard
				emotion={emotion}
				emotionReason={emotionReason}
				emotionSource={emotionSource}
				isSpeaking={isSpeaking}
			/>

			<Divider />

			<RelationalTuningCard
				config={config}
				affect={affect}
				onExpressionTimeoutChange={handleExpressionTimeoutChange}
				onPersistExpressionTimeout={persistExpressionTimeout}
				onProactiveSilenceChange={handleProactiveSilenceChange}
				onPersistProactiveSilence={persistProactiveSilence}
			/>

			<Divider />

			<ProactiveDebugCard
				currentMode={companionMode.mode}
				preferredMode={companionMode.preferredMode}
				proactive={proactive}
			/>

			<Divider />

			<DelegationMemoryCard
				latestRecord={delegationMemory.latestRecord}
				recentCount={delegationMemory.recentRecords.length}
			/>

			<Divider />

			<PromptLabCard
				config={config}
				onUpdateCharacter={updateCharacter}
				onSetConfig={setConfig}
				onPersistCharacter={persistCharacter}
			/>
		</Box>
	);
}
