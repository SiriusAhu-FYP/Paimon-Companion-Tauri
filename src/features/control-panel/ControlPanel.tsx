import { useState, useEffect, useCallback } from "react";
import {
	Box,
	Button,
	Chip,
	Divider,
	MenuItem,
	Select,
	Stack,
	type SelectChangeEvent,
	Typography,
} from "@mui/material";
import StopIcon from "@mui/icons-material/Stop";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import { useRuntime, useCharacter } from "@/hooks";
import { useI18n } from "@/contexts/I18nProvider";
import { getServices } from "@/services";
import { updateConfig, getConfig } from "@/services/config";
import { MOCK_CHARACTER_PROFILE } from "@/utils/mock";
import type { CharacterProfile } from "@/types";
import { createLogger } from "@/services/logger";
import { PanelCard, PanelRoot } from "./panel-shell";

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
	return (
		<PanelRoot title={t("陪伴面板", "Companion Panel")}>
			<PanelCard>
				<Stack direction="row" alignItems="center" spacing={0.5} sx={{ mb: 0.5 }}>
					<Typography variant="caption" color="text.secondary" fontWeight={600}>
						{t("运行状态", "Runtime State")}
					</Typography>
					{mode === "stopped" && (
						<Chip label="STOPPED" size="small" color="error" sx={{ height: 18, fontSize: 10 }} />
					)}
				</Stack>
				<Typography variant="body2" sx={{ mb: 0.75 }}>
					{t("模式", "Mode")}：<strong>{mode}</strong>
				</Typography>
				<Stack direction="row" spacing={0.5}>
					<Button
						variant="outlined"
						size="small"
						onClick={stop}
						disabled={mode === "stopped"}
						startIcon={<StopIcon />}
						color="error"
					>
						{t("急停", "Stop")}
					</Button>
					<Button
						variant="outlined"
						size="small"
						onClick={resume}
						disabled={mode === "auto"}
						startIcon={<PlayArrowIcon />}
					>
						{t("恢复", "Resume")}
					</Button>
				</Stack>
			</PanelCard>

			<Divider />

			<PanelCard>
				<Typography variant="caption" color="text.secondary" fontWeight={600} sx={{ mb: 0.5, display: "block" }}>
					{t("当前角色", "Current Character")}：{currentProfileName}
				</Typography>
				<Select
					size="small"
					fullWidth
					value={selectedId}
					onChange={handleCharacterSwitch}
					displayEmpty
					sx={{ fontSize: 13, mb: 1 }}
				>
					<MenuItem value="__manual__">
						<em>{t("手动人设", "Manual Persona")}</em>
					</MenuItem>
					{profiles.map((profile) => (
						<MenuItem key={profile.id} value={profile.id}>
							{profile.name}
						</MenuItem>
					))}
				</Select>

				<Box sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}>
					<Typography variant="body2">{t("当前表情", "Current Emotion")}：{emotion}</Typography>
					<Typography variant="body2">{t("语音状态", "Speech State")}：{isSpeaking ? t("说话中", "Speaking") : t("空闲", "Idle")}</Typography>
				</Box>
			</PanelCard>
		</PanelRoot>
	);
}
