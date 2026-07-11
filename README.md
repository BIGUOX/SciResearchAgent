# SciResearchAgent 科研智能助手

SciResearchAgent 是一个面向科研资料检索、知识库问答、结构化数据查询与报告生成的多智能体科研助手。它基于 DeepAgents 组织主智能体和多个专业子智能体，通过 FastAPI 与 WebSocket 提供后端服务，并使用 React + Vite 构建可视化前端任务台。

项目适合用于科研综述、课题调研、论文资料整理、行业研究、知识库问答、实验数据或业务数据查询，以及自动生成 Markdown / PDF 研究报告等场景。

## 核心能力

- 多智能体协作：主智能体负责任务理解、步骤规划、工具调度和最终汇总。
- 网络检索：通过 Tavily 搜索公开网页、新闻、政策、论文线索和行业资料。
- 数据库查询：通过 MySQL 工具查看表结构、读取样例数据并执行 SQL 查询。
- 知识库问答：通过 RAGFlow 接入私有文档知识库，支持基于内部资料的问答。
- 附件读取：支持读取用户上传的 PDF、Word、Excel、Markdown 和文本文件。
- 报告交付：可生成 Markdown 报告，并按需转换为 PDF 文件。
- 实时过程展示：任务执行、工具调用、子智能体协作、结果生成和异常信息通过 WebSocket 实时推送到前端。
- 人工审批链路：后端包含审批接口，可用于需要人工确认后再继续执行的 Agent 工作流。

## 技术栈

| 模块 | 技术 | 作用 |
| --- | --- | --- |
| 智能体编排 | DeepAgents、LangGraph、LangChain | 构建主智能体、子智能体和长任务执行链路 |
| 大模型接入 | OpenAI 兼容 API、langchain-openai | 接入通义千问等 OpenAI 协议兼容模型 |
| 网络检索 | Tavily | 获取公开互联网资料 |
| 私有知识库 | RAGFlow、ragflow-sdk | 查询内部文档知识库 |
| 结构化数据 | MySQL、mysql-connector-python | 查询业务数据、样本数据或科研结构化数据 |
| 文件处理 | pypdf、python-docx、pandas、openpyxl、ReportLab | 读取上传文件并生成报告产物 |
| 后端服务 | FastAPI、Uvicorn、WebSocket | 提供任务、上传、下载、审批和实时事件接口 |
| 前端应用 | React、Vite、TypeScript、Ant Design、Tailwind CSS | 提供科研助手交互界面、事件流和文件面板 |
| 依赖管理 | uv、pnpm | 管理 Python 与前端依赖 |

## 系统架构

```text
用户任务
  -> React 前端任务台
  -> FastAPI 接收任务、上传文件、建立 WebSocket
  -> run_deep_agent 创建会话目录并注入上下文
  -> 主智能体分析任务并选择工具或子智能体
  -> 网络检索子智能体 / 数据库查询子智能体 / RAGFlow 知识库子智能体
  -> 主智能体整合多来源资料
  -> 生成 Markdown / PDF 等交付文件
  -> WebSocket 实时推送执行过程与最终结果
```

主智能体位于 `app/agent/main_agent.py`，当前装配了三类信息获取子智能体：

| 子智能体 | 文件 | 能力 |
| --- | --- | --- |
| 网络检索助手 | `app/agent/subagents/network_search_agent.py` | 调用 Tavily 获取公开网络资料 |
| 数据库查询助手 | `app/agent/subagents/database_query_agent.py` | 列表、预览并查询 MySQL 数据 |
| 知识库助手 | `app/agent/subagents/knowledge_base_agent.py` | 调用 RAGFlow 查询私有知识库 |

主智能体直接持有报告和文件相关工具：

- `read_file_content`：读取用户上传的文件内容。
- `generate_markdown`：生成 Markdown 报告。
- `convert_md_to_pdf`：将 Markdown 转换为 PDF。

## 项目结构

```text
SciResearchAgent-main/
├─ app/
│  ├─ agent/
│  │  ├─ main_agent.py              # 主智能体与 run_deep_agent 入口
│  │  ├─ prompts.py                 # 读取提示词配置
│  │  └─ subagents/                 # 网络、数据库、知识库子智能体
│  ├─ api/
│  │  ├─ server.py                  # FastAPI 接口与 WebSocket
│  │  ├─ monitor.py                 # 任务事件推送
│  │  ├─ context.py                 # 会话上下文
│  │  └─ approvals.py               # 人工审批状态管理
│  ├─ prompt/
│  │  └─ prompts.yml                # 主智能体与子智能体提示词
│  ├─ tools/
│  │  ├─ tavily_tool.py             # 网络检索工具
│  │  ├─ db_tools.py                # MySQL 查询工具
│  │  ├─ ragflow_tools.py           # RAGFlow 工具
│  │  ├─ upload_file_read_tool.py   # 上传文件读取
│  │  ├─ markdown_tools.py          # Markdown 生成
│  │  └─ pdf_tools.py               # PDF 转换
│  ├─ output/                       # 运行时生成的报告文件
│  └─ updated/                      # 运行时上传文件暂存目录
├─ docker/
│  └─ docker-compose.yaml           # 本地 MySQL 示例环境
├─ docs/                            # 项目文档与知识库示例资料
├─ examples/                        # DeepAgents 示例脚本
├─ frontend/
│  ├─ src/
│  │  ├─ components/                # 前端任务台组件
│  │  ├─ hooks/                     # 会话状态 Hook
│  │  └─ lib/                       # API、配置、线程工具
│  ├─ package.json
│  └─ vite.config.ts
├─ .env.example                     # 后端环境变量示例
├─ pyproject.toml                   # Python 依赖声明
├─ requirements.txt                 # Python 依赖清单
└─ uv.lock                          # uv 锁文件
```

## 快速开始

### 1. 环境要求

- Python 3.12
- uv
- Node.js 与 pnpm
- Docker 与 Docker Compose
- 可用的大模型 API Key
- Tavily API Key
- RAGFlow 服务与 API Key，可选但推荐配置

### 2. 安装后端依赖

```bash
uv sync
```

如果不用 uv，也可以使用：

```bash
pip install -r requirements.txt
```

### 3. 配置后端环境变量

复制示例配置：

```bash
cp .env.example .env
```

按你的实际服务修改 `.env`：

```bash
OPENAI_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
OPENAI_API_KEY=你的大模型_API_KEY
LLM_QWEN_MAX=qwen-max

TAVILY_API_KEY=你的_TAVILY_API_KEY

RAGFLOW_API_URL=http://your-ragflow-host
RAGFLOW_API_KEY=ragflow-your-api-key

MYSQL_USER=root
MYSQL_PASSWORD=root
MYSQL_DATABASE=deepsearch_db
MYSQL_HOST=localhost
MYSQL_PORT=3307
MYSQL_CHARSET=utf8mb4
MYSQL_COLLATION=utf8mb4_unicode_ci
MYSQL_SQL_MODE=TRADITIONAL
```

### 4. 启动 MySQL 示例库

```bash
docker compose -f docker/docker-compose.yaml up -d
```

如果你已有自己的科研数据或业务数据库，也可以直接修改 `.env` 中的 MySQL 连接信息。

### 5. 准备 RAGFlow 知识库

RAGFlow 不在本项目的 Docker Compose 中启动，需要连接你已有的 RAGFlow 服务。可以将 `docs/knowledge_base/` 中的示例资料导入 RAGFlow，创建知识库和聊天助手后，再在 `.env` 中配置 `RAGFLOW_API_URL` 与 `RAGFLOW_API_KEY`。

不配置 RAGFlow 时，网络检索、数据库查询、上传文件读取与报告生成仍可使用；只有任务需要查询私有知识库时才会依赖 RAGFlow。

### 6. 启动后端

```bash
uv run uvicorn app.api.server:app --host 0.0.0.0 --port 8000 --reload
```

后端默认监听：

```text
http://localhost:8000
```

### 7. 安装并启动前端

```bash
cd frontend
pnpm install
pnpm dev
```

前端默认连接：

```text
API: http://localhost:8000
WS:  ws://localhost:8000
```

如需修改，编辑 `frontend/.env.example` 或创建 `frontend/.env.local`：

```bash
VITE_API_BASE_URL=http://localhost:8000
VITE_WS_BASE_URL=ws://localhost:8000
```

## 后端接口

| 接口 | 说明 |
| --- | --- |
| `POST /api/task` | 启动一次科研助手任务 |
| `POST /api/task/{thread_id}/cancel` | 取消指定会话任务 |
| `POST /api/upload` | 上传一个或多个文件到指定会话 |
| `GET /api/files` | 列出指定会话的输出文件 |
| `GET /api/download` | 下载生成的文件 |
| `GET /api/approvals/{approval_id}` | 查询人工审批状态 |
| `POST /api/approvals/{approval_id}/approve` | 通过审批 |
| `POST /api/approvals/{approval_id}/reject` | 拒绝审批 |
| `WebSocket /ws/{thread_id}` | 推送执行过程、工具调用、结果和错误事件 |

## 示例任务

可以在前端输入类似任务：

```text
检索近两年多智能体在科研文献综述中的应用进展，整理成一份 Markdown 研究摘要。
```

```text
读取我上传的论文 PDF，提取研究问题、方法、实验设计、主要结论和局限性。
```

```text
结合数据库中的样例数据，分析药品库存风险，并生成一份可下载的 PDF 报告。
```

```text
从 RAGFlow 知识库中查找与课题相关的内部资料，再结合公开网络信息生成研究计划草案。
```

## 开发说明

- 后端提示词集中在 `app/prompt/prompts.yml`，可以按科研领域改写主智能体与子智能体行为。
- 新增外部工具时，建议放在 `app/tools/`，再挂载到主智能体或对应子智能体。
- 运行时文件按会话隔离，上传文件位于 `app/updated/`，生成结果位于 `app/output/`。
- 前端核心状态管理在 `frontend/src/hooks/useDeepAgentSession.ts`，界面组件位于 `frontend/src/components/`。
- 生产部署时请妥善保护 `.env` 中的 API Key、数据库密码和 RAGFlow Token。

## 常见问题

### 任务没有返回网络资料

检查 `TAVILY_API_KEY` 是否有效，并确认当前运行环境可以访问 Tavily 服务。

### 数据库查询失败

确认 MySQL 容器是否已启动，`.env` 中的 `MYSQL_HOST`、`MYSQL_PORT`、用户名、密码和数据库名是否与实际环境一致。

### RAGFlow 查询失败

确认 RAGFlow 服务可访问，API Key 有效，并且已经创建可用的知识库助手。

### 前端无法连接后端

确认后端运行在 `http://localhost:8000`，并检查 `frontend/.env.local` 中的 `VITE_API_BASE_URL` 和 `VITE_WS_BASE_URL`。

## License

请根据你的项目实际授权方式补充 License 信息。
