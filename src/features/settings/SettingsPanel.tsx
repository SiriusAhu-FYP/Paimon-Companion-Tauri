import { useState, useEffect, useCallback } from "react";
import {
	Box, Button, Typography, Stack, TextField, Select, MenuItem,
	Divider, Alert, IconButton, Tooltip,
	Popover,
	type SelectChangeEvent,
} from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import NetworkCheckIcon from "@mui/icons-material/NetworkCheck";
import VolumeUpIcon from "@mui/icons-material/VolumeUp";
import EditIcon from "@mui/icons-material/Edit";
import AddIcon from "@mui/icons-material/Add";
import WarningIcon from "@mui/icons-material/Warning";
import {
	type AppConfig, type LLMProviderType, type TTSProviderType,
	type LLMProfile, type TTSProfile,
	type TTSProviderConfig,
	DEFAULT_CONFIG, SECRET_KEYS,
	loadConfig, updateConfig,
	proxyRequest,
	setSecret, getSecret, deleteSecret,
} from "@/services/config";
import { createLogger } from "@/services/logger";
import { GptSovitsTTSService, MockTTSService, splitText, normalizeForSpeech, SpeechQueue } from "@/services/tts";
import { AudioPlayer } from "@/services/audio/audio-player";
import { checkLocalSherpaHealth } from "@/services/asr";
import { HelpTooltip } from "@/components";
import { useI18n } from "@/contexts/I18nProvider";
import { refreshProviders } from "@/services";
import { AsrProfilesSection } from "./AsrProfilesSection";

const log = createLogger("settings");

interface SettingsPanelProps {
	onClose?: () => void;
	embedded?: boolean;
}

export function SettingsPanel({ onClose, embedded = false }: SettingsPanelProps) {
	const { t } = useI18n();
	const [config, setConfig] = useState<AppConfig>(DEFAULT_CONFIG);
	const [message, setMessage] = useState<{ type: "success" | "error" | "info" | "warning"; text: string } | null>(null);
	const [llmTestResult, setLlmTestResult] = useState<{ ok: boolean; text: string } | null>(null);
	const [ttsTestResult, setTtsTestResult] = useState<{ ok: boolean; text: string } | null>(null);
	const [asrTestResult, setAsrTestResult] = useState<{ ok: boolean; text: string } | null>(null);
	const [testing, setTesting] = useState<"llm" | "tts" | "asr" | null>(null);
	const [ttsTestText, setTtsTestText] = useState(() => t("你好，我是测试文本", "Hello, this is a test sample."));
	const [ttsTesting, setTtsTesting] = useState(false);

	useEffect(() => {
		let cancelled = false;
		(async () => {
			const loaded = await loadConfig();
			if (cancelled) return;
			setConfig(loaded);
			log.info("settings loaded");
		})();
		return () => { cancelled = true; };
	}, []);

	/** 从激活的 LLM 档案或根配置中获取当前 LLM 配置 */
	const getActiveLlmConfig = useCallback(() => {
		if (config.activeLlmProfileId) {
			const profile = config.llmProfiles.find((p) => p.id === config.activeLlmProfileId);
			if (profile) return profile;
		}
		return config.llm;
	}, [config]);

	/** 从激活的 TTS 档案或根配置中获取当前 TTS 配置 */
	const getActiveTtsConfig = useCallback(() => {
		if (config.activeTtsProfileId) {
			const profile = config.ttsProfiles.find((p) => p.id === config.activeTtsProfileId);
			if (profile) {
				log.info("[settings] getActiveTtsConfig: using profile", {
					profileId: profile.id,
					name: profile.name,
					baseUrl: profile.baseUrl,
					gptPath: profile.gptWeightsPath,
					sovitsPath: profile.sovitsWeightsPath,
				});
				return profile;
			}
		}
		log.info("[settings] getActiveTtsConfig: no active profile, using config.tts", {
			ttsBaseUrl: config.tts.baseUrl,
		});
		return config.tts;
	}, [config]);

	const handleTestLLM = useCallback(async () => {
		setTesting("llm");
		setLlmTestResult(null);
		try {
			const llmCfg = getActiveLlmConfig();
			let base = (llmCfg.baseUrl || "").replace(/\/+$/, "");
			if (!base) {
				setLlmTestResult({ ok: false, text: t("请先在档案中配置 Base URL", "Please configure Base URL in the profile first") });
				return;
			}
			// 兼容有无 /v1 后缀
			if (!base.endsWith("/v1")) base += "/v1";
			const url = base + "/models";
			const profileId = config.activeLlmProfileId || null;
			const resp = await proxyRequest({
				url,
				method: "GET",
				headers: { "Content-Type": "application/json" },
				secretKey: profileId ? SECRET_KEYS.LLM_API_KEY(profileId) : undefined,
				timeoutMs: 10000,
			});
			if (resp.status >= 200 && resp.status < 400) {
				setLlmTestResult({ ok: true, text: t(`连接成功 (HTTP ${resp.status})`, `Connected successfully (HTTP ${resp.status})`) });
				log.info("LLM connection test passed", { status: resp.status });
			} else {
				setLlmTestResult({ ok: false, text: `HTTP ${resp.status}: ${resp.body.slice(0, 100)}` });
			}
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			setLlmTestResult({ ok: false, text: msg });
			log.warn("LLM connection test failed", msg);
		} finally {
			setTesting(null);
		}
	}, [getActiveLlmConfig, config.activeLlmProfileId]);

	const handleTestTTS = useCallback(async () => {
		setTesting("tts");
		setTtsTestResult(null);
		try {
			const ttsCfg = getActiveTtsConfig();
			if (!ttsCfg.baseUrl || !ttsCfg.baseUrl.trim()) {
				setTtsTestResult({ ok: false, text: t("请先在档案中配置服务地址", "Please configure service URL in the profile first") });
				return;
			}
			const base = ttsCfg.baseUrl.replace(/\/+$/, "");
			const testUrl = `${base}/set_gpt_weights?weights_path=/tmp/dummy`;
			const resp = await proxyRequest({
				url: testUrl,
				method: "GET",
				timeoutMs: 8000,
			});
			setTtsTestResult({ ok: true, text: t(`服务可达 (HTTP ${resp.status})`, `Service reachable (HTTP ${resp.status})`) });
			log.info("TTS connection test passed", { status: resp.status });
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			setTtsTestResult({ ok: false, text: msg });
			log.warn("TTS connection test failed", msg);
		} finally {
			setTesting(null);
		}
	}, [getActiveTtsConfig]);

	const handleTestTTSDirect = useCallback(async () => {
		if (!ttsTestText.trim()) return;

		setTtsTesting(true);
		setMessage(null);
		try {
			const ttsCfg = getActiveTtsConfig();
			if (!ttsCfg.baseUrl || !ttsCfg.baseUrl.trim()) {
				setMessage({ type: "error", text: t("请先在档案中配置服务地址", "Please configure service URL in the profile first") });
				return;
			}
			let ttsService: GptSovitsTTSService | MockTTSService;
			if (ttsCfg.provider === "gpt-sovits") {
				ttsService = new GptSovitsTTSService(ttsCfg as unknown as TTSProviderConfig);
			} else {
				ttsService = new MockTTSService();
			}
			const player = new AudioPlayer();
			const queue = new SpeechQueue(ttsService, player, (speaking) => {
				if (speaking) {
					setMessage({ type: "info", text: t("正在播放语音...", "Playing audio...") });
				}
			});

			const spokenText = normalizeForSpeech(ttsTestText);
			const segments = splitText(spokenText);

			log.info("TTS test with full pipeline", {
				original: ttsTestText,
				spoken: spokenText,
				segments: segments.map((s) => `[${s.lang}]"${s.text.slice(0, 20)}"`),
			});

			if (!segments.length) {
				setMessage({ type: "error", text: t("切片结果为空，请检查输入文本", "No speech segments produced. Please check the input text.") });
				return;
			}

			const preview = segments
				.map((s) => `[${s.lang}]${s.text.slice(0, 15)}${s.text.length > 15 ? "…" : ""}`)
				.join(" | ");
			setMessage({ type: "success", text: t(`切片完成：${segments.length} 段，正在合成... — ${preview}`, `Segmentation complete: ${segments.length} parts, synthesizing... — ${preview}`) });

			const result = await queue.speakAll(segments);

			if (result.stopped) {
				setMessage({ type: "warning", text: t("播放已中断", "Playback interrupted") });
			} else if (result.playedSegments > 0) {
				setMessage({ type: "success", text: t(`播放完成 (${result.playedSegments}/${result.totalSegments} 段)`, `Playback finished (${result.playedSegments}/${result.totalSegments} segments)`) });
			} else if (result.errors.length > 0) {
				const firstErr = result.errors[0].length > 120 ? result.errors[0].slice(0, 120) + "…" : result.errors[0];
				setMessage({ type: "error", text: t(`合成失败: ${firstErr}`, `Synthesis failed: ${firstErr}`) });
			} else {
				setMessage({ type: "warning", text: t("合成完成但未能播放任何段落，请检查 TTS 配置", "Synthesis completed but nothing played. Please check the TTS configuration.") });
			}
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			setMessage({ type: "error", text: t(`TTS 测试失败: ${msg}`, `TTS test failed: ${msg}`) });
			log.error("TTS direct test failed", err);
		} finally {
			setTtsTesting(false);
		}
	}, [getActiveTtsConfig, ttsTestText]);

	const handleTestASR = useCallback(async () => {
		setTesting("asr");
		setAsrTestResult(null);
		try {
			const health = await checkLocalSherpaHealth();
			setAsrTestResult({
				ok: true,
				text: t(`本地模型已就绪：${health.modelName} @ ${health.modelDir}`, `Local model is ready: ${health.modelName} @ ${health.modelDir}`),
			});
			log.info("local sherpa healthcheck passed", health);
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			setAsrTestResult({ ok: false, text: msg });
			log.warn("ASR connection test failed", msg);
		} finally {
			setTesting(null);
		}
	}, [t]);

	const handleRuntimeConfigChange = useCallback(<K extends keyof AppConfig["companionRuntime"]>(
		key: K,
		value: AppConfig["companionRuntime"][K],
	) => {
		setConfig((current) => ({
			...current,
			companionRuntime: {
				...current.companionRuntime,
				[key]: value,
			},
		}));
	}, []);

	const handleSaveRuntimeConfig = useCallback(async () => {
		try {
			await updateConfig({ companionRuntime: { ...config.companionRuntime } });
			setMessage({ type: "success", text: t("运行时配置已保存。", "Runtime settings saved.") });
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			setMessage({ type: "error", text: msg });
		}
	}, [config.companionRuntime, t]);

	return (
		<Box sx={{ p: 1.5, display: "flex", flexDirection: "column", gap: 1, height: "100%", overflowY: "auto" }}>
			<Stack direction="row" alignItems="center" spacing={1}>
				{!embedded && onClose ? (
					<Tooltip title={t("返回控制面板", "Back to control panel")}>
						<IconButton size="small" onClick={onClose}>
							<ArrowBackIcon fontSize="small" />
						</IconButton>
					</Tooltip>
				) : null}
				<Typography variant="subtitle2" sx={{ color: "primary.main", fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5 }}>
					{t("设置", "Settings")}
				</Typography>
			</Stack>

		{message && (
			<Alert severity={message.type} onClose={() => setMessage(null)} sx={{ py: 0 }}>
				{message.text}
			</Alert>
		)}

		{/* ═══ 第一级：配置档案 ═══ */}

		{/* ── LLM 配置档案 ── */}
		<SectionTitle>{t("LLM 配置", "LLM Configuration")}</SectionTitle>
		<LLMProfilesSection
			profiles={config.llmProfiles}
			activeId={config.activeLlmProfileId}
			onAdd={(p) => setConfig((c) => ({ ...c, llmProfiles: [...c.llmProfiles, p] }))}
			onUpdate={(p) => setConfig((c) => ({ ...c, llmProfiles: c.llmProfiles.map((x) => x.id === p.id ? p : x) }))}
			onDelete={(id) => setConfig((c) => ({ ...c, llmProfiles: c.llmProfiles.filter((x) => x.id !== id), activeLlmProfileId: c.activeLlmProfileId === id ? "" : c.activeLlmProfileId }))}
			onSelect={(id) => { setConfig((c) => ({ ...c, activeLlmProfileId: id })); updateConfig({ activeLlmProfileId: id }); refreshProviders(); }}
			onPersist={async (newProfiles, newActiveId) => (await updateConfig({ llmProfiles: newProfiles, activeLlmProfileId: newActiveId }), refreshProviders())}
		/>

		<Divider />

		{/* ── TTS 配置档案 ── */}
		<SectionTitle>{t("TTS 配置", "TTS Configuration")}</SectionTitle>
		<TTSProfilesSection
			profiles={config.ttsProfiles}
			activeId={config.activeTtsProfileId}
			onAdd={(p) => setConfig((c) => ({ ...c, ttsProfiles: [...c.ttsProfiles, p] }))}
			onUpdate={(p) => setConfig((c) => ({ ...c, ttsProfiles: c.ttsProfiles.map((x) => x.id === p.id ? p : x) }))}
			onDelete={(id) => setConfig((c) => ({ ...c, ttsProfiles: c.ttsProfiles.filter((x) => x.id !== id), activeTtsProfileId: c.activeTtsProfileId === id ? "" : c.activeTtsProfileId }))}
			onSelect={(id) => { setConfig((c) => ({ ...c, activeTtsProfileId: id })); updateConfig({ activeTtsProfileId: id }); refreshProviders(); }}
			onPersist={async (newProfiles, newActiveId) => (await updateConfig({ ttsProfiles: newProfiles, activeTtsProfileId: newActiveId }), refreshProviders())}
		/>

		<Divider />

		<SectionTitle>
			{t("ASR 配置", "ASR Configuration")}
			<HelpTooltip title={t("ASR 当前固定为应用内置的 sherpa-onnx 双语模型；设置页只保留本地路线。", "ASR is fixed to the bundled sherpa-onnx bilingual model; settings now expose the local route only.")} />
		</SectionTitle>
		<AsrProfilesSection
			profiles={config.asrProfiles}
			activeId={config.activeAsrProfileId}
			onAdd={(profile) => setConfig((current) => ({ ...current, asrProfiles: [...current.asrProfiles, profile] }))}
			onUpdate={(profile) => setConfig((current) => ({
				...current,
				asrProfiles: current.asrProfiles.map((item) => item.id === profile.id ? profile : item),
			}))}
			onDelete={(id) => setConfig((current) => ({
				...current,
				asrProfiles: current.asrProfiles.filter((item) => item.id !== id),
				activeAsrProfileId: current.activeAsrProfileId === id ? "" : current.activeAsrProfileId,
			}))}
			onSelect={(id) => {
				setConfig((current) => ({ ...current, activeAsrProfileId: id }));
				updateConfig({ activeAsrProfileId: id });
				refreshProviders();
			}}
			onPersist={async (newProfiles, newActiveId) => {
				await updateConfig({ asrProfiles: newProfiles, activeAsrProfileId: newActiveId });
				refreshProviders();
			}}
		/>

		<Divider />

		<SectionTitle>
			{t("Companion Runtime", "Companion Runtime")}
			<HelpTooltip title={t("这里管理本地视觉观察链的地址、模型和时间窗口。日常实验里的启动/停止保留在 Workbench。", "Manage the local observation runtime address, model, and timing windows here. Day-to-day start/stop controls remain in Workbench.")} />
		</SectionTitle>
		<Box sx={{ bgcolor: "background.paper", borderRadius: 1, p: 1, display: "flex", flexDirection: "column", gap: 0.75 }}>
			<Stack direction="row" spacing={0.5}>
				<TextField
					size="small"
					fullWidth
					label={t("本地视觉 Base URL", "Local Vision Base URL")}
					value={config.companionRuntime.localVisionBaseUrl}
					onChange={(event) => handleRuntimeConfigChange("localVisionBaseUrl", event.target.value)}
				/>
				<TextField
					size="small"
					fullWidth
					label={t("本地视觉模型", "Local Vision Model")}
					value={config.companionRuntime.localVisionModel}
					onChange={(event) => handleRuntimeConfigChange("localVisionModel", event.target.value)}
				/>
			</Stack>
			<Stack direction="row" spacing={0.5}>
				<TextField
					size="small"
					fullWidth
					type="number"
					label={t("采样间隔(秒)", "Capture Interval (s)")}
					value={Math.round(config.companionRuntime.captureIntervalMs / 1000)}
					onChange={(event) => handleRuntimeConfigChange("captureIntervalMs", Math.max(1, Number(event.target.value) || 1) * 1000)}
				/>
				<TextField
					size="small"
					fullWidth
					type="number"
					label={t("总结窗口(秒)", "Summary Window (s)")}
					value={Math.round(config.companionRuntime.summaryWindowMs / 1000)}
					onChange={(event) => handleRuntimeConfigChange("summaryWindowMs", Math.max(1, Number(event.target.value) || 1) * 1000)}
				/>
				<TextField
					size="small"
					fullWidth
					type="number"
					label={t("历史保留(秒)", "History Retention (s)")}
					value={Math.round(config.companionRuntime.historyRetentionMs / 1000)}
					onChange={(event) => handleRuntimeConfigChange("historyRetentionMs", Math.max(1, Number(event.target.value) || 1) * 1000)}
				/>
			</Stack>
			<Button size="small" variant="outlined" onClick={() => { void handleSaveRuntimeConfig(); }} sx={{ alignSelf: "flex-start" }}>
				{t("保存运行时配置", "Save Runtime Settings")}
			</Button>
		</Box>

		{/* ═══ 第二级：连接测试 ═══ */}
		<Box sx={{ mt: 1, pt: 1, borderTop: 2, borderColor: "divider" }}>
			<Typography variant="caption" color="text.secondary" fontWeight={700} sx={{ textTransform: "uppercase", letterSpacing: 0.5, mb: 0.5, display: "block" }}>
				{t("连接测试", "Connection Tests")}
			</Typography>
		</Box>

		{/* ── LLM 测试 ── */}
		<SectionTitle>
			{t("ASR 测试", "ASR Test")}
			<HelpTooltip title={t("这里只做内置本地 sherpa-onnx 的健康检查。真正的麦克风 -> 识别链路仍需在聊天区手测。", "This only performs a health check for the bundled local sherpa-onnx route. The real microphone-to-ASR path still needs manual testing in chat.")} />
		</SectionTitle>
		<Box sx={{ bgcolor: "background.paper", borderRadius: 1, p: 1, display: "flex", flexDirection: "column", gap: 0.75 }}>
			<Typography variant="caption" color="text.secondary" sx={{ fontSize: 10 }}>
				{t("内置本地 sherpa-onnx 健康检查", "Built-in local sherpa-onnx health check")}
			</Typography>
			<Button
				size="small" variant="outlined"
				startIcon={<NetworkCheckIcon />}
				onClick={handleTestASR}
				disabled={testing === "asr"}
			>
				{testing === "asr" ? t("测试中...", "Testing...") : t("测试连接", "Test Connection")}
			</Button>
			{asrTestResult && (
				<Alert severity={asrTestResult.ok ? "success" : "error"} sx={{ py: 0, fontSize: 11 }}>
					{asrTestResult.text}
				</Alert>
			)}
		</Box>

		<Divider />

		{/* ── LLM 测试 ── */}
		<SectionTitle>
			{t("LLM 测试", "LLM Test")}
			<HelpTooltip title={t("选择或新建 LLM 档案并保存后，点击测试连接是否可达。", "Select or create an LLM profile, save it, then test connectivity.")} />
		</SectionTitle>
		<Box sx={{ bgcolor: "background.paper", borderRadius: 1, p: 1, display: "flex", flexDirection: "column", gap: 0.75 }}>
			<Typography variant="caption" color="text.secondary" sx={{ fontSize: 10 }}>
				{t("当前读取", "Using")}: {config.activeLlmProfileId
					? t(`档案「${config.llmProfiles.find((p) => p.id === config.activeLlmProfileId)?.name || "(未命名)"}」`, `Profile "${config.llmProfiles.find((p) => p.id === config.activeLlmProfileId)?.name || "(Unnamed)"}"`)
					: t("根配置（无激活档案）", "Root config (no active profile)")}
				· {getActiveLlmConfig().model || getActiveLlmConfig().provider}
			</Typography>
			<Button
				size="small" variant="outlined"
				startIcon={<NetworkCheckIcon />}
				onClick={handleTestLLM}
				disabled={testing === "llm"}
			>
				{testing === "llm" ? t("测试中...", "Testing...") : t("测试连接", "Test Connection")}
			</Button>
			{llmTestResult && (
				<Alert severity={llmTestResult.ok ? "success" : "error"} sx={{ py: 0, fontSize: 11 }}>
					{llmTestResult.text}
				</Alert>
			)}
		</Box>

		<Divider />

		{/* ── TTS 测试 ── */}
		<SectionTitle>
			{t("TTS 测试", "TTS Test")}
			<HelpTooltip title={t("选择或新建 TTS 档案并保存后，点击测试连接是否可达。", "Select or create a TTS profile, save it, then test connectivity.")} />
		</SectionTitle>
		<Box sx={{ bgcolor: "background.paper", borderRadius: 1, p: 1, display: "flex", flexDirection: "column", gap: 0.75 }}>
			<Typography variant="caption" color="text.secondary" sx={{ fontSize: 10 }}>
				{t("当前读取", "Using")}: {config.activeTtsProfileId
					? t(`档案「${config.ttsProfiles.find((p) => p.id === config.activeTtsProfileId)?.name || "(未命名)"}」`, `Profile "${config.ttsProfiles.find((p) => p.id === config.activeTtsProfileId)?.name || "(Unnamed)"}"`)
					: t("根配置（无激活档案）", "Root config (no active profile)")}
				· {getActiveTtsConfig().provider}
			</Typography>
			<Button
				size="small" variant="outlined"
				startIcon={<NetworkCheckIcon />}
				onClick={handleTestTTS}
				disabled={testing === "tts"}
			>
				{testing === "tts" ? t("测试中...", "Testing...") : t("测试连接", "Test Connection")}
			</Button>
			{ttsTestResult && (
				<Alert severity={ttsTestResult.ok ? "success" : "error"} sx={{ py: 0, fontSize: 11 }}>
					{ttsTestResult.text}
				</Alert>
			)}

			<Divider sx={{ my: 0.5 }} />

			<Typography variant="caption" color="text.secondary" sx={{ fontSize: 10 }}>{t("TTS 直测（合成并播放）", "Direct TTS Test (synthesize and play)")}</Typography>
			<TextField
				size="small" fullWidth
				placeholder={t("输入测试文本", "Enter test text")}
				value={ttsTestText}
				onChange={(e) => setTtsTestText(e.target.value)}
			/>
			<Button
				size="small" variant="contained"
				startIcon={<VolumeUpIcon />}
				onClick={handleTestTTSDirect}
				disabled={ttsTesting}
			>
				{ttsTesting ? t("合成中...", "Synthesizing...") : t("合成并播放", "Synthesize and Play")}
			</Button>
		</Box>

	</Box>
	);
}

function SectionTitle({ children }: { children: React.ReactNode }) {
	return (
		<Typography variant="caption" color="text.secondary" fontWeight={600} sx={{ display: "flex", alignItems: "center", gap: 0.25 }}>
			{children}
		</Typography>
	);
}

// ── LLM Profile 管理组件 ───────────────────────────────────────────────────

interface LLMProfilesSectionProps {
	profiles: LLMProfile[];
	activeId: string;
	onAdd: (p: LLMProfile) => void;
	onUpdate: (p: LLMProfile) => void;
	onDelete: (id: string) => void;
	onSelect: (id: string) => void;
	/** Popover 保存/删除后立即持久化（传入更新后的完整 profiles 数组） */
	onPersist: (newProfiles: LLMProfile[], newActiveId: string) => Promise<unknown>;
}

function LLMProfilesSection({ profiles, activeId, onAdd, onUpdate, onDelete, onSelect, onPersist }: LLMProfilesSectionProps) {
	const { t } = useI18n();
	const [dialogOpen, setDialogOpen] = useState(false);
	const [editingProfile, setEditingProfile] = useState<LLMProfile | null>(null);
	const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
	const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
	const [deleteCountdown, setDeleteCountdown] = useState(0);

	// 组件挂载时清理旧版全局 keyring 条目（key = "llm-api-key"）
	useEffect(() => {
		deleteSecret("llm-api-key").catch(() => { /* ignore if not exists */ });
	}, []);

	// 删除倒计时
	useEffect(() => {
		if (deleteCountdown <= 0) return;
		const timer = setTimeout(() => setDeleteCountdown((c) => c - 1), 1000);
		return () => clearTimeout(timer);
	}, [deleteCountdown]);

	const handleEdit = async (event: React.MouseEvent<HTMLElement>) => {
		if (activeId) {
			const profile = profiles.find((p) => p.id === activeId) ?? null;
			if (profile) {
				// 从 keyring 读取 API key 填入表单
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
		// API key 写入 per-profile keyring
		if (editingProfile.apiKey) {
			await setSecret(SECRET_KEYS.LLM_API_KEY(editingProfile.id), editingProfile.apiKey);
		}
		const exists = profiles.some((p) => p.id === editingProfile.id);
		let newProfiles: LLMProfile[];
		let newActiveId = activeId;
		// 保存时剔除 apiKey 明文（key 已在 keyring）
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
		// 删除 keyring 中的 key
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
							<TextField size="small" fullWidth label={t("API Key", "API Key")} type="password" value={editingProfile.apiKey ?? ""}
								onChange={(e) => setEditingProfile({ ...editingProfile, apiKey: e.target.value })}
								helperText={t("密钥将安全存储在系统钥匙串中", "Secrets are stored securely in the system keychain")} />
							<TextField size="small" fullWidth label={t("Base URL", "Base URL")} value={editingProfile.baseUrl}
								onChange={(e) => setEditingProfile({ ...editingProfile, baseUrl: e.target.value })}
								helperText={t("支持是否带 /v1 后缀", "Supports URLs with or without /v1")} />
							<TextField size="small" fullWidth label={t("模型名称", "Model Name")} value={editingProfile.model}
								onChange={(e) => setEditingProfile({ ...editingProfile, model: e.target.value })} />
							<Stack direction="row" spacing={0.5}>
								<TextField size="small" fullWidth label={t("Temperature", "Temperature")} type="number"
									slotProps={{ htmlInput: { min: 0, max: 2, step: 0.1 } }}
									value={editingProfile.temperature}
									onChange={(e) => setEditingProfile({ ...editingProfile, temperature: parseFloat(e.target.value) || 0.7 })} />
								<TextField size="small" fullWidth label={t("Max Tokens", "Max Tokens")} type="number"
									slotProps={{ htmlInput: { min: 100, max: 16384, step: 256 } }}
									value={editingProfile.maxTokens}
									onChange={(e) => setEditingProfile({ ...editingProfile, maxTokens: parseInt(e.target.value) || 2048 })} />
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
											size="small" variant="contained" color="error"
											disabled={deleteCountdown > 0}
											onClick={() => { setConfirmDeleteOpen(false); handleDelete(editingProfile.id); }}
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

// ── TTS Profile 管理组件 ───────────────────────────────────────────────────

interface TTSProfilesSectionProps {
	profiles: TTSProfile[];
	activeId: string;
	onAdd: (p: TTSProfile) => void;
	onUpdate: (p: TTSProfile) => void;
	onDelete: (id: string) => void;
	onSelect: (id: string) => void;
	/** Popover 保存/删除后立即持久化（传入更新后的完整 profiles 数组） */
	onPersist: (newProfiles: TTSProfile[], newActiveId: string) => Promise<unknown>;
}

function TTSProfilesSection({ profiles, activeId, onAdd, onUpdate, onDelete, onSelect, onPersist }: TTSProfilesSectionProps) {
	const { t } = useI18n();
	const [dialogOpen, setDialogOpen] = useState(false);
	const [editingProfile, setEditingProfile] = useState<TTSProfile | null>(null);
	const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
	const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
	const [deleteCountdown, setDeleteCountdown] = useState(0);

	// 删除倒计时
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
								onChange={(e) => setEditingProfile({ ...editingProfile, name: e.target.value })} />
							<Select size="small" fullWidth label={t("Provider", "Provider")}
								value={editingProfile.provider}
								onChange={(e: SelectChangeEvent) => setEditingProfile({ ...editingProfile, provider: e.target.value as TTSProviderType })}>
								<MenuItem value="mock">{t("Mock（模拟）", "Mock")}</MenuItem>
								<MenuItem value="gpt-sovits">GPT-SoVITS</MenuItem>
							</Select>
							<TextField size="small" fullWidth label={t("服务地址", "Service URL")}
								value={editingProfile.baseUrl}
								onChange={(e) => setEditingProfile({ ...editingProfile, baseUrl: e.target.value })} />

							{isGptSovits && (
								<>
									<TextField size="small" fullWidth label={t("GPT 权重路径", "GPT Weights Path")}
										value={editingProfile.gptWeightsPath}
										onChange={(e) => setEditingProfile({ ...editingProfile, gptWeightsPath: e.target.value })} />
									<TextField size="small" fullWidth label={t("SoVITS 权重路径", "SoVITS Weights Path")}
										value={editingProfile.sovitsWeightsPath}
										onChange={(e) => setEditingProfile({ ...editingProfile, sovitsWeightsPath: e.target.value })} />
									<TextField size="small" fullWidth label={t("参考音频路径", "Reference Audio Path")}
										value={editingProfile.refAudioPath}
										onChange={(e) => setEditingProfile({ ...editingProfile, refAudioPath: e.target.value })} />
									<TextField size="small" fullWidth label={t("参考音频文本", "Reference Audio Text")}
										value={editingProfile.promptText}
										onChange={(e) => setEditingProfile({ ...editingProfile, promptText: e.target.value })} />
									<Stack direction="row" spacing={0.5}>
										<Select size="small" sx={{ flex: 1 }} label={t("参考语言", "Reference Language")}
											value={editingProfile.promptLang}
											onChange={(e: SelectChangeEvent) => setEditingProfile({ ...editingProfile, promptLang: e.target.value })}>
											<MenuItem value="zh">{t("中文", "Chinese")}</MenuItem>
											<MenuItem value="en">English</MenuItem>
											<MenuItem value="ja">{t("日语", "Japanese")}</MenuItem>
										</Select>
										<Select size="small" sx={{ flex: 1 }} label={t("合成语言", "Synthesis Language")}
											value={editingProfile.textLang}
											onChange={(e: SelectChangeEvent) => setEditingProfile({ ...editingProfile, textLang: e.target.value })}>
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
											size="small" variant="contained" color="error"
											disabled={deleteCountdown > 0}
											onClick={() => { setConfirmDeleteOpen(false); handleDelete(editingProfile.id); }}
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

