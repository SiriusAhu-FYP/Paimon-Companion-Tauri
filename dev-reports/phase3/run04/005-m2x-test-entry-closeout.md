# Phase 3 Run 04.4 — M2.x 测试入口收口与语言边界确认

**Commit**: `a2e1e6a`
**日期**: 2026-03-25
**分支**: `feature/phase3-integration`

---

## 1. 本次完成内容

### TTS 测试入口接入正式前处理链路

**问题**：`SettingsPanel` 的"合成并播放"按钮（`handleTestTTSDirect`）将测试文本直接传给 `ttsService.synthesize()`，跳过了：
- `normalizeForSpeech`（数字/符号转口语）
- `splitText`（按标点切片 + 中英日分离）
- `SpeechQueue`（1段预缓冲并发合成 + 严格顺序播放）

导致测试结果与正式链路行为不一致，无法验证切片、语言路由、unsupported 跳过等关键能力。

**修复**：将 `handleTestTTSDirect` 改造为调用完整前处理 pipeline：

```
ttsTestText
  → normalizeForSpeech()       // 数字、符号转口语
  → splitText()               // 切片 + 中英日分离 + unsupported 标注
  → SpeechQueue.speakAll()     // 并发合成 + 严格顺序播放
```

新增切片结果预览：点合成后显示每段 `[lang]"text..."` 预览，成功/失败信息更清晰。

**关键文件**：
- `src/features/settings/SettingsPanel.tsx` — `handleTestTTSDirect` 重构

---

## 2. TTS 测试入口是否已与正式链路一致

**结论：已一致。**

| 前处理步骤 | 正式链路（PipelineService） | Settings 测试入口（改造后） |
|-----------|--------------------------|--------------------------|
| `normalizeForSpeech` | ✅ | ✅ |
| `splitText`（标点切片） | ✅ | ✅ |
| 语言检测（zh/en/ja/unsupported） | ✅ | ✅ |
| `SpeechQueue` 并发合成 + 顺序播放 | ✅ | ✅ |
| unsupported 跳过（返回空 audio） | ✅ | ✅ |

---

## 3. 当前正式支持的语言边界

**LANG_ROUTE 定义**（`gptsovits-tts-service.ts`）：

```
zh  → zh        ✅ 正式支持
en  → en        ✅ 正式支持
ja  → ja        ✅ 正式支持
jp  → ja        ✅ 兼容标签
auto → zh       ⚠️ 保守降级（GPT-SoVITS 部分版本不支持 auto）
ko  → unsupported  ❌
fr  → unsupported  ❌
de  → unsupported  ❌
其他非 zh/en/ja → unsupported  ❌
```

**`text-splitter.ts` 语言检测规则**：

| 检测到 | 标注 lang | 说明 |
|--------|---------|------|
| 含假名（平/片） | `ja` | 即使只有假名没有汉字 |
| CJK 字符占比 > 30% | `zh` | 含汉字和少量假名 |
| 含汉字但 CJK 占比 ≤ 30% | `zh` | 保守优先走中文音色 |
| 含韩文（Hangul） | `unsupported` | 跳过 |
| 含西里尔/阿拉伯/泰文 | `unsupported` | 跳过 |
| 其他拉丁文字（含法语等） | `en` | 统一走英文音色 |

---

## 4. 复杂多语混合句的已知限制

### 表现

输入：
```
给你说句韩语：안녕하세요。再给你说句日语：こんにちは。然后是法语：Bonjour
```

实际行为：
- 韩语句 `안녕하세요` → 被 `detectNonCJKLang` 识别为韩文 → 标注 `unsupported` → **整段被跳过**（不合成）
- 日语句 `こんにちは` → 含片假名 → 标注 `ja` → **正常合成**
- 法语句 `Bonjour` → 拉丁字母 → 标注 `en` → **正常合成**

输出中韩语部分静默缺失，用户不会收到任何提示。

### 原因分析

`splitText` 按标点（`。`）硬切分后，每个片段独立做语言检测。韩语片段中没有中文，`isMostlyCJK` 返回 false，进入 `detectNonCJKLang`，含韩文字符被标记为 `unsupported`，`SpeechQueue` 跳过该段。

**没有中韩日混合一句话内的动态语言切换机制**——每段只能有一个 `lang` 标签，不能在一句话内切换语言。

### 限制级别

**已知 limitation，不作为当前 blocker**。

- 韩语/法语/俄语/阿拉伯语等 unsupported 语言混入句子时，该语言片段静默跳过
- 这不影响主流使用场景（中文为主 + 少量英文/日文）
- 后续增强方向：检测 unsupported 片段时给出明确提示而非静默跳过，或做 phrase-level 中英混合切片（当前不属于 M2 范围）

---

## 5. M2.x 是否已足够 close-out

**结论：是。**

M2（GPT-SoVITS 真实 TTS 接入）当前状态：

| 能力 | 状态 |
|------|------|
| GPT-SoVITS HTTP API 接入（三步加载流程） | ✅ |
| 权重缓存（不重复加载） | ✅ |
| 数字/符号口语化（normalizeForSpeech） | ✅ |
| 标点切片（splitText） | ✅ |
| 中/英/日 三角语言路由 | ✅ |
| 1段预缓冲并发合成 + 顺序播放 | ✅ |
| 播放完成确认回调 | ✅ |
| TTS Settings 配置 UI | ✅ |
| TTS 连接测试 | ✅ |
| TTS 测试入口前处理一致性 | ✅（本次修复） |
| 急停机制（RuntimeService） | ✅ |
| 静音裁剪（可选） | ✅ |

**剩余已知 limitation**：
1. 复杂多语混合句（韩/法/俄等 unsupported 语言混入时静默跳过）
2. 中英日 phrase-level 混合切片（中日在同一句内无法动态切换）

**两者均不影响 M2 核心目标达成，记录为已知限制即可进入 M3。**

---

## 附录：本次 commit

```
a2e1e6a fix(settings): wire TTS test to full normalize→split→queue pipeline
```

改动：`src/features/settings/SettingsPanel.tsx`，约 31 行新增，11 行删除。
