import { Alert, Button, FormControlLabel, Stack, Switch, TextField } from "@mui/material";
import { useState } from "react";
import type { UnifiedRuntimeState } from "@/types";
import { InfoLine, PanelCard, SectionHeader, SectionStatusChip } from "./panel-shell";

export function UnifiedRunSection(props: {
	unifiedState: UnifiedRuntimeState;
	onRunUnified2048: () => Promise<unknown>;
	onSubmitVoiceText: (text: string) => Promise<unknown>;
	onSetSpeechEnabled: (enabled: boolean) => void;
	onSetVoiceInputEnabled: (enabled: boolean) => void;
	busy: boolean;
}) {
	const [voiceText, setVoiceText] = useState("帮我看一下 2048 下一步");
	const [error, setError] = useState<string | null>(null);

	return (
		<PanelCard compact>
			<SectionHeader
				title="Unified Run"
				subtitle="陪伴表达、表情和功能动作走同一条链"
				right={(
					<SectionStatusChip
						label={props.unifiedState.activeRunId ? props.unifiedState.phase : "就绪"}
						color={props.unifiedState.activeRunId ? "warning" : "default"}
					/>
				)}
			/>

			<Stack direction="row" spacing={0.5} sx={{ mb: 0.75, flexWrap: "wrap" }}>
				<Button
					size="small"
					variant="contained"
					onClick={async () => {
						setError(null);
						try {
							await props.onRunUnified2048();
						} catch (err) {
							setError(err instanceof Error ? err.message : String(err));
						}
					}}
					disabled={props.busy}
				>
					运行统一单步
				</Button>
			</Stack>

			<Stack direction="row" spacing={1} sx={{ mb: 0.75, flexWrap: "wrap", rowGap: 0.5 }}>
				<FormControlLabel
					control={(
						<Switch
							size="small"
							checked={props.unifiedState.speechEnabled}
							onChange={(_, checked) => props.onSetSpeechEnabled(checked)}
						/>
					)}
					label="自动播报"
				/>
				<FormControlLabel
					control={(
						<Switch
							size="small"
							checked={props.unifiedState.voiceInputEnabled}
							onChange={(_, checked) => props.onSetVoiceInputEnabled(checked)}
						/>
					)}
					label="语音入口"
				/>
			</Stack>

			<Stack direction="row" spacing={0.5} sx={{ mb: 0.75 }}>
				<TextField
					size="small"
					fullWidth
					value={voiceText}
					onChange={(event) => setVoiceText(event.target.value)}
					placeholder="模拟语音输入，例如：帮我看一下 2048 下一步"
					sx={{ "& .MuiInputBase-input": { fontSize: 12 } }}
				/>
				<Button
					size="small"
					variant="outlined"
					disabled={props.busy || !voiceText.trim()}
					onClick={async () => {
						setError(null);
						try {
							await props.onSubmitVoiceText(voiceText);
						} catch (err) {
							setError(err instanceof Error ? err.message : String(err));
						}
					}}
				>
					提交
				</Button>
			</Stack>

			{error && (
				<Alert severity="error" sx={{ mb: 0.75, py: 0 }}>
					{error}
				</Alert>
			)}

			<InfoLine>阶段：{props.unifiedState.phase}</InfoLine>
			<InfoLine>最近语音：{props.unifiedState.lastVoiceInput ?? "—"}</InfoLine>
			<InfoLine>最近命令：{props.unifiedState.lastCommand ?? "—"}</InfoLine>
			<InfoLine>最近播报：{props.unifiedState.lastCompanionText ?? "—"}</InfoLine>
			<InfoLine>
				最近统一结果：{props.unifiedState.lastRun?.summary ?? "尚未执行"}
			</InfoLine>
		</PanelCard>
	);
}
