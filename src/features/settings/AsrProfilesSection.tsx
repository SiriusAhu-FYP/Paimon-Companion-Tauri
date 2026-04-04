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
	type ASRModelSource,
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
	"openai-compatible": "OpenAI 兼容接口",
	"faster-whisper-local": "Faster-Whisper 本地服务",
	volcengine: "火山引擎 ASR",
	aliyun: "阿里云 ASR",
};

const sourceLabels: Record<ASRModelSource, string> = {
	cloud: "云端托管",
	"local-path": "指定本地模型路径",
	download: "设置中下载到本地",
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
		provider: "openai-compatible",
		apiKey: "",
		baseUrl: "",
		model: "",
		language: "zh",
		autoDetectLanguage: false,
		modelSource: "cloud",
		modelPath: "",
		downloadUrl: "",
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
		editingProfile?.provider === "openai-compatible"
		|| editingProfile?.provider === "volcengine"
		|| editingProfile?.provider === "aliyun";
	const isLocalProvider = editingProfile?.provider === "faster-whisper-local";

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
				ASR 现在已经接入麦克风/VAD/上传链路，但本地重模型仍不默认打进安装包。推荐通过云接口或本地 sidecar / 本地已有模型路径接入。
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

							{editingProfile.provider !== "mock" && (
								<TextField
									size="small"
									fullWidth
									label="服务地址"
									value={editingProfile.baseUrl}
									onChange={(event) => setEditingProfile({ ...editingProfile, baseUrl: event.target.value })}
									helperText={isLocalProvider ? "本地 Python/Rust sidecar 或 HTTP 服务地址" : "云端 ASR 接口基地址"}
								/>
							)}

							<TextField
								size="small"
								fullWidth
								label="模型名"
								value={editingProfile.model}
								onChange={(event) => setEditingProfile({ ...editingProfile, model: event.target.value })}
							/>

							<Stack direction="row" spacing={0.5}>
								<TextField
									size="small"
									fullWidth
									label="语言"
									value={editingProfile.language}
									onChange={(event) => setEditingProfile({ ...editingProfile, language: event.target.value })}
									helperText="例如 zh / en / ja"
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

							<Select
								size="small"
								fullWidth
								value={editingProfile.modelSource}
								onChange={(event: SelectChangeEvent) => setEditingProfile({
									...editingProfile,
									modelSource: event.target.value as ASRModelSource,
								})}
							>
								{Object.entries(sourceLabels).map(([value, label]) => (
									<MenuItem key={value} value={value}>{label}</MenuItem>
								))}
							</Select>

							{editingProfile.modelSource === "local-path" && (
								<TextField
									size="small"
									fullWidth
									label="本地模型路径"
									value={editingProfile.modelPath}
									onChange={(event) => setEditingProfile({ ...editingProfile, modelPath: event.target.value })}
									helperText="先支持手填路径；文件选择器可后续接入"
								/>
							)}

							{editingProfile.modelSource === "download" && (
								<>
									<TextField
										size="small"
										fullWidth
										label="下载地址"
										value={editingProfile.downloadUrl}
										onChange={(event) => setEditingProfile({ ...editingProfile, downloadUrl: event.target.value })}
									/>
									<TextField
										size="small"
										fullWidth
										label="下载目标路径"
										value={editingProfile.modelPath}
										onChange={(event) => setEditingProfile({ ...editingProfile, modelPath: event.target.value })}
										helperText="后续下载器会把模型放到这里或应用数据目录下"
									/>
								</>
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
								Tauri 主应用负责 UI、设置、麦克风状态和编排；本地重模型优先通过外部 Python/本地服务接入，而不是直接打包进桌面应用。
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
