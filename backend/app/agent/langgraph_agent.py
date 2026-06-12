"""
LangGraph Agent — 两阶段 + 三条路径架构

第一阶段：自动化体检（确定性，无 LLM）
  build_material → run_baseline(predict + cost + similar) → score_deviation → triage

第二阶段：Agent 诊断（LLM 自主决策）
  start_diagnosis → agent_router ↔ execute_diagnostic_tool
  → conclude_diagnosis → wait_human → finalize

三条路径：
  score < 20       → fast_pass（自动通过，不调 LLM，不等人）
  20 ≤ score < 60 → 标准诊断 + 人工确认（interrupt_severity=optional）
  score ≥ 60      → 紧急诊断 + 强制确认（interrupt_severity=mandatory）
"""

import os
import time
import json
from typing import List, Dict, Any, TypedDict, Literal, Optional
from datetime import datetime

from langgraph.graph import StateGraph, END, START
from langgraph.checkpoint.memory import MemorySaver
from langgraph.types import Command, interrupt

from openai import OpenAI

from app.skills.tool_registry import ToolRegistry


# =============================================================================
# State 定义
# =============================================================================

class AgentState(TypedDict):
    # ===== 输入 =====
    quote_data: Dict[str, Any]

    # ===== 第一阶段输出（确定性体检） =====
    material: Dict[str, Any]
    prediction: Optional[Dict[str, Any]]
    cost_analysis: Optional[Dict[str, Any]]
    similar_materials: List[Dict[str, Any]]
    deviation: Optional[Dict[str, Any]]

    # ===== 第二阶段：Agent 诊断 =====
    diagnosis_hypotheses: List[Dict[str, Any]]
    diagnosis_investigations: List[Dict[str, Any]]
    diagnosis_conclusion: Optional[Dict[str, Any]]

    supplier_profile: Optional[Dict[str, Any]]
    peer_benchmark: Optional[Dict[str, Any]]
    market_context: Optional[Dict[str, Any]]
    inventory_context: Optional[Dict[str, Any]]
    alternatives: List[Dict[str, Any]]

    # ===== 方案 =====
    solutions: List[Dict[str, Any]]
    llm_summary: Optional[str]

    # ===== ReAct 控制 =====
    messages: List[Dict[str, Any]]
    diagnostic_tools_schema: List[Dict[str, Any]]
    tools_called: List[str]
    diagnosis_rounds: int
    phase: str  # "baseline" | "diagnosis" | "resolution" | "fast_pass"

    # ===== 人机交互 =====
    execution_trace: List[Dict[str, Any]]
    decision_log: List[Dict[str, Any]]
    interrupt_reason: Optional[str]
    interrupt_severity: Optional[str]  # "optional" | "mandatory" | None
    human_feedback: Optional[Dict[str, Any]]


# =============================================================================
# 辅助函数
# =============================================================================

def _append_trace(
    state: AgentState,
    step: str,
    status: str,
    output: str,
    duration_ms: float = 0,
    tool_name: Optional[str] = None,
    tool_confidence: Optional[float] = None,
    tool_reasoning: Optional[str] = None,
    agent_thought: Optional[str] = None,
    decision: Optional[str] = None,
    conclusion: Optional[str] = None,
) -> None:
    entry = {
        "step": step,
        "status": status,
        "timestamp": datetime.now().isoformat(),
        "duration_ms": round(duration_ms, 1),
        "output": output,
    }
    if tool_name:
        entry["tool"] = tool_name
    if tool_confidence is not None:
        entry["tool_confidence"] = tool_confidence
    if tool_reasoning:
        entry["tool_reasoning"] = tool_reasoning
    if agent_thought:
        entry["agent_thought"] = agent_thought
    if decision:
        entry["decision"] = decision
    if conclusion:
        entry["conclusion_from_step"] = conclusion
    state.setdefault("execution_trace", []).append(entry)


def _append_decision_log(
    state: AgentState,
    decision_point: str,
    options: List[str],
    chosen: str,
    reasoning: str,
    confidence: float,
) -> None:
    state.setdefault("decision_log", []).append({
        "timestamp": datetime.now().isoformat(),
        "decision_point": decision_point,
        "options_considered": options,
        "chosen_action": chosen,
        "reasoning": reasoning,
        "confidence": confidence,
    })


# =============================================================================
# 第一阶段节点：自动化体检（确定性，无 LLM）
# =============================================================================

def node_build_material(state: AgentState) -> AgentState:
    """构造物料对象"""
    t0 = time.perf_counter()
    qd = state["quote_data"]
    material = {
        "id": qd.get("material_id") or f"MAT-{datetime.now().strftime('%Y%m%d%H%M%S')}",
        "name": qd.get("material_name", "未知物料"),
        "category": qd.get("category", "塑料外壳"),
        "material_type": qd.get("material_type", "ABS"),
        "dimensions": qd.get("dimensions", "80×60×15mm"),
        "processing": qd.get("processing", "注塑成型"),
        "precision": qd.get("precision", "±0.1mm"),
        "supplier_name": qd.get("supplier_name", "未知供应商"),
        "unit_price": qd.get("supplier_quote", 0),
        "order_quantity": qd.get("quantity", 10000),
    }
    state["material"] = material
    state["phase"] = "baseline"
    state["solutions"] = []
    state["diagnosis_investigations"] = []
    state["diagnosis_hypotheses"] = []
    state["diagnosis_rounds"] = 0
    state["tools_called"] = []
    state["messages"] = []
    state["decision_log"] = []
    state["similar_materials"] = []
    state["prediction"] = None
    state["cost_analysis"] = None
    state["deviation"] = None
    _append_trace(
        state, "物料构造", "completed",
        f"物料={material['name']}, 类别={material['category']}, "
        f"供应商={material['supplier_name']}, 报价=¥{qd.get('supplier_quote', 0)}",
        (time.perf_counter() - t0) * 1000,
    )
    return state


def node_run_baseline(state: AgentState, registry: ToolRegistry) -> AgentState:
    """
    串行执行三项体检（互相独立，结果分别记录）：
      1. tool_predict_price_range    — 价格区间预测
      2. tool_analyze_cost_structure — 成本结构拆解
      3. tool_match_similar_material — 相似物料检索
    """
    mat = state["material"]
    qd = state["quote_data"]

    # 1. 价格预测
    t0 = time.perf_counter()
    tool = registry.get("tool_predict_price_range")
    out = tool.execute(
        material_id=mat["id"],
        quantity=qd.get("quantity", 10000),
        category=mat.get("category"),
        processing=mat.get("processing"),
        unit_price=qd.get("supplier_quote"),
    )
    state["prediction"] = out.get("result") or {}
    pred = state["prediction"]
    _append_trace(
        state, "价格预测", "completed",
        f"P10=¥{pred.get('p10')} / P50=¥{pred.get('p50')} / P90=¥{pred.get('p90')}",
        (time.perf_counter() - t0) * 1000,
        tool_name="tool_predict_price_range",
        tool_confidence=out.get("confidence"),
        tool_reasoning=out.get("reasoning"),
    )

    # 1.5 行情刷新（缓存过期时联网更新，确保成本拆解用到新鲜数据）
    try:
        from datetime import datetime as _dt
        from app.db.database import get_connection
        cat = mat.get("category", "")
        conn = get_connection()
        try:
            row = conn.execute(
                "SELECT updated_at FROM external_references WHERE material_category = ?",
                (cat,),
            ).fetchone()
            need_refresh = True
            if row and row["updated_at"]:
                try:
                    age = (_dt.now() - _dt.fromisoformat(row["updated_at"])).total_seconds()
                    need_refresh = age > 86400  # 超过 24 小时
                except (ValueError, TypeError):
                    pass
        finally:
            conn.close()

        if need_refresh:
            t0_refresh = time.perf_counter()
            lookup = registry.get("tool_search_market_price")
            out = lookup.execute(material_category=cat,
                                 material_type=mat.get("material_type", ""))
            if out.get("result", {}).get("searched"):
                _append_trace(
                    state, "行情刷新(联网)", "completed",
                    f"已更新 {cat} 市场行情: "
                    f"¥{out['result'].get('price_low')}~¥{out['result'].get('price_high')}",
                    (time.perf_counter() - t0_refresh) * 1000,
                    tool_name="tool_search_market_price",
                )
    except Exception:
        pass  # 刷新失败不阻塞流程

    # 2. 成本拆解（传入贝叶斯 P50 作为锚点 + 新鲜行情数据）
    t0 = time.perf_counter()
    tool = registry.get("tool_analyze_cost_structure")
    pred = state.get("prediction") or {}
    out = tool.execute(
        material_id=mat["id"],
        supplier_quote=qd.get("supplier_quote", 0),
        category=mat.get("category"),
        processing=mat.get("processing"),
        prediction_p50=pred.get("p50"),  # 贝叶斯合理价作为锚点
    )
    state["cost_analysis"] = out.get("result") or {}
    ca = state["cost_analysis"]
    _append_trace(
        state, "成本拆解", "completed",
        f"锚点=¥{ca.get('anchor_price', 'N/A')}, "
        f"异常项={ca.get('anomaly_count', 0)}, "
        f"原材料交叉验证={'已完成' if ca.get('cost_items', [{}])[0].get('independently_verified') else '未完成'}",
        (time.perf_counter() - t0) * 1000,
        tool_name="tool_analyze_cost_structure",
        tool_confidence=out.get("confidence"),
        tool_reasoning=out.get("reasoning"),
    )

    # 3. 相似物料检索
    t0 = time.perf_counter()
    tool = registry.get("tool_match_similar_material")
    out = tool.execute(material_id=mat["id"], top_k=5)
    state["similar_materials"] = out.get("result") if isinstance(out.get("result"), list) else []
    _append_trace(
        state, "相似物料检索", "completed",
        f"检索到 {len(state['similar_materials'])} 条相似物料",
        (time.perf_counter() - t0) * 1000,
        tool_name="tool_match_similar_material",
        tool_confidence=out.get("confidence"),
        tool_reasoning=out.get("reasoning"),
    )

    return state


def node_score_deviation(state: AgentState, registry: ToolRegistry) -> AgentState:
    """计算偏离度（确定性）"""
    t0 = time.perf_counter()
    tool = registry.get("tool_score_deviation")
    out = tool.execute(
        material_id=state["material"]["id"],
        supplier_quote=state["quote_data"]["supplier_quote"],
        prediction=state.get("prediction") or {},
        cost_analysis=state.get("cost_analysis") or {},
        category=state["material"].get("category", ""),
    )
    state["deviation"] = out.get("result") or {}
    dev = state["deviation"]
    _append_trace(
        state, "偏离度评分", "completed",
        f"偏离度={dev.get('deviation_score', 0)}分 ({dev.get('severity_level', '')})，"
        f"价格={dev.get('price_deviation', 0)}% / "
        f"成本={dev.get('cost_deviation', 0)}% / "
        f"市场={dev.get('market_deviation', 0)}%",
        (time.perf_counter() - t0) * 1000,
        tool_name="tool_score_deviation",
        tool_confidence=out.get("confidence"),
        tool_reasoning=out.get("reasoning"),
    )
    return state


# =============================================================================
# 分流节点（无 LLM）
# =============================================================================

def node_triage(state: AgentState) -> AgentState:
    """分流节点 — 根据偏离度决定三条路径"""
    dev = state.get("deviation") or {}
    score = dev.get("deviation_score", 0)

    if score < 20:
        state["phase"] = "fast_pass"
        state["interrupt_severity"] = None
        _append_trace(
            state, "分流决策", "completed",
            f"偏离度={score}分 → 快速通道（自动通过）", 0,
        )
    elif score >= 60:
        state["phase"] = "diagnosis"
        state["interrupt_severity"] = "mandatory"
        _append_trace(
            state, "分流决策", "completed",
            f"偏离度={score}分 → 紧急诊断（强制人工确认）", 0,
        )
    else:
        state["phase"] = "diagnosis"
        state["interrupt_severity"] = "optional"
        _append_trace(
            state, "分流决策", "completed",
            f"偏离度={score}分 → 标准诊断（人工确认）", 0,
        )

    return state


def triage_router(state: AgentState) -> Literal["node_fast_pass", "node_start_diagnosis"]:
    """分流条件边"""
    if state["phase"] == "fast_pass":
        return "node_fast_pass"
    return "node_start_diagnosis"


# =============================================================================
# 快速通道
# =============================================================================

def node_fast_pass(state: AgentState) -> AgentState:
    """快速通道：自动通过，不调用 LLM，不 interrupt"""
    qd = state["quote_data"]
    pred = state.get("prediction") or {}
    dev = state.get("deviation") or {}

    state["solutions"] = [{
        "id": f"SOL-{qd.get('id', 'Q-NEW')}-PASS",
        "title": "直接通过",
        "description": (
            f"报价 ¥{qd.get('supplier_quote', 0)} 在预测区间内"
            f"（P10=¥{pred.get('p10')} ~ P90=¥{pred.get('p90')}），"
            f"偏离度仅 {dev.get('deviation_score', 0)} 分，建议直接通过。"
        ),
        "confidence": 0.95,
        "estimated_savings": "¥0",
        "action": "accept",
        "generated_by": "auto",
    }]
    state["diagnosis_conclusion"] = {
        "root_cause": "报价正常，在预测区间内",
        "cause_category": "normal",
        "confidence": 0.95,
        "reasoning_chain": [],
    }
    state["interrupt_reason"] = (
        f"偏离度 {dev.get('deviation_score', 0)} 分（正常），建议直接通过。"
    )
    _append_trace(
        state, "快速通道", "completed",
        "自动通过，无需 LLM 诊断，无需人工确认", 0,
    )
    return state


# =============================================================================
# 第二阶段：Agent 诊断（LLM 自主决策）
# =============================================================================

# 诊断阶段开放给 LLM 的工具列表
DIAGNOSTIC_TOOL_NAMES = [
    "tool_get_supplier_profile",
    "tool_compare_peer_price",
    "tool_check_market_trend",
    "tool_search_market_price",
    "tool_check_urgency",
    "tool_search_alternatives",
    "tool_analyze_cost_anomaly",
    "tool_generate_solutions",
]


def node_start_diagnosis(state: AgentState, registry: ToolRegistry) -> AgentState:
    """诊断入口：准备 LLM 上下文，生成初始假设"""
    t0 = time.perf_counter()

    # 只暴露诊断工具给 LLM
    diagnostic_schemas = []
    for name in DIAGNOSTIC_TOOL_NAMES:
        try:
            t = registry.get(name)
            diagnostic_schemas.append(t.get_openai_function())
        except KeyError:
            pass
    state["diagnostic_tools_schema"] = diagnostic_schemas

    # 构建 system prompt
    system_prompt = _build_diagnosis_system_prompt(state)
    state["messages"] = [{"role": "system", "content": system_prompt}]

    # 生成初始假设
    dev = state.get("deviation") or {}
    price_dev = dev.get("price_deviation", 0)
    market_dev = dev.get("market_deviation", 0)
    cost_dev = dev.get("cost_deviation", 0)

    hypotheses = []
    if price_dev > 15:
        hypotheses.append({
            "hypothesis": "供应商系统性溢价",
            "prior_confidence": 0.6 if market_dev < 20 else 0.3,
            "to_verify": "调用 tool_get_supplier_profile 查看该供应商历史偏离趋势",
            "conclusion": f"价格偏离 {price_dev:.0f}%，市场偏离 {market_dev:.0f}%，"
                          f"{'供应商溢价可能性高' if market_dev < 20 else '需结合市场因素综合判断'}",
        })
    if market_dev > 15:
        hypotheses.append({
            "hypothesis": "原材料市场行情上涨",
            "prior_confidence": 0.5,
            "to_verify": "调用 tool_check_market_trend 查看原材料行情",
            "conclusion": f"市场偏离 {market_dev:.0f}%，需核实近期原材料行情变动幅度",
        })
    if cost_dev > 20:
        hypotheses.append({
            "hypothesis": "工艺复杂度被低估或成本项异常",
            "prior_confidence": 0.4,
            "to_verify": "调用 tool_analyze_cost_anomaly 深度分析成本结构",
            "conclusion": f"成本偏离 {cost_dev:.0f}%，可能存在成本项异常或行业基准不匹配",
        })
    if not hypotheses:
        hypotheses.append({
            "hypothesis": "数据稀疏导致误判",
            "prior_confidence": 0.3,
            "to_verify": "检查历史数据量和参考数据可用性",
            "conclusion": "三个偏离分均低于阈值，但偏离度评分异常，怀疑样本量不足或数据质量问题",
        })

    state["diagnosis_hypotheses"] = hypotheses

    _append_trace(
        state, "诊断启动", "completed",
        f"生成 {len(hypotheses)} 个初始假设: "
        + "; ".join(h["hypothesis"] for h in hypotheses),
        (time.perf_counter() - t0) * 1000,
        conclusion="; ".join(h.get("conclusion", h["hypothesis"]) for h in hypotheses),
    )
    return state


def node_agent_router(state: AgentState, registry: ToolRegistry) -> AgentState:
    """LLM 决策节点 — 仅用于诊断阶段，自主选择诊断工具"""
    t0 = time.perf_counter()
    messages = list(state["messages"])
    tools = state.get("diagnostic_tools_schema", [])

    response = _call_kimi_with_tools(
        messages[0]["content"],  # system prompt
        messages[1:],            # conversation history (assistant + tool messages)
        tools,
    )
    messages.append(response)
    state["messages"] = messages

    if response.get("tool_calls"):
        called_names = [tc["function"]["name"] for tc in response["tool_calls"]]
        called_set = set(state.get("tools_called", []))
        for name in called_names:
            called_set.add(name)
        state["tools_called"] = list(called_set)

        _append_decision_log(
            state,
            decision_point=f"诊断第{state['diagnosis_rounds'] + 1}轮",
            options=[t["function"]["name"] for t in tools],
            chosen=", ".join(called_names),
            reasoning=(response.get("content") or "")[:200],
            confidence=0.7,
        )
        llm_reasoning = (response.get("content") or "")[:400]
        _append_trace(
            state, "Agent决策", "tool_call",
            f"选择调用: {', '.join(called_names)}",
            (time.perf_counter() - t0) * 1000,
            agent_thought=llm_reasoning[:300],
            decision=", ".join(called_names),
            conclusion=llm_reasoning[:200],
        )
    else:
        llm_conclusion = (response.get("content") or "")[:400]
        _append_trace(
            state, "Agent决策", "diagnosis_conclusion",
            llm_conclusion[:300],
            (time.perf_counter() - t0) * 1000,
            agent_thought=llm_conclusion[:300],
            conclusion=llm_conclusion[:200],
        )

    return state


def node_execute_diagnostic_tool(state: AgentState, registry: ToolRegistry) -> AgentState:
    """执行 LLM 选择的诊断工具，结果回填 state 并追加到 messages"""
    messages = list(state["messages"])
    last_msg = messages[-1] if messages else {}
    tool_calls = last_msg.get("tool_calls", [])

    if not tool_calls:
        return state

    for call in tool_calls:
        tool_name = call["function"]["name"]
        try:
            args = (
                json.loads(call["function"]["arguments"])
                if isinstance(call["function"]["arguments"], str)
                else call["function"]["arguments"]
            )
        except (json.JSONDecodeError, TypeError):
            args = {}

        # 注入诊断上下文（强制覆盖，LLM 传参不可靠）
        if tool_name == "tool_analyze_cost_anomaly":
            args["cost_analysis"] = state.get("cost_analysis", {})
            args["supplier_quote"] = state["quote_data"].get("supplier_quote", 0)
            args["material_category"] = state["quote_data"].get("category", "")
            args.setdefault("supplier_profile", state.get("supplier_profile", {}))
            args.setdefault("peer_benchmark", state.get("peer_benchmark", {}))
            args.setdefault("market_context", state.get("market_context", {}))
        if tool_name == "tool_check_urgency":
            args["material_name"] = state["quote_data"].get("material_name", "")
            args["category"] = state["quote_data"].get("category", "")
        if tool_name == "tool_generate_solutions":
            args["quantity"] = state["quote_data"].get("quantity", 0)
            args["supplier_profile"] = state.get("supplier_profile", {})
            args["inventory_context"] = state.get("inventory_context", {})
            args["peer_benchmark"] = state.get("peer_benchmark", {})
            args["market_context"] = state.get("market_context", {})
            args["alternatives"] = state.get("alternatives", [])
            args["cost_analysis"] = state.get("cost_analysis", {})
            pred = state.get("prediction") or {}
            args["ai_prediction_mid"] = pred.get("p50")
            args["ai_prediction_high"] = pred.get("p90")

        try:
            tool = registry.get(tool_name)
            result = tool.execute(**args)
        except Exception as e:
            result = {
                "result": {},
                "confidence": 0.0,
                "reasoning": f"工具执行失败: {e}",
            }

        # 追加 tool 消息到对话历史
        tool_msg = {
            "role": "tool",
            "tool_call_id": call["id"],
            "content": json.dumps(result, ensure_ascii=False),
        }
        messages.append(tool_msg)

        result_data = result.get("result", {})
        reasoning = result.get("reasoning", "")

        # 回填到 state 对应字段
        _dispatch_diagnostic_result(state, tool_name, result_data)

        # 记录调查过程（调试工作台核心数据）
        state["diagnosis_investigations"].append({
            "step": len(state["diagnosis_investigations"]) + 1,
            "tool": tool_name,
            "args_summary": str(args).replace("{", "").replace("}", "")[:120],
            "result_summary": reasoning[:200],
            "confidence": result.get("confidence", 0),
        })

        _append_trace(
            state, f"诊断工具:{tool_name}", "completed",
            reasoning[:200], 0,
            tool_name=tool_name,
            tool_confidence=result.get("confidence"),
            tool_reasoning=reasoning,
            conclusion=reasoning[:150],
        )

    state["messages"] = messages
    state["diagnosis_rounds"] += 1
    return state


def _dispatch_diagnostic_result(
    state: AgentState, tool_name: str, result_data: Any
) -> None:
    """将诊断工具结果回填到 state 对应字段"""
    if tool_name == "tool_get_supplier_profile" and isinstance(result_data, dict):
        state["supplier_profile"] = result_data
    elif tool_name == "tool_compare_peer_price" and isinstance(result_data, dict):
        state["peer_benchmark"] = result_data
    elif tool_name == "tool_search_market_price" and isinstance(result_data, dict):
        state["market_context"] = result_data  # 与 market_trend 共用字段
    elif tool_name == "tool_check_market_trend" and isinstance(result_data, dict):
        state["market_context"] = result_data
    elif tool_name == "tool_check_urgency" and isinstance(result_data, dict):
        state["inventory_context"] = result_data
    elif tool_name == "tool_search_alternatives":
        state["alternatives"] = result_data if isinstance(result_data, list) else []
    elif tool_name == "tool_generate_solutions" and isinstance(result_data, list):
        state["solutions"] = result_data


def after_agent_router(
    state: AgentState,
) -> Literal["node_execute_diagnostic_tool", "node_conclude_diagnosis"]:
    """agent_router 之后的路径选择"""
    MAX_ROUNDS = 5

    if state["diagnosis_rounds"] >= MAX_ROUNDS:
        _append_trace(
            state, "诊断循环", "max_rounds",
            f"达到最大轮次 {MAX_ROUNDS}，强制结束诊断", 0,
        )
        return "node_conclude_diagnosis"

    for msg in reversed(state.get("messages", [])):
        if msg.get("role") == "assistant":
            if msg.get("tool_calls"):
                return "node_execute_diagnostic_tool"
            return "node_conclude_diagnosis"

    return "node_conclude_diagnosis"


def after_execute_tool(
    state: AgentState,
) -> Literal["node_agent_router", "node_conclude_diagnosis"]:
    """execute_tool 之后的路径选择"""
    MAX_ROUNDS = 5

    if state["diagnosis_rounds"] >= MAX_ROUNDS:
        _append_trace(
            state, "诊断循环", "max_rounds",
            f"达到最大轮次 {MAX_ROUNDS}，强制结束诊断", 0,
        )
        return "node_conclude_diagnosis"

    return "node_agent_router"


def node_conclude_diagnosis(state: AgentState, registry: ToolRegistry) -> AgentState:
    """诊断结论提取 + 兜底方案生成"""
    t0 = time.perf_counter()
    messages = state.get("messages", [])
    dev = state.get("deviation") or {}

    # 提取 LLM 最后的自然语言结论
    llm_conclusion = ""
    for msg in reversed(messages):
        if msg.get("role") == "assistant" and msg.get("content"):
            llm_conclusion = msg["content"]
            break

    # 如果 LLM 没调 tool_generate_solutions，这里兜底生成
    if not state.get("solutions"):
        qd = state["quote_data"]
        sims = state.get("similar_materials") or []
        try:
            tool = registry.get("tool_generate_solutions")
            out = tool.execute(
                quote_id=qd.get("id", "Q-NEW"),
                supplier_quote=qd.get("supplier_quote", 0),
                deviation_score=dev.get("deviation_score", 0),
                severity_level=dev.get("severity_level", "正常"),
                deviation_details=dev,
                similar_materials=sims,
                quantity=qd.get("quantity", 0),
                supplier_profile=state.get("supplier_profile", {}),
                inventory_context=state.get("inventory_context", {}),
                peer_benchmark=state.get("peer_benchmark", {}),
                market_context=state.get("market_context", {}),
                alternatives=state.get("alternatives", []),
                cost_analysis=state.get("cost_analysis", {}),
                ai_prediction_mid=(state.get("prediction") or {}).get("p50"),
                ai_prediction_high=(state.get("prediction") or {}).get("p90"),
            )
            state["solutions"] = out.get("result") or []
            _append_trace(
                state, "方案生成(兜底)", "completed",
                f"生成 {len(state['solutions'])} 个方案", 0,
                tool_name="tool_generate_solutions",
                tool_confidence=out.get("confidence"),
            )
        except Exception as e:
            _append_trace(
                state, "方案生成(兜底)", "failed",
                f"方案生成失败: {e}", 0,
            )

    # 构造诊断结论
    state["diagnosis_conclusion"] = {
        "root_cause": _derive_root_cause(state),
        "cause_category": _derive_cause_category(state),
        "confidence": _estimate_diagnosis_confidence(state),
        "reasoning_chain": state.get("diagnosis_investigations", []),
        "llm_summary": llm_conclusion,
    }

    state["llm_summary"] = llm_conclusion
    dc = state["diagnosis_conclusion"]
    state["interrupt_reason"] = (
        f"偏离度 {dev.get('deviation_score', 0)} 分（{dev.get('severity_level', '')}），"
        f"诊断结论：{dc['root_cause']}，"
        f"已生成 {len(state.get('solutions', []))} 个方案，请人工审批。"
    )

    _append_trace(
        state, "诊断结论", "completed",
        f"根因={dc['root_cause']}，类别={dc['cause_category']}，"
        f"置信度={dc['confidence']}",
        (time.perf_counter() - t0) * 1000,
        conclusion=dc['root_cause'],
    )
    return state


def _derive_root_cause(state: AgentState) -> str:
    """从诊断调查结果综合判断根因"""
    supplier = state.get("supplier_profile") or {}
    market = state.get("market_context") or {}
    peer = state.get("peer_benchmark") or {}
    dev = state.get("deviation") or {}
    cost = state.get("cost_analysis") or {}

    supplier_available = supplier.get("available", False)
    market_available = market.get("available", False)
    peer_available = peer.get("available", False)
    anomaly_count = cost.get("anomaly_count", 0)

    if anomaly_count >= 2 and dev.get("cost_deviation", 0) >= 25:
        return (
            f"成本结构异常：发现 {anomaly_count} 个异常成本项，"
            f"成本偏离 {dev.get('cost_deviation', 0):.0f}%，"
            "建议优先核实原材料、工艺或利润加成假设。"
        )

    # 有供应商画像 + 有同行对比 → 最可靠
    if supplier_available and peer_available:
        premium = peer.get("current_premium_pct", 0)
        if premium > 15:
            return (
                f"供应商溢价：同行均价 ¥{peer.get('peer_avg_price', '?')}，"
                f"当前报价偏高 {premium:.0f}%，"
                f"该供应商历史均价 ¥{supplier.get('avg_unit_price', '?')}"
            )
        return f"报价略高于同行（偏高{premium:.0f}%），尚在合理范围"

    # 只有供应商画像
    if supplier_available:
        trend = supplier.get("price_trend", "稳定")
        if trend == "上升":
            return f"供应商历史报价呈上升趋势，本次偏离可能为趋势延续"
        return f"供应商历史{len(supplier.get('sample_materials', []))}条记录，无明显异常模式"

    # 只有市场行情
    if market_available:
        return (
            f"市场行情驱动：{market.get('category', '')} 品类"
            f"外部参考价 ¥{market.get('price_low', '?')}~¥{market.get('price_high', '?')}"
        )

    # 如果没有执行任何诊断工具（LLM 不可用或未调用工具）
    if not state.get("diagnosis_investigations"):
        score = dev.get("deviation_score", 0)
        severity = dev.get("severity_level", "未知")
        return (
            f"未执行诊断工具（LLM 不可用或未调用），无法定位具体根因。"
            f"偏离度 {score} 分（{severity}），已有规则生成方案，建议人工判断。"
        )

    # 数据不全
    score = dev.get("deviation_score", 0)
    if score > 40:
        return "数据不足，仅执行了部分诊断工具，根因不明，建议人工判断"
    return "部分诊断工具未返回有效数据，根因待确认"


def _derive_cause_category(state: AgentState) -> str:
    supplier = state.get("supplier_profile") or {}
    market = state.get("market_context") or {}
    peer = state.get("peer_benchmark") or {}
    cost = state.get("cost_analysis") or {}

    if cost.get("anomaly_count", 0) >= 2:
        return "cost_structure_anomaly"
    elif peer.get("current_premium_pct", 0) > 15:
        return "supplier_premium"
    elif market.get("available"):
        return "market_trend"
    elif (supplier.get("purchase_count", 0) + supplier.get("analyzed_quotes", 0)) < 3:
        return "insufficient_data"
    else:
        return "unknown_anomaly"


def _estimate_diagnosis_confidence(state: AgentState) -> float:
    investigations = state.get("diagnosis_investigations", [])
    if not investigations:
        return 0.5
    avg = sum(inv.get("confidence", 0.5) for inv in investigations) / len(investigations)
    return round(min(0.95, avg), 2)


# =============================================================================
# Human-in-the-Loop
# =============================================================================

def node_wait_human(state: AgentState) -> AgentState:
    """人工确认节点 — 根据 interrupt_severity 控制行为"""
    interrupt_severity = state.get("interrupt_severity", "optional")

    review_package = {
        "type": "human_review",
        "severity": interrupt_severity,
        "quote_id": state["quote_data"].get("id", "Q-NEW"),
        "diagnosis_chain": state.get("diagnosis_investigations", []),
        "diagnosis_conclusion": state.get("diagnosis_conclusion", {}),
        "solutions": state.get("solutions", []),
        "deviation": state.get("deviation", {}),
        "available_actions": [
            "approve",
            "select_solution",
            "modify",
            "add_evidence",
            "reject_and_rerun",
            "escalate",
        ],
    }

    feedback = interrupt(review_package)

    if feedback:
        state["human_feedback"] = feedback
        # 人如果提供了补充信息，注入到 messages
        if feedback.get("additional_info"):
            state["messages"].append({
                "role": "user",
                "content": f"人工补充信息：{feedback['additional_info']}",
            })

    return state


def node_finalize(state: AgentState) -> AgentState:
    """最终汇总"""
    fb = state.get("human_feedback")
    if fb:
        decision = fb.get("decision", "")
        comment = fb.get("comment", "")
        for sol in state.get("solutions", []):
            sol["human_decision"] = decision
            if comment:
                sol["human_comment"] = comment

    _append_trace(
        state, "流程结束", "completed",
        f"最终方案数={len(state.get('solutions', []))}，"
        f"诊断调查步数={len(state.get('diagnosis_investigations', []))}，"
        f"阶段={state.get('phase', 'unknown')}",
        0,
    )
    return state


# =============================================================================
# System Prompt（仅诊断阶段使用）
# =============================================================================

def _build_diagnosis_system_prompt(state: AgentState) -> str:
    qd = state.get("quote_data", {})
    pred = state.get("prediction") or {}
    cost = state.get("cost_analysis") or {}
    dev = state.get("deviation") or {}
    rag = dev.get("rag", {}) if dev else {}
    sims = state.get("similar_materials", [])
    hypotheses = state.get("diagnosis_hypotheses", [])

    pred_text = (
        f"P10=¥{pred.get('p10')} / P50=¥{pred.get('p50')} / P90=¥{pred.get('p90')}"
        if pred else "无"
    )
    cost_text = "\n".join(
        f"  - {c['item']}: 供应商占比{c.get('supplier_pct', '?')}% "
        f"vs 基准{c.get('benchmark_pct', '?')}% ({c.get('status', '?')})"
        for c in cost.get("cost_items", [])
    ) if cost.get("cost_items") else "无"
    dev_text = (
        f"偏离度={dev.get('deviation_score')}分（{dev.get('severity_level')}），"
        f"价格偏离={dev.get('price_deviation')}% / "
        f"成本偏离={dev.get('cost_deviation')}% / "
        f"市场偏离={dev.get('market_deviation')}%"
        if dev else "无"
    )
    rag_text = (
        f"外部参考 ¥{rag.get('ref_low', '?')}~¥{rag.get('ref_high', '?')}"
        f"（{rag.get('source', '无')}）"
        if rag.get("available") else "无外部数据"
    )
    sims_text = "\n".join(
        f"  - {s['name']} | ¥{s.get('price', '?')} | 相似度{s.get('similarity', '?')}"
        for s in sims[:3]
    ) if sims else "无"

    hyps_text = "\n".join(
        f"  {i+1}. {h['hypothesis']}（先验置信度 {h.get('prior_confidence', '?')}）"
        f"→ {h.get('to_verify', '')}"
        for i, h in enumerate(hypotheses)
    ) if hypotheses else "（待生成）"

    return f"""你是九安医疗的供应链诊断专家。你收到一份报价异常体检报告，你的任务是找出异常根因并给出建议。

## 当前体检报告
- 物料：{qd.get('material_name', '')} / {qd.get('category', '')}
- 供应商：{qd.get('supplier_name', '')}，报价 ¥{qd.get('supplier_quote', '')}
- 数量：{qd.get('quantity', 0):,} 件
- 价格预测：{pred_text}
- 成本拆解：
{cost_text}
- 偏离度：{dev_text}
- 外部数据：{rag_text}
- 相似物料：
{sims_text}

## 初始假设
{hyps_text}

## 诊断思路
1. 看偏离模式：三个偏离分中哪个占主导？
   - 价格偏离高 + 市场偏离低 → 可能是供应商溢价
   - 市场偏离高 → 可能是原材料行情问题
   - 成本偏离高 → 可能是工艺复杂度被低估
2. 查供应商历史 → tool_get_supplier_profile
3. 比同行价格 → tool_compare_peer_price
4. 查市场行情 → tool_check_market_trend（静态参考）或 tool_search_market_price（联网实时查询）
   - 优先用 tool_search_market_price 获取当前市场价格
   - 偏离模式指向行情驱动时，必须调用此工具验证
5. 深挖成本 → tool_analyze_cost_anomaly（如成本项异常）
6. 查紧急度 → tool_check_urgency（判断是否有时间议价）
7. 找替代 → tool_search_alternatives（准备备选方案）
8. 下结论 → 确认根因后调 tool_generate_solutions 生成方案

## 可用工具
- tool_get_supplier_profile：查供应商历史偏离趋势
- tool_compare_peer_price：同类物料同行价格对比
- tool_check_market_trend：原材料市场行情（静态参考数据）
- tool_search_market_price：联网搜索当前市场行情（实时价格，优先使用）
- tool_check_urgency：库存/紧急度查询
- tool_search_alternatives：检索替代供应商
- tool_analyze_cost_anomaly：深度成本异常分析
- tool_generate_solutions：生成应对方案（诊断完成后调用）

## 规则
- 每轮调用 1-2 个工具收集证据
- 确认根因后再调 tool_generate_solutions 生成方案
- 没有 tool call 时视为给出最终诊断结论
- 结论需包含：根因 / 推理链 / 置信度 / 建议"""


# =============================================================================
# LLM 调用
# =============================================================================

def _call_kimi_with_tools(
    system_prompt: str,
    messages: List[Dict[str, Any]],
    tools: List[Dict[str, Any]],
) -> Dict[str, Any]:
    api_key = os.environ.get("KIMI_API_KEY", "")
    base_url = os.environ.get("KIMI_BASE_URL", "https://ai-gateway.ailab.jiuan.com/v1")
    model = os.environ.get("KIMI_MODEL", "kimi-k2.5")

    if not api_key:
        return {
            "role": "assistant",
            "content": "KIMI_API_KEY not set",
            "tool_calls": [],
        }

    try:
        import httpx
        client = OpenAI(
            api_key=api_key,
            base_url=base_url,
            timeout=httpx.Timeout(60.0, connect=10.0),
        )

        full_messages = [{"role": "system", "content": system_prompt}] + list(messages)

        response = client.chat.completions.create(
            model=model,
            messages=full_messages,
            tools=tools,
            tool_choice="auto",
            temperature=0.3,
            max_tokens=2048,
        )
        msg = response.choices[0].message
        return {
            "role": "assistant",
            "content": msg.content or "",
            "tool_calls": [
                {
                    "id": tc.id,
                    "function": {
                        "name": tc.function.name,
                        "arguments": tc.function.arguments,
                    },
                }
                for tc in (msg.tool_calls or [])
            ],
        }
    except Exception as e:
        print(f"[LangGraph] Kimi LLM 调用失败: {e}")
        return {
            "role": "assistant",
            "content": f"LLM调用失败: {e}",
            "tool_calls": [],
        }


# =============================================================================
# 图构建
# =============================================================================

def build_quote_agent_graph(
    registry: ToolRegistry, checkpointer=None
) -> StateGraph:
    """
    两阶段 + 三条路径架构：

    START → node_build_material → node_run_baseline → node_score_deviation
      → node_triage
        ├── score<20 → node_fast_pass → END
        └── score≥20 → node_start_diagnosis → node_agent_router
              ↕ (max 5 rounds)
              node_execute_diagnostic_tool
              → node_conclude_diagnosis → node_wait_human → node_finalize → END
    """

    def _bind(fn):
        def wrapper(state):
            return fn(state, registry)
        return wrapper

    workflow = StateGraph(AgentState)

    # ===== 第一阶段节点 =====
    workflow.add_node("node_build_material", node_build_material)
    workflow.add_node("node_run_baseline", _bind(node_run_baseline))
    workflow.add_node("node_score_deviation", _bind(node_score_deviation))
    workflow.add_node("node_triage", node_triage)

    # ===== 快速通道 =====
    workflow.add_node("node_fast_pass", node_fast_pass)

    # ===== 第二阶段节点 =====
    workflow.add_node("node_start_diagnosis", _bind(node_start_diagnosis))
    workflow.add_node("node_agent_router", _bind(node_agent_router))
    workflow.add_node(
        "node_execute_diagnostic_tool", _bind(node_execute_diagnostic_tool)
    )
    workflow.add_node("node_conclude_diagnosis", _bind(node_conclude_diagnosis))
    workflow.add_node("node_wait_human", node_wait_human)
    workflow.add_node("node_finalize", node_finalize)

    # ===== 第一阶段边 =====
    workflow.add_edge(START, "node_build_material")
    workflow.add_edge("node_build_material", "node_run_baseline")
    workflow.add_edge("node_run_baseline", "node_score_deviation")
    workflow.add_edge("node_score_deviation", "node_triage")

    # ===== 分流条件边 =====
    workflow.add_conditional_edges(
        "node_triage",
        triage_router,
        path_map={
            "node_fast_pass": "node_fast_pass",
            "node_start_diagnosis": "node_start_diagnosis",
        },
    )

    # 快速通道结束
    workflow.add_edge("node_fast_pass", END)

    # ===== 第二阶段边 =====
    workflow.add_edge("node_start_diagnosis", "node_agent_router")

    workflow.add_conditional_edges(
        "node_agent_router",
        after_agent_router,
        path_map={
            "node_execute_diagnostic_tool": "node_execute_diagnostic_tool",
            "node_conclude_diagnosis": "node_conclude_diagnosis",
        },
    )

    workflow.add_conditional_edges(
        "node_execute_diagnostic_tool",
        after_execute_tool,
        path_map={
            "node_agent_router": "node_agent_router",
            "node_conclude_diagnosis": "node_conclude_diagnosis",
        },
    )

    workflow.add_edge("node_conclude_diagnosis", "node_wait_human")
    workflow.add_edge("node_wait_human", "node_finalize")
    workflow.add_edge("node_finalize", END)

    if checkpointer is None:
        checkpointer = MemorySaver()
    app = workflow.compile(checkpointer=checkpointer)
    return app
