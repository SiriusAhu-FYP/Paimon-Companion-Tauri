export interface DebugCaptureState {
	enabled: boolean;
	sessionId: string | null;
	sessionDirectory: string | null;
	capturedEventCount: number;
	capturedImageCount: number;
	lastWriteAt: number | null;
	lastError: string | null;
}
