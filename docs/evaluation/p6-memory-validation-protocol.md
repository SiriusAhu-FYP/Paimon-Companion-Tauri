# P6 Memory Validation Protocol

## Purpose

This protocol defines the pre-acceptance and formal-validation procedure for `P6` memory work.
It is designed to produce thesis-friendly quantitative evidence instead of only qualitative demos.

## Scope

This protocol validates:

- companion short-term memory continuity on short gameplay clips
- long-term memory prototype quality through structured summary artifacts
- salient event detection consistency with known scenario labels

This protocol does not validate:

- product-grade always-on auto-recall triggers
- complex dynamic multi-agent game delegation behavior

## Evaluation Assets

- `.private/video4test/01_Minecraft.mp4`
- `.private/video4test/02_GenshinImpact.mp4`
- `.private/video4test/01-Minecraft.md` (label notes)
- `.private/video4test/02-GenshinImpact.md` (label notes)

## Execution Steps

1. Run simulation pipeline for one video.
2. Archive that run's logs to a dedicated folder.
3. Run scoring script against archived logs.
4. Repeat for the second video.
5. Merge both case reports into thesis tables.

## Commands

### 1) Generate Logs (One Video)

```bash
node .workbench/simulation/run-simulation.mjs --video .private/video4test/01_Minecraft.mp4 --context .private/video4test/01-Minecraft.md --fps 1
```

### 2) Archive Run Logs

```powershell
New-Item -ItemType Directory -Force -Path docs/evaluation/artifacts/minecraft | Out-Null
Copy-Item .workbench/simulation/output/logs/*.jsonl docs/evaluation/artifacts/minecraft/
```

### 3) Score The Run

```bash
pnpm run eval:p6:memory -- --label minecraft --summaries docs/evaluation/artifacts/minecraft/summaries.jsonl --digests docs/evaluation/artifacts/minecraft/digests.jsonl --salient docs/evaluation/artifacts/minecraft/salient-events.jsonl --out docs/evaluation/artifacts/minecraft/score-report.md
```

Repeat the same flow for `genshin` by replacing input/output paths and `--label`.

## Metrics

The scoring script outputs:

- signal coverage:
  - expected scenario signals hit / total expected signals
- salient consistency:
  - whether salient event types match scenario expectation
- structure integrity:
  - whether summaries/digests/event files are complete and non-empty
- total score:
  - weighted score from `0` to `100`

## Acceptance Threshold

- single-case pass line: `>= 70`
- recommended target for thesis: both cases `>= 75`

## Suggested Thesis Table Columns

- case id (`minecraft` / `genshin`)
- frames processed
- summaries count
- digests count
- salient events count
- signal coverage (%)
- salient consistency (%)
- total score
- pass/fail

## Notes

- This protocol is intentionally lightweight and reproducible.
- For final thesis, keep both machine-generated score reports and raw jsonl logs as appendix evidence.
