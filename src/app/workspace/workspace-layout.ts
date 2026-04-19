import { Actions, DockLocation, Model, type IJsonModel, type IJsonTabNode } from "flexlayout-react";

export const WORKSPACE_LAYOUT_STORAGE_KEY = "paimon-companion-tauri:workspace-layout:v1";

export const DOCK_PANEL_IDS = [
	"stage-controls",
	"stage-slot",
	"chat",
	"control-panel",
	"knowledge",
	"workbench",
	"settings",
	"event-log",
] as const;

export type DockPanelId = typeof DOCK_PANEL_IDS[number];
export type WorkspaceLayoutState = IJsonModel;
export type DefaultWorkspaceLayout = IJsonModel;

const TABSET_IDS = {
	stage: "stage-tabset",
	chat: "stage-slot-tabset",
	chatMain: "chat-main-tabset",
	right: "right-tabset",
	bottom: "bottom-tabset",
} as const;

const WORKSPACE_NODE_IDS = {
	root: "workspace-root",
	main: "workspace-main",
} as const;

const PANEL_TITLES: Record<DockPanelId, string> = {
	"stage-controls": "Stage",
	"stage-slot": "Attach Stage",
	chat: "Chat",
	"control-panel": "Control Panel",
	knowledge: "Knowledge",
	workbench: "Workbench",
	settings: "Settings",
	"event-log": "Event Log",
};

function createDockTabJson(panelId: DockPanelId): IJsonTabNode {
	return {
		type: "tab",
		id: panelId,
		name: PANEL_TITLES[panelId],
		component: panelId,
		enableClose: panelId !== "control-panel",
		enableDrag: true,
		enableRename: false,
	};
}

const DEFAULT_LAYOUT: DefaultWorkspaceLayout = {
	global: {
		rootOrientationVertical: true,
		splitterSize: 8,
		splitterEnableHandle: true,
		enableEdgeDock: true,
		tabEnableClose: true,
		tabEnableDrag: true,
		tabEnablePopout: false,
		tabSetEnableClose: false,
		tabSetEnableDrag: true,
		tabSetEnableDrop: true,
		tabSetEnableTabStrip: true,
		tabSetEnableTabScrollbar: true,
	},
	borders: [],
	layout: {
		type: "row",
		id: "workspace-root",
		weight: 100,
		children: [
			{
				type: "row",
				id: "workspace-main",
				weight: 78,
				children: [
					{
						type: "tabset",
						id: TABSET_IDS.stage,
						weight: 24,
						enableDrag: true,
						enableDrop: true,
						selected: 0,
						children: [
							createDockTabJson("stage-controls"),
						],
					},
					{
						type: "tabset",
						id: TABSET_IDS.chat,
						weight: 28,
						enableDrag: true,
						enableDrop: true,
						selected: 0,
						children: [
							createDockTabJson("stage-slot"),
						],
					},
					{
						type: "tabset",
						id: TABSET_IDS.chatMain,
						weight: 28,
						enableDrag: true,
						enableDrop: true,
						selected: 0,
						children: [
							createDockTabJson("chat"),
						],
					},
					{
						type: "tabset",
						id: TABSET_IDS.right,
						weight: 24,
						enableDrag: true,
						enableDrop: true,
						selected: 0,
						children: [
							createDockTabJson("control-panel"),
							createDockTabJson("knowledge"),
							createDockTabJson("workbench"),
							createDockTabJson("settings"),
						],
					},
				],
			},
			{
				type: "tabset",
				id: TABSET_IDS.bottom,
				weight: 22,
				enableDrag: true,
				enableDrop: true,
				selected: 0,
				children: [
					createDockTabJson("event-log"),
				],
			},
		],
	},
};

export function getDefaultWorkspaceLayout(): DefaultWorkspaceLayout {
	return JSON.parse(JSON.stringify(DEFAULT_LAYOUT)) as DefaultWorkspaceLayout;
}

export function createWorkspaceModelFromStorage(): Model {
	try {
		const raw = window.localStorage.getItem(WORKSPACE_LAYOUT_STORAGE_KEY);
		if (!raw) {
			return Model.fromJson(getDefaultWorkspaceLayout());
		}
		return Model.fromJson(JSON.parse(raw) as WorkspaceLayoutState);
	} catch {
		return Model.fromJson(getDefaultWorkspaceLayout());
	}
}

export function getStoredOpenDockPanels(): Set<DockPanelId> {
	return getOpenDockPanels(createWorkspaceModelFromStorage());
}

export function saveWorkspaceModel(model: Model) {
	try {
		window.localStorage.setItem(WORKSPACE_LAYOUT_STORAGE_KEY, JSON.stringify(model.toJson()));
	} catch {
		// ignore storage failures
	}
}

export function resetWorkspaceModel(): Model {
	const model = Model.fromJson(getDefaultWorkspaceLayout());
	saveWorkspaceModel(model);
	return model;
}

export function getOpenDockPanels(model: Model): Set<DockPanelId> {
	const open = new Set<DockPanelId>();
	model.visitNodes((node) => {
		if (node.getType() !== "tab") return;
		const component = node.getAttr("component") as DockPanelId | undefined;
		if (component && DOCK_PANEL_IDS.includes(component)) {
			open.add(component);
		}
	});
	return open;
}

export function focusOrRestoreDockPanel(model: Model, panelId: DockPanelId) {
	if (panelId === "event-log") {
		moveOrRestoreBottomEventLog(model);
		return;
	}

	const existing = model.getNodeById(panelId);
	if (existing?.getType() === "tab") {
		model.doAction(Actions.selectTab(panelId));
		return;
	}

	const tabJson = createDockTabJson(panelId);
	const restoreTarget = getRestoreTarget(model, panelId);
	model.doAction(Actions.addNode(tabJson, restoreTarget.toNodeId, restoreTarget.location, -1, true));
}

function moveOrRestoreBottomEventLog(model: Model) {
	const existing = model.getNodeById("event-log");
	if (existing?.getType() === "tab") {
		const parentId = existing.getParent()?.getId();
		if (parentId === TABSET_IDS.bottom) {
			model.doAction(Actions.selectTab("event-log"));
			return;
		}
		model.doAction(Actions.deleteTab("event-log"));
	}
	restoreBottomEventLog(model);
}

function restoreBottomEventLog(model: Model) {
	const existingBottom = model.getNodeById(TABSET_IDS.bottom);
	if (existingBottom?.getType() === "tabset") {
		model.doAction(Actions.addNode(createDockTabJson("event-log"), TABSET_IDS.bottom, DockLocation.CENTER, -1, true));
		return;
	}

	const workspaceMain = model.getNodeById(WORKSPACE_NODE_IDS.main);
	if (workspaceMain) {
		model.doAction(Actions.addNode(createDockTabJson("event-log"), WORKSPACE_NODE_IDS.main, DockLocation.BOTTOM, -1, true));
		return;
	}

	const workspaceRoot = model.getNodeById(WORKSPACE_NODE_IDS.root);
	if (workspaceRoot) {
		model.doAction(Actions.addNode(createDockTabJson("event-log"), WORKSPACE_NODE_IDS.root, DockLocation.BOTTOM, -1, true));
		return;
	}

	const fallbackTarget = model.getFirstTabSet().getId();
	model.doAction(Actions.addNode(createDockTabJson("event-log"), fallbackTarget, DockLocation.BOTTOM, -1, true));
}

function getRestoreTarget(model: Model, panelId: DockPanelId): { toNodeId: string; location: DockLocation } {
	if (panelId === "stage-slot") {
		const stageSlotTabset = model.getNodeById(TABSET_IDS.chat);
		if (stageSlotTabset?.getType() === "tabset") {
			return { toNodeId: TABSET_IDS.chat, location: DockLocation.CENTER };
		}
	}

	const directTargetId = getPreferredTabsetId(panelId);
	const directTarget = model.getNodeById(directTargetId);
	if (directTarget?.getType() === "tabset") {
		return { toNodeId: directTargetId, location: DockLocation.CENTER };
	}

	if (panelId === "event-log") {
		const workspaceMain = model.getNodeById(WORKSPACE_NODE_IDS.main);
		if (workspaceMain) {
			return { toNodeId: WORKSPACE_NODE_IDS.main, location: DockLocation.BOTTOM };
		}
		const workspaceRoot = model.getNodeById(WORKSPACE_NODE_IDS.root);
		if (workspaceRoot) {
			return { toNodeId: WORKSPACE_NODE_IDS.root, location: DockLocation.BOTTOM };
		}
	}

	const rightTabset = model.getNodeById(TABSET_IDS.right);
	if (rightTabset?.getType() === "tabset") {
		if (panelId === "stage-slot") {
			return { toNodeId: TABSET_IDS.right, location: DockLocation.LEFT };
		}
		if (panelId === "stage-controls") {
			return { toNodeId: TABSET_IDS.right, location: DockLocation.LEFT };
		}
		if (panelId === "chat") {
			return { toNodeId: TABSET_IDS.right, location: DockLocation.LEFT };
		}
		if (panelId === "event-log") {
			return { toNodeId: TABSET_IDS.right, location: DockLocation.BOTTOM };
		}
	}

	const anchorPanelId = getFallbackAnchorPanel(panelId);
	const anchorNode = model.getNodeById(anchorPanelId);
	const anchorTabsetId = anchorNode?.getParent()?.getId();
	if (anchorTabsetId) {
		if (panelId === "stage-slot") {
			return { toNodeId: anchorTabsetId, location: DockLocation.LEFT };
		}
		if (panelId === "stage-controls") {
			return { toNodeId: anchorTabsetId, location: DockLocation.LEFT };
		}
		if (panelId === "chat") {
			return { toNodeId: anchorTabsetId, location: DockLocation.LEFT };
		}
		if (panelId === "event-log") {
			return { toNodeId: anchorTabsetId, location: DockLocation.BOTTOM };
		}
		if (panelId === "control-panel" || panelId === "knowledge" || panelId === "workbench" || panelId === "settings") {
			return { toNodeId: anchorTabsetId, location: DockLocation.RIGHT };
		}
	}

	return { toNodeId: model.getFirstTabSet().getId(), location: DockLocation.CENTER };
}

function getPreferredTabsetId(panelId: DockPanelId): string {
	switch (panelId) {
		case "stage-controls":
			return TABSET_IDS.stage;
		case "stage-slot":
			return TABSET_IDS.chat;
		case "chat":
			return TABSET_IDS.chatMain;
		case "event-log":
			return TABSET_IDS.bottom;
		default:
			return TABSET_IDS.right;
	}
}

function getFallbackAnchorPanel(panelId: DockPanelId): DockPanelId {
	switch (panelId) {
		case "stage-controls":
			return "chat";
		case "stage-slot":
			return "chat";
		case "chat":
			return "control-panel";
		case "event-log":
			return "chat";
		default:
			return "chat";
	}
}
