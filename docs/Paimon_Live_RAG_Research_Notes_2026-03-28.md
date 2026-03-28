# Paimon Live RAG 方案调研笔记（2026-03-28）

> 目的：沉淀本轮对 Cherry Studio 及其他成熟产品的 RAG 实现调研，供后续 Phase 4 / Knowledge Run 技术选型与边界制定参考。
>
> 说明：本文是面向项目内部的工程研究笔记，不是最终 PRD。重点在于：哪些思路值得继承、哪些实现适合当前阶段、哪些坑需要提前规避。

## 一、这次调研最重要的结论

1. **Cherry Studio 证明了“桌面应用做本地知识库”这条路是成立的。**
   它不是把 RAG 丢到一个外部云服务里，而是放在桌面应用主进程的 `KnowledgeService` 中管理。

2. **RAG 不该只是“向量检索 + 一把塞进 prompt”。**
   成熟产品普遍已经走到：
   - 多来源导入
   - 文档解析与分块
   - 持久化索引
   - hybrid retrieval（关键词 + 向量）
   - rerank
   - 引用来源展示
   - 用户可调的检索参数

3. **对 Paimon Live 来说，当前最合理的方向不是“先做超重 Rust 检索内核”，而是先完成一个可测试、可解释、可持续迭代的本地 RAG 闭环。**
   也就是：
   - 可导入
   - 可搜索验证
   - 可引用
   - 可调参
   - 可安全注入当前 LLM 主链路

4. **知识库在 Paimon Live 里不是支线，而是主线。**
   当前角色与上下文层已经完成前半段；接下来欠缺的是 knowledge base productization：持久化、导入、检索、引用、后续再扩展到更完整的 RAG。

---

## 二、Cherry Studio：它的 RAG 大概是怎么做的

### 2.1 架构位置：RAG 在主进程服务层，而不是 UI 层

Cherry Studio 的仓库说明里明确把 `KnowledgeService` 放在主进程服务列表中，并标注为 “RAG / knowledge base (via `@cherrystudio/embedjs`)”。这说明它把知识库能力放在 backend/service 层，而不是渲染层临时拼装。

这点对 Paimon Live 很重要：
- UI 负责管理和展示
- service/backend 负责文档导入、索引、检索和生命周期
- 这样才能避免前端状态和知识索引逻辑纠缠在一起

### 2.2 技术形态：本地知识库 + embedjs 生态

从 Cherry Studio 的 `package.json` 可以直接看出它的知识库不是手写一整套 parser / vector store，而是基于 `@cherrystudio/embedjs` 及其配套 loader 实现。

可见依赖包括：
- `@cherrystudio/embedjs`
- `@cherrystudio/embedjs-libsql`
- `@cherrystudio/embedjs-loader-csv`
- `@cherrystudio/embedjs-loader-image`
- `@cherrystudio/embedjs-loader-markdown`
- `@cherrystudio/embedjs-loader-msoffice`
- `@cherrystudio/embedjs-loader-pdf`
- `@cherrystudio/embedjs-loader-sitemap`
- `@cherrystudio/embedjs-loader-web`
- `@cherrystudio/embedjs-loader-xml`
- `@cherrystudio/embedjs-ollama`
- `@cherrystudio/embedjs-openai`

这基本暴露了它的实现路径：
- loader 负责读不同来源
- embedjs 负责文档处理 / embedding / retrieval 的主流程
- libsql 作为本地存储底座
- embedding / rerank provider 可切换

### 2.3 产品能力：Cherry 已经不是“只能传文件”

Cherry Studio 官方知识库教程显示，它支持：
- 创建知识库时选择 embedding model
- 导入文件并自动 vectorize
- 支持 `pdf/docx/pptx/xlsx/txt/md/mdx` 等格式
- 支持整目录导入
- 支持网站 URL
- 支持 sitemap
- 支持纯文本笔记
- 支持手工搜索知识库并显示匹配分数
- 在对话中引用知识库并给出来源引用

这说明 Cherry 的产品层已经明确区分：
- **知识导入**
- **知识搜索验证**
- **知识在对话中的使用与引用**

对于 Paimon Live，这里最值得学的不是“做很多格式”，而是产品节奏：
1. 先能导入
2. 再能搜索验证
3. 最后再接对话引用

### 2.4 Cherry 的成熟点：它已经做了 rerank

Cherry 的知识库流程公开痕迹显示，它已经存在 rerank 步骤，知识库中 embedding model 和 reranking model 都可以配置，Top N 等设置也会影响 rerank 的工作范围。

这意味着它不是“向量搜出来就结束”，而是：
- retrieval 先召回
- reranker 再收缩候选片段
- 最终把更相关的内容送进回答

对于 Paimon Live，这一点值得学，但不代表第一版必须重型实现。更现实的做法是：
- 第一版预留 rerank 开关与接口
- 默认可先关闭
- 等搜索质量不够时再加

### 2.5 Cherry 暴露出的坑：这部分非常值得学

Cherry 的公开 issue 很有价值，因为它暴露了知识库产品化里的真实坑：

#### 坑 1：embedding 维度漂移会直接打爆旧库

Cherry 的 issue 中出现过升级后检索失败，错误是：`vector_distance: vectors must have the same length: 4096 != 1024`。报错说明旧知识库是在 4096 维 embedding 下建立的，而升级后的系统错误地改用了 1024 维，导致检索直接失效。

**对 Paimon Live 的启发：**
- 知识库元数据里必须保存：
  - embedding provider
  - embedding model id
  - embedding dimension
  - chunking 策略版本
  - index schema version
- 这些都不能只存在 UI 配置里，必须成为知识库本身的一部分
- 一旦 model / dim 变化，应该明确提示“需重建索引”，而不是静默复用旧库

#### 坑 2：大批量 rerank / embedding 会遇到请求体、性能和稳定性问题

Cherry 的 issue 还反映出 rerank 请求体过大、远程 rerank 失败等问题。

**对 Paimon Live 的启发：**
- 不要把过多 chunk 一次性送进 rerank
- 检索和重排前都要有硬阈值
- 需要把 topK、候选数、context 注入上限分成不同参数

#### 坑 3：网站导入不稳定，必须给“搜索验证入口”

Cherry 官方教程自己就提醒：网站导入不一定成功，最好创建后先做搜索测试。

**这对你们极关键。**
因为 Paimon Live 现在最需要的是“能测试”，而不是“导入了看起来很厉害”。

---

## 三、Cherry Studio 最值得 Paimon Live 学的三件事

### 3.1 本地知识库是完全可行的

Cherry 已经证明桌面应用完全可以做：
- 本地导入
- 本地持久化
- 本地搜索
- 本地对话引用

这说明你们不需要因为 RAG 就立刻拆成独立后端服务。

### 3.2 知识层应在 service/backend 层，不应绑死在 UI 层

这和你们现在的项目结构也很契合。Paimon Live 本来就已经在往 service 分层走，知识库天然应属于 service 层而不是页面逻辑。

### 3.3 产品上一定要有“搜索验证 + 引用来源”

Cherry 官方流程不是“导入完直接聊天”，而是先允许用户手工搜索知识库并看分数，再在聊天中附来源引用。

**这非常适合 Paimon Live。**
因为你们现在需要的是可测、可证伪、可调参，而不是一个表面上“会回答”的黑箱。

---

## 四、AnythingLLM：最值得学的是什么

AnythingLLM 很像“桌面 / 本地知识产品化”的另一个成熟样本。

### 4.1 默认本地 LanceDB，这点很强

AnythingLLM 文档明确说，默认会使用内置的 LanceDB，本地文档文本和 embeddings 都不会离开应用。

这点非常符合 Paimon Live 当前阶段：
- 你们暂时不需要上 client-server 向量库
- 本地底座越简单，越适合现在的桌面主工程
- LanceDB 也方便后续扩展成更正规知识库底层

### 4.2 它很重视用户可调的检索旋钮

AnythingLLM 文档里把这些设置讲得很清楚：
- Search Preference / Reranking
- Max Context Snippets
- Document similarity threshold

而且它非常诚实地给出经验值：
- reranking 会增加大约 100–500ms 响应时间
- 大多数模型的 snippets 最好控制在 4–6
- 相似度阈值过高会把真正有用的 chunk 过滤掉

**这对 Paimon Live 的启发：**
第一版知识库就应该预留最少但关键的调参项：
- topK / max snippets
- similarity threshold
- 是否启用 rerank

不要把它们写死。

### 4.3 Query Mode vs Chat Mode 的区分值得学

AnythingLLM 把两种模式分得很清楚：
- Query Mode：只依赖文档，不找不到就说找不到
- Chat Mode：文档 + 模型一般知识一起用

这对 Paimon Live 很有价值。你们未来很可能也需要区分：
- **严格知识回答**：FAQ / 商品资料 / 规则口径
- **角色化自由聊天**：允许角色风格发挥

否则系统会把“查知识”和“角色扮演”混成一团，很难测。

---

## 五、Open WebUI：最值得学的是什么

Open WebUI 的强项不在“桌面产品形态”，而在**检索策略更成熟**。

### 5.1 它默认只注入最相关片段

Open WebUI 文档明确写了：Knowledge 使用 RAG 找相关 chunks，只把最相关的部分注入上下文。

这点看起来普通，但很关键：
- 不是所有检索结果都该喂给 LLM
- 文档检索必须强调“节制注入”

### 5.2 它把 hybrid search 做成正式能力

官方文档明确写明，开启 hybrid search 后，会使用：
- BM25 keyword search
- vector search
- reranking

这说明成熟产品已经不把“纯向量搜”当终点了。

对 Paimon Live 来说，这尤其重要，因为你们的知识里会有很多**关键词强召回场景**：
- 商品名
- 型号
- 品牌词
- 活动名
- FAQ 固定提法
- 直播间固定话术

这些内容只靠向量检索并不稳。

### 5.3 它还做了 retrieval query generation

Open WebUI 的配置与讨论中都可以看到，它会基于用户问题和聊天历史自动生成 1–3 个检索 query，再用这些 query 去搜知识库。

这个能力很值得你们后续考虑，尤其直播语境下用户问法经常很口语化、很碎。

例如：
- “这个能防水不”
- “刚刚那个蓝色的有没有大码”
- “那个不是说联名吗”

这些原始问法未必适合直接检索。让系统先做 query rewrite，再去搜商品或 FAQ，会稳很多。

---

## 六、Dify：最值得学的其实是“chunk 结构设计”

Dify 最大的启发不是“它支持很多插件”，而是它把知识内容区分成不同 chunk 结构，而不是所有内容一刀切。

### 6.1 它明确支持三种 chunk 结构

Dify 文档写得非常清楚：
- General Mode
- Parent-child Mode
- Q&A Mode

并且官方还建议：第一次建知识库时优先考虑 Parent-child Mode。

### 6.2 Parent-child 很适合长商品资料和长说明文档

Dify 文档对 Parent-child 的描述很实用：
- child chunk 用来做高精度匹配
- parent chunk 提供更完整上下文

这很适合你们未来的：
- 长商品介绍
- 品牌资料
- 使用说明
- 活动规则

### 6.3 Q&A Mode 对 FAQ 特别合适

Dify 的 Q&A Processor 是专门给结构化问答数据用的，很适合 FAQ、排班表、清单类表格。

对 Paimon Live 来说，这个启发非常直接：
- 商品 FAQ
- 售后规则 FAQ
- 直播常见问答
- 活动规则问答

都不该和普通长文档混为一种 chunk。

### 6.4 Dify 还把数据处理看成一条可观察 pipeline

Dify 最新 Knowledge Pipeline 的思路是：
- Parse
- Enrich
- Chunk
- Embed
- Load
- Retrieval + rerank + citation
- 还支持 test run / variable inspect

这对你们虽然不必照抄，但理念值得吸收：

> **知识库不是一个“上传文件黑箱”，而是一条可以被拆开观察和验证的处理链。**

这很像你们现在最需要的东西：能测、能看中间结果、能定位问题。

---

## 七、LibreChat：最值得学的是什么

LibreChat 的启发不在“现在立刻照搬”，而在于它把 RAG 作为一个可分离能力。

LibreChat 官方文档明确写了，它的 RAG API 是：
- LangChain
- FastAPI
- 独立文档索引 / 检索 API
- 与主聊天系统集成

这对 Paimon Live 的意义是：
- 现在可以先做主工程内嵌式 RAG
- 以后如果知识库膨胀、需要独立伸缩或独立维护，可以把这层抽出来

也就是说，当前阶段不需要一开始就上 sidecar，但架构上最好保留未来拆分的可能性。

---

## 八、把这些产品对照起来看，我们真正学到了什么

### 8.1 Cherry Studio 学的是“桌面本地知识库形态”
- backend/service 持有知识库
- 本地导入与本地持久化
- 多 source loader
- 手工搜索验证
- 回答附引用

### 8.2 AnythingLLM 学的是“检索调参产品化”
- 本地 LanceDB 默认底座
- rerank / snippets / threshold 都是用户可调的
- 区分 Query Mode 和 Chat Mode

### 8.3 Open WebUI 学的是“检索策略成熟化”
- hybrid retrieval
- rerank
- 只注入最相关片段
- query generation

### 8.4 Dify 学的是“不同知识类型要不同 chunk 结构”
- general
- parent-child
- q&a
- 可视化处理管线

### 8.5 LibreChat 学的是“RAG 可独立成服务边界”
- 现在可内嵌
- 将来可拆分

---

## 九、对 Paimon Live 最实际的工程建议

### 9.1 不要把第一版做成“纯向量搜 + 全塞 prompt”

这会很快撞上几个问题：
- 商品名 / 型号 / 固定规则召回差
- 长上下文噪声高
- 很难调试
- 很难解释“为什么这次答错”

### 9.2 第一版应该至少具备这些产品能力

#### A. 知识导入
最低应支持：
- 纯文本
- FAQ
- 商品资料
- 普通 Markdown / txt

后续再扩到 pdf / docx / 网页。

#### B. 知识搜索验证
必须有一个单独入口，允许：
- 输入 query
- 查看命中 chunk
- 查看分数 / 来源
- 验证知识本身是否被正确索引

#### C. 对话引用
当知识参与回答时，必须带：
- source title
- source type
- chunk excerpt 或来源定位

#### D. 检索参数调节
第一版最少保留：
- topK / max snippets
- similarity threshold
- 是否启用 rerank

### 9.3 第一版更适合的知识类型划分

建议一开始就按三类存：

#### 1. FAQ
- 适合 Q&A chunk
- 典型内容：售后、发货、尺码、活动规则

#### 2. 商品资料
- 适合 parent-child
- 典型内容：商品介绍、卖点、参数、注意事项

#### 3. 普通文档 / 运营资料
- 适合 general chunk
- 典型内容：运营口径、品牌背景、直播话术、内部备忘

这会比“所有东西都切成 500 字块”强得多。

### 9.4 检索策略建议：从第一版就做 hybrid-ready

即便第一版不做完整高级混合检索，也应该在数据结构和边界上准备好：
- vector recall
- lexical recall
- optional rerank
- citation packaging

因为你们的知识场景天然适合 hybrid。

### 9.5 模式建议：早一点区分“严格知识回答”与“角色聊天”

这个非常重要。

建议未来至少有两种工作语义：
- **Knowledge / Query mode**：严格基于检索结果回答，找不到就说找不到
- **Persona / Chat mode**：允许角色风格发挥，但知识结果仍可作为约束或优先参考

否则测试时会一直分不清：
- 是检索错了
- 还是角色发挥过头了
- 还是 LLM 自己编了

---

## 十、对技术选型的再判断

### 当前最像样的方向
如果延续前一轮调研结论，我仍然认为当前最像样的组合是：
- **LlamaIndex.TS**：编排 ingest / retriever / query engine
- **LanceDB**：本地持久化向量底座
- **Transformers.js 或其他本地 embedding 方案**：前期尽量降低对外部 embedding API 的依赖

### 为什么仍然成立
因为它们和这次产品调研得到的经验是对齐的：
- Cherry / AnythingLLM 都证明了本地知识库可行
- AnythingLLM 也证明了 LanceDB 做桌面内置底座是合理的
- 你们现在更需要“快形成闭环”，而不是抢着 Rust-native all-in

### Rust 的定位应该是什么
当前我不建议你们一上来把检索核心全下沉到 Rust。更合理的是：
- 先把知识产品闭环跑起来
- Rust 负责文件 IO / backend bridge / 稳定存储边界
- 真到性能或长期维护需要时，再逐步下沉 embedding / lexical / ANN 内核

---

## 十一、如果由我来定义第一轮 RAG 实现边界

### 本轮要做
1. 本地知识库存储
2. FAQ / 商品资料 / 普通文档 三类知识导入
3. 检索验证入口
4. 基础引用展示
5. 检索结果安全注入当前 LLM 主链路
6. 最少量的调参入口

### 本轮先不做
1. 全格式大而全 loader
2. 网页抓取全家桶
3. 完整可视化 ETL canvas
4. 多租户
5. 图谱型 RAG
6. 复杂 agentic retrieval
7. 过早重型 Rust 检索内核

### 本轮验收标准
1. 用户可导入最少几类知识
2. 用户可在独立搜索入口验证结果
3. 对话回答可引用来源
4. FAQ 与商品资料检索质量可被真实手测
5. 与当前角色系统结合时，不会把知识层和角色层搅乱

---

## 十二、这次调研之后，我最希望项目组记住的几句话

### 1. Cherry Studio 值得学，但不要神化
它证明了桌面本地知识库这条路可行，但它暴露出的维度漂移、rerank 负载、网站导入不稳定等问题，同样说明知识库是“产品工程”，不是装个向量库就结束。

### 2. 真正成熟的 RAG，都很重视“可验证”
成熟产品不是只强调“能回答”，而是强调：
- 可搜索
- 可引用
- 可调参
- 可区分模式
- 可定位错误

### 3. 对 Paimon Live 来说，知识库不是附加件
它直接决定：
- 商品讲解能不能落地
- FAQ 能不能稳定回答
- 后续直播接线进来后，系统有没有真实内容可用

### 4. 现在最重要的不是追求最强技术，而是做出第一条可测闭环
导入、检索、引用、注入，这四件事先成立，后面的优化才有意义。

---

## 十三、建议的后续动作

### 给 Minimax / Trae 的下一轮观察重点
1. 现有 `KnowledgeService` / context 组装链路里，最适合插入 RAG retrieval 的位置在哪里
2. FAQ / 商品资料 / 普通文档 三类知识在当前仓库里分别该落什么结构
3. 当前最小搜索验证入口应放在哪个 panel / route
4. 引用来源在当前聊天 UI 里最自然的展示位在哪里
5. 哪些 store / service 现有边界可直接复用，哪些需要新增

### 给 Opus 的后续施工边界
1. 先做知识导入、搜索验证、引用展示、主链路注入
2. 不要一上来做超大而全格式支持
3. 不要急着上完整 RAG 高级花活
4. 不要把知识检索逻辑塞进 UI 页面
5. 必须把 embedding model / dimension / chunk strategy 做进知识库元数据

---

## 十四、参考来源（按本轮调研）

- Cherry Studio `CLAUDE.md`
- Cherry Studio `package.json`
- Cherry Studio knowledge base docs
- Cherry Studio issues about embedding dimension mismatch / rerank failures
- AnythingLLM docs: vector database, using documents, chat modes
- Open WebUI docs: Knowledge, env configuration, query generation discussions
- Dify docs: indexing methods, knowledge pipeline orchestration, knowledge pipeline release notes
- LibreChat docs: RAG API

