# 供销计划异常协调 Agent — 重构设计方案

## 设计目标

1. **题目 5（Agent）**：Agent 有真正的自主决策空间，做"诊断"而非"体检"
2. **题目 11（调试工作台）**：展示的是推理链，不是工具调用日志
3. 偏离 < 20 自动通过，≥ 20 才进入 Agent 诊断
4. 确定性计算和不确定性推理严格分离

---

## 一、整体架构：两阶段 + 三条路径

```
用户提交报价
    │
    ▼
┌────────────── 第一阶段：自动化体检（确定性，无 LLM）──────────────┐
│                                                                  │
│  build_material → predict_price ┐                                │
│                  → analyze_cost ├→ score_deviation               │
│                  → match_similar┘                                │
│                                                                  │
│  产出：结构化体检报告（偏离度 + 三分位 + 成本基准 + 相似物料）    │
└────────────────────────┬─────────────────────────────────────────┘
                         │
              偏离度 score 判断
                         │
            ┌────────────┼────────────┐
            │            │            │
         score<20    20≤score<60  score≥60
            │            │            │
            ▼            ▼            ▼
      ┌─────────┐ ┌──────────┐ ┌──────────┐
      │ 快速通道 │ │ 标准诊断 │ │ 紧急升级 │
      │ 自动通过 │ │ Agent诊断│ │Agent诊断 │
      │ 不打断人 │ │+人工确认 │ │+强制确认 │
      └─────────┘ └──────────┘ └──────────┘
```

三条路径的区别：

| | 快速通道 | 标准诊断 | 紧急升级 |
|---|---|---|---|
| 触发条件 | score < 20 | 20 ≤ score < 60 | score ≥ 60 |
| Agent 诊断 | 跳过 | 完整执行 | 完整执行 |
| 人工确认 | 不需要 | interrupt 等待 | interrupt 强制等待 |
| 方案生成 | 单方案"直接通过" | 多方案对比 | 多方案 + 升级建议 |

---

## 二、状态设计

```python
class AgentState(TypedDict):
    # ===== 输入 =====
    quote_data: Dict[str, Any]

    # ===== 第一阶段输出（确定性） =====
    material: Dict[str, Any]
    prediction: Optional[Dict]           # P10/P50/P90 + confidence
    cost_analysis: Optional[Dict]        # 5项成本拆解 + 行业基准
    similar_materials: List[Dict]        # Top-K 相似物料
    deviation: Optional[Dict]            # 两层打分 + 严重级别

    # ===== 第二阶段：Agent 诊断（LLM 驱动） =====
    diagnosis_hypotheses: List[Dict]     # Agent 提出的根因假设
    # 每条: {hypothesis, confidence, evidence, source}

    diagnosis_investigations: List[Dict] # Agent 执行的调查动作
    # 每条: {tool_name, reason, result, conclusion}

    diagnosis_conclusion: Optional[Dict] # 最终诊断结论
    # {root_cause, cause_category, confidence, reasoning_chain}

    supplier_profile: Optional[Dict]     # 供应商画像（历史偏离趋势）
    peer_benchmark: Optional[Dict]       # 同类供应商对比
    market_context: Optional[Dict]       # 市场行情上下文
    inventory_context: Optional[Dict]    # 库存/紧急度上下文

    # ===== 方案 =====
    solutions: List[Dict]
    llm_summary: Optional[str]

    # ===== ReAct 控制 =====
    messages: List[Dict]                 # LLM 对话历史
    tools_called: List[str]              # 已调工具追踪
    diagnosis_rounds: int                # 诊断轮次计数
    phase: str                           # "baseline" | "diagnosis" | "resolution"

    # ===== 人机交互 =====
    execution_trace: List[Dict]          # 完整执行轨迹
    interrupt_reason: Optional[str]
    human_feedback: Optional[Dict]

    # ===== 调试可见性 =====
    decision_log: List[Dict]             # Agent 每个决策点的记录
    # 每条: {timestamp, decision_point, options_considered,
    #        chosen_action, reasoning, confidence}
```

---

## 三、图结构

```
                            START
                              │
                              ▼
                     node_build_material
                              │
              ┌───────┬───────┼───────┐
              ▼       ▼               ▼
     node_predict  node_analyze   node_match
     _price        _cost          _similar
              │       │               │
              └───────┴───────┬───────┘
                              ▼
                     node_score_deviation
                              │
                              ▼
                     node_triage           ← 分流节点（无 LLM）
                              │
              ┌───────────────┼────────────────┐
              │               │                │
           score<20      20≤score<60       score≥60
              │               │                │
              ▼               ▼                ▼
     node_fast_pass   node_start_diag   node_start_diag
     (生成通过方案)   (标准诊断入口)   (紧急诊断入口)
              │               │                │
              ▼               ▼                ▼
            END       node_agent_router  node_agent_router
                           │                    │
                    ┌──────┴──────┐       ┌─────┴──────┐
                    │             │       │            │
                有tool_call  无tool_call 有tool_call 无tool_call
                    │             │       │            │
                    ▼             ▼       ▼            ▼
            node_execute   node_conclude  ...     node_conclude
            _tool          _diagnosis              _diagnosis
                    │             │       │            │
                    └──────┬──────┘       └─────┬──────┘
                           │                    │
                      back to router       node_generate
                      (max 5 rounds)       _solutions
                                                │
                                                ▼
                                         node_wait_human
                                         (标准: interrupt)
                                         (紧急: interrupt)
                                                │
                                                ▼
                                         node_finalize
                                                │
                                                ▼
                                               END
```

**关键设计**：`node_triage` 是无 LLM 的分流节点，根据偏离度直接路由到三条路径。Agent 只在需要诊断时启动，不浪费。

---

## 四、诊断阶段：Agent 真正的决策空间

Agent 的目标是回答一个核心问题：**"为什么偏高了？"**

### 4.1 诊断工具集

| 工具 | 作用 | Agent 什么时候调 |
|---|---|---|
| `tool_get_supplier_profile` | 查询该供应商历史报价趋势、平均偏离、合作年限 | 怀疑是供应商溢价 |
| `tool_compare_peer_price` | 同类物料 × 其他供应商的报价对比 | 需要验证是品类普涨还是个别行为 |
| `tool_check_market_trend` | 原材料行情走势（限有外部数据的品类） | 怀疑是市场行情驱动 |
| `tool_check_urgency` | 查询该物料库存水位和采购紧急度 | 判断是否可以慢慢议价 |
| `tool_search_alternatives` | 检索可替代供应商 | 方案生成前备选 |
| `tool_analyze_cost_anomaly` | 对成本拆解结果做深度分析，定位异常成本项 | 需要定位具体哪个成本项出问题 |
| `tool_generate_solutions` | 根据诊断结论生成定制化方案 | 诊断完成后 |

### 4.2 Agent 的推理路径（假设-验证循环）

```
偏离度 55 分，严重级别 "警示"
    │
    ▼
Agent 生成初始假设：
  H1: 供应商溢价（该供应商一贯报高价）         ← 先验概率 60%
  H2: 市场行情（原材料涨价传导）               ← 先验概率 25%
  H3: 数据稀疏（历史数据不够，误判）           ← 先验概率 10%
  H4: 真实异常（供应商这次确实报高了）         ← 先验概率 5%
    │
    ▼
Agent 决策：先查供应商历史 → 调 tool_get_supplier_profile
    │
    ▼
结果：该供应商近 6 个月平均偏离 +12%，但这次 +38%
    │
    ▼
Agent 更新假设：
  H1: 供应商一贯溢价 +12%，但本次额外高出 26%  ← 置信度上升
  H2: 保留（需验证）                            ← 置信度不变
  H3: 该供应商有 15 条记录，数据充足 → 排除
    │
    ▼
Agent 决策：查同类供应商 → 调 tool_compare_peer_price
    │
    ▼
结果：同类物料供应商B报价¥12.5，供应商C报价¥13.0
    │
    ▼
Agent 判断：同行报价在 ¥12.5-¥13.0，报价 ¥17.5 明显偏高
  → H2 排除（不是品类普涨）
  → H1/H4 确认（供应商问题）
    │
    ▼
Agent 给出诊断结论 + 生成方案：
  根因：供应商溢价（系统性偏高 + 本次额外偏高）
  建议：议价（目标¥13.0）+ 引入供应商B竞争
  置信度：高
```

### 4.3 Agent Router 的 System Prompt

```
你是九安医疗的供应链诊断专家。你收到一份报价异常体检报告，你的任务是
找出异常根因并给出建议。

## 你可以使用的诊断工具
- tool_get_supplier_profile: 查询供应商历史报价趋势、平均偏离、合作年限
- tool_compare_peer_price: 同类物料 × 其他供应商的报价对比
- tool_check_market_trend: 原材料行情走势
- tool_check_urgency: 查询库存水位和采购紧急度
- tool_search_alternatives: 检索可替代供应商
- tool_analyze_cost_anomaly: 对成本拆解结果做深度分析

## 当前体检报告
- 物料：{material_name} / {category}
- 供应商：{supplier_name}，报价 ¥{quote}
- 价格预测区间：P10=¥{p10} P50=¥{p50} P90=¥{p90}
- 偏离度：{score}分（{severity}）
- 价格偏离：{price_dev}% / 成本偏离：{cost_dev}% / 市场偏离：{market_dev}%
- 相似物料：{similar_materials_summary}
- 成本拆解异常项：{abnormal_items}

## 诊断思路
1. 看 pattern：价格偏离 vs 成本偏离 vs 市场偏离，哪个占主导？
   - 价格偏离高 + 市场偏离低 → 可能供应商溢价
   - 市场偏离高 → 可能原材料行情问题
   - 成本偏离高 → 可能工艺复杂度被低估
2. 查历史：该供应商过去表现如何？
3. 比对等：同品类其他供应商的报价水平？
4. 下结论：给出根因判断 + 置信度

## 输出要求
每轮你可以：调用1-2个工具获取证据，或给出诊断结论。
当你给出结论时，必须说明：根因 / 置信度 / 推理链 / 下一步建议。
```

---

## 五、分流逻辑

```python
def node_triage(state: AgentState) -> str:
    """分流节点 — 纯规则，不用 LLM"""
    dev = state["deviation"]
    score = dev["deviation_score"]

    if score < 20:
        state["phase"] = "fast_pass"
        return "node_fast_pass"

    elif score >= 60:
        state["phase"] = "diagnosis_urgent"
        state["interrupt_severity"] = "mandatory"  # 强制人工确认
        return "node_start_diagnosis"

    else:
        state["phase"] = "diagnosis_standard"
        state["interrupt_severity"] = "optional"    # 人工可跳过
        return "node_start_diagnosis"


def node_fast_pass(state: AgentState) -> AgentState:
    """快速通道：自动生成通过方案，不调用 LLM，不 interrupt"""
    qd = state["quote_data"]
    state["solutions"] = [{
        "id": f"SOL-{qd['id']}-PASS",
        "title": "直接通过",
        "description": f"报价在预测区间内，偏离度 {state['deviation']['deviation_score']} 分",
        "confidence": 0.95,
        "action": "accept",
        "generated_by": "auto",
    }]
    state["diagnosis_conclusion"] = {
        "root_cause": "报价正常",
        "cause_category": "normal",
        "confidence": 0.95,
    }
    _append_trace(state, "快速通道", "completed", "偏离度<20，自动通过", 0)
    return state
```

---

## 六、Human-in-the-Loop 设计

```python
def node_wait_human(state: AgentState) -> AgentState:
    """
    人工确认节点。
    - 标准诊断：展示诊断链 + 方案，人可以修改/否决/补充
    - 紧急升级：同上，但不可跳过
    """
    diagnosis = state.get("diagnosis_conclusion", {})
    solutions = state.get("solutions", [])

    # 构造给人看的结构化信息
    review_package = {
        "type": "human_review",
        "severity": state["interrupt_severity"],  # "optional" or "mandatory"

        # Agent 的诊断推理链（调试工作台的核心展示内容）
        "diagnosis_chain": state.get("diagnosis_investigations", []),
        # 每条：{step, tool, reason_for_calling, result_summary, conclusion_from_result}

        "conclusion": diagnosis,
        "solutions": solutions,

        # 人可以做的操作
        "available_actions": [
            "approve",           # 同意 Agent 判断 + 方案
            "select_solution",   # 从多个方案中选一个
            "modify",            # 修改方案参数（目标价、议价幅度等）
            "add_evidence",      # 补充 Agent 没发现的信息
            "reject_and_rerun",  # 不同意，重跑诊断
            "escalate",          # 升级到更高级别
        ],
    }

    feedback = interrupt(review_package)

    if feedback:
        state["human_feedback"] = feedback
        # 人如果提供了补充信息，注入到 messages 让 Agent 重新推理
        if feedback.get("additional_info"):
            state["messages"].append({
                "role": "user",
                "content": f"人工补充信息：{feedback['additional_info']}"
            })

    return state
```

---

## 七、执行轨迹设计（对接调试工作台）

每条 trace 不再是一个无意义的工具名，而是一个**决策记录**：

```python
# 现在的 trace（无意义）：
{"step": "LLM路由", "output": "选择了 tool_predict_price_range"}

# 改后的 trace（可解释）：
{
    "phase": "diagnosis",
    "step": 1,
    "agent_thought": "偏离度 55 分，价格偏离 38% 但市场偏离仅 25%，怀疑是供应商溢价而非行情问题",
    "decision": "调 tool_get_supplier_profile 查看该供应商历史表现",
    "confidence": 0.7,
    "result_summary": "该供应商近 6 个月平均偏离 +12%，本次 +38%，系统性偏高",
    "conclusion_from_step": "排除纯行情因素，确认为供应商溢价 + 本次额外偏高",
    "timestamp": "2025-05-25T10:30:00",
}
```

调试工作台渲染这串记录时，用户看到的是 Agent 的**思考过程**，每一条都可以点击展开看细节、或者注入修正。

---

## 八、容错设计

| 场景 | 处理 |
|---|---|
| LLM 调用失败 | 重试 2 次 → 降级为规则诊断（直接用偏离度模板生成方案） |
| 诊断循环超过 5 轮 | 强制结束，取当前最优假设作为结论，标注"诊断不完全" |
| 某个诊断工具无数据 | 工具返回 `available: false`，Agent 跳过该假设继续 |
| 第一阶段工具失败 | `node_triage` 前兜底补全，但标置信度为低 |
| 新供应商无历史 | `tool_get_supplier_profile` 返回同类均值作为先验，Agent 标注不确定性高 |

---

## 九、与当前代码的映射

| 当前 | 改后 | 变化 |
|---|---|---|
| `node_build_material` | `node_build_material` | 保留 |
| `node_llm_router`（无所不包） | `node_agent_router`（仅诊断阶段） | 职责收缩 |
| `node_execute_tool` | `node_execute_tool` | 保留，但只在诊断阶段循环 |
| `node_final_decision`（含大量兜底） | `node_triage` + `node_score_deviation` | 拆分，兜底仅第一阶段 |
| `node_wait_human`（无条件中断） | `node_wait_human`（条件中断） | 三条路径不同行为 |
| 无 | `node_start_diagnosis`、`node_conclude_diagnosis` | 新增 |
| 无 | `node_fast_pass` | 新增 |
| 无 | `decision_log` 字段 | 新增，调试工作台核心数据 |

---

## 十、核心设计思想总结

**把"体检"和"诊断"分开：**

- **体检**（第一阶段）是确定性的，并行跑完，产出结构化的偏离度报告
- **诊断**（第二阶段）是 Agent 真正发挥价值的地方——提出假设、收集证据、排除误判、给出结论
- **三条路径**确保正常报价不被打断，异常报价分级处理
- **执行轨迹**记录的是推理决策，不是工具调用，支撑题目 11 的调试工作台
