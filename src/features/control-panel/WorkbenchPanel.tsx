import { lazy, Suspense, useState } from "react";
import { Box, Button, ButtonGroup, CircularProgress } from "@mui/material";
import { useI18n } from "@/contexts/I18nProvider";
import { FunctionalPanel } from "./FunctionalPanel";
import { CompanionWorkbenchPanel } from "./CompanionWorkbenchPanel";
import { PanelRoot } from "./panel-shell";
import { WorkbenchMcpQuickActions } from "./WorkbenchMcpQuickActions";

const DelegationTimelinePanel = lazy(() =>
	import("./DelegationTimelinePanel").then((m) => ({ default: m.DelegationTimelinePanel })),
);

type WorkbenchSection = "companion" | "functional" | "timeline";

export function WorkbenchPanel() {
	const { t } = useI18n();
	const [section, setSection] = useState<WorkbenchSection>("companion");

	return (
		<Box sx={{ height: "100%", display: "flex", flexDirection: "column", minHeight: 0, overflow: "hidden" }}>
			<PanelRoot title={t("开发工作台", "Developer Workbench")}>
				<ButtonGroup size="small" fullWidth>
					<Button variant={section === "companion" ? "contained" : "outlined"} onClick={() => setSection("companion")}>
						{t("陪伴", "Companion")}
					</Button>
					<Button variant={section === "functional" ? "contained" : "outlined"} onClick={() => setSection("functional")}>
						{t("功能", "Functional")}
					</Button>
					<Button variant={section === "timeline" ? "contained" : "outlined"} onClick={() => setSection("timeline")}>
						{t("时间轴", "Timeline")}
					</Button>
				</ButtonGroup>
				<WorkbenchMcpQuickActions />
			</PanelRoot>

			<Box
				sx={{
					flex: 1,
					minHeight: 0,
					borderTop: "1px solid",
					borderColor: "divider",
					overflowY: "auto",
				}}
			>
				{section === "companion" && <CompanionWorkbenchPanel />}
				{section === "functional" && <FunctionalPanel />}
				{section === "timeline" && (
					<Suspense fallback={<Box sx={{ p: 2, display: "flex", justifyContent: "center" }}><CircularProgress size={24} /></Box>}>
						<DelegationTimelinePanel />
					</Suspense>
				)}
			</Box>
		</Box>
	);
}
