import { Actions, DockLocation, Model, type IJsonModel, type IJsonTabNode, type IJsonTabSetNode } from "flexlayout-react";

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

const TABSET_WEIGHTS = {
	stage: 24,
	stageSlot: 28,
	chat: 28,
	right: 24,
	bottom: 22,
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

function createDockTabsetJson(tabsetId: string, panelIds: DockPanelId[], weight: number): IJsonTabSetNode {
	return {
		type: "tabset",
		id: tabsetId,
		weight,
		enableDrag: true,
		enableDrop: true,
		selected: 0,
		children: panelIds.map((panelId) => createDockTabJson(panelId)),
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
						...createDockTabsetJson(TABSET_IDS.stage, ["stage-controls"], TABSET_WEIGHTS.stage),
					},
					{
						...createDockTabsetJson(TABSET_IDS.chat, ["stage-slot"], TABSET_WEIGHTS.stageSlot),
					},
					{
						...createDockTabsetJson(TABSET_IDS.chatMain, ["chat"], TABSET_WEIGHTS.chat),
					},
					{
						...createDockTabsetJson(TABSET_IDS.right, ["control-panel", "knowledge", "workbench", "settings"], TABSET_WEIGHTS.right),
					},
				],
			},
			{
				...createDockTabsetJson(TABSET_IDS.bottom, ["event-log"], TABSET_WEIGHTS.bottom),
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

	const workspaceRoot = model.getNodeById(WORKSPACE_NODE_IDS.root);
	if (workspaceRoot) {
		model.doAction(
			Actions.addNode(
				createDockTabsetJson(TABSET_IDS.bottom, ["event-log"], TABSET_WEIGHTS.bottom) as unknown as IJsonTabNode,
				WORKSPACE_NODE_IDS.root,
				DockLocation.BOTTOM,
				-1,
				true,
			),
		);
		return;
	}

	const fallbackTarget = model.getFirstTabSet().getId();
	model.doAction(Actions.addNode(createDockTabJson("event-log"), fallbackTarget, DockLocation.BOTTOM, -1, true));
}

function getRestoreTarget(model: Model, panelId: DockPanelId): { toNodeId: string; location: DockLocation } {
	const directTargetId = getPreferredTabsetId(panelId);
	const directTarget = model.getNodeById(directTargetId);
	if (directTarget?.getType() === "tabset") {
		return { toNodeId: directTargetId, location: DockLocation.CENTER };
	}

	if (panelId === "stage-controls") {
		const workspaceMain = model.getNodeById(WORKSPACE_NODE_IDS.main);
		if (workspaceMain) {
			model.doAction(
				Actions.addNode(
					createDockTabsetJson(TABSET_IDS.stage, ["stage-controls"], TABSET_WEIGHTS.stage) as unknown as IJsonTabNode,
					WORKSPACE_NODE_IDS.main,
					DockLocation.LEFT,
					-1,
					true,
				),
			);
			return { toNodeId: TABSET_IDS.stage, location: DockLocation.CENTER };
		}
	}

	if (panelId === "stage-slot") {
		if (model.getNodeById(TABSET_IDS.chatMain)?.getType() === "tabset") {
			model.doAction(
				Actions.addNode(
					createDockTabsetJson(TABSET_IDS.chat, ["stage-slot"], TABSET_WEIGHTS.stageSlot) as unknown as IJsonTabNode,
					TABSET_IDS.chatMain,
					DockLocation.LEFT,
					-1,
					true,
				),
			);
			return { toNodeId: TABSET_IDS.chat, location: DockLocation.CENTER };
		}
	}

	if (panelId === "chat") {
		const stageSlotTabset = model.getNodeById(TABSET_IDS.chat);
		if (stageSlotTabset?.getType() === "tabset") {
			model.doAction(
				Actions.addNode(
					createDockTabsetJson(TABSET_IDS.chatMain, ["chat"], TABSET_WEIGHTS.chat) as unknown as IJsonTabNode,
					TABSET_IDS.chat,
					DockLocation.RIGHT,
					-1,
					true,
				),
			);
			return { toNodeId: TABSET_IDS.chatMain, location: DockLocation.CENTER };
		}

		const workspaceMain = model.getNodeById(WORKSPACE_NODE_IDS.main);
		if (workspaceMain) {
			model.doAction(
				Actions.addNode(
					createDockTabsetJson(TABSET_IDS.chatMain, ["chat"], TABSET_WEIGHTS.chat) as unknown as IJsonTabNode,
					WORKSPACE_NODE_IDS.main,
					DockLocation.LEFT,
					-1,
					true,
				),
			);
			return { toNodeId: TABSET_IDS.chatMain, location: DockLocation.CENTER };
		}
	}

	if (panelId === "event-log") {
		const workspaceRoot = model.getNodeById(WORKSPACE_NODE_IDS.root);
		if (workspaceRoot) {
			return { toNodeId: WORKSPACE_NODE_IDS.root, location: DockLocation.BOTTOM };
		}
	}

	const rightTabset = model.getNodeById(TABSET_IDS.right);
	if (rightTabset?.getType() === "tabset") {
		if (panelId === "event-log") {
			return { toNodeId: TABSET_IDS.right, location: DockLocation.BOTTOM };
		}
		if (panelId === "stage-controls" || panelId === "stage-slot" || panelId === "chat") {
			return { toNodeId: TABSET_IDS.right, location: DockLocation.LEFT };
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
