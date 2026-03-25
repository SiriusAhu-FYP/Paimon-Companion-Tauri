import { useState, useEffect, useCallback } from "react";
import {
	Box, Button, Typography, Stack, TextField, Select, MenuItem,
	Divider, Alert, InputAdornment, IconButton, Tooltip,
	type SelectChangeEvent,
} from "@mui/material";
import VisibilityIcon from "@mui/icons-material/Visibility";
import VisibilityOffIcon from "@mui/icons-material/VisibilityOff";
import SaveIcon from "@mui/icons-material/Save";
import RestoreIcon from "@mui/icons-material/Restore";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import NetworkCheckIcon from "@mui/icons-material/NetworkCheck";
import VolumeUpIcon from "@mui/icons-material/VolumeUp";
import {
	type AppConfig, type LLMProviderType, type TTSProviderType,
	DEFAULT_CONFIG, SECRET_KEYS,
	loadConfig, updateConfig, resetConfig,
	hasSecret, setSecret, deleteSecret,
	proxyRequest,
} from "@/services/config";
import { createLogger } from "@/services/logger";
import { GptSovitsTTSService, MockTTSService } from "@/services/tts";
import { AudioPlayer } from "@/services/audio/audio-player";

const log = createLogger("settings");

interface SettingsPanelProps {
	onClose: () => void;
}

export function SettingsPanel({ onClose }: SettingsPanelProps) {
	const [config, setConfig] = useState<AppConfig>(DEFAULT_CONFIG);
	const [llmApiKey, setLlmApiKey] = useState("");
	const [ttsApiKey, setTtsApiKey] = useState("");
	const [llmKeyExists, setLlmKeyExists] = useState(false);
	const [showLlmKey, setShowLlmKey] = useState(false);
	const [saving, setSaving] = useState(false);
	const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
	const [llmTestResult, setLlmTestResult] = useState<{ ok: boolean; text: string } | null>(null);
	const [ttsTestResult, setTtsTestResult] = useState<{ ok: boolean; text: string } | null>(null);
	const [testing, setTesting] = useState<"llm" | "tts" | null>(null);
	const [ttsTestText, setTtsTestText] = useState("你好，我是测试文本");
	const [ttsTesting, setTtsTesting] = useState(false);

	useEffect(() => {
		let cancelled = false;
		(async () => {
			const loaded = await loadConfig();
			if (cancelled) return;
			setConfig(loaded);
			const llmHas = await hasSecret(SECRET_KEYS.LLM_API_KEY);
			if (cancelled) return;
			setLlmKeyExists(llmHas);
			log.info("settings loaded", { provider: loaded.llm.provider, llmKeyExists: llmHas });
		})();
		return () => { cancelled = true; };
	}, []);

	const handleSave = useCallback(async () => {
		setSaving(true);
		setMessage(null);
		try {
			await updateConfig(config);

			if (llmApiKey.trim()) {
				await setSecret(SECRET_KEYS.LLM_API_KEY, llmApiKey.trim());
				setLlmKeyExists(true);
				setLlmApiKey("");
			}

			if (ttsApiKey.trim()) {
				await setSecret(SECRET_KEYS.TTS_API_KEY, ttsApiKey.trim());
				setTtsApiKey("");
			}

			setMessage({ type: "success", text: "设置已保存" });
			log.info("settings saved");
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			setMessage({ type: "error", text: `保存失败: ${msg}` });
			log.error("settings save failed", err);
		} finally {
			setSaving(false);
		}
	}, [config, llmApiKey, ttsApiKey]);

	const handleReset = useCallback(async () => {
		const defaults = await resetConfig();
		setConfig(defaults);
		await deleteSecret(SECRET_KEYS.LLM_API_KEY);
		await deleteSecret(SECRET_KEYS.TTS_API_KEY);
		setLlmKeyExists(false);
		setLlmApiKey("");
		setTtsApiKey("");
		setMessage({ type: "success", text: "已恢复默认设置" });
	}, []);

	const updateLLM = useCallback((patch: Partial<AppConfig["llm"]>) => {
		setConfig((c) => ({ ...c, llm: { ...c.llm, ...patch } }));
	}, []);

	const updateTTS = useCallback((patch: Partial<AppConfig["tts"]>) => {
		setConfig((c) => ({ ...c, tts: { ...c.tts, ...patch } }));
	}, []);

	const updateCharacter = useCallback((patch: Partial<AppConfig["character"]>) => {
		setConfig((c) => ({ ...c, character: { ...c.character, ...patch } }));
	}, []);

	const handleTestLLM = useCallback(async () => {
		setTesting("llm");
		setLlmTestResult(null);
		try {
			const url = config.llm.baseUrl.replace(/\/+$/, "") + "/models";
			const needsKey = !isLocalUrl(config.llm.baseUrl);
			const resp = await proxyRequest({
				url,
				method: "GET",
				headers: { "Content-Type": "application/json" },
				secretKey: needsKey ? SECRET_KEYS.LLM_API_KEY : undefined,
				timeoutMs: 10000,
			});
			if (resp.status >= 200 && resp.status < 400) {
				setLlmTestResult({ ok: true, text: `连接成功 (HTTP ${resp.status})` });
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
	}, [config.llm.baseUrl]);

	const handleTestTTS = useCallback(async () => {
		setTesting("tts");
		setTtsTestResult(null);
		try {
			const base = (config.tts.baseUrl || "http://localhost:9880").replace(/\/+$/, "");

			// GPT-SoVITS /set_gpt_weights 需要 weights_path 参数才返回 200，空参数返回 400
			// 用一个肯定存在的路径做探测即可（路径是否存在不影响 HTTP 状态码）
			const testUrl = `${base}/set_gpt_weights?weights_path=/tmp/dummy`;
			const resp = await proxyRequest({
				url: testUrl,
				method: "GET",
				timeoutMs: 8000,
			});
			// 任何 HTTP 响应都说明服务器可达（GPT-SoVITS 不认识路径但会返回 200）
			setTtsTestResult({ ok: true, text: `服务可达 (HTTP ${resp.status})` });
			log.info("TTS connection test passed", { status: resp.status });
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			setTtsTestResult({ ok: false, text: msg });
			log.warn("TTS connection test failed", msg);
		} finally {
			setTesting(null);
		}
	}, [config.tts.baseUrl]);

	const handleTestTTSDirect = useCallback(async () => {
		if (!ttsTestText.trim()) return;
		
		setTtsTesting(true);
		try {
			let ttsService;
			if (config.tts.provider === "gpt-sovits") {
				ttsService = new GptSovitsTTSService(config.tts);
			} else {
				ttsService = new MockTTSService();
			}
			const player = new AudioPlayer();
			
			log.info("Testing TTS direct synthesis", { text: ttsTestText, lang: config.tts.textLang });
			const audio = await ttsService.synthesize(ttsTestText, { lang: config.tts.textLang });
			
			log.info("TTS synthesis successful", { audioLength: audio.byteLength });
			await player.play(audio);
			
			setMessage({ type: "success", text: "TTS 合成播放成功" });
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			setMessage({ type: "error", text: `TTS 测试失败: ${msg}` });
			log.error("TTS direct test failed", err);
		} finally {
			setTtsTesting(false);
		}
	}, [config.tts, ttsTestText]);

	const needsLlmKey = config.llm.provider !== "mock" && !llmKeyExists && !llmApiKey.trim();

	return (
		<Box sx={{ p: 1.5, display: "flex", flexDirection: "column", gap: 1, height: "100%", overflowY: "auto" }}>
			<Stack direction="row" alignItems="center" spacing={1}>
				<Tooltip title="返回控制面板">
					<IconButton size="small" onClick={onClose}>
						<ArrowBackIcon fontSize="small" />
					</IconButton>
				</Tooltip>
				<Typography variant="subtitle2" sx={{ color: "primary.main", fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5 }}>
					设置
				</Typography>
			</Stack>

			{message && (
				<Alert severity={message.type} onClose={() => setMessage(null)} sx={{ py: 0 }}>
					{message.text}
				</Alert>
			)}

			{/* LLM 设置 */}
			<SectionTitle>LLM 设置</SectionTitle>
			<Box sx={{ bgcolor: "background.paper", borderRadius: 1, p: 1, display: "flex", flexDirection: "column", gap: 0.75 }}>
				<FieldLabel>Provider</FieldLabel>
				<Select
					size="small"
					value={config.llm.provider}
					onChange={(e: SelectChangeEvent) => updateLLM({ provider: e.target.value as LLMProviderType })}
					fullWidth
				>
					<MenuItem value="mock">Mock（模拟）</MenuItem>
					<MenuItem value="openai-compatible">OpenAI 兼容 API</MenuItem>
				</Select>

				{config.llm.provider !== "mock" && (
					<>
						<FieldLabel>Base URL</FieldLabel>
						<TextField
							size="small" fullWidth
							placeholder="https://api.openai.com/v1"
							value={config.llm.baseUrl}
							onChange={(e) => updateLLM({ baseUrl: e.target.value })}
						/>

						<FieldLabel>模型名称</FieldLabel>
						<TextField
							size="small" fullWidth
							placeholder="gpt-4o"
							value={config.llm.model}
							onChange={(e) => updateLLM({ model: e.target.value })}
						/>

						<FieldLabel>API Key {llmKeyExists && <KeyBadge />}</FieldLabel>
						<TextField
							size="small" fullWidth
							type={showLlmKey ? "text" : "password"}
							placeholder={llmKeyExists ? "已保存（输入新值覆盖）" : "请输入 API Key"}
							value={llmApiKey}
							onChange={(e) => setLlmApiKey(e.target.value)}
							slotProps={{
								input: {
									endAdornment: (
										<InputAdornment position="end">
											<IconButton size="small" onClick={() => setShowLlmKey(!showLlmKey)}>
												{showLlmKey ? <VisibilityOffIcon fontSize="small" /> : <VisibilityIcon fontSize="small" />}
											</IconButton>
										</InputAdornment>
									),
								},
							}}
						/>

						{needsLlmKey && (
							<Alert severity="warning" sx={{ py: 0, fontSize: 12 }}>
								选择真实 LLM provider 需要配置 API Key
							</Alert>
						)}

						<Stack direction="row" spacing={1}>
							<Box sx={{ flex: 1 }}>
								<FieldLabel>Temperature</FieldLabel>
								<TextField
									size="small" fullWidth type="number"
									slotProps={{ htmlInput: { min: 0, max: 2, step: 0.1 } }}
									value={config.llm.temperature}
									onChange={(e) => updateLLM({ temperature: parseFloat(e.target.value) || 0.7 })}
								/>
							</Box>
							<Box sx={{ flex: 1 }}>
								<FieldLabel>Max Tokens</FieldLabel>
								<TextField
									size="small" fullWidth type="number"
									slotProps={{ htmlInput: { min: 100, max: 16384, step: 256 } }}
									value={config.llm.maxTokens}
									onChange={(e) => updateLLM({ maxTokens: parseInt(e.target.value) || 2048 })}
								/>
							</Box>
						</Stack>

						<Button
							size="small" variant="outlined"
							startIcon={<NetworkCheckIcon />}
							onClick={handleTestLLM}
							disabled={!config.llm.baseUrl || testing === "llm"}
						>
							{testing === "llm" ? "测试中..." : "测试连接"}
						</Button>
						{llmTestResult && (
							<Alert severity={llmTestResult.ok ? "success" : "error"} sx={{ py: 0, fontSize: 11 }}>
								{llmTestResult.text}
							</Alert>
						)}
					</>
				)}
			</Box>

			<Divider />

			{/* TTS 设置 */}
			<SectionTitle>TTS 设置</SectionTitle>
			<Box sx={{ bgcolor: "background.paper", borderRadius: 1, p: 1, display: "flex", flexDirection: "column", gap: 0.75 }}>
				<FieldLabel>Provider</FieldLabel>
				<Select
					size="small"
					value={config.tts.provider}
					onChange={(e: SelectChangeEvent) => updateTTS({ provider: e.target.value as TTSProviderType })}
					fullWidth
				>
					<MenuItem value="mock">Mock（模拟）</MenuItem>
					<MenuItem value="gpt-sovits">GPT-SoVITS</MenuItem>
				</Select>

				{config.tts.provider === "gpt-sovits" && (
					<>
						<FieldLabel>GPT-SoVITS 服务地址</FieldLabel>
						<TextField
							size="small" fullWidth
							placeholder="http://localhost:9880"
							value={config.tts.baseUrl}
							onChange={(e) => updateTTS({ baseUrl: e.target.value })}
						/>

						<FieldLabel>GPT 权重路径（服务端路径）</FieldLabel>
						<TextField
							size="small" fullWidth
							placeholder="/path/to/model.ckpt"
							value={config.tts.gptWeightsPath}
							onChange={(e) => updateTTS({ gptWeightsPath: e.target.value })}
						/>

						<FieldLabel>SoVITS 权重路径（服务端路径）</FieldLabel>
						<TextField
							size="small" fullWidth
							placeholder="/path/to/model.pth"
							value={config.tts.sovitsWeightsPath}
							onChange={(e) => updateTTS({ sovitsWeightsPath: e.target.value })}
						/>

						<FieldLabel>参考音频路径（服务端路径）</FieldLabel>
						<TextField
							size="small" fullWidth
							placeholder="/path/to/ref_audio.wav"
							value={config.tts.refAudioPath}
							onChange={(e) => updateTTS({ refAudioPath: e.target.value })}
						/>

						<FieldLabel>参考音频文本</FieldLabel>
						<TextField
							size="small" fullWidth
							placeholder="参考音频对应的文字内容"
							value={config.tts.promptText}
							onChange={(e) => updateTTS({ promptText: e.target.value })}
						/>

						<Stack direction="row" spacing={1}>
							<Box sx={{ flex: 1 }}>
								<FieldLabel>参考音频语言</FieldLabel>
								<Select
									size="small" fullWidth
									value={config.tts.promptLang}
									onChange={(e: SelectChangeEvent) => updateTTS({ promptLang: e.target.value })}
								>
									<MenuItem value="zh">中文</MenuItem>
									<MenuItem value="en">English</MenuItem>
									<MenuItem value="ja">日本語</MenuItem>
								</Select>
							</Box>
							<Box sx={{ flex: 1 }}>
								<FieldLabel>合成语言</FieldLabel>
								<Select
									size="small" fullWidth
									value={config.tts.textLang}
									onChange={(e: SelectChangeEvent) => updateTTS({ textLang: e.target.value })}
								>
									<MenuItem value="zh">中文</MenuItem>
									<MenuItem value="en">English</MenuItem>
									<MenuItem value="ja">日本語</MenuItem>
								</Select>
							</Box>
						</Stack>

						<Button
							size="small" variant="outlined"
							startIcon={<NetworkCheckIcon />}
							onClick={handleTestTTS}
							disabled={!config.tts.baseUrl || testing === "tts"}
						>
							{testing === "tts" ? "测试中..." : "测试连接"}
						</Button>
						{ttsTestResult && (
							<Alert severity={ttsTestResult.ok ? "success" : "error"} sx={{ py: 0, fontSize: 11 }}>
								{ttsTestResult.text}
							</Alert>
						)}

						<Divider sx={{ my: 1 }} />

						<FieldLabel>TTS 直测输入框</FieldLabel>
						<TextField
							size="small" fullWidth
							placeholder="输入测试文本"
							value={ttsTestText}
							onChange={(e) => setTtsTestText(e.target.value)}
						/>
						<Button
							size="small" variant="contained"
							startIcon={<VolumeUpIcon />}
							onClick={handleTestTTSDirect}
							disabled={!config.tts.baseUrl || ttsTesting}
						>
							{ttsTesting ? "合成中..." : "合成并播放"}
						</Button>
					</>
				)
				}
			</Box>

			<Divider />

			{/* 角色设置 */}
			<SectionTitle>角色设置</SectionTitle>
			<Box sx={{ bgcolor: "background.paper", borderRadius: 1, p: 1, display: "flex", flexDirection: "column", gap: 0.75 }}>
				<FieldLabel>角色人设</FieldLabel>
				<TextField
					size="small" fullWidth multiline minRows={3} maxRows={6}
					value={config.character.persona}
					onChange={(e) => updateCharacter({ persona: e.target.value })}
				/>
			</Box>

			{/* 操作按钮 */}
			<Stack direction="row" spacing={1} sx={{ mt: 1, flexShrink: 0 }}>
				<Button
					variant="contained" size="small" fullWidth
					startIcon={<SaveIcon />}
					onClick={handleSave}
					disabled={saving}
				>
					{saving ? "保存中..." : "保存"}
				</Button>
				<Button
					variant="outlined" size="small" color="warning"
					startIcon={<RestoreIcon />}
					onClick={handleReset}
				>
					重置
				</Button>
			</Stack>
		</Box>
	);
}

function SectionTitle({ children }: { children: React.ReactNode }) {
	return (
		<Typography variant="caption" color="text.secondary" fontWeight={600} sx={{ display: "block" }}>
			{children}
		</Typography>
	);
}

function FieldLabel({ children }: { children: React.ReactNode }) {
	return (
		<Typography variant="caption" color="text.secondary" sx={{ fontSize: 11 }}>
			{children}
		</Typography>
	);
}

function KeyBadge() {
	return (
		<Typography component="span" sx={{ fontSize: 10, color: "success.main", ml: 0.5 }}>
			(已保存)
		</Typography>
	);
}

function isLocalUrl(url: string): boolean {
	try {
		const u = new URL(url);
		const host = u.hostname;
		return host === "localhost" || host === "127.0.0.1" || host.startsWith("192.168.") || host.startsWith("10.") || host.endsWith(".local");
	} catch {
		return false;
	}
}
