# services/llm/

LLM 对接服务。

## 职责

- 与大语言模型 API 通信（OpenAI 兼容接口）
- 对话历史管理
- System Prompt 与角色人设注入
- 工具调用（Tool Use）解析与转发
- 知识接入层预留（长期知识 vs 临时高优先级商品消息）
- 流式响应处理
