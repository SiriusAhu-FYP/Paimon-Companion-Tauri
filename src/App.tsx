import { MainWindow } from "@/app/MainWindow";
import { StageWindow } from "@/features/stage";
import { windowLabel } from "@/utils/window-label";

function App() {
	if (windowLabel === "stage") {
		return <StageWindow />;
	}
	return <MainWindow />;
}

export default App;
