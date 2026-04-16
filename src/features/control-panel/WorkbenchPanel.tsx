import { useState } from "react";
import { Box, Button, ButtonGroup } from "@mui/material";
import { useI18n } from "@/contexts/I18nProvider";
import { FunctionalPanel } from "./FunctionalPanel";
import { CompanionWorkbenchPanel } from "./CompanionWorkbenchPanel";
import { PanelRoot } from "./panel-shell";

export function WorkbenchPanel() {
	const { t } = useI18n();
	const [section, setSection] = useState<"companion" | "functional">("companion");

	return (
		<Box sx={{ height: "100%", display: "flex", flexDirection: "column", minHeight: 0 }}>
			<PanelRoot title={t("开发工作台", "Developer Workbench")}>
				<ButtonGroup size="small" fullWidth sx={{ mb: 1 }}>
					<Button variant={section === "companion" ? "contained" : "outlined"} onClick={() => setSection("companion")}>
						{t("陪伴", "Companion")}
					</Button>
					<Button variant={section === "functional" ? "contained" : "outlined"} onClick={() => setSection("functional")}>
						{t("功能", "Functional")}
					</Button>
				</ButtonGroup>
			</PanelRoot>

			<Box sx={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
				{section === "companion" && <CompanionWorkbenchPanel />}
				{section === "functional" && <FunctionalPanel />}
			</Box>
		</Box>
	);
}
