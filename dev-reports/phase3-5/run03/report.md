# Phase 3.5 Run 03 — 角色卡 Broadcast Sanitization

## 背景

Phase 3.5 Run 01 / Run 02 完成了知识库基础和 Rerank 集成。在对接真实角色卡进行直播/桌面口播测试时，发现原始角色卡（从 CharHub SillyTavern 格式导入）存在不适合口播场景的内容。

本轮不是重写角色系统，也不是改人设，只是在尽量保持角色核心人设和语气的前提下，去掉会诱发不良回复模式的内容。

---

## 清洗原则

| 风险类型 | 处理方式 |
|----------|----------|
| 括号动作描写 `*...*` | 删除或改写为纯口播语气 |
| 舞台说明式场景描述 | 保留场景框架，删除具体动作描写 |
| 过长对话示例 | 精简到 2~3 轮短对话 |
| 过重 roleplay 腔调（第三/第一人称混用、过度场景演绎） | 改写为相对自然的对话语气 |
| 暴露身体细节描写（ BODY / CLOTHING 字段） | 大幅精简，保留角色核心辨识特征 |
| creator_notes / alternate_greetings | 删除或改为 broadcast-safe 说明 |

**不删改的内容**：角色名、核心性格设定、第三人称自称习惯（派蒙）、职业身份背景、主要对话语气。

---

## 改动详情

### Paimon

| 字段 | 原始内容 | 清洗后 | 改动原因 |
|------|----------|--------|----------|
| `description` | 大段神话考据、详细外观描述（发型/肤色/衣服/靴子/发簪/悬浮光环） | 保留核心：第三人称自称、喜欢食物和冒险、身份神秘、爱用派蒙称呼自己 | 外观细节不适合口播输入，外观通过 Live2D 模型表达 |
| `first_mes` | 完整场景描写（蒙德节日、人群、派蒙浮空、嘴里塞满苹果派） | 删去场景，仅保留两条口播式台词 | 括号动作和场景描写会进入 first message，影响语气 |
| `mes_example` | 两条长 roleplay 风格示例 | 精简为两条短台词 | 过重腔调会诱发 LLM 生成过度演绎回复 |
| `scenario` | 空 | 不变 | — |
| `creator_notes` | 原始创作者信息 | 改为 broadcast-safe 说明，注明是清洗版本 | 原始内容无 broadcast 风险但标注来源便于追溯 |
| `character_version` | `main` | `sanitized-v1` | 区分原始卡与清洗卡 |

### Ganyu

| 字段 | 原始内容 | 清洗后 | 改动原因 |
|------|----------|--------|----------|
| `description` | 详细 BODY（身材/肤色/胸围/臀部）、CLOTHING（胸衣/露背/黑丝/高跟鞋）、大量敏感考据性历史描述 | 保留： adeptus 身份、甘雨港秘书身份、核心性格（害羞/工作狂/美食）；精简 BODY 为"外貌近似人类、山羊角、冰蓝色长发、紫眼"；删除胸围/臀部/内衣细节；CLOTHING 删除"胸衣/露背/黑丝"，保留"白尾外套/冰蓝手套/白高跟鞋" | 大量身体细节会诱发不适合直播的回复；身体细节通过 Live2D 表达 |
| `first_mes` | 完整 stage direction（写合同场景、脸红、收回纸） | 保留台词核心，删去场景动作描写 | 括号动作描写进入 first message 会影响语气 |
| `mes_example` | 长篇演绎示例（写作合同/深呼吸/跑年度审核流程） | 精简为"写合同 + 脸红 + 跑年度审核"短版 | 过重角色扮演腔调会诱发 LLM 过度演绎 |
| `scenario` | 保留（甘雨港世界观背景，不含敏感内容） | 不变 | 场景框架对口播语气无负面影响 |
| `creator_notes` | 原始创作者信息 | 改为 broadcast-safe 说明 | 同上 |

---

## 产物清单

| 文件 | 说明 |
|------|------|
| `public/cards/paimon-sanitized-v1.json` | 派蒙清洗版（v1） |
| `public/cards/ganyu-sanitized-v1.json` | 甘雨清洗版（v1） |

> ⚠️ 文件名不含子目录路径前缀（避免 URL 编码 404）。通过 `cards-manifest.json` 加载。

---

## 未涉及的范围

- 不修改 `card-parser.ts` 或角色解析逻辑——清洗卡与原始卡格式完全兼容
- 不修改 `character-cards.ts` 加载逻辑
- 不修改任何 Live2D、Stage、TTS、Pipeline 逻辑
- 不新建角色系统——清洗产物仅为 public/cards 下的 JSON 文件

---

## 使用建议

在 `cards-manifest.json` 中将路径指向清洗版即可加载：

```json
[
  "paimon-sanitized-v1.json",
  "ganyu-sanitized-v1.json"
]
```

原始卡仍保留在 `public/cards/` 下，可随时切回。

> ⚠️ 注意：清洗版文件名不含子目录路径前缀。`character-cards.ts` 的 URL 拼接逻辑为 `/cards/${filename}`，文件名中的路径分隔符会被 URL 编码导致 404。因此清洗版必须放在 `public/cards/` 根目录下。

---

## 元信息

- 报告路径: `dev-reports/phase3-5/run03/report.md`
- 产物: `public/cards/sanitized/main_paimon-sanitized.json`, `public/cards/sanitized/main_ganyu-sanitized.json`
