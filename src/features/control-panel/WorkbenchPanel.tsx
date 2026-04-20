import { useState } from "react";
import { Box, Button, ButtonGroup } from "@mui/material";
import { useI18n } from "@/contexts/I18nProvider";
import { useCompanionRuntime, useFunctional } from "@/hooks";
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
	} = useCompanionRuntime();
	const [section, setSection] = useState<"companion" | "functional">("companion");
	const [runtimeCollapsed, setRuntimeCollapsed] = useState(true);

	return (
		<Box sx={{ height: "100%", display: "flex", flexDirection: "column", minHeight: 0, overflow: "hidden" }}>
			<PanelRoot title={t("开发工作台", "Developer Workbench")}>
				<CompanionRuntimeSection
					functionalState={functionalState}
					companionRuntimeState={companionRuntimeState}
					onStart={startCompanionRuntime}
					onStop={stopCompanionRuntime}
					onClearHistory={clearCompanionRuntimeHistory}
					onRunSummaryNow={runSummaryNow}
					collapsed={runtimeCollapsed}
					onToggleCollapsed={() => setRuntimeCollapsed((current) => !current)}
				/>
				<ButtonGroup size="small" fullWidth>
					<Button variant={section === "companion" ? "contained" : "outlined"} onClick={() => setSection("companion")}>
						{t("陪伴", "Companion")}
					</Button>
					<Button variant={section === "functional" ? "contained" : "outlined"} onClick={() => setSection("functional")}>
						{t("功能", "Functional")}
					</Button>
				</ButtonGroup>
			</PanelRoot>

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
