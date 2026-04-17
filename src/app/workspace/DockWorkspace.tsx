import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from "react";
import {
	Actions,
	type BorderNode,
	Layout,
	Model,
	type Action,
	type ITabRenderValues,
	type ITabSetRenderValues,
	type TabNode,
	type TabSetNode,
} from "flexlayout-react";
import { Box } from "@mui/material";
import TuneIcon from "@mui/icons-material/Tune";
import AutoStoriesIcon from "@mui/icons-material/AutoStories";
import ScienceIcon from "@mui/icons-material/Science";
import SettingsIcon from "@mui/icons-material/Settings";
import TerminalIcon from "@mui/icons-material/Terminal";
import ChatIcon from "@mui/icons-material/Chat";
import ViewSidebarIcon from "@mui/icons-material/ViewSidebar";
import CropSquareIcon from "@mui/icons-material/CropSquare";
import KeyboardArrowDownIcon from "@mui/icons-material/KeyboardArrowDown";
import { StageHost, StageSlot } from "@/features/stage";
import { ChatPanel } from "@/features/chat";
import { ControlPanel } from "@/features/control-panel/ControlPanel";
import { EventLog } from "@/app/EventLog";
import { useI18n } from "@/contexts/I18nProvider";
import { WorkspaceContext, subscribeWorkspaceClosePanel, subscribeWorkspaceOpenPanel, subscribeWorkspaceResetLayout } from "./WorkspaceContext";
import {
	createWorkspaceModelFromStorage,
	focusOrRestoreDockPanel,
	getOpenDockPanels,
	resetWorkspaceModel,
	saveWorkspaceModel,
	type DockPanelId,
} from "./workspace-layout";

const KnowledgePanel = lazy(async () => import("@/features/knowledge/KnowledgePanel").then((module) => ({ default: module.KnowledgePanel })));
const SettingsPanel = lazy(async () => import("@/features/settings/SettingsPanel").then((module) => ({ default: module.SettingsPanel })));
const WorkbenchPanel = lazy(async () => import("@/features/control-panel/WorkbenchPanel").then((module) => ({ default: module.WorkbenchPanel })));

function PanelLoadingState() {
	const { t } = useI18n();
	return (
		<Box sx={{ p: 1.5, color: "text.secondary", fontSize: 12 }}>
			{t("加载中...", "Loading...")}
		</Box>
	);
}

const PANEL_ICONS: Record<DockPanelId, React.ReactNode> = {
	"stage-controls": <ViewSidebarIcon sx={{ fontSize: 14 }} />,
	"stage-slot": <CropSquareIcon sx={{ fontSize: 14 }} />,
	chat: <ChatIcon sx={{ fontSize: 14 }} />,
	"control-panel": <TuneIcon sx={{ fontSize: 14 }} />,
	knowledge: <AutoStoriesIcon sx={{ fontSize: 14 }} />,
	workbench: <ScienceIcon sx={{ fontSize: 14 }} />,
	settings: <SettingsIcon sx={{ fontSize: 14 }} />,
	"event-log": <TerminalIcon sx={{ fontSize: 14 }} />,
};

const PANEL_LABELS: Record<DockPanelId, { zh: string; en: string }> = {
	"stage-controls": { zh: "舞台", en: "Stage" },
	"stage-slot": { zh: "贴靠舞台", en: "Attach Stage" },
	chat: { zh: "对话", en: "Chat" },
	"control-panel": { zh: "控制面板", en: "Control Panel" },
	knowledge: { zh: "知识库", en: "Knowledge" },
	workbench: { zh: "开发工作台", en: "Workbench" },
	settings: { zh: "设置", en: "Settings" },
	"event-log": { zh: "事件日志", en: "Event Log" },
};

interface DockWorkspaceProps {
	stageVisible: boolean;
	stageMode: "docked" | "floating";
	alwaysOnTop: boolean;
	displayMode: "interactive" | "static";
	onShowStage: () => void;
	onVisibilityChange: (visible: boolean) => void;
	onAlwaysOnTopChange: (value: boolean) => void;
	onDisplayModeChange: (mode: "interactive" | "static") => void;
	onStageSlotOpenChange: (open: boolean) => void;
	onStageSlotRectChange: (rect: DOMRect | null) => void;
}

export function DockWorkspace(props: DockWorkspaceProps) {
	const { locale, t } = useI18n();
	const [model, setModel] = useState<Model>(() => createWorkspaceModelFromStorage());
	const [revision, setRevision] = useState(0);

	const openPanels = useMemo(() => getOpenDockPanels(model), [model, revision]);

	useEffect(() => {
		const isOpen = openPanels.has("stage-slot");
		props.onStageSlotOpenChange(isOpen);
		if (!isOpen) {
			props.onStageSlotRectChange(null);
		}
	}, [openPanels, props]);

	const handleModelChange = useCallback((nextModel: Model) => {
		saveWorkspaceModel(nextModel);
		setRevision((current) => current + 1);
	}, []);

	const handleAction = useCallback((action: Action) => {
		if (action.type === Actions.DELETE_TAB && action.data.node === "control-panel") {
			return undefined;
		}
		return action;
	}, []);

	const handleFocusOrRestorePanel = useCallback((panelId: DockPanelId) => {
		focusOrRestoreDockPanel(model, panelId);
		saveWorkspaceModel(model);
		setRevision((current) => current + 1);
	}, [model]);

	const handleResetLayout = useCallback(() => {
		setModel(resetWorkspaceModel());
		setRevision((current) => current + 1);
	}, []);

	const handleCollapseEventLog = useCallback(() => {
		const eventLogNode = model.getNodeById("event-log");
		if (eventLogNode?.getType() === "tab") {
			model.doAction(Actions.deleteTab("event-log"));
			saveWorkspaceModel(model);
			setRevision((current) => current + 1);
		}
	}, [model]);

	const handleClosePanel = useCallback((panelId: DockPanelId) => {
		const panelNode = model.getNodeById(panelId);
		if (panelNode?.getType() === "tab" && panelId !== "control-panel") {
			model.doAction(Actions.deleteTab(panelId));
			saveWorkspaceModel(model);
			setRevision((current) => current + 1);
		}
	}, [model]);

	const factory = useCallback((node: TabNode) => {
		const component = node.getComponent() as DockPanelId | undefined;
		switch (component) {
			case "stage-controls":
				return (
					<Box sx={{ height: "100%", overflowY: "auto" }}>
						<StageHost
							stageVisible={props.stageVisible}
							stageMode={props.stageMode}
							alwaysOnTop={props.alwaysOnTop}
							displayMode={props.displayMode}
							variant="developer"
							onShowStage={props.onShowStage}
							onVisibilityChange={props.onVisibilityChange}
							onAlwaysOnTopChange={props.onAlwaysOnTopChange}
							onDisplayModeChange={props.onDisplayModeChange}
						/>
					</Box>
				);
			case "chat":
				return (
					<Box sx={{ height: "100%", overflow: "hidden" }}>
						<ChatPanel />
					</Box>
				);
			case "stage-slot":
				return (
					<StageSlot
						visible={props.stageVisible}
						mode={props.stageMode}
						displayMode={props.displayMode}
						onRectChange={props.onStageSlotRectChange}
					/>
				);
			case "control-panel":
				return (
					<Box sx={{ height: "100%", overflowY: "auto" }}>
						<ControlPanel />
					</Box>
				);
			case "knowledge":
				return (
					<Suspense fallback={<PanelLoadingState />}>
						<KnowledgePanel embedded />
					</Suspense>
				);
			case "workbench":
				return (
					<Suspense fallback={<PanelLoadingState />}>
						<WorkbenchPanel />
					</Suspense>
				);
			case "settings":
				return (
					<Suspense fallback={<PanelLoadingState />}>
						<SettingsPanel embedded />
					</Suspense>
				);
			case "event-log":
				return <EventLog />;
			default:
				return null;
		}
	}, [props]);

	const handleRenderTab = useCallback((node: TabNode, renderValues: ITabRenderValues) => {
		const panelId = node.getComponent() as DockPanelId | undefined;
		if (!panelId) return;
		renderValues.leading = PANEL_ICONS[panelId];
		renderValues.content = locale === "zh" ? PANEL_LABELS[panelId].zh : PANEL_LABELS[panelId].en;
	}, [locale]);

	const handleRenderTabSet = useCallback((tabSetNode: TabSetNode | BorderNode, renderValues: ITabSetRenderValues) => {
		const hasEventLog = tabSetNode
			.getChildren()
			.some((child) => child.getType() === "tab" && child.getId() === "event-log");
		if (!hasEventLog) return;

		renderValues.buttons.push(
			<button
				key="collapse-event-log"
				type="button"
				className="paimon-tabset-action"
				onClick={handleCollapseEventLog}
				title={t("收起事件日志", "Collapse event log")}
			>
				<KeyboardArrowDownIcon sx={{ fontSize: 15 }} />
			</button>,
		);
	}, [handleCollapseEventLog, t]);

	useEffect(() => subscribeWorkspaceOpenPanel(handleFocusOrRestorePanel), [handleFocusOrRestorePanel]);
	useEffect(() => subscribeWorkspaceClosePanel(handleClosePanel), [handleClosePanel]);
	useEffect(() => subscribeWorkspaceResetLayout(handleResetLayout), [handleResetLayout]);

	return (
		<WorkspaceContext.Provider
			value={{
				openPanels,
				focusOrRestorePanel: handleFocusOrRestorePanel,
				resetLayout: handleResetLayout,
			}}
		>
			<Box className="paimon-workspace" sx={{ position: "relative", flex: 1, minHeight: 0 }}>
				<Layout
					model={model}
					factory={factory}
					onAction={handleAction}
					onModelChange={handleModelChange}
					onRenderTab={handleRenderTab}
					onRenderTabSet={handleRenderTabSet}
				/>
			</Box>
		</WorkspaceContext.Provider>
	);
}
