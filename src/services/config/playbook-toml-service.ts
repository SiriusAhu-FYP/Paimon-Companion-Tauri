import { invoke } from "@tauri-apps/api/core";

export type PlaybookTomlPrimitive = string | number | boolean;
export type PlaybookTomlValue = PlaybookTomlPrimitive | PlaybookTomlPrimitive[];

export interface PlaybookTomlValueUpdate {
	keyPath: string;
	value: PlaybookTomlValue;
}

export async function readPlaybookTomlValues(relativePath: string): Promise<Record<string, unknown>> {
	return invoke("read_playbook_toml_values", {
		request: { relativePath },
	});
}

export async function updatePlaybookTomlValues(
	relativePath: string,
	updates: PlaybookTomlValueUpdate[],
): Promise<void> {
	await invoke("update_playbook_toml_values", {
		request: { relativePath, updates },
	});
}
