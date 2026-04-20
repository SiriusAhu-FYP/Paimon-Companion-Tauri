import { useEffect, useState } from "react";
import {
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
	type LLMProfile,
	type LLMProviderType,
	SECRET_KEYS,
	deleteSecret,
	getSecret,
	setSecret,
} from "@/services/config";
import { useI18n } from "@/contexts/I18nProvider";

interface LLMProfilesSectionProps {
	profiles: LLMProfile[];
	activeId: string;
	onAdd: (p: LLMProfile) => void;
	onUpdate: (p: LLMProfile) => void;
	onDelete: (id: string) => void;
	onSelect: (id: string) => void;
	onPersist: (newProfiles: LLMProfile[], newActiveId: string) => Promise<unknown>;
}

export function LLMProfilesSection({ profiles, activeId, onAdd, onUpdate, onDelete, onSelect, onPersist }: LLMProfilesSectionProps) {
	const { t } = useI18n();
	const [dialogOpen, setDialogOpen] = useState(false);
	const [editingProfile, setEditingProfile] = useState<LLMProfile | null>(null);
	const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
	const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
	const [deleteCountdown, setDeleteCountdown] = useState(0);

	useEffect(() => {
		deleteSecret("llm-api-key").catch(() => { /* ignore if not exists */ });
	}, []);

	useEffect(() => {
		if (deleteCountdown <= 0) return;
		const timer = setTimeout(() => setDeleteCountdown((c) => c - 1), 1000);
		return () => clearTimeout(timer);
	}, [deleteCountdown]);

	const handleEdit = async (event: React.MouseEvent<HTMLElement>) => {
		if (activeId) {
			const profile = profiles.find((p) => p.id === activeId) ?? null;
			if (profile) {
				const apiKey = await getSecret(SECRET_KEYS.LLM_API_KEY(profile.id)) ?? "";
				setEditingProfile({ ...profile, apiKey });
			} else {
				setEditingProfile(null);
			}
		} else {
			setEditingProfile({
				id: `llm-${Date.now()}`,
				name: "",
				provider: "openai-compatible",
				apiKey: "",
				baseUrl: "",
				model: "",
				temperature: 0.7,
				maxTokens: 4096,
			});
		}
		setAnchorEl(event.currentTarget);
		setDialogOpen(true);
	};

	const handleNew = (event: React.MouseEvent<HTMLElement>) => {
		setEditingProfile({
			id: `llm-${Date.now()}`,
			name: "",
			provider: "openai-compatible",
			apiKey: "",
			baseUrl: "",
			model: "",
			temperature: 0.7,
			maxTokens: 4096,
		});
		setAnchorEl(event.currentTarget);
		setDialogOpen(true);
	};

	const handleDialogSave = async () => {
		if (!editingProfile) return;
		if (editingProfile.apiKey) {
			await setSecret(SECRET_KEYS.LLM_API_KEY(editingProfile.id), editingProfile.apiKey);
		}
		const exists = profiles.some((p) => p.id === editingProfile.id);
		let newProfiles: LLMProfile[];
		let newActiveId = activeId;
		const profileToSave = { ...editingProfile, apiKey: "" };
		if (exists) {
			onUpdate(profileToSave);
			newProfiles = profiles.map((p) => p.id === editingProfile.id ? profileToSave : p);
		} else {
			onAdd(profileToSave);
			onSelect(editingProfile.id);
			newActiveId = editingProfile.id;
			newProfiles = [...profiles, profileToSave];
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
		await deleteSecret(SECRET_KEYS.LLM_API_KEY(id));
		setDialogOpen(false);
		setEditingProfile(null);
		setAnchorEl(null);
		const newProfiles = profiles.filter((p) => p.id !== id);
		await onPersist(newProfiles, id === activeId ? "" : activeId);
	};

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
					<Typography variant="subtitle2" sx={{ mb: 1 }}>{t("LLM 配置档案", "LLM Profile")}</Typography>
					{editingProfile && (
						<Stack spacing={1}>
							<TextField
								size="small" fullWidth label={t("档案名称", "Profile Name")}
								value={editingProfile.name}
								onChange={(e) => setEditingProfile({ ...editingProfile, name: e.target.value })}
							/>
							<Select
								size="small" fullWidth label={t("Provider", "Provider")}
								value={editingProfile.provider}
								onChange={(e: SelectChangeEvent) => setEditingProfile({ ...editingProfile, provider: e.target.value as LLMProviderType })}
							>
								<MenuItem value="mock">{t("Mock（模拟）", "Mock")}</MenuItem>
								<MenuItem value="openai-compatible">{t("OpenAI 兼容 API", "OpenAI-compatible API")}</MenuItem>
							</Select>
							<TextField
								size="small"
								fullWidth
								label={t("API Key", "API Key")}
								type="password"
								value={editingProfile.apiKey ?? ""}
								onChange={(e) => setEditingProfile({ ...editingProfile, apiKey: e.target.value })}
								helperText={t("密钥将安全存储在系统钥匙串中", "Secrets are stored securely in the system keychain")}
							/>
							<TextField
								size="small"
								fullWidth
								label={t("Base URL", "Base URL")}
								value={editingProfile.baseUrl}
								onChange={(e) => setEditingProfile({ ...editingProfile, baseUrl: e.target.value })}
								helperText={t("支持是否带 /v1 后缀", "Supports URLs with or without /v1")}
							/>
							<TextField
								size="small"
								fullWidth
								label={t("模型名称", "Model Name")}
								value={editingProfile.model}
								onChange={(e) => setEditingProfile({ ...editingProfile, model: e.target.value })}
							/>
							<Stack direction="row" spacing={0.5}>
								<TextField
									size="small"
									fullWidth
									label={t("Temperature", "Temperature")}
									type="number"
									slotProps={{ htmlInput: { min: 0, max: 2, step: 0.1 } }}
									value={editingProfile.temperature}
									onChange={(e) => setEditingProfile({ ...editingProfile, temperature: parseFloat(e.target.value) || 0.7 })}
								/>
								<TextField
									size="small"
									fullWidth
									label={t("Max Tokens", "Max Tokens")}
									type="number"
									slotProps={{ htmlInput: { min: 100, max: 16384, step: 256 } }}
									value={editingProfile.maxTokens}
									onChange={(e) => setEditingProfile({ ...editingProfile, maxTokens: parseInt(e.target.value) || 2048 })}
								/>
							</Stack>

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
