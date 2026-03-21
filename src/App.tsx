import { MainWindow } from "@/app/MainWindow";
import { StageWindow } from "@/features/stage";
import { getCurrentWindow } from "@tauri-apps/api/window";

function getWindowLabel(): string {
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
