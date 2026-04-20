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
import type { TTSProfile, TTSProviderType } from "@/services/config";
import { useI18n } from "@/contexts/I18nProvider";

interface TTSProfilesSectionProps {
	profiles: TTSProfile[];
	activeId: string;
	onAdd: (p: TTSProfile) => void;
	onUpdate: (p: TTSProfile) => void;
	onDelete: (id: string) => void;
	onSelect: (id: string) => void;
	onPersist: (newProfiles: TTSProfile[], newActiveId: string) => Promise<unknown>;
}

export function TTSProfilesSection({ profiles, activeId, onAdd, onUpdate, onDelete, onSelect, onPersist }: TTSProfilesSectionProps) {
	const { t } = useI18n();
	const [dialogOpen, setDialogOpen] = useState(false);
	const [editingProfile, setEditingProfile] = useState<TTSProfile | null>(null);
	const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
	const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
	const [deleteCountdown, setDeleteCountdown] = useState(0);

	useEffect(() => {
		if (deleteCountdown <= 0) return;
		const timer = setTimeout(() => setDeleteCountdown((c) => c - 1), 1000);
		return () => clearTimeout(timer);
	}, [deleteCountdown]);

	const defaultTTS = (): TTSProfile => ({
		id: `tts-${Date.now()}`,
		name: "",
		provider: "gpt-sovits",
		baseUrl: "http://localhost:9880",
		speakerId: "",
		speed: 1.0,
		gptWeightsPath: "",
		sovitsWeightsPath: "",
		refAudioPath: "",
		promptText: "",
		promptLang: "zh",
		textLang: "zh",
	});

	const handleEdit = (event: React.MouseEvent<HTMLElement>) => {
		if (activeId) {
			setEditingProfile(profiles.find((p) => p.id === activeId) ?? null);
		} else {
			setEditingProfile(defaultTTS());
		}
		setAnchorEl(event.currentTarget);
		setDialogOpen(true);
	};

	const handleNew = (event: React.MouseEvent<HTMLElement>) => {
		setEditingProfile(defaultTTS());
		setAnchorEl(event.currentTarget);
		setDialogOpen(true);
	};

	const handleDialogSave = async () => {
		if (!editingProfile) return;
		const exists = profiles.some((p) => p.id === editingProfile.id);
		let newProfiles: TTSProfile[];
		let newActiveId = activeId;
		if (exists) {
			onUpdate(editingProfile);
			newProfiles = profiles.map((p) => p.id === editingProfile.id ? editingProfile : p);
		} else {
			onAdd(editingProfile);
			onSelect(editingProfile.id);
			newActiveId = editingProfile.id;
			newProfiles = [...profiles, editingProfile];
		}
		setDialogOpen(false);
		setEditingProfile(null);
		setAnchorEl(null);
		await onPersist(newProfiles, newActiveId);
	};

	const handleDialogClose = () => {
		setDialogOpen(false);
		setEditingProfile(null);
		setAnchorEl(null);
	};

	const handleDelete = async (id: string) => {
		onDelete(id);
		if (id === activeId) onSelect("");
		setDialogOpen(false);
		setEditingProfile(null);
		setAnchorEl(null);
		const newProfiles = profiles.filter((p) => p.id !== id);
		await onPersist(newProfiles, id === activeId ? "" : activeId);
	};

	const isGptSovits = editingProfile?.provider === "gpt-sovits";

	return (
		<>
			<Stack direction="row" spacing={0.5} alignItems="center">
				<Select
					size="small"
					value={activeId}
					onChange={(e: SelectChangeEvent) => onSelect(e.target.value)}
					displayEmpty
					sx={{ flex: 1, fontSize: 13 }}
				>
					<MenuItem value=""><em>{t("无（使用手动配置）", "None (use manual config)")}</em></MenuItem>
					{profiles.map((p) => (
						<MenuItem key={p.id} value={p.id}>{p.name || t("(未命名)", "(Unnamed)")}</MenuItem>
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

			<Popover
				open={dialogOpen}
				anchorEl={anchorEl}
				onClose={handleDialogClose}
				anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
				transformOrigin={{ vertical: "top", horizontal: "right" }}
				slotProps={{ paper: { sx: { width: 360, maxHeight: 480, overflowY: "auto" } } }}
			>
				<Box sx={{ p: 1.5 }}>
					<Typography variant="subtitle2" sx={{ mb: 1 }}>{t("TTS 配置档案", "TTS Profile")}</Typography>
					{editingProfile && (
						<Stack spacing={1}>
							<TextField size="small" fullWidth label={t("档案名称", "Profile Name")}
								value={editingProfile.name}
								onChange={(e) => setEditingProfile({ ...editingProfile, name: e.target.value })}
							/>
							<Select
								size="small"
								fullWidth
								label={t("Provider", "Provider")}
								value={editingProfile.provider}
								onChange={(e: SelectChangeEvent) => setEditingProfile({ ...editingProfile, provider: e.target.value as TTSProviderType })}
							>
								<MenuItem value="mock">{t("Mock（模拟）", "Mock")}</MenuItem>
								<MenuItem value="gpt-sovits">GPT-SoVITS</MenuItem>
							</Select>
							<TextField size="small" fullWidth label={t("服务地址", "Service URL")}
								value={editingProfile.baseUrl}
								onChange={(e) => setEditingProfile({ ...editingProfile, baseUrl: e.target.value })}
							/>

							{isGptSovits && (
								<>
									<TextField size="small" fullWidth label={t("GPT 权重路径", "GPT Weights Path")}
										value={editingProfile.gptWeightsPath}
										onChange={(e) => setEditingProfile({ ...editingProfile, gptWeightsPath: e.target.value })}
									/>
									<TextField size="small" fullWidth label={t("SoVITS 权重路径", "SoVITS Weights Path")}
										value={editingProfile.sovitsWeightsPath}
										onChange={(e) => setEditingProfile({ ...editingProfile, sovitsWeightsPath: e.target.value })}
									/>
									<TextField size="small" fullWidth label={t("参考音频路径", "Reference Audio Path")}
										value={editingProfile.refAudioPath}
										onChange={(e) => setEditingProfile({ ...editingProfile, refAudioPath: e.target.value })}
									/>
									<TextField size="small" fullWidth label={t("参考音频文本", "Reference Audio Text")}
										value={editingProfile.promptText}
										onChange={(e) => setEditingProfile({ ...editingProfile, promptText: e.target.value })}
									/>
									<Stack direction="row" spacing={0.5}>
										<Select size="small" sx={{ flex: 1 }} label={t("参考语言", "Reference Language")}
											value={editingProfile.promptLang}
											onChange={(e: SelectChangeEvent) => setEditingProfile({ ...editingProfile, promptLang: e.target.value })}
										>
											<MenuItem value="zh">{t("中文", "Chinese")}</MenuItem>
											<MenuItem value="en">English</MenuItem>
											<MenuItem value="ja">{t("日语", "Japanese")}</MenuItem>
										</Select>
										<Select size="small" sx={{ flex: 1 }} label={t("合成语言", "Synthesis Language")}
											value={editingProfile.textLang}
											onChange={(e: SelectChangeEvent) => setEditingProfile({ ...editingProfile, textLang: e.target.value })}
										>
											<MenuItem value="zh">{t("中文", "Chinese")}</MenuItem>
											<MenuItem value="en">English</MenuItem>
											<MenuItem value="ja">{t("日语", "Japanese")}</MenuItem>
										</Select>
									</Stack>
									<Alert severity="info" sx={{ py: 0 }}>
										{t("TTS 当前只接受 GPT-SoVITS 路线。", "TTS currently only supports the GPT-SoVITS route.")}
									</Alert>
								</>
							)}

							<Stack direction="row" spacing={0.5} justifyContent="space-between" alignItems="center">
								{profiles.length > 1 ? (
									<Button size="small" color="error" onClick={() => { setConfirmDeleteOpen(true); setDeleteCountdown(2); }}>
										{t("删除档案", "Delete Profile")}
									</Button>
								) : <Box />}
								<Stack direction="row" spacing={0.5}>
									<Button size="small" onClick={handleDialogClose}>{t("取消", "Cancel")}</Button>
									<Button size="small" variant="contained" onClick={handleDialogSave}>{t("保存", "Save")}</Button>
								</Stack>
							</Stack>

							{confirmDeleteOpen && editingProfile && (
								<Box sx={{ bgcolor: "background.default", border: "1px solid", borderColor: "error.main", borderRadius: 1, p: 1.5, mt: 0.5 }}>
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
											onClick={() => { setConfirmDeleteOpen(false); void handleDelete(editingProfile.id); }}
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
