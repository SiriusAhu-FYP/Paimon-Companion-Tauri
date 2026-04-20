import { useState } from "react";
import { Box, Button, ButtonGroup } from "@mui/material";
import { useI18n } from "@/contexts/I18nProvider";
import { useCompanionRuntime, useCompanionRuntimeBenchmark, useFunctional } from "@/hooks";
import { CompanionRuntimeSection } from "./CompanionRuntimeSection";
import { FunctionalPanel } from "./FunctionalPanel";
import { CompanionWorkbenchPanel } from "./CompanionWorkbenchPanel";
import { PanelRoot } from "./panel-shell";

export function WorkbenchPanel() {
	const { t } = useI18n();
	const { state: functionalState } = useFunctional();
	const {
		state: companionRuntimeState,
		start: startCompanionRuntime,
		stop: stopCompanionRuntime,
		clearHistory: clearCompanionRuntimeHistory,
		runSummaryNow,
		testLocalVisionConnection,
		updateRuntimeConfig,
	} = useCompanionRuntime();
	const {
		state: companionRuntimeBenchmarkState,
		runBenchmark: runCompanionRuntimeBenchmark,
	} = useCompanionRuntimeBenchmark();
	const [section, setSection] = useState<"companion" | "functional">("companion");

	return (
		<Box sx={{ height: "100%", display: "flex", flexDirection: "column", minHeight: 0, overflow: "hidden" }}>
			<PanelRoot title={t("开发工作台", "Developer Workbench")}>
				<Box sx={{ maxHeight: 340, overflowY: "auto", pr: 0.5 }}>
					<CompanionRuntimeSection
						functionalState={functionalState}
						companionRuntimeState={companionRuntimeState}
						companionRuntimeBenchmarkState={companionRuntimeBenchmarkState}
						onStart={startCompanionRuntime}
						onStop={stopCompanionRuntime}
						onClearHistory={clearCompanionRuntimeHistory}
						onRunSummaryNow={runSummaryNow}
						onTestConnection={testLocalVisionConnection}
						onRunBenchmark={runCompanionRuntimeBenchmark}
						onUpdateConfig={updateRuntimeConfig}
					/>
				</Box>
			</PanelRoot>

			<Box sx={{ px: 1.5, pb: 1, flexShrink: 0 }}>
				<ButtonGroup size="small" fullWidth>
					<Button variant={section === "companion" ? "contained" : "outlined"} onClick={() => setSection("companion")}>
						{t("陪伴", "Companion")}
					</Button>
					<Button variant={section === "functional" ? "contained" : "outlined"} onClick={() => setSection("functional")}>
						{t("功能", "Functional")}
					</Button>
				</ButtonGroup>
			</Box>

			<Box
				sx={{
					flex: 1,
					minHeight: 0,
					display: "flex",
					flexDirection: "column",
					overflow: "hidden",
					borderTop: "1px solid",
					borderColor: "divider",
				}}
			>
				<Box sx={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
					{section === "companion" && <CompanionWorkbenchPanel />}
					{section === "functional" && <FunctionalPanel />}
				</Box>
			</Box>
		</Box>
	);
}
