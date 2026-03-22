import { Live2DPreview } from "@/features/live2d";
import { ControlPanel } from "@/features/control-panel";
import { ChatPanel } from "@/features/chat";
import { EventLog } from "@/app/EventLog";

export function MainWindow() {
	return (
		<div className="main-window">
			<header className="main-header">
				<h1>Paimon Live</h1>
			</header>

			<div className="main-layout">
				<div className="main-left">
					<Live2DPreview />
				</div>

				<div className="main-center">
					<ChatPanel />
				</div>

				<div className="main-right">
					<ControlPanel />
				</div>
			</div>

			<footer className="main-footer">
				<EventLog />
			</footer>
		</div>
	);
}
