import { useState } from "react";
import { Box, Button, ButtonGroup } from "@mui/material";
import { useI18n } from "@/contexts/I18nProvider";
import { FunctionalPanel } from "./FunctionalPanel";
import { CompanionWorkbenchPanel } from "./CompanionWorkbenchPanel";
import { PanelRoot } from "./panel-shell";
import { WorkbenchMcpQuickActions } from "./WorkbenchMcpQuickActions";

export function WorkbenchPanel() {
	const { t } = useI18n();
	const [section, setSection] = useState<"companion" | "functional">("companion");

	return (
		<Box sx={{ height: "100%", display: "flex", flexDirection: "column", minHeight: 0, overflow: "hidden" }}>
			<PanelRoot title={t("高级诊断面板", "Advanced Diagnostics")}>
				<ButtonGroup size="small" fullWidth>
					<Button variant={section === "companion" ? "contained" : "outlined"} onClick={() => setSection("companion")}>
						{t("陪伴", "Companion")}
					</Button>
					<Button variant={section === "functional" ? "contained" : "outlined"} onClick={() => setSection("functional")}>
						{t("功能", "Functional")}
					</Button>
				</ButtonGroup>
				<Box sx={{ mt: 0.75, fontSize: 11, color: "text.secondary" }}>
					{t("用于调试与答辩检查，默认日常使用可不打开。", "For diagnostics and demo inspection; optional for normal use.")}
				</Box>
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
			</Box>
		</Box>
	);
}
