import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";

type Axis = "x" | "y";
type HandlePlacement = "start" | "end";

interface ResizablePaneProps {
	axis: Axis;
	storageKey: string;
	initialSize: number;
	minSize: number;
	maxSize: number;
	handlePlacement?: HandlePlacement;
	className?: string;
	handleClassName?: string;
	style?: CSSProperties;
	children: ReactNode;
}

function clamp(value: number, min: number, max: number) {
	return Math.min(max, Math.max(min, value));
}

export function ResizablePane(props: ResizablePaneProps) {
	const {
		axis,
		storageKey,
		initialSize,
		minSize,
		maxSize,
		handlePlacement = "start",
		className,
		handleClassName,
		style,
		children,
	} = props;
	const localStorageKey = `paimon-companion-tauri:resizable-pane:${storageKey}`;
	const [size, setSize] = useState(() => {
		try {
			const raw = window.localStorage.getItem(localStorageKey);
			if (!raw) {
				return clamp(initialSize, minSize, maxSize);
			}
			return clamp(Number.parseFloat(raw), minSize, maxSize);
		} catch {
			return clamp(initialSize, minSize, maxSize);
		}
	});
	const dragStateRef = useRef<{ startPointer: number; startSize: number } | null>(null);

	useEffect(() => {
		try {
			window.localStorage.setItem(localStorageKey, String(size));
		} catch {
			// ignore localStorage failures
		}
	}, [localStorageKey, size]);

	useEffect(() => {
		const handlePointerMove = (event: PointerEvent) => {
			const dragState = dragStateRef.current;
			if (!dragState) return;
			const pointer = axis === "y" ? event.clientY : event.clientX;
			const delta = pointer - dragState.startPointer;
			const nextSize = handlePlacement === "start"
				? dragState.startSize - delta
				: dragState.startSize + delta;
			setSize(clamp(nextSize, minSize, maxSize));
		};

		const stopDragging = () => {
			dragStateRef.current = null;
			document.body.style.userSelect = "";
			document.body.style.cursor = "";
		};

		window.addEventListener("pointermove", handlePointerMove);
		window.addEventListener("pointerup", stopDragging);
		window.addEventListener("pointercancel", stopDragging);

		return () => {
			window.removeEventListener("pointermove", handlePointerMove);
			window.removeEventListener("pointerup", stopDragging);
			window.removeEventListener("pointercancel", stopDragging);
		};
	}, [axis, handlePlacement, maxSize, minSize]);

	const paneStyle = useMemo(() => {
		const sizedStyle = axis === "y" ? { height: size } : { width: size };
		return {
			...style,
			...sizedStyle,
		};
	}, [axis, size, style]);

	return (
		<div className={className} style={paneStyle}>
			<div
				className={handleClassName}
				onPointerDown={(event) => {
					dragStateRef.current = {
						startPointer: axis === "y" ? event.clientY : event.clientX,
						startSize: size,
					};
					document.body.style.userSelect = "none";
					document.body.style.cursor = axis === "y" ? "row-resize" : "col-resize";
				}}
			/>
			{children}
		</div>
	);
}
