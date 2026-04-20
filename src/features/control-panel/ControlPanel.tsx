import { useState, useEffect, useCallback } from "react";
import { Divider, type SelectChangeEvent } from "@mui/material";
import { useRuntime, useCharacter, useCompanionMode, useDebugCaptureState, useDelegationMemory } from "@/hooks";
import { useI18n } from "@/contexts/I18nProvider";
import { getServices } from "@/services";
import { updateConfig, getConfig } from "@/services/config";
import { MOCK_CHARACTER_PROFILE } from "@/utils/mock";
import type { CharacterProfile } from "@/types";
import { createLogger } from "@/services/logger";
import { PanelRoot } from "./panel-shell";
import {
	CharacterSwitcherCard,
	DebugCaptureCard,
	InteractionModeCard,
	LatestDelegatedRecordCard,
	RuntimeStateCard,
} from "./control-panel-cards";

const log = createLogger("control-panel");

function normalizeSelectedCharacterId(currentId: string | null, available: readonly CharacterProfile[]): string {
	if (!currentId || currentId === MOCK_CHARACTER_PROFILE.id) {
		return "__manual__";
	}

	return available.some((profile) => profile.id === currentId) ? currentId : "__manual__";
}

export function ControlPanel() {
	const { t } = useI18n();
	const { mode, stop, resume } = useRuntime();
	const { emotion, isSpeaking } = useCharacter();
	const companionMode = useCompanionMode();
	const debugCapture = useDebugCaptureState();
	const delegationMemory = useDelegationMemory();
	const [profiles, setProfiles] = useState<CharacterProfile[]>([]);
	const [selectedId, setSelectedId] = useState<string>("__manual__");

	useEffect(() => {
		const { character } = getServices();
		const available = character.getAvailableProfiles();
		setProfiles([...available]);

		const current = character.getProfile();
		setSelectedId(normalizeSelectedCharacterId(current?.id ?? null, available));
	}, []);

	const handleCharacterSwitch = useCallback(async (event: SelectChangeEvent<string>) => {
		const id = event.target.value;
		const { character, llm } = getServices();

		if (id === "__manual__") {
			character.loadFromProfile(MOCK_CHARACTER_PROFILE);
			setSelectedId("__manual__");
			llm.clearHistory();
			await updateConfig({ character: { ...getConfig().character, activeProfileId: "" } });
			log.info("switched to manual/default character");
			return;
		}

		const profile = character.findProfileById(id);
		if (!profile) return;

		character.loadFromProfile(profile);
		setSelectedId(profile.id);
		llm.clearHistory();
		await updateConfig({ character: { ...getConfig().character, activeProfileId: profile.id } });
		log.info(`switched to character: ${profile.name} (${profile.id})`);
	}, []);

	const currentProfileName = selectedId === "__manual__"
		? t("手动人设", "Manual Persona")
		: profiles.find((profile) => profile.id === selectedId)?.name ?? t("手动人设", "Manual Persona");
	const latestDelegatedRecord = delegationMemory.latestRecord;

	const handleModeChange = useCallback((nextMode: "companion" | "delegated") => {
		const { companionMode: companionModeService } = getServices();
		companionModeService.setMode(nextMode, "control-panel-toggle", "manual");
	}, []);

	const handleToggleDebugCapture = useCallback(async () => {
		const { debugCapture: debugCaptureService } = getServices();
		await debugCaptureService.setEnabled(!debugCapture.enabled);
	}, [debugCapture.enabled]);
	return (
		<PanelRoot title={t("陪伴面板", "Companion Panel")}>
			<RuntimeStateCard mode={mode} onStop={stop} onResume={resume} />

			<Divider />

			<InteractionModeCard
				mode={companionMode.mode}
				preferredMode={companionMode.preferredMode}
				lastReason={companionMode.lastReason}
				onModeChange={handleModeChange}
			/>

			<Divider />

			<CharacterSwitcherCard
				selectedId={selectedId}
				profiles={profiles}
				currentProfileName={currentProfileName}
				emotion={emotion}
				isSpeaking={isSpeaking}
				onChange={handleCharacterSwitch}
			/>

			<Divider />

			<DebugCaptureCard state={debugCapture} onToggle={handleToggleDebugCapture} />

			<Divider />

			<LatestDelegatedRecordCard record={latestDelegatedRecord} />
		</PanelRoot>
	);
}
