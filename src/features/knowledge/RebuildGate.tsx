import { useState, useCallback } from "react";
import {
	Box, Button, Typography, Stack, LinearProgress,
} from "@mui/material";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import { getServices } from "@/services";
import { createLogger } from "@/services/logger";

const log = createLogger("rebuild-gate");

interface RebuildGateProps {
	onRebuilt: () => void;
	onCancel: () => void;
}

/**
 * 强制确认型门控面板：索引状态为 needs_rebuild 时拦截依赖索引的动作。
 * 只允许二选一：重建索引 / 取消。不可通过 ESC、遮罩点击等方式关闭。
 */
export function RebuildGate({ onRebuilt, onCancel }: RebuildGateProps) {
	const [rebuilding, setRebuilding] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const handleRebuild = useCallback(async () => {
		setRebuilding(true);
		setError(null);
		try {
			const { knowledge } = getServices();
			const result = await knowledge.rebuildIndex();
			if (result.success) {
				log.info("rebuild via gate succeeded");
				onRebuilt();
			} else {
				setError(result.error ?? "重建失败");
			}
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setRebuilding(false);
		}
	}, [onRebuilt]);

	return (
		<Box sx={{
			border: "2px solid",
			borderColor: "warning.main",
			borderRadius: 1,
			bgcolor: "background.paper",
			p: 2,
			display: "flex",
			flexDirection: "column",
			gap: 1.5,
		}}>
			<Stack direction="row" spacing={1} alignItems="center">
				<WarningAmberIcon color="warning" />
				<Typography variant="subtitle2" fontWeight={700}>
					索引需要重建
				</Typography>
			</Stack>

			<Typography variant="body2" color="text.secondary" sx={{ fontSize: 12 }}>
				文档已变更，当前索引与文档内容不一致。必须重建索引后才能执行检索操作。
			</Typography>

			{error && (
				<Typography variant="body2" color="error" sx={{ fontSize: 11 }}>
					{error}
				</Typography>
			)}

			{rebuilding && <LinearProgress />}

			<Stack direction="row" spacing={1} justifyContent="flex-end">
				<Button
					size="small"
					variant="outlined"
					onClick={onCancel}
					disabled={rebuilding}
				>
					取消
				</Button>
				<Button
					size="small"
					variant="contained"
					color="warning"
					onClick={handleRebuild}
					disabled={rebuilding}
				>
					{rebuilding ? "重建中..." : "重建索引"}
				</Button>
			</Stack>
		</Box>
	);
}
