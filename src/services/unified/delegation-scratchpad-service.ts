import { invoke } from "@tauri-apps/api/core";
import { isTauriEnvironment } from "@/utils/window-sync";

export interface DelegationScratchpadSession {
	scratchpadId: string;
	directory: string;
	mirrorDirectory: string | null;
}

interface StartDelegationScratchpadRequest {
	label?: string | null;
	mirrorDebugSessionId?: string | null;
}

interface WriteDelegationScratchpadTextRequest {
	scratchpadId: string;
	relativePath: string;
	text: string;
	append?: boolean;
}

interface ReadDelegationScratchpadTextRequest {
	scratchpadId: string;
	relativePath: string;
	maxChars?: number;
}

export async function startDelegationScratchpad(
	request?: StartDelegationScratchpadRequest,
): Promise<DelegationScratchpadSession | null> {
	if (!isTauriEnvironment()) {
		return null;
	}
	const response = await invoke<{
		scratchpadId: string;
		directory: string;
		mirrorDirectory?: string | null;
	}>("start_delegation_scratchpad", {
		request: {
			label: request?.label ?? null,
			mirrorDebugSessionId: request?.mirrorDebugSessionId ?? null,
		},
	});
	return {
		scratchpadId: response.scratchpadId,
		directory: response.directory,
		mirrorDirectory: response.mirrorDirectory ?? null,
	};
}

export async function writeDelegationScratchpadText(request: WriteDelegationScratchpadTextRequest): Promise<void> {
	if (!isTauriEnvironment()) {
		return;
	}
	await invoke("write_delegation_scratchpad_text", {
		request: {
			scratchpadId: request.scratchpadId,
			relativePath: request.relativePath,
			text: request.text,
			append: request.append ?? true,
		},
	});
}

export async function readDelegationScratchpadText(request: ReadDelegationScratchpadTextRequest): Promise<string> {
	if (!isTauriEnvironment()) {
		return "";
	}
	return invoke<string>("read_delegation_scratchpad_text", {
		request: {
			scratchpadId: request.scratchpadId,
			relativePath: request.relativePath,
			maxChars: request.maxChars,
		},
	});
}
