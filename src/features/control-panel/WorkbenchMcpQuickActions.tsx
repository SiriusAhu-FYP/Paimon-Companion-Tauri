import { useCallback, useState } from "react";
import { Alert, Button, Stack, Typography } from "@mui/material";
import { useI18n } from "@/contexts/I18nProvider";
import { callLocalMcpToolJson } from "@/services/mcp/local-mcp-client";
import { chooseWindowByKeywords } from "@/services/games/game-utils";
import type { FunctionalTarget, HostWindowInfo } from "@/types";
import { PanelCard } from "./panel-shell";

const DEFAULT_GOOGLE_URL = "https://www.google.com";

interface HostListWindowsResult {
	total: number;
	returned: number;
	windows: HostWindowInfo[];
}

function pickFirefoxWindow(windows: HostWindowInfo[]): HostWindowInfo | null {
	const preferred = chooseWindowByKeywords(windows, {
		keywords: ["firefox", "mozilla firefox", "github"],
		processKeywords: ["firefox", "zen"],
		visibleBonus: 2,
		normalBonus: 2,
	});
	if (preferred) {
		return preferred;
	}

	return windows.find((windowInfo) => (
		windowInfo.visible
		&& !windowInfo.minimized
		&& (windowInfo.processName.toLowerCase().includes("firefox") || windowInfo.processName.toLowerCase().includes("zen"))
	)) ?? null;
}

function stringifyError(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}

export function WorkbenchMcpQuickActions() {
	const { t } = useI18n();
	const [busy, setBusy] = useState(false);
	const [target, setTarget] = useState<FunctionalTarget | null>(null);
	const [status, setStatus] = useState<{ type: "success" | "error"; text: string } | null>(null);

	const resolveFirefoxTarget = useCallback(async (): Promise<FunctionalTarget> => {
		const result = await callLocalMcpToolJson<HostListWindowsResult>(
			"host.list_windows",
			{ query: "firefox", limit: 80 },
			{ timeoutMs: 15_000 },
		);
		const picked = pickFirefoxWindow(result.windows ?? []);
		if (!picked) {
			throw new Error(t("未找到可用的 Firefox 窗口。", "No eligible Firefox window found."));
		}

		const nextTarget: FunctionalTarget = { handle: picked.handle, title: picked.title };
		setTarget(nextTarget);
		return nextTarget;
	}, [t]);

	const ensureTarget = useCallback(async (): Promise<FunctionalTarget> => {
		if (target) {
			return target;
		}
		return resolveFirefoxTarget();
	}, [resolveFirefoxTarget, target]);

	const runFocusTarget = useCallback(async (focusTarget: FunctionalTarget, applyDelegatedViewport: boolean) => {
		await callLocalMcpToolJson<Record<string, unknown>>(
			"host.focus_window",
			{
				targetHandle: focusTarget.handle,
				targetTitle: focusTarget.title,
				applyDelegatedViewport,
			},
			{ timeoutMs: 20_000 },
		);
	}, []);

	const run = useCallback(async (action: () => Promise<void>) => {
		if (busy) {
			return;
		}
		setBusy(true);
		setStatus(null);
		try {
			await action();
		} catch (err) {
			setStatus({ type: "error", text: stringifyError(err) });
		} finally {
			setBusy(false);
		}
	}, [busy]);

	const handleFocusFirefox = useCallback(() => {
		void run(async () => {
			const current = await resolveFirefoxTarget();
			await runFocusTarget(current, true);
			setStatus({ type: "success", text: `${t("已聚焦", "Focused")} ${current.title}` });
		});
	}, [resolveFirefoxTarget, run, runFocusTarget, t]);

	const handleCtrlL = useCallback(() => {
		void run(async () => {
			const current = await ensureTarget();
			await runFocusTarget(current, false);
			await callLocalMcpToolJson<Record<string, unknown>>(
				"host.send_key",
				{
					key: "Ctrl+L",
					targetHandle: current.handle,
					targetTitle: current.title,
				},
				{ timeoutMs: 20_000 },
			);
			setStatus({ type: "success", text: t("已发送 Ctrl+L。", "Ctrl+L sent.") });
		});
	}, [ensureTarget, run, runFocusTarget, t]);

	const handleAltD = useCallback(() => {
		void run(async () => {
			const current = await ensureTarget();
			await runFocusTarget(current, false);
			await callLocalMcpToolJson<Record<string, unknown>>(
				"host.send_key",
				{
					key: "Alt+d",
					targetHandle: current.handle,
					targetTitle: current.title,
				},
				{ timeoutMs: 20_000 },
			);
			setStatus({ type: "success", text: t("已发送 Alt+D。", "Alt+D sent.") });
		});
	}, [ensureTarget, run, runFocusTarget, t]);

	const handlePasteGoogle = useCallback(() => {
		void run(async () => {
			const current = await ensureTarget();
			await runFocusTarget(current, false);
			await callLocalMcpToolJson<Record<string, unknown>>(
				"host.paste_text",
				{
					text: DEFAULT_GOOGLE_URL,
					targetHandle: current.handle,
					targetTitle: current.title,
				},
				{ timeoutMs: 20_000 },
			);
			setStatus({ type: "success", text: t("已粘贴 Google URL。", "Google URL pasted.") });
		});
	}, [ensureTarget, run, runFocusTarget, t]);

	const handleEnter = useCallback(() => {
		void run(async () => {
			const current = await ensureTarget();
			await runFocusTarget(current, false);
			await callLocalMcpToolJson<Record<string, unknown>>(
				"host.send_key",
				{
					key: "Enter",
					targetHandle: current.handle,
					targetTitle: current.title,
				},
				{ timeoutMs: 20_000 },
			);
			setStatus({ type: "success", text: t("已发送 Enter。", "Enter sent.") });
		});
	}, [ensureTarget, run, runFocusTarget, t]);

	const handleRunAll = useCallback(() => {
		void run(async () => {
			const current = await resolveFirefoxTarget();
			await runFocusTarget(current, true);
			await callLocalMcpToolJson<Record<string, unknown>>(
				"host.send_key",
				{ key: "Ctrl+L", targetHandle: current.handle, targetTitle: current.title },
				{ timeoutMs: 20_000 },
			);
			await callLocalMcpToolJson<Record<string, unknown>>(
				"host.paste_text",
				{ text: DEFAULT_GOOGLE_URL, targetHandle: current.handle, targetTitle: current.title },
				{ timeoutMs: 20_000 },
			);
			await callLocalMcpToolJson<Record<string, unknown>>(
				"host.send_key",
				{ key: "Enter", targetHandle: current.handle, targetTitle: current.title },
				{ timeoutMs: 20_000 },
			);
			setStatus({ type: "success", text: t("四步动作已执行。", "4-step action sequence executed.") });
		});
	}, [resolveFirefoxTarget, run, runFocusTarget, t]);

	return (
		<PanelCard compact>
			<Typography variant="caption" color="text.secondary" fontWeight={700} sx={{ display: "block", mb: 0.5 }}>
				{t("临时 MCP 快捷操作", "Temporary MCP Quick Actions")}
			</Typography>
			<Stack direction="row" spacing={0.5} sx={{ flexWrap: "wrap", mb: 0.5 }}>
				<Button size="small" variant="outlined" onClick={handleFocusFirefox} disabled={busy}>
					{t("聚焦 Firefox", "Focus Firefox")}
				</Button>
				<Button size="small" variant="outlined" onClick={handleCtrlL} disabled={busy}>
					Ctrl+L
				</Button>
				<Button size="small" variant="outlined" onClick={handleAltD} disabled={busy}>
					Alt+D
				</Button>
				<Button size="small" variant="outlined" onClick={handlePasteGoogle} disabled={busy}>
					{t("粘贴 Google", "Paste Google")}
				</Button>
				<Button size="small" variant="outlined" onClick={handleEnter} disabled={busy}>
					Enter
				</Button>
				<Button size="small" variant="contained" onClick={handleRunAll} disabled={busy}>
					{t("一键四步", "Run All 4")}
				</Button>
			</Stack>
			<Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
				{t("目标窗口", "Target")}：{target ? `${target.title} (${target.handle})` : t("未选择", "Not selected")}
			</Typography>
			{status && (
				<Alert severity={status.type} sx={{ mt: 0.5, py: 0 }}>
					{status.text}
				</Alert>
			)}
		</PanelCard>
	);
}
