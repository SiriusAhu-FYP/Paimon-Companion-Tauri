import { MainWindow } from "@/app/MainWindow";
import { StageWindow } from "@/features/stage";
import { getCurrentWindow } from "@tauri-apps/api/window";

function getWindowLabel(): string {
	// URL 参数覆盖（浏览器调试用）: ?window=stage
	const urlParams = new URLSearchParams(window.location.search);
	const urlOverride = urlParams.get("window");
	if (urlOverride === "stage") return "stage";

	try {
		return getCurrentWindow().label;
	} catch {
		return "main";
	}
}

const windowLabel = getWindowLabel();

function App() {
	if (windowLabel === "stage") {
		return <StageWindow />;
	}
	return <MainWindow />;
}

export default App;
