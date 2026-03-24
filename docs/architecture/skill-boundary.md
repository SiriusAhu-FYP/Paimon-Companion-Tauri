# Paimon Live 中 Skill 的定位与边界

## 1. 本文档的目的

本文档用于明确：

- 在 Paimon Live 中，什么叫 Skill
- Skill 与 MCP 的关系是什么
- Skill 与本地执行内核、本地服务、UI 控制层之间如何分工
- 哪些能力适合长成 Skill，哪些不适合
- 后续在项目内引入 Skill 时，应该遵循什么原则

本文档不讨论 Cursor 自身的 Skill，也不讨论开发工作流模板。  
本文档只讨论 **Paimon Live 这个产品内部的 Skill 概念**。

---

## 2. 为什么这个项目需要 Skill

Paimon Live 后续要做的，不只是“模型回复一句话”。

它更像一个虚拟主播系统，后续会不断出现这种完整业务动作：

- 读到弹幕后决定要不要回复
- 查当前商品资料与 FAQ
- 选择合适的情绪和动作
- 生成适合显示的回复文本
- 再生成适合口播的 spoken_text
- 需要时触发商品切换或其他运营动作
- 失败时自动降级，必要时让人工接管

这些能力都不是一个单独的 tool call、一个单独的 provider 或一个单独的 service 能表达的。

它们更像：

**围绕某个业务目标展开的一组可复用编排。**

这就是 Skill 最合适的定位。

---

## 3. 在 Paimon Live 中，Skill 是什么

在本项目中，Skill 更适合被定义为：

**一个面向主播业务目标的可复用编排单元。**

它通常会组合：

- Prompt 规则
- MCP Resources / Tools
- 本地服务
- 状态约束
- fallback 逻辑
- 结果后处理

Skill 的重点不是“它是不是一个函数”，而是：

> 它是否表达了一个完整、可复用、可替换、可约束的主播行为流程。

---

## 4. Skill 不是什么

在 Paimon Live 中，Skill 不是：

- 一个底层 provider
- 一个单独的 MCP Tool
- 一个单独的 React 组件
- 一个 Live2D 动作 API
- 一个音频播放函数
- 一个窗口控制函数

也就是说：

**Skill 不是原子能力本身，而是对原子能力的组织与编排。**

---

## 5. Skill 与 MCP 的关系

本文档默认继承 `mcp-boundary.md` 的判断。

### 简单地说：

- **MCP** 提供标准化原子能力
- **Skill** 把这些原子能力编排成一个完整主播动作

---

## 6. MCP 与 Skill 的分工

## 6.1 MCP 更适合提供什么

MCP 更适合提供：

- 商品资料查询
- FAQ 检索
- 角色设定读取
- 当前直播上下文读取
- 切商品
- 查库存
- 请求某个表情/动作
- 口播文本改写工具
- 模板化提示词入口

这些能力是：

**标准化、可参数化、可独立调用的。**

---

## 6.2 Skill 更适合负责什么

Skill 更适合负责：

- 何时调用这些能力
- 按什么顺序调用
- 什么情况下跳过某一步
- 调用失败后如何降级
- 最终向 Stage / TTS / UI 提交什么结果

这些能力是：

**业务导向、编排导向、结果导向的。**

---

## 7. 一个例子：为什么“回复弹幕”更像 Skill

“回复弹幕”不是一个简单函数。  
它很可能包含：

1. 判断当前是否允许自动回复
2. 读取当前直播上下文
3. 查当前商品资料/FAQ
4. 判断这条弹幕是否值得回复
5. 生成一版 `display_text`
6. 生成一版 `spoken_text`
7. 选择 emotion / motion
8. 提交给 TTS / Stage / UI
9. 在失败时回退到更简化的回复模式

这说明：

- `get_current_product()` 是 MCP 能力
- `search_product_faq()` 是 MCP 能力
- `rewrite_for_tts()` 可以是 MCP 能力
- `request_stage_expression()` 可以是 MCP 能力或本地动作接口

但：

**`reply_to_danmaku` 本身更适合作为 Skill。**

因为它组织的是一整段行为，而不是一个原子动作。

---

## 8. Skill 与本地执行内核的关系

这也是一个重要边界。

### Skill 不负责高频执行
Skill 可以决定：

- 用什么情绪
- 触发什么动作
- 现在要不要说这句话
- spoken_text 应该是什么

但 Skill 不应直接负责：

- 嘴型逐帧更新
- 音频播放调度
- Stage 窗口 attach/floating 底层控制
- Live2D 渲染细节
- 合成队列与播放队列底层实现

这些仍属于：

**本地执行内核。**

---

## 9. Skill 在项目分层中的位置

建议以后按以下分层理解：

## 9.1 执行内核层
包含：

- Stage
- CharacterService
- AudioPlayer
- Pipeline
- Runtime
- 队列系统
- Live2D 渲染器
- 窗口语义控制

这一层负责“把行为稳定做出来”。

---

## 9.2 MCP 能力层
包含：

- 商品资源
- FAQ 资源
- 直播上下文
- 角色 profile
- 离散动作工具
- 运营工具
- 后续检索能力

这一层负责“能查什么、能调什么”。

---

## 9.3 Skill 编排层
包含：

- reply_to_danmaku
- sell_product
- introduce_product
- rewrite_for_tts
- choose_emotion_for_reply
- react_to_gift
- switch_product_with_context

这一层负责“一个主播业务动作怎么组织起来”。

---

## 9.4 UI / 控制层
包含：

- 主控界面
- 设置页
- 状态面板
- 日志面板
- 人工接管入口

---

## 10. 当前项目里适合长成 Skill 的能力

我建议未来优先考虑以下 Skill：

### 10.1 `reply_to_danmaku`
输入：
- 弹幕内容
- 当前直播上下文
- 当前商品信息

输出：
- display_text
- spoken_text
- emotion / motion 请求
- 是否需要回复

---

### 10.2 `introduce_product`
输入：
- 当前商品资料
- 当前活动口径
- 主播角色设定

输出：
- 一段适合直播介绍的内容
- 配套的 spoken_text
- 推荐的情绪/动作

---

### 10.3 `rewrite_for_tts`
输入：
- 原始回复文本

输出：
- 更适合口播的文本版本

注意：
这个 Skill 未来也可能拆成：
- 一个 Skill
- 或一个被多个 Skill 调用的 MCP Tool

---

### 10.4 `choose_emotion_for_reply`
输入：
- 回复文本
- 当前直播场景
- 商品类型
- 角色状态

输出：
- emotion
- motion request

---

### 10.5 `react_to_gift`
输入：
- 礼物事件
- 当前直播上下文

输出：
- display_text
- spoken_text
- emotion / motion

---

## 11. 当前不适合长成 Skill 的能力

以下能力当前不建议包装成 Skill：

- 嘴型控制
- 音频 buffer 播放
- Stage attach/floating/pinToApp 底层行为
- Runtime 急停底层逻辑
- 口型高频同步
- TTS 队列底层执行
- Live2D 参数逐帧更新

这些都属于：

**执行层能力，而不是业务编排层能力。**

---

## 12. Skill 的输入输出应该长什么样

为了避免 Skill 越做越散，建议以后统一遵循：

### 输入
Skill 输入应尽量是“业务上下文”，例如：

- 当前消息
- 当前商品
- 当前角色 profile
- 当前直播状态
- 当前 mode
- 当前上下文资源

### 输出
Skill 输出应尽量是“结构化行为结果”，例如：

- `display_text`
- `spoken_text`
- `emotion`
- `motion`
- `product_switch_request`
- `should_reply`
- `tool_requests`

而不是让 Skill 直接深入控制底层播放器或渲染器。

---

## 13. Skill 设计原则

后续如果项目里开始实现 Skill，建议遵循这些原则：

### 13.1 面向业务目标，不面向技术模块
Skill 应该以“主播行为”命名，而不是以“调用了几个 service”命名。

推荐：
- `reply_to_danmaku`
- `introduce_product`

不推荐：
- `call_knowledge_then_call_tts`

---

### 13.2 输入输出结构化
Skill 的输入输出应尽量清晰，不要到处传临时对象和隐式状态。

---

### 13.3 允许降级
Skill 内部应允许：
- 资料取不到时降级
- 某个 Tool 失败时跳过
- 模型无法决定时退回默认策略

---

### 13.4 不直接承担高频执行
Skill 负责决策和组织，不直接承担逐帧执行。

---

### 13.5 能被替换、能被拆分
一个 Skill 后续如果过大，应该允许拆成：
- 更小 Skill
- 或更多 MCP Tools

---

## 14. 当前阶段要不要立刻实现完整 Skill 系统

我的建议是：

**先定义概念与边界，但不要立刻上完整 Skill 框架。**

原因：

- 当前项目更需要先把真实 LLM / TTS / 角色卡 / 知识注入串起来
- 现在立即实现完整 SkillRuntime / SkillRegistry / SkillGraph 容易过早抽象
- 更好的做法是：
  - 先在文档中定义 Skill
  - 后续在几个真实业务能力中自然长出第一批 Skill

---

## 15. 结论

在 Paimon Live 中：

- MCP 更适合提供标准化原子能力
- Skill 更适合承接主播业务编排
- 本地执行内核仍负责高频实时执行

一句话总结：

**MCP 负责“主播可以调用什么能力”，Skill 负责“主播这件事应该怎么完整地做出来”。**