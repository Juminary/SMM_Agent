# 供销计划异常协调Agent - 完整项目指南

## 项目概述

**项目名称**: 供销计划异常协调Agent + 黑盒可见化调试工作台  
**应用场景**: 九安医疗 BOM 成本核算  
**当前状态**: Demo已完成，进入真实落地阶段

### 双题目覆盖
- **题目5**: 供销计划异常协调Agent - 自动检测供应商报价异常，生成应对方案
- **题目11**: 黑盒可见化调试工作台 - 让业务人员理解AI决策过程，支持人工干预

---

## 一、已完成内容（Demo阶段）

### 1.1 前端调试工作台 (frontend/)

**技术栈**: React 18 + TypeScript + Tailwind CSS + Recharts

**已完成页面**:
| 页面 | 功能 | 状态 |
|------|------|------|
| Dashboard | 工作台首页，统计概览 | ✅ 完成 |
| QuoteList | 异常列表，支持筛选搜索 | ✅ 完成 |
| QuoteDetail | 报价详情，成本结构可视化 | ✅ 字体已优化 |
| ExecutionTrace | 执行轨迹可视化，支持回放 | ✅ 完成 |
| NewQuote | 新建报价分析 | ✅ 完成 |
| Stats | 统计分析图表 | ✅ 完成 |

**UI优化**:
- ✅ 浅色系主题（#f8fafc背景）
- ✅ 响应式布局（移动端适配）
- ✅ 字体可读性优化（标题加大、正文14px）
- ✅ 移除暗色主题残留代码

**前端代码逻辑详解**:

**1. 页面路由 (frontend/src/App.tsx)**
```
/              → Dashboard（工作台首页）
/quotes        → QuoteList（异常列表）
/quotes/new    → NewQuote（新建分析）
/quotes/:id    → QuoteDetail（详情页）
/quotes/:id/trace → ExecutionTrace（执行轨迹）
/stats         → Stats（统计分析）
```

**2. 状态管理**
使用React Hooks管理状态：
```typescript
const [quote, setQuote] = useState<Quote | null>(null)  // 当前报价
const [loading, setLoading] = useState(true)              // 加载状态
const [selectedSolution, setSelectedSolution] = useState(null)  // 选中方案
```

**3. 核心页面逻辑**

**Dashboard（工作台首页）**
```typescript
// 加载数据
useEffect(() => {
  fetchQuotes()    // 获取最近报价
  fetchStats()     // 获取统计数据
}, [])

// 展示内容
- 统计卡片（总报价数、紧急异常、平均偏离度、潜在节省）
- 异常分布图表
- 最近报价列表
```

**QuoteDetail（报价详情页）**
三栏布局：
- **左栏 - 价格信息**：供应商报价 vs AI预测区间、偏离度分数（带颜色标识）、相似历史物料列表
- **中栏 - 成本结构**：成本构成条形图（原材料/加工/管理等）、每项与基准的对比、异常项高亮显示
- **右栏 - AI建议方案**：2-3个可执行方案卡片，每个方案包含标题、描述、置信度、预计节省，点击选择方案可提交决策

**ExecutionTrace（执行轨迹页）**
```typescript
// 时间线展示
trace.map((step, index) => (
  <TimelineNode>
    <Icon />           {/* 步骤图标 */}
    <StepName />       {/* 步骤名称 */}
    <Duration />       {/* 执行耗时 */}
    <Output />         {/* 输出结果 */}
  </TimelineNode>
))

// 功能
- 播放/暂停动画
- 点击节点查看详情
- 显示输入参数和输出结果
```

**4. API调用 (frontend/src/utils/api.ts)**
```typescript
// 封装axios请求
const api = axios.create({
  baseURL: 'http://localhost:8000/api'
})

// 主要API
fetchQuotes()        // GET /quotes
fetchQuote(id)         // GET /quotes/:id
analyzeQuote(data)     // POST /quotes/analyze
submitDecision(id, data) // POST /quotes/:id/decision
fetchQuoteTrace(id)    // GET /quotes/:id/trace
```

### 1.2 后端API服务 (backend/)

**技术栈**: FastAPI + Pydantic

**已完成模块**:
- ✅ RESTful API完整实现
- ✅ Agent核心逻辑（6个Skill，基于规则）
- ✅ 数据模型定义

**核心Skill**:
1. SimilarityMatcher - 相似物料检索（规则加权）
2. PricePredictor - 价格区间预测（统计分位数）
3. CostAnalyzer - 成本结构拆解
4. AnomalyScorer - 偏离度综合打分
5. SolutionGenerator - 应对方案生成
6. AgentOrchestrator - 编排器

**后端代码逻辑详解**:

**1. 主入口 (backend/app/main.py)**
```python
# 核心流程
1. 接收报价请求 POST /api/quotes/analyze
2. 调用 AgentOrchestrator.process_quote() 进行分析
3. 返回完整的分析结果（偏离度、方案、执行轨迹）

# 主要API端点：
- POST /api/quotes/analyze - 分析新报价
- GET /api/quotes - 获取异常列表
- GET /api/quotes/{id} - 获取详情
- POST /api/quotes/{id}/decision - 提交人工决策
- GET /api/quotes/{id}/trace - 获取执行轨迹
```

**2. Agent核心逻辑 (backend/app/skills/agent_core.py)**

这是整个系统的核心，包含6个Skill：

**Skill 1: SimilarityMatcher（相似物料检索）**
```python
# 逻辑流程
输入：新物料属性（材料、尺寸、工艺等）
  ↓
计算相似度分数（加权计算）
  - category匹配: 25%
  - material_type匹配: 25%
  - processing匹配: 20%
  - precision匹配: 15%
  - dimensions相似度: 15%
  ↓
输出：Top-5最相似的历史物料

# 代码关键：
def calculate_similarity(self, target, candidate):
    # 维度匹配得分
    if target.category == candidate.category:
        score += 0.25
    # 尺寸相似度（解析字符串比较）
    dim_sim = self._calculate_dim_similarity(dims1, dims2)
```

**Skill 2: PricePredictor（价格区间预测）**
```python
# 逻辑流程
输入：物料特征（类别、工艺、数量等）
  ↓
查找同类物料历史价格
  ↓
计算分位数
  - P10: 10%分位（低价边界）
  - P50: 50%分位（中位数）
  - P90: 90%分位（高价边界）
  ↓
工艺复杂度调整（如沉金+15%）
  ↓
订单量调整（量大价优）
  ↓
输出：预测区间 [P10, P50, P90]
```

**Skill 3: CostAnalyzer（成本结构拆解）**
```python
# 逻辑流程
输入：供应商报价 + 物料信息
  ↓
获取行业基准比例（塑料外壳/PCB等）
  - 原材料: 40%
  - 加工费: 25%
  - 表面处理: 10%
  - 管理+利润: 20%
  ↓
模拟供应商隐含成本结构
  ↓
对比基准，计算偏离
  ↓
输出：各成本项偏离分析

# 示例输出：
原材料    供应商42%  vs  基准40%  →  正常
加工费    供应商18%  vs  基准25%  →  偏低28%（疑似偷工减料）
管理+利润 供应商35%  vs  基准20%  →  偏高75%（严重异常）
```

**Skill 4: AnomalyScorer（偏离度综合打分）**
```python
# 两层打分模型

第一层：偏离度综合打分
偏离度 = α×价格偏离分 + β×成本偏离分 + γ×市场偏离分

权重策略：
- 历史数据充足：α=0.5, β=0.3, γ=0.2
- 历史数据不足：α=0.2, β=0.2, γ=0.6

第二层：RAG综合打分（外部校准）
综合打分 = 内部预测分×0.6 + 外部偏离分×0.4

输出分级：
<20  → 正常（绿色）
20-40 → 关注（黄色）
40-60 → 警示（橙色）
>60  → 紧急（红色）
```

**Skill 5: SolutionGenerator（应对方案生成）**
```python
# 根据偏离度级别生成方案

正常（<20）：
  └─ 方案：直接通过

关注/警示（20-60）：
  ├─ 方案A：议价谈判
  └─ 方案B：历史对比

紧急（>60）：
  ├─ 方案A：直接议价（目标价+节省金额）
  ├─ 方案B：二次询价（开发备选供应商）
  └─ 方案C：升级处理（上报采购经理）
```

**Skill 6: AgentOrchestrator（编排器）**
```python
# 协调所有Skill按顺序执行：
def process_quote(self, quote_data):
    # 步骤1: 异常检测
    detect_anomaly()

    # 步骤2: 相似物料检索
    similar_materials = matcher.find_similar()

    # 步骤3: 价格区间预测
    prediction = predictor.predict()

    # 步骤4: 成本结构拆解
    cost_analysis = cost_analyzer.analyze()

    # 步骤5: 偏离度综合打分
    deviation = scorer.calculate_deviation()

    # 步骤6: 方案生成
    solutions = solution_gen.generate()

    # 记录执行轨迹
    return assemble_result()
```

**API端点**:
- `POST /api/quotes/analyze` - 分析报价异常
- `GET /api/quotes` - 获取报价列表
- `GET /api/quotes/{id}` - 获取报价详情
- `POST /api/quotes/{id}/decision` - 提交人工决策
- `GET /api/quotes/{id}/trace` - 获取执行轨迹
- `GET /api/stats` - 获取统计数据

### 1.3 模拟数据 (data/raw/)

- ✅ 15条历史物料数据
- ✅ 5条报价异常样例（覆盖正常/关注/警示/紧急各级别）
- ✅ 外部参考数据（1688/行业报告）

### 1.4 数据流转示例

以新建报价分析为例：
```
用户填写表单（NewQuote.tsx）
        ↓
前端调用 analyzeQuote(data)
        ↓
POST /api/quotes/analyze
        ↓
后端 AgentOrchestrator.process_quote()
        ↓
依次执行6个Skill
        ↓
返回分析结果
        ↓
前端跳转到 QuoteDetail 页面展示
        ↓
用户查看后提交决策
        ↓
POST /api/quotes/:id/decision
```

### 1.5 关键设计亮点

**1. 人机协同边界**
```python
# 自动处理 vs 人工介入
if deviation_score < 20:
    auto_approve()      # 自动通过
elif deviation_score > 60:
    force_escalate()    # 强制推送工作台
else:
    notify_engineer()   # 推送等待确认
```

**2. 可解释性设计**
每个AI决策都有明确的依据：
- 价格偏离：基于历史数据对比
- 成本异常：基于行业基准对比
- 方案推荐：基于偏离程度和置信度

**3. 执行轨迹记录**
完整记录每个步骤：
- 输入参数
- 输出结果
- 执行时间
- 模型版本

方便调试和审计。

### 1.4 评分维度覆盖

**题目5评分维度**:
- ✅ AI-driven理解深度：完整的异常检测→方案生成链路
- ✅ 异常识别准确性：相似物料检索 + 价格区间预测
- ✅ 方案生成可执行性：具体可操作的2-3个方案
- ✅ 人机协同边界：清晰的分级处理机制
- ✅ 原型完成度：可运行、可演示

**题目11评分维度**:
- ✅ 人类可理解性：业务语言展示，双层视图
- ✅ 问题定位能力：执行轨迹可视化，逐节点查看
- ✅ 调试效率提升：相比直接看日志，节省排查时间
- ✅ Override体验：顺畅的参数调整和重跑流程
- ✅ 工程可用性：完整的日志记录和回放能力

---

## 二、六周实施计划（引入真实AI模型）

### Week 1: 数据基础设施搭建

**目标**: 建立数据处理流水线，为模型训练准备数据

**需要补充的代码目录**:
```
data/
├── scripts/                    # 数据处理脚本
│   ├── __init__.py
│   ├── preprocess.py            # 数据清洗（待完善）
│   ├── feature_engineering.py   # 特征工程（待完善）
│   ├── prepare_training_data.py # 训练数据准备（待完善）
│   ├── data_validation.py       # 数据质量检查（新建）
│   └── sync_from_erp.py         # ERP数据同步（新建）
│
└── processed/                   # 处理后数据（自动生成）
    ├── features/                # 特征数据
    ├── training/                # 训练数据集
    └── pipeline/                # 流水线缓存
```

**具体任务**:
1. [ ] 完善 `preprocess.py` - 实现数据清洗逻辑
2. [ ] 完善 `feature_engineering.py` - 实现特征工程
3. [ ] 完善 `prepare_training_data.py` - 生成训练集
4. [ ] 创建 `data_validation.py` - 数据质量检查
5. [ ] 创建 `sync_from_erp.py` - 从ERP同步数据（Mock版本）

**交付物**:
- 可运行的数据处理流水线
- 生成训练数据集（基于模拟数据）

---

### Week 2: 价格预测模型（XGBoost）

**目标**: 训练价格区间预测模型，替代规则预测

**需要补充的代码目录**:
```
backend/
├── models/                      # 模型文件
│   ├── price_predictor/         # 价格预测模型
│   │   ├── model_0.1.pkl        # P10模型（训练生成）
│   │   ├── model_0.5.pkl        # P50模型（训练生成）
│   │   ├── model_0.9.pkl        # P90模型（训练生成）
│   │   ├── scaler.pkl           # 标准化器（训练生成）
│   │   └── metadata.json        # 模型元数据（训练生成）
│   │
│   └── training/                # 训练代码
│       ├── __init__.py
│       ├── train_price_predictor.py  # 训练脚本（待完善）
│       └── utils.py             # 训练工具（新建）
│
└── app/
    └── models/                  # 模型推理
        ├── __init__.py
        └── model_inference.py   # 推理封装（待完善）
```

**模型说明**:
| 属性 | 说明 |
|------|------|
| 算法 | XGBoost分位数回归 |
| 输入 | 物料类别、工艺、数量、时间等10维特征 |
| 输出 | P10/P50/P90价格区间 + 置信度 |
| 训练脚本 | `backend/models/training/train_price_predictor.py` |

**具体任务**:
1. [ ] 完善 `train_price_predictor.py` - XGBoost分位数回归训练
2. [ ] 完善 `model_inference.py` 中的 `PricePredictor` 类
3. [ ] 运行训练脚本，生成模型文件
4. [ ] 测试模型推理接口

**交付物**:
- 训练好的价格预测模型
- 模型推理API可用

---

### Week 3: 相似度嵌入模型（Sentence-BERT）

**目标**: 训练语义相似度模型，提升物料检索准确性

**需要补充的代码目录**:
```
backend/
└── models/
    ├── similarity_embedder/     # 相似度模型
    │   ├── embedder/            # Sentence-BERT模型（训练生成）
    │   ├── index.faiss          # FAISS索引（训练生成）
    │   ├── embeddings.npy       # 物料向量（训练生成）
 │   ├── material_ids.json    # ID映射（训练生成）
    │   └── metadata.json        # 元数据（训练生成）
    │
    └── training/
        └── train_similarity_embedder.py  # 训练脚本（待完善）
```

**模型说明**:
| 属性 | 说明 |
|------|------|
| 算法 | Sentence-BERT + FAISS |
| 输入 | 物料描述文本（类别+材料+工艺+精度+尺寸） |
| 输出 | 768维向量 + Top-K相似物料 |
| 训练脚本 | `backend/models/training/train_similarity_embedder.py` |

**具体任务**:
1. [ ] 完善 `train_similarity_embedder.py` - Sentence-BERT训练
2. [ ] 完善 `model_inference.py` 中的 `SimilarityEmbedder` 类
3. [ ] 训练模型，构建FAISS索引
4. [ ] 测试相似度检索接口

**交付物**:
- 训练好的相似度模型
- FAISS向量索引
- 语义检索API可用

---

### Week 4: 异常检测模型（孤立森林）

**目标**: 训练异常检测模型，识别异常报价

**需要补充的代码目录**:
```
backend/
└── models/
    ├── anomaly_detector/        # 异常检测模型
    │   ├── model.pkl            # 孤立森林模型（训练生成）
    │   ├── scaler.pkl           # 标准化器（训练生成）
    │   └── metadata.json        # 元数据（训练生成）
    │
    └── training/
        └── train_anomaly_detector.py  # 训练脚本（待完善）
```

**模型说明**:
| 属性 | 说明 |
|------|------|
| 算法 | 孤立森林 (Isolation Forest) |
| 输入 | 价格偏离度、成本偏离度、市场偏离度等6维特征 |
| 输出 | 异常概率 + 置信度 |
| 训练脚本 | `backend/models/training/train_anomaly_detector.py` |

**具体任务**:
1. [ ] 完善 `train_anomaly_detector.py` - 孤立森林训练
2. [ ] 完善 `model_inference.py` 中的 `AnomalyDetector` 类
3. [ ] 训练模型
4. [ ] 测试异常检测接口

**交付物**:
- 训练好的异常检测模型
- 异常检测API可用

---

### Week 5: Agent核心集成

**目标**: 将AI模型集成到Agent核心，替换规则逻辑

**需要修改的代码**:
```
backend/
└── app/
    └── skills/
        └── agent_core.py        # Agent核心（修改）
```

**具体任务**:
1. [ ] 修改 `SimilarityMatcher` - 集成语义相似度模型
2. [ ] 修改 `PricePredictor` - 集成XGBoost价格预测
3. [ ] 修改 `AnomalyScorer` - 集成异常检测模型
4. [ ] 添加模型加载失败时的规则回退机制
5. [ ] 更新执行轨迹，记录模型版本和置信度

**交付物**:
- 集成AI模型的Agent核心
- 保持向后兼容（无模型时回退到规则）

---

### Week 6: 工程化与部署

**目标**: 完善工程化，准备生产部署

**需要补充的代码目录**:
```
backend/
├── requirements.txt             # 更新依赖（修改）
├── Dockerfile                   # 容器化（新建）
├── docker-compose.yml           # 编排（新建）
│
└── app/
    ├── main.py                  # 添加模型健康检查（修改）
    └── utils/
        └── model_monitor.py     # 模型监控（新建）

data/
└── scripts/
    └── sync_from_erp.py         # 完善ERP同步（修改）

docs/
├── MODEL_TRAINING.md            # 模型训练指南（新建）
├── DEPLOYMENT.md                # 部署文档（新建）
└── API_REFERENCE.md             # API文档（新建）
```

**具体任务**:
1. [ ] 更新 `requirements.txt` - 添加ML依赖
2. [ ] 创建 `Dockerfile` - 后端容器化
3. [ ] 创建 `docker-compose.yml` - 完整编排
4. [ ] 创建 `model_monitor.py` - 模型性能监控
5. [ ] 完善 `sync_from_erp.py` - 真实ERP数据同步
6. [ ] 编写部署文档

**交付物**:
- Docker化部署方案
- 生产环境配置
- 完整技术文档

---

## 三、三个AI模型详细说明

### 3.1 价格预测模型

**算法**: XGBoost分位数回归

**输入特征（10维）**:
| 特征名 | 类型 | 说明 |
|--------|------|------|
| category_encoded | int | 物料类别编码 |
| material_type_encoded | int | 材料类型编码 |
| processing_encoded | int | 加工工艺编码 |
| precision_encoded | int | 精度要求编码 |
| quantity | float | 采购数量（归一化） |
| month | float | 月份（1-12） |
| year | float | 年份 |
| volume_cm3 | float | 体积（立方厘米） |
| surface_area_cm2 | float | 表面积 |
| complexity_score | float | 复杂度评分 |

**输出**:
```python
{
    'price_low': 4.5,    # P10分位数
    'price_mid': 5.2,    # P50分位数
    'price_high': 6.0,   # P90分位数
    'confidence': 0.85   # 预测置信度
}
```

**模型文件**:
- `model_0.1.pkl` - P10模型
- `model_0.5.pkl` - P50模型
- `model_0.9.pkl` - P90模型
- `scaler.pkl` - 特征标准化器
- `metadata.json` - 模型元数据

### 3.2 相似度嵌入模型

**算法**: Sentence-BERT (paraphrase-multilingual-MiniLM-L12-v2) + FAISS

**输入**: 物料描述文本
```
物料类别：塑料外壳，材料类型：ABS，加工工艺：注塑成型，精度要求：±0.1mm，尺寸规格：80×60×15mm
```

**输出**: 768维向量

**模型文件**:
- `embedder/` - Sentence-BERT模型目录
- `index.faiss` - FAISS向量索引
- `embeddings.npy` - 物料向量库
- `material_ids.json` - ID映射

### 3.3 异常检测模型

**算法**: 孤立森林 (Isolation Forest)

**输入特征（6维）**:
| 特征名 | 说明 |
|--------|------|
| price_deviation | 价格偏离度 |
| cost_deviation | 成本偏离度 |
| market_deviation | 市场偏离度 |
| supplier_history_count | 供应商历史交易数 |
| supplier_avg_deviation | 供应商平均偏离度 |
| material_complexity | 物料复杂度 |

**输出**:
```python
{
    'is_anomaly': True,       # 是否异常
    'anomaly_score': 0.75,    # 异常概率
    'confidence': 0.82        # 置信度
}
```

**模型文件**:
- `model.pkl` - 孤立森林模型
- `scaler.pkl` - 标准化器
- `metadata.json` - 元数据

---

## 四、使用流程

### 4.1 准备训练数据

```bash
cd data/scripts
python preprocess.py              # 数据清洗
python feature_engineering.py     # 特征工程
python prepare_training_data.py   # 生成训练集
```

### 4.2 训练模型

```bash
cd backend/models/training
python train_price_predictor.py      # 训练价格预测模型
python train_similarity_embedder.py    # 训练相似度模型
python train_anomaly_detector.py       # 训练异常检测模型
```

### 4.3 在Agent中调用

修改 `backend/app/skills/agent_core.py`:

```python
from app.models.model_inference import (
    get_price_predictor,
    get_similarity_embedder,
    get_anomaly_detector
)

# 获取模型实例
price_model = get_price_predictor()
similarity_model = get_similarity_embedder()
anomaly_model = get_anomaly_detector()

# 价格预测
result = price_model.predict({
    'category_encoded': 1,
    'material_type_encoded': 2,
    'quantity': 10000,
    ...
})
# 返回: {'price_low': 4.5, 'price_mid': 5.2, 'price_high': 6.0, 'confidence': 0.85}

# 相似度检索
similar = similarity_model.find_similar("塑料外壳 ABS 注塑", top_k=5)
# 返回: [('MAT001', 0.92), ('MAT002', 0.88), ...]

# 异常检测
anomaly = anomaly_model.predict({
    'price_deviation': 0.6,
    'cost_deviation': 0.4,
    ...
})
# 返回: {'is_anomaly': True, 'anomaly_score': 0.75, 'confidence': 0.82}
```

---

## 五、数据需求

### 5.1 当前状态

当前使用**模拟数据**（15条物料 + 5条报价），可启动训练但效果有限。

### 5.2 真实数据需求

| 数据类型 | 数量建议 | 来源 |
|---------|---------|------|
| 历史物料数据 | 1000+ | 九安医疗ERP系统 |
| 历史报价数据 | 5000+ | 采购部门 |
| 外部市场数据 | 10000+ | 1688/行业报告 |

### 5.3 数据同步

**实时同步**: 新报价数据 → 触发模型重训练  
**每日同步**: ERP数据同步  
**每周更新**: 特征工程和数据验证

---

## 六、依赖安装

### 6.1 基础依赖（已安装）
```bash
pip install fastapi uvicorn pydantic numpy
```

### 6.2 Week 1 依赖（数据处理）
```bash
pip install pandas numpy scikit-learn
```

### 6.3 Week 2 依赖（XGBoost）
```bash
pip install xgboost
```

### 6.4 Week 3 依赖（Sentence-BERT）
```bash
pip install sentence-transformers faiss-cpu torch
```

### 6.5 Week 4 依赖（孤立森林）
```bash
# 已包含在scikit-learn中
```

### 6.6 Week 6 依赖（部署）
```bash
pip install docker-compose
```

---

## 七、项目目录结构（完整）

```
SMM_Agent/
├── backend/                    # FastAPI后端服务
│   ├── app/
│   │   ├── main.py            # API主入口
│   │   ├── models/            # 模型推理封装（Week 2-4）
│   │   │   ├── __init__.py
│   │   │   └── model_inference.py
│   │   ├── skills/
│   │   │   └── agent_core.py  # Agent核心逻辑（Week 5修改）
│   │   └── utils/
│   │       └── model_monitor.py  # 模型监控（Week 6）
│   │
│   ├── models/                # 训练好的模型（Week 2-4生成）
│   │   ├── price_predictor/
│   │   ├── similarity_embedder/
│   │   ├── anomaly_detector/
│   │   └── training/          # 训练代码
│   │       ├── train_price_predictor.py
│   │       ├── train_similarity_embedder.py
│   │       └── train_anomaly_detector.py
│   │
│   ├── requirements.txt       # 依赖（Week 6更新）
│   ├── Dockerfile             # 容器化（Week 6）
│   ├── docker-compose.yml     # 编排（Week 6）
│   └── run.py
│
├── frontend/                   # React前端调试工作台
│   ├── src/
│   │   ├── components/        # 组件
│   │   ├── pages/             # 页面（已完成）
│   │   ├── utils/             # 工具函数
│   │   ├── types/             # TypeScript类型
│   │   ├── App.tsx
│   │   └── main.tsx
│   ├── package.json
│   ├── vite.config.ts
│   └── index.html
│
├── data/                       # 数据
│   ├── raw/                   # 原始数据
│   │   ├── materials.json
│   │   ├── quotes.json
│   │   └── external_references.json
│   │
│   ├── processed/             # 处理后数据（Week 1生成）
│   │   ├── features/
│   │   ├── training/
│   │   └── pipeline/
│   │
│   └── scripts/               # 数据处理脚本（Week 1）
│       ├── preprocess.py
│       ├── feature_engineering.py
│       ├── prepare_training_data.py
│       ├── data_validation.py
│       └── sync_from_erp.py
│
├── docs/                       # 文档
│   ├── PROJECT_GUIDE.md       # 本文件
│   ├── MODEL_TRAINING.md      # 模型训练指南（Week 6）
│   ├── DEPLOYMENT.md          # 部署文档（Week 6）
│   └── API_REFERENCE.md       # API文档（Week 6）
│
├── start.bat                  # Windows启动脚本
├── start.sh                   # Linux/Mac启动脚本
└── README.md                  # 项目说明
```

---

## 八、风险与应对

| 风险 | 可能性 | 应对措施 |
|-----|-------|---------|
| 训练数据不足 | 高 | 先用规则回退，并行收集数据 |
| 模型效果不佳 | 中 | 调整特征工程，尝试其他算法 |
| ERP数据同步困难 | 中 | 先使用CSV导入方式 |
| 计算资源不足 | 低 | 使用轻量级模型（MiniLM） |

---

## 九、里程碑

| 时间 | 里程碑 | 交付物 |
|------|--------|--------|
| Week 1结束 | 数据处理流水线可用 | 训练数据集 |
| Week 2结束 | 价格预测模型可用 | XGBoost模型 |
| Week 3结束 | 相似度模型可用 | Sentence-BERT + FAISS |
| Week 4结束 | 异常检测模型可用 | 孤立森林模型 |
| Week 5结束 | Agent核心集成完成 | 集成AI模型的Agent |
| Week 6结束 | 生产部署就绪 | Docker化部署 |

---

## 十、快速启动

### 当前Demo启动

# 后端
cd backend && python run.py

# 前端
cd frontend && npm install && npm run dev
```

**访问地址**:
- 前端界面: http://localhost:3000
- 后端API: http://localhost:8000
- API文档: http://localhost:8000/docs

---

## 十一、注意事项

1. **模型回退机制**: `model_inference.py` 已实现规则回退，模型不存在时自动使用原有规则逻辑

2. **训练数据**: 当前模拟数据只有15条，训练出的模型效果有限，建议先用规则引擎，等有真实数据后再训练

3. **依赖安装**: 训练脚本需要额外依赖，按周逐步安装

4. **并行开发**: Week 5-6可以与前端优化并行进行

---

## 十二、团队分工建议

| 角色 | 职责 | 对应Week |
|------|------|---------|
| 数据工程师 | 数据处理流水线、ERP同步 | Week 1, 6 |
| 算法工程师 | 模型训练、特征工程 | Week 2-4 |
| 后端工程师 | Agent集成、API开发 | Week 5 |
| 运维工程师 | Docker化、部署 | Week 6 |
| 前端工程师 | UI优化（并行） | Week 5-6 |

---

**最后更新**: 2024-05-18  
**版本**: v1.0  
**状态**: Demo已完成，进入六周实施计划
