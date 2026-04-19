import { useEffect, useState } from "react";
import {
	Alert,
	Box,
	Button,
	IconButton,
	MenuItem,
	Popover,
	Select,
	Stack,
	TextField,
	Tooltip,
	Typography,
	type SelectChangeEvent,
} from "@mui/material";
import EditIcon from "@mui/icons-material/Edit";
import AddIcon from "@mui/icons-material/Add";
import WarningIcon from "@mui/icons-material/Warning";
import {
	type ASRProfile,
	type ASRProviderType,
	SECRET_KEYS,
	deleteSecret,
	getSecret,
	setSecret,
} from "@/services/config";
import { useI18n } from "@/contexts/I18nProvider";

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
	profiles,
	activeId,
	onAdd,
	onUpdate,
	onDelete,
	onSelect,
	onPersist,
}: AsrProfilesSectionProps) {
	const { t } = useI18n();
	const providerLabels: Record<ASRProviderType, string> = {
		mock: t("Mock（模拟）", "Mock"),
		"local-sherpa": t("本地离线 ASR（sherpa-onnx）", "Local Offline ASR (sherpa-onnx)"),
		volcengine: t("火山引擎 ASR", "Volcengine ASR"),
		aliyun: t("阿里云 ASR", "Aliyun ASR"),
	};
	const [dialogOpen, setDialogOpen] = useState(false);
	const [editingProfile, setEditingProfile] = useState<ASRProfile | null>(null);
	const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
	const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
	const [deleteCountdown, setDeleteCountdown] = useState(0);

	useEffect(() => {
		if (deleteCountdown <= 0) return;
		const timer = setTimeout(() => setDeleteCountdown((count) => count - 1), 1000);
		return () => clearTimeout(timer);
	}, [deleteCountdown]);

	const defaultProfile = (): ASRProfile => ({
		id: `asr-${Date.now()}`,
		name: "",
		provider: "local-sherpa",
		apiKey: "",
		baseUrl: "",
		model: "sherpa-onnx-streaming-zipformer-small-bilingual-zh-en-2023-02-16",
		language: "zh-en",
		autoDetectLanguage: true,
		vadEnabled: true,
		vadAggressiveness: 2,
		silenceThresholdMs: 800,
		minSpeechMs: 1000,
	});

	const handleEdit = async (event: React.MouseEvent<HTMLElement>) => {
		if (activeId) {
			const profile = profiles.find((item) => item.id === activeId) ?? null;
			if (profile) {
				const apiKey = await getSecret(SECRET_KEYS.ASR_API_KEY(profile.id)) ?? "";
				setEditingProfile({ ...profile, apiKey });
			} else {
				setEditingProfile(null);
			}
		} else {
			setEditingProfile(defaultProfile());
		}
		setAnchorEl(event.currentTarget);
		setDialogOpen(true);
	};

	const handleNew = (event: React.MouseEvent<HTMLElement>) => {
		setEditingProfile(defaultProfile());
		setAnchorEl(event.currentTarget);
		setDialogOpen(true);
	};

	const handleDialogClose = () => {
		setDialogOpen(false);
		setEditingProfile(null);
		setAnchorEl(null);
		setConfirmDeleteOpen(false);
		setDeleteCountdown(0);
	};

	const handleDialogSave = async () => {
		if (!editingProfile) return;

		if (editingProfile.apiKey) {
			await setSecret(SECRET_KEYS.ASR_API_KEY(editingProfile.id), editingProfile.apiKey);
		}

		const exists = profiles.some((item) => item.id === editingProfile.id);
		const profileToSave = { ...editingProfile, apiKey: "" };
		let newProfiles: ASRProfile[];
		let newActiveId = activeId;

		if (exists) {
			onUpdate(profileToSave);
			newProfiles = profiles.map((item) => item.id === editingProfile.id ? profileToSave : item);
		} else {
			onAdd(profileToSave);
			onSelect(editingProfile.id);
			newActiveId = editingProfile.id;
			newProfiles = [...profiles, profileToSave];
		}

		handleDialogClose();
		await onPersist(newProfiles, newActiveId);
	};

	const handleDelete = async (id: string) => {
		onDelete(id);
		if (id === activeId) onSelect("");
		await deleteSecret(SECRET_KEYS.ASR_API_KEY(id));
		handleDialogClose();
		const newProfiles = profiles.filter((item) => item.id !== id);
		await onPersist(newProfiles, id === activeId ? "" : activeId);
	};

	const isCloudProvider =
		editingProfile?.provider === "volcengine"
		|| editingProfile?.provider === "aliyun";
	const isLocalProvider = editingProfile?.provider === "local-sherpa";

	return (
		<>
			<Stack direction="row" spacing={0.5} alignItems="center">
				<Select
					size="small"
					value={activeId}
					onChange={(event: SelectChangeEvent) => onSelect(event.target.value)}
					displayEmpty
					sx={{ flex: 1, fontSize: 13 }}
				>
					<MenuItem value=""><em>{t("无（使用手动配置）", "None (use manual config)")}</em></MenuItem>
					{profiles.map((profile) => (
						<MenuItem key={profile.id} value={profile.id}>{profile.name || t("(未命名)", "(Unnamed)")}</MenuItem>
					))}
				</Select>
				<Tooltip title={t("编辑档案", "Edit profile")}>
					<IconButton
						size="small"
						onClick={handleEdit}
						disabled={!activeId && profiles.length === 0}
						sx={{ color: "text.secondary" }}
					>
						<EditIcon sx={{ fontSize: 14 }} />
					</IconButton>
				</Tooltip>
				<Tooltip title={t("新增档案", "Add profile")}>
					<IconButton size="small" onClick={handleNew} sx={{ color: "primary.main" }}>
						<AddIcon sx={{ fontSize: 14 }} />
					</IconButton>
				</Tooltip>
			</Stack>

			<Alert severity="info" sx={{ py: 0, mt: 0.75 }}>
				{t("ASR 当前只保留三类路线：内置本地 sherpa-onnx、火山引擎、阿里云。", "ASR currently supports three routes only: built-in local sherpa-onnx, Volcengine, and Aliyun.")}
			</Alert>

			<Popover
				open={dialogOpen}
				anchorEl={anchorEl}
				onClose={handleDialogClose}
				anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
				transformOrigin={{ vertical: "top", horizontal: "right" }}
				slotProps={{ paper: { sx: { width: 380, maxHeight: 560, overflowY: "auto" } } }}
			>
				<Box sx={{ p: 1.5 }}>
					<Typography variant="subtitle2" sx={{ mb: 1 }}>{t("ASR 配置档案", "ASR Profile")}</Typography>
					{editingProfile && (
						<Stack spacing={1}>
							<TextField
								size="small"
								fullWidth
								label={t("档案名称", "Profile Name")}
								value={editingProfile.name}
								onChange={(event) => setEditingProfile({ ...editingProfile, name: event.target.value })}
							/>

							<Select
								size="small"
								fullWidth
								value={editingProfile.provider}
								onChange={(event: SelectChangeEvent) => setEditingProfile({
									...editingProfile,
									provider: event.target.value as ASRProviderType,
								})}
							>
								{Object.entries(providerLabels).map(([value, label]) => (
									<MenuItem key={value} value={value}>{label}</MenuItem>
								))}
							</Select>

							{isCloudProvider && (
								<TextField
									size="small"
									fullWidth
									label={t("API Key / Token", "API Key / Token")}
									type="password"
									value={editingProfile.apiKey ?? ""}
									onChange={(event) => setEditingProfile({ ...editingProfile, apiKey: event.target.value })}
									helperText={t("敏感凭证会写入系统钥匙串", "Sensitive credentials are stored in the system keychain")}
								/>
							)}

							{isCloudProvider && (
								<TextField
									size="small"
									fullWidth
									label={t("服务地址", "Service URL")}
									value={editingProfile.baseUrl}
									onChange={(event) => setEditingProfile({ ...editingProfile, baseUrl: event.target.value })}
									helperText={t("云端 ASR 接口地址", "Cloud ASR endpoint URL")}
								/>
							)}

							<TextField
								size="small"
								fullWidth
								label={t("模型名", "Model Name")}
								value={editingProfile.model}
								onChange={(event) => setEditingProfile({ ...editingProfile, model: event.target.value })}
								helperText={isLocalProvider ? t("当前内置模型固定为 sherpa-onnx bilingual zipformer；此字段主要用于标识和显示。", "The built-in local model is fixed to sherpa-onnx bilingual zipformer; this field is mainly for labeling and display.") : undefined}
							/>

							{isCloudProvider ? (
								<Stack direction="row" spacing={0.5}>
									<TextField
										size="small"
										fullWidth
										label={t("语言", "Language")}
										value={editingProfile.language}
										onChange={(event) => setEditingProfile({ ...editingProfile, language: event.target.value })}
										helperText={t("例如 zh / en / auto", "For example: zh / en / auto")}
									/>
									<Select
										size="small"
										sx={{ minWidth: 150 }}
										value={editingProfile.autoDetectLanguage ? "auto" : "fixed"}
										onChange={(event: SelectChangeEvent) => setEditingProfile({
											...editingProfile,
											autoDetectLanguage: event.target.value === "auto",
										})}
									>
										<MenuItem value="fixed">{t("固定语言", "Fixed Language")}</MenuItem>
										<MenuItem value="auto">{t("自动识别", "Auto Detect")}</MenuItem>
									</Select>
								</Stack>
							) : (
								<Alert severity="info" sx={{ py: 0 }}>
									{t("内置本地 ASR 使用应用内置的 `sherpa-onnx-streaming-zipformer-small-bilingual-zh-en-2023-02-16`，默认支持中英双语，不再要求手动提供服务地址、下载地址或模型路径。", "Built-in local ASR uses the bundled `sherpa-onnx-streaming-zipformer-small-bilingual-zh-en-2023-02-16`, supports Chinese and English by default, and no longer requires manual service URLs, download URLs, or model paths.")}
								</Alert>
							)}

							{isLocalProvider && (
								<Alert severity="warning" sx={{ py: 0 }}>
									{t("当前本地 ASR 为应用内置模型，仓库侧由固定脚本准备资源；设置页不再暴露 locate/download 入口。", "The current local ASR uses a bundled model prepared by fixed scripts; the settings page no longer exposes locate/download controls.")}
								</Alert>
							)}

							{!isLocalProvider && (
								<TextField
									size="small"
									fullWidth
									label={t("语言", "Language")}
									value={editingProfile.language}
									onChange={(event) => setEditingProfile({ ...editingProfile, language: event.target.value })}
									helperText={t("例如 zh / en / ja", "For example: zh / en / ja")}
								/>
							)}

							<Select
								size="small"
								fullWidth
								value={editingProfile.vadEnabled ? "enabled" : "disabled"}
								onChange={(event: SelectChangeEvent) => setEditingProfile({
									...editingProfile,
									vadEnabled: event.target.value === "enabled",
								})}
							>
								<MenuItem value="enabled">{t("启用 VAD 分段", "Enable VAD Segmentation")}</MenuItem>
								<MenuItem value="disabled">{t("关闭 VAD 分段", "Disable VAD Segmentation")}</MenuItem>
							</Select>

							<Stack direction="row" spacing={0.5}>
								<TextField
									size="small"
									fullWidth
									label={t("VAD 激进度", "VAD Aggressiveness")}
									type="number"
									slotProps={{ htmlInput: { min: 0, max: 3, step: 1 } }}
									value={editingProfile.vadAggressiveness}
									onChange={(event) => setEditingProfile({
										...editingProfile,
										vadAggressiveness: parseInt(event.target.value, 10) || 0,
									})}
								/>
								<TextField
									size="small"
									fullWidth
									label={t("静音阈值(ms)", "Silence Threshold (ms)")}
									type="number"
									slotProps={{ htmlInput: { min: 200, max: 5000, step: 100 } }}
									value={editingProfile.silenceThresholdMs}
									onChange={(event) => setEditingProfile({
										...editingProfile,
										silenceThresholdMs: parseInt(event.target.value, 10) || 800,
									})}
								/>
							</Stack>

							<TextField
								size="small"
								fullWidth
								label={t("最短语音段(ms)", "Minimum Speech (ms)")}
								type="number"
								slotProps={{ htmlInput: { min: 200, max: 10000, step: 100 } }}
								value={editingProfile.minSpeechMs}
								onChange={(event) => setEditingProfile({
									...editingProfile,
									minSpeechMs: parseInt(event.target.value, 10) || 1000,
								})}
							/>

							<Alert severity="warning" sx={{ py: 0 }}>
								{t("Tauri 主应用负责 UI、设置、麦克风状态和编排；本地离线 ASR 当前固定为内置 sherpa-onnx，云端则保留火山与阿里云两条接口。", "The Tauri app handles UI, settings, microphone state, and orchestration; local offline ASR is currently fixed to the bundled sherpa-onnx model, while cloud routes remain Volcengine and Aliyun.")}
							</Alert>

							<Stack direction="row" spacing={0.5} justifyContent="space-between" alignItems="center">
								{profiles.length > 1 ? (
									<Button
										size="small"
										color="error"
										onClick={() => {
											setConfirmDeleteOpen(true);
											setDeleteCountdown(2);
										}}
									>
										{t("删除档案", "Delete Profile")}
									</Button>
								) : <Box />}
								<Stack direction="row" spacing={0.5}>
									<Button size="small" onClick={handleDialogClose}>{t("取消", "Cancel")}</Button>
									<Button size="small" variant="contained" onClick={handleDialogSave}>{t("保存", "Save")}</Button>
								</Stack>
							</Stack>

							{confirmDeleteOpen && editingProfile && (
								<Box sx={{ bgcolor: "background.default", border: "1px solid", borderColor: "error.main", borderRadius: 1, p: 1.5 }}>
									<Stack direction="row" spacing={0.5} alignItems="center">
										<WarningIcon sx={{ fontSize: 14, color: "error.main" }} />
										<Typography variant="subtitle2" sx={{ color: "error.main" }}>{t("删除此档案将无法恢复", "Deleting this profile cannot be undone")}</Typography>
									</Stack>
									<Stack direction="row" spacing={0.5} justifyContent="flex-end">
										<Button
											size="small"
											variant="contained"
											color="error"
											disabled={deleteCountdown > 0}
											onClick={() => void handleDelete(editingProfile.id)}
										>
											{deleteCountdown > 0 ? t(`确认删除 (${deleteCountdown}s)`, `Confirm Delete (${deleteCountdown}s)`) : t("确认删除", "Confirm Delete")}
										</Button>
										<Button size="small" onClick={() => setConfirmDeleteOpen(false)}>{t("取消", "Cancel")}</Button>
									</Stack>
								</Box>
							)}
						</Stack>
					)}
				</Box>
			</Popover>
		</>
	);
}
