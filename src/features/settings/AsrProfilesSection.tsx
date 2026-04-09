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

interface AsrProfilesSectionProps {
	profiles: ASRProfile[];
	activeId: string;
	onAdd: (profile: ASRProfile) => void;
	onUpdate: (profile: ASRProfile) => void;
	onDelete: (id: string) => void;
	onSelect: (id: string) => void;
	onPersist: (newProfiles: ASRProfile[], newActiveId: string) => Promise<unknown>;
}

const providerLabels: Record<ASRProviderType, string> = {
	mock: "Mock（模拟）",
	"local-sherpa": "本地离线 ASR（sherpa-onnx）",
	volcengine: "火山引擎 ASR",
	aliyun: "阿里云 ASR",
};

export function AsrProfilesSection({
	profiles,
	activeId,
	onAdd,
	onUpdate,
	onDelete,
	onSelect,
	onPersist,
}: AsrProfilesSectionProps) {
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
					<MenuItem value=""><em>无（使用手动配置）</em></MenuItem>
					{profiles.map((profile) => (
						<MenuItem key={profile.id} value={profile.id}>{profile.name || "(未命名)"}</MenuItem>
					))}
				</Select>
				<Tooltip title="编辑档案">
					<IconButton
						size="small"
						onClick={handleEdit}
						disabled={!activeId && profiles.length === 0}
						sx={{ color: "text.secondary" }}
					>
						<EditIcon sx={{ fontSize: 14 }} />
					</IconButton>
				</Tooltip>
				<Tooltip title="新增档案">
					<IconButton size="small" onClick={handleNew} sx={{ color: "primary.main" }}>
						<AddIcon sx={{ fontSize: 14 }} />
					</IconButton>
				</Tooltip>
			</Stack>

			<Alert severity="info" sx={{ py: 0, mt: 0.75 }}>
				ASR 当前只保留三类路线：内置本地 sherpa-onnx、火山引擎、阿里云。
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
					<Typography variant="subtitle2" sx={{ mb: 1 }}>ASR 配置档案</Typography>
					{editingProfile && (
						<Stack spacing={1}>
							<TextField
								size="small"
								fullWidth
								label="档案名称"
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
									label="API Key / Token"
									type="password"
									value={editingProfile.apiKey ?? ""}
									onChange={(event) => setEditingProfile({ ...editingProfile, apiKey: event.target.value })}
									helperText="敏感凭证会写入系统钥匙串"
								/>
							)}

							{isCloudProvider && (
								<TextField
									size="small"
									fullWidth
									label="服务地址"
									value={editingProfile.baseUrl}
									onChange={(event) => setEditingProfile({ ...editingProfile, baseUrl: event.target.value })}
									helperText="云端 ASR 接口地址"
								/>
							)}

							<TextField
								size="small"
								fullWidth
								label="模型名"
								value={editingProfile.model}
								onChange={(event) => setEditingProfile({ ...editingProfile, model: event.target.value })}
								helperText={isLocalProvider ? "当前内置模型固定为 sherpa-onnx bilingual zipformer；此字段主要用于标识和显示。" : undefined}
							/>

							{isCloudProvider ? (
								<Stack direction="row" spacing={0.5}>
									<TextField
										size="small"
										fullWidth
										label="语言"
										value={editingProfile.language}
										onChange={(event) => setEditingProfile({ ...editingProfile, language: event.target.value })}
										helperText="例如 zh / en / auto"
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
										<MenuItem value="fixed">固定语言</MenuItem>
										<MenuItem value="auto">自动识别</MenuItem>
									</Select>
								</Stack>
							) : (
								<Alert severity="info" sx={{ py: 0 }}>
									内置本地 ASR 使用应用内置的 `sherpa-onnx-streaming-zipformer-small-bilingual-zh-en-2023-02-16`，默认支持中英双语，不再要求手动提供服务地址、下载地址或模型路径。
								</Alert>
							)}

							{isLocalProvider && (
								<Alert severity="warning" sx={{ py: 0 }}>
									当前本地 ASR 为应用内置模型，仓库侧由固定脚本准备资源；设置页不再暴露 locate/download 入口。
								</Alert>
							)}

							{!isLocalProvider && (
								<TextField
									size="small"
									fullWidth
									label="语言"
									value={editingProfile.language}
									onChange={(event) => setEditingProfile({ ...editingProfile, language: event.target.value })}
									helperText="例如 zh / en / ja"
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
								<MenuItem value="enabled">启用 VAD 分段</MenuItem>
								<MenuItem value="disabled">关闭 VAD 分段</MenuItem>
							</Select>

							<Stack direction="row" spacing={0.5}>
								<TextField
									size="small"
									fullWidth
									label="VAD 激进度"
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
									label="静音阈值(ms)"
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
								label="最短语音段(ms)"
								type="number"
								slotProps={{ htmlInput: { min: 200, max: 10000, step: 100 } }}
								value={editingProfile.minSpeechMs}
								onChange={(event) => setEditingProfile({
									...editingProfile,
									minSpeechMs: parseInt(event.target.value, 10) || 1000,
								})}
							/>

							<Alert severity="warning" sx={{ py: 0 }}>
								Tauri 主应用负责 UI、设置、麦克风状态和编排；本地离线 ASR 当前固定为内置 sherpa-onnx，云端则保留火山与阿里云两条接口。
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
										删除档案
									</Button>
								) : <Box />}
								<Stack direction="row" spacing={0.5}>
									<Button size="small" onClick={handleDialogClose}>取消</Button>
									<Button size="small" variant="contained" onClick={handleDialogSave}>保存</Button>
								</Stack>
							</Stack>

							{confirmDeleteOpen && editingProfile && (
								<Box sx={{ bgcolor: "background.default", border: "1px solid", borderColor: "error.main", borderRadius: 1, p: 1.5 }}>
									<Stack direction="row" spacing={0.5} alignItems="center">
										<WarningIcon sx={{ fontSize: 14, color: "error.main" }} />
										<Typography variant="subtitle2" sx={{ color: "error.main" }}>删除此档案将无法恢复</Typography>
									</Stack>
									<Stack direction="row" spacing={0.5} justifyContent="flex-end">
										<Button
											size="small"
											variant="contained"
											color="error"
											disabled={deleteCountdown > 0}
											onClick={() => void handleDelete(editingProfile.id)}
										>
											{deleteCountdown > 0 ? `确认删除 (${deleteCountdown}s)` : "确认删除"}
										</Button>
										<Button size="small" onClick={() => setConfirmDeleteOpen(false)}>取消</Button>
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
