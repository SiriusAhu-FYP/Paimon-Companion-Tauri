# P6 Memory Validation Protocol

## Purpose

This protocol defines the pre-acceptance and formal-validation procedure for `P6` memory work.
It is designed to produce thesis-friendly quantitative evidence instead of only qualitative demos.

## Review Positioning

This document is a repository evidence protocol, not a packaging/reproducibility contract.

It explains how `P6` memory evidence was produced and scored, including machine-dependent local assets.

## Scope

This protocol validates:

- companion short-term memory continuity on short gameplay clips
- long-term memory prototype quality through structured summary artifacts
- salient event detection consistency with known scenario labels

This protocol does not validate:

- product-grade always-on auto-recall triggers
- complex dynamic multi-agent game delegation behavior
- final product gameplay scope (for example, this protocol does not define what games are in/out of the shipped companion target)

## Evaluation Assets

- two local benchmark videos (`Minecraft`, `GenshinImpact`) used as memory-stress evaluation cases
- their corresponding local label-note files
- a local runtime manifest that resolves concrete asset paths for the current machine

Asset availability notes:

- these videos/notes are local evaluation materials and are not required to be fully tracked in this repository
- path values are intentionally machine-specific and should be adapted per evaluator machine
- `.workbench/simulation/` is treated as an evaluation harness area, not a production runtime surface

## Execution Steps

1. Run simulation pipeline for one video.
2. Archive that run's logs to a dedicated folder.
3. Run scoring script against archived logs.
4. Repeat for the second video.
5. Merge both case reports into thesis tables.

## Commands

### 1) Generate Logs (One Video)

```bash
node .workbench/simulation/run-simulation.mjs --video <local-minecraft-video> --context <local-minecraft-label-notes> --fps 1
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

If your local harness path differs, keep the same pipeline shape and substitute equivalent local paths.

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

- This protocol is intentionally lightweight and reproducible at procedure level, while acknowledging machine-dependent asset paths.
- `Minecraft` and `GenshinImpact` here are evaluation labels for memory protocol scoring, not a claim that they are the repository’s final gameplay scope.
- For final thesis, keep both machine-generated score reports and raw jsonl logs as appendix evidence.
