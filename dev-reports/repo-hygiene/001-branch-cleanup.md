# Repo Hygiene — 分支整理与未提交内容收纳

## 整理前现状

### 分支
| 分支 | 本地 HEAD | 远程 HEAD | 问题 |
|------|-----------|-----------|------|
| `feature/phase2-planning` | `010da03` (Phase 3 Run 04) | `1668f51` (Phase 3 M4+M6) | Phase 3 所有工作挂在 Phase 2 分支名下 |
| `feature/phase1-foundation` | — | 有远程 | 正常（已完成的历史分支） |
| `main` | — | 有远程 | 正常 |

### Phase 3 提交（均位于 `feature/phase2-planning` 上）
| Hash | 说明 | 真实归属 |
|------|------|----------|
| `2d2c0e7` | Phase 3 blueprint | Phase 3 |
| `1668f51` | M4+M6 配置管理 | Phase 3 |
| `59d2259` | 配置持久化 blocker fix | Phase 3 |
| `192a6d3` | M1 真实 LLM 接入 | Phase 3 |
| `5483ff5` | TTS CORS 修复 | Phase 3 |
| `010da03` | M2 GPT-SoVITS + SpeechQueue | Phase 3 |

### 未提交文件
- `.cursor/agents/` — 3 个自定义 agent 定义（closeout-review, phase-blueprint-writer, old-project-archaeology）
- `.cursor/skills/` — 3 个自定义 skill（implementation-guardrails, desktop-verification-checklist, run-report-format）
- `docs/architecture/` — 2 个架构文档（mcp-boundary, skill-boundary）

## 执行操作

### 1. 新建正确分支
- 在当前 HEAD（`010da03`，包含所有 Phase 3 成果）上新建 `feature/phase3-integration`
- 所有后续 Phase 3 开发均在此分支进行

### 2. 提交 Cursor 配置
- Commit `b34cee9`: `.cursor/agents/` + `.cursor/skills/`（6 个文件）
- 与业务代码分开提交

### 3. 提交架构文档
- Commit `613bef6`: `docs/architecture/`（2 个文件）
- 与 Cursor 配置分开提交

### 4. 旧分支处理评估

**结论：不动旧分支，保守处理。**

理由：
1. `feature/phase2-planning` 本地 HEAD（`010da03`）与新建的 `feature/phase3-integration` 指向同一个 commit，不存在分叉
2. 远程 `origin/feature/phase2-planning` 停在 `1668f51`，本地领先 4 个 commit 未 push
3. 回退旧分支到 Phase 2.1 最后一个 commit（`3233ebc`）在理论上可行，但：
   - 需要 force push 覆盖远程，存在风险
   - 其他协作者可能已基于远程 HEAD 工作
   - 旧分支上的 Phase 3 commit 已全部包含在新分支中，不会丢失
4. 最安全的做法：**冻结旧分支，仅在新分支上继续工作**

建议后续如果需要清理旧分支：
- 等 Phase 3 在新分支上稳定后，可以考虑删除本地 `feature/phase2-planning`
- 远程旧分支可通过 PR 或手动操作归档

## 整理后状态

### 分支结构
```
main
  └── feature/phase1-foundation (已完成)
      └── feature/phase2-planning (冻结，不再使用)
          └── feature/phase3-integration ← 当前工作分支
```

### 新增 Commit
| Hash | Message |
|------|---------|
| `b34cee9` | `chore(cursor): add custom agents and skills for project workflow` |
| `613bef6` | `docs(architecture): add MCP boundary and skill boundary documentation` |

### 已纳入版本控制的新内容
- `.cursor/agents/closeout-review.md`
- `.cursor/agents/phase-blueprint-writer.md`
- `.cursor/agents/old-project-archaeology.md`
- `.cursor/skills/desktop-verification-checklist/SKILL.md`
- `.cursor/skills/implementation-guardrails/SKILL.md`
- `.cursor/skills/run-report-format/SKILL.md`
- `docs/architecture/mcp-boundary.md`
- `docs/architecture/skill-boundary.md`

## 后续行动

1. **后续所有 Phase 3 开发**均在 `feature/phase3-integration` 分支上进行
2. 不再向 `feature/phase2-planning` 提交任何新内容
3. 可以立即在正确分支上继续 M2.1 或其他 Phase 3 工作
4. 首次 push 时使用 `git push -u origin feature/phase3-integration` 建立远程追踪
