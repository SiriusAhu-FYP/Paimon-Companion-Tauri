import { Alert, Box, Stack, Typography } from "@mui/material";
import { useI18n } from "@/contexts/I18nProvider";
import type { ASRProfile } from "@/services/config";

interface AsrProfilesSectionProps {
	profiles: ASRProfile[];
	activeId: string;
	onAdd: (profile: ASRProfile) => void;
	onUpdate: (profile: ASRProfile) => void;
	onDelete: (id: string) => void;
	onSelect: (id: string) => void;
	onPersist: (newProfiles: ASRProfile[], newActiveId: string) => Promise<unknown>;
}

export function AsrProfilesSection({
	profiles: _profiles,
	activeId: _activeId,
	onAdd: _onAdd,
	onUpdate: _onUpdate,
	onDelete: _onDelete,
	onSelect: _onSelect,
	onPersist: _onPersist,
}: AsrProfilesSectionProps) {
	const { t } = useI18n();

	return (
		<Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
			<Alert severity="info" sx={{ py: 0 }}>
				{t(
					"ASR 当前只保留应用内置的本地 sherpa-onnx 方案。",
					"ASR now keeps only the built-in local sherpa-onnx route.",
				)}
			</Alert>

			<Stack spacing={0.25}>
				<Typography variant="body2">
					{t("当前路线", "Current Route")}：{t("本地离线 ASR（sherpa-onnx）", "Local Offline ASR (sherpa-onnx)")}
				</Typography>
				<Typography variant="body2">
					{t("内置模型", "Bundled Model")}：sherpa-onnx-streaming-zipformer-small-bilingual-zh-en-2023-02-16
				</Typography>
				<Typography variant="body2">
					{t("默认语言", "Default Language")}：zh-en
				</Typography>
			</Stack>

			<Alert severity="warning" sx={{ py: 0 }}>
				{t(
					"该方案不再暴露云端 provider/profile 选择；如需确认可用性，请直接使用下方的 ASR 测试。",
					"Cloud provider/profile selection is no longer exposed here; use the ASR test below to verify readiness.",
				)}
			</Alert>
		</Box>
	);
}
