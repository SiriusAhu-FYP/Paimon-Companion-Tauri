import { createContext, useContext } from "react";
import type { DockPanelId } from "./workspace-layout";

const OPEN_PANEL_EVENT = "paimon:workspace-open-panel";
const CLOSE_PANEL_EVENT = "paimon:workspace-close-panel";
const RESET_LAYOUT_EVENT = "paimon:workspace-reset-layout";

export interface WorkspaceContextValue {
	openPanels: Set<DockPanelId>;
	focusOrRestorePanel: (panelId: DockPanelId) => void;
	resetLayout: () => void;
}

export const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function useWorkspace() {
	return useContext(WorkspaceContext);
}

export function requestOpenWorkspacePanel(panelId: DockPanelId) {
	window.dispatchEvent(new CustomEvent<DockPanelId>(OPEN_PANEL_EVENT, { detail: panelId }));
}

export function requestCloseWorkspacePanel(panelId: DockPanelId) {
	window.dispatchEvent(new CustomEvent<DockPanelId>(CLOSE_PANEL_EVENT, { detail: panelId }));
}

export function subscribeWorkspaceOpenPanel(handler: (panelId: DockPanelId) => void) {
	const listener = (event: Event) => {
		const customEvent = event as CustomEvent<DockPanelId>;
		if (customEvent.detail) {
			handler(customEvent.detail);
		}
	};
	window.addEventListener(OPEN_PANEL_EVENT, listener);
	return () => window.removeEventListener(OPEN_PANEL_EVENT, listener);
}

export function subscribeWorkspaceClosePanel(handler: (panelId: DockPanelId) => void) {
	const listener = (event: Event) => {
		const customEvent = event as CustomEvent<DockPanelId>;
		if (customEvent.detail) {
			handler(customEvent.detail);
		}
	};
	window.addEventListener(CLOSE_PANEL_EVENT, listener);
	return () => window.removeEventListener(CLOSE_PANEL_EVENT, listener);
}

export function requestResetWorkspaceLayout() {
	window.dispatchEvent(new Event(RESET_LAYOUT_EVENT));
}

export function subscribeWorkspaceResetLayout(handler: () => void) {
	window.addEventListener(RESET_LAYOUT_EVENT, handler);
	return () => window.removeEventListener(RESET_LAYOUT_EVENT, handler);
}
