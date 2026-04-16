import { useState, type ComponentProps } from "react";
import { Box, Button, ButtonGroup } from "@mui/material";
import { useI18n } from "@/contexts/I18nProvider";
import { StageHost } from "@/features/stage";
import { FunctionalPanel } from "./FunctionalPanel";
import { CompanionWorkbenchPanel } from "./CompanionWorkbenchPanel";
import { PanelRoot } from "./panel-shell";
import { EventLog } from "@/app/EventLog";

type StageHostProps = ComponentProps<typeof StageHost>;

export function WorkbenchPanel(props: {
	stageHostProps: StageHostProps;
}) {
	const { t } = useI18n();
	const [section, setSection] = useState<"companion" | "stage" | "functional" | "logs">("companion");

	return (
		<Box sx={{ height: "100%", display: "flex", flexDirection: "column", minHeight: 0 }}>
			<PanelRoot title={t("开发工作台", "Developer Workbench")}>
				<ButtonGroup size="small" fullWidth sx={{ mb: 1 }}>
					<Button variant={section === "companion" ? "contained" : "outlined"} onClick={() => setSection("companion")}>
						{t("陪伴", "Companion")}
					</Button>
					<Button variant={section === "stage" ? "contained" : "outlined"} onClick={() => setSection("stage")}>
						{t("舞台", "Stage")}
					</Button>
					<Button variant={section === "functional" ? "contained" : "outlined"} onClick={() => setSection("functional")}>
						{t("功能", "Functional")}
					</Button>
					<Button variant={section === "logs" ? "contained" : "outlined"} onClick={() => setSection("logs")}>
						{t("日志", "Logs")}
					</Button>
				</ButtonGroup>
			</PanelRoot>

			<Box sx={{ flex: 1, minHeight: 0, overflowY: section === "logs" ? "hidden" : "auto" }}>
				{section === "companion" && <CompanionWorkbenchPanel />}
				{section === "stage" && <StageHost {...props.stageHostProps} variant="developer" />}
				{section === "functional" && <FunctionalPanel />}
				{section === "logs" && (
					<Box sx={{ height: "100%", minHeight: 0 }}>
						<EventLog />
					</Box>
				)}
			</Box>
		</Box>
	);
}
