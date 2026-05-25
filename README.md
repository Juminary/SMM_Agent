# 供销计划异常协调Agent + 黑盒可见化调试工作台

## 项目概述

**应用场景**：九安医疗 BOM 成本核算  
**双题目覆盖**：
- **题目5**：供销计划异常协调Agent — 自动检测供应商报价异常，AI 自主诊断根因，生成应对方案
- **题目11**：黑盒可见化调试工作台 — 让业务人员理解 AI 决策过程，支持人工干预

---

## 系统架构

```
┌─────────────────────────────────────────────────────┐
│                    前端 (React 18)                    │
│  Dashboard / QuoteList / QuoteDetail / Trace / Stats │
└────────────────────┬────────────────────────────────┘
                     │ REST API
┌────────────────────┴────────────────────────────────┐
│                  FastAPI 后端                         │
│                                                      │
│  ┌────────── 第一阶段：体检（确定性）────────────┐   │
│  │  build_material → predict_price ┐              │   │
│  │                  → analyze_cost ├→ score → triage│   │
│  │                  → match_similar┘              │   │
│  └──────────────────┬────────────────────────────┘   │
│                     │                                │
│         score<20    20≤score<60    score≥60          │
│            │            │            │               │
│       快速通道      标准诊断      紧急升级            │
│       (自动通过)   (Agent+确认)  (Agent+强制确认)    │
│            │            │            │               │
│            └────────────┴────────────┘               │
│                         │                            │
│  ┌────── 第二阶段：Agent诊断（LLM自主）─────────┐   │
│  │  start → agent_router ↔ execute_tool          │   │
│  │           → conclude → wait_human → finalize  │   │
│  └───────────────────────────────────────────────┘   │
│                                                      │
│  11 个 Skill/Tool  │  Kimi K2.5 LLM  │  SQLite/PG   │
└─────────────────────────────────────────────────────┘
```

### 两阶段 + 三条路径

| | 快速通道 | 标准诊断 | 紧急升级 |
|---|---|---|---|
| 触发条件 | score < 20 | 20 ≤ score < 60 | score ≥ 60 |
| Agent 诊断 | 跳过 | 完整执行 | 完整执行 |
| 人工确认 | 不需要 | interrupt 等待 | interrupt 强制 |
| 方案生成 | 1 方案 | 多方案对比 | 多方案 + 升级 |

---

## 数据库

### 快速开始

```bash
cd backend

# 1. 初始化数据库 + 迁移 JSON 数据
python -m app.db.migrate

# 2. 生成大量测试数据（可选）
python -m app.db.seed_data --reset
```

执行后生成 `data/smm_agent.db`（SQLite，约 1.2MB），包含所有业务数据。

### Schema（8 张表）

| 表 | 说明 | 数据量 |
|---|---|---|
| `materials` | 物料主数据（品类/材质/工艺/价格） | 15 → 500+ |
| `quotes` | 报价分析全量结果（含偏离度/方案/轨迹） | 5 → 200+ |
| `external_references` | 外部市场参考价 | 10 |
| `industry_benchmarks` | 行业成本结构基准 | 5 |
| `supplier_profiles` | 供应商画像（从 materials 物化） | 自动刷新 |
| `raw_material_prices` | 原材料市场价格时序 | 240 |
| `processing_rates` | 工艺费率 | 9 |
| `checkpoints` + `checkpoint_writes` | LangGraph 执行状态持久化 | 自动 |

### 切 PostgreSQL

```bash
export DATABASE_URL="postgresql://user:pass@localhost:5432/smm_agent"
python -m app.db.migrate
```

SQLite 和 PostgreSQL 共享同一套 SQL 接口，只改连接串。

---

## 快速开始

### 环境要求

- Python 3.11+
- Node.js 18+
- （可选）Docker（用于 PostgreSQL）

### 1. 后端

```bash
cd backend
pip install -r requirements.txt

# 配置环境变量
cp .env.example .env
# 编辑 .env，填入 KIMI_API_KEY

# 初始化数据库 + 迁移数据
python -m app.db.migrate

# 生成测试数据（500物料 + 200报价 + 行情数据）
python -m app.db.seed_data --reset

# 启动
python run.py
# 或：uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

### 2. 前端

```bash
cd frontend
npm install
npm run dev
```

访问 `http://localhost:5173`

### 3. 环境变量

```bash
# backend/.env
KIMI_API_KEY=sk-xxx
KIMI_BASE_URL=https://ai-gateway.ailab.jiuan.com/v1
KIMI_MODEL=kimi-k2.5

# 数据库（可选，默认 SQLite）
# DATABASE_URL=sqlite:///data/smm_agent.db
```

---

## 工具集（11 个 Skill/Tool）

### 第一阶段：体检工具（确定性，代码直接调用）

| 工具 | 实现 | 数据源 |
|---|---|---|
| `tool_match_similar_material` | **Embedding 向量检索**（BGE-small-zh 512d）+ 规则兜底 | materials |
| `tool_predict_price_range` | 分位数统计 P10/P50/P90 + 工艺/数量系数 | materials |
| `tool_analyze_cost_structure` | 行业基准反推 5 项成本参考值（标注 `reference_only`） | benchmarks |
| `tool_score_deviation` | 两层串联打分：α×价格 + β×成本 + γ×市场 → 外部校准 | prediction + cost + external |
| `tool_generate_solutions` | 规则模板：正常→通过 / 警示→议价 / 紧急→多方案 | 无 |

### 第二阶段：诊断工具（LLM 通过 function calling 自主选择）

| 工具 | 功能 | 数据源 |
|---|---|---|
| `tool_get_supplier_profile` | 供应商历史偏离趋势、均价、合作跨度 | materials |
| `tool_compare_peer_price` | 同品类同行价格对比，溢价% | materials |
| `tool_check_market_trend` | 外部市场行情、参考价区间 | external_references |
| `tool_check_urgency` | 库存紧急度（占位，待对接 ERP） | 无 |
| `tool_search_alternatives` | 替代供应商检索 | materials |
| `tool_analyze_cost_anomaly` | 成本异常项深度分析 + 追问建议 | cost_analysis + 模板 |

---

## API 端点

| 方法 | 路径 | 说明 |
|---|---|---|
| `POST` | `/api/quotes/analyze` | 核心：分析报价异常 |
| `GET` | `/api/quotes` | 报价列表（支持 status/severity 筛选） |
| `GET` | `/api/quotes/{id}` | 报价详情（含诊断结论/调查过程） |
| `POST` | `/api/quotes/{id}/decision` | 提交人工决策 |
| `GET` | `/api/quotes/{id}/trace` | 执行轨迹 |
| `POST` | `/api/quotes/{id}/rerun` | 参数调整后重跑 |
| `GET` | `/api/materials` | 物料列表 |
| `GET` | `/api/materials/{id}` | 物料详情 |
| `GET` | `/api/external-references` | 外部参考数据 |
| `GET` | `/api/benchmarks` | 行业成本基准 |
| `GET` | `/api/stats` | 统计信息 |
| `GET` | `/health` | 健康检查 |

### 分析请求示例

```json
POST /api/quotes/analyze
{
  "material_id": "MAT-0001",
  "material_name": "ABS注塑外壳",
  "supplier_quote": 15.0,
  "supplier_name": "华塑科技",
  "quantity": 10000,
  "quote_date": "2025-05-25",
  "category": "塑料外壳",
  "material_type": "ABS",
  "processing": "注塑成型"
}
```

### 分析响应关键字段

```json
{
  "id": "Q-20250525...",
  "deviation_score": 37.7,
  "severity_level": "关注",
  "phase": "diagnosis",
  "diagnosis_conclusion": {
    "root_cause": "供应商溢价：同行均价 ¥11.07，当前报价偏高 36%",
    "cause_category": "supplier_premium",
    "confidence": 0.75
  },
  "diagnosis_investigations": [
    {"step": 1, "tool": "tool_get_supplier_profile", ...},
    {"step": 2, "tool": "tool_compare_peer_price", ...}
  ],
  "decision_log": [...],
  "solutions": [...],
  "similar_materials": [...],
  "cost_breakdown": {...},
  "execution_trace": [...]
}
```

---

## 项目结构

```
SMM_Agent/
├── backend/
│   ├── app/
│   │   ├── main.py                    # FastAPI 入口
│   │   ├── agent/
│   │   │   ├── langgraph_agent.py     # 两阶段 + 三条路径图
│   │   │   └── graph_config.py        # Checkpoint 配置
│   │   ├── skills/
│   │   │   ├── agent_core.py          # 11 个 Skill/Tool + AgentOrchestrator
│   │   │   ├── tool_base.py           # Tool 基类
│   │   │   └── tool_registry.py       # 工具注册中心
│   │   └── db/
│   │       ├── database.py             # 连接管理 + Schema + CRUD + Checkpointer
│   │       ├── migrate.py              # JSON → SQLite 迁移
│   │       └── seed_data.py            # 大规模测试数据生成
│   ├── models/
│   │   └── training/                   # 模型训练脚本（XGBoost 基线）
│   ├── requirements.txt
│   ├── run.py
│   └── .env
├── frontend/
│   ├── src/
│   │   ├── pages/
│   │   │   ├── Dashboard.tsx
│   │   │   ├── QuoteList.tsx
│   │   │   ├── QuoteDetail.tsx
│   │   │   ├── NewQuote.tsx
│   │   │   ├── ExecutionTrace.tsx
│   │   │   └── Stats.tsx
│   │   ├── components/
│   │   ├── types/
│   │   └── utils/
│   ├── package.json
│   └── vite.config.ts
├── data/
│   ├── raw/                  # 原始 JSON 数据
│   └── smm_agent.db          # SQLite 数据库
└── docs/
    └── agent-redesign-plan.md  # 重构设计方案
```

---

## 依赖

### Python (backend/requirements.txt)

```
fastapi, uvicorn, pydantic, numpy, scikit-learn
langgraph>=1.2.0, langgraph-checkpoint-sqlite
openai>=1.12.0, httpx
sentence-transformers
python-dotenv
```

### Node (frontend/package.json)

```
react 18, typescript, tailwindcss, recharts
reactflow, zustand, axios, lucide-react
```

---

## 数据生成

```bash
# 重新生成（清空旧数据）
python -m app.db.seed_data --reset

# 追加生成
python -m app.db.seed_data
```

生成数据覆盖 8 个品类、12 家供应商、10 种原材料、9 种工艺费率，含价格因子（0.92~1.25）和数量折扣模拟。
