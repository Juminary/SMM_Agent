"""
LangGraph Agent 核心模块
基于 LangGraph 重构的报价异常检测 Agent
支持：条件路由、Human-in-the-loop、状态持久化、Kimi K2.5 LLM 方案生成

节点通过 ToolRegistry 动态查找工具：
  registry.get("tool_match_similar_material").execute(...)
  registry.get("tool_predict_price_range").execute(...)
  ...
"""

import os
import time
import json
import re
from typing import List, Dict, Any, TypedDict, Literal, Optional, Annotated
from datetime import datetime

from langgraph.graph import StateGraph, END, START
from langgraph.checkpoint.memory import MemorySaver
from langgraph.types import Command, interrupt

try:
    from langgraph.graph import add_messages
    HAS_ADD_MESSAGES = True
except ImportError:
    HAS_ADD_MESSAGES = False

from openai import OpenAI

from app.skills.tool_registry import ToolRegistry


# =============================================================================
# State 定义
# =============================================================================

class AgentState(TypedDict, total=False):
    """Agent 执行状态——所有节点共享"""
    quote_data: Dict[str, Any]
    material: Dict[str, Any]
    similar_materials: List[Dict[str, Any]]
    prediction: Dict[str, Any]
    cost_analysis: Dict[str, Any]
    deviation: Dict[str, Any]
    solutions: List[Dict[str, Any]]
    execution_trace: List[Dict[str, Any]]
    interrupt_reason: Optional[str]
    human_feedback: Optional[Dict[str, Any]]
    llm_solution_text: Optional[str]
    resume_from_node: Optional[str]
    # LLM ReAct 动态工具调用专用字段
    messages: List[Dict[str, Any]]           # LLM 对话历史
    final_answer: Optional[str]              # LLM 最终回答（无 tool_calls 时）


# =============================================================================
# 辅助：执行轨迹记录（包含 tool 调用信息）
# =============================================================================

def _append_trace(
    state: AgentState,
    step: str,
    status: str,
    output: str,
    duration_ms: float,
    tool_name: Optional[str] = None,
    tool_confidence: Optional[float] = None,
    tool_reasoning: Optional[str] = None,
) -> None:
    entry = {
        "step": step,
        "status": status,
        "timestamp": datetime.now().isoformat(),
        "duration_ms": round(duration_ms, 1),
        "output": output,
    }
    if tool_name is not None:
        entry["tool"] = tool_name
    if tool_confidence is not None:
        entry["tool_confidence"] = tool_confidence
    if tool_reasoning is not None:
        entry["tool_reasoning"] = tool_reasoning
    state.setdefault("execution_trace", []).append(entry)


# =============================================================================
# 节点函数（通过 ToolRegistry 调用工具）
# =============================================================================

def node_build_material(state: AgentState) -> AgentState:
    """构造物料对象"""
    t0 = time.perf_counter()
    qd = state["quote_data"]
    material = {
        "id": qd["material_id"],
        "name": qd["material_name"],
        "category": qd.get("category", "塑料外壳"),
        "material_type": qd.get("material_type", "ABS"),
        "dimensions": qd.get("dimensions", "80x60x15mm"),
        "processing": qd.get("processing", "注塑成型"),
        "precision": qd.get("precision", "±0.1mm"),
        "supplier_id": "TEMP",
        "supplier_name": qd["supplier_name"],
        "unit_price": qd["supplier_quote"],
        "order_quantity": qd["quantity"],
        "order_date": qd.get("quote_date", datetime.now().strftime("%Y-%m-%d")),
        "description": qd.get("description", ""),
    }
    state["material"] = material
    _append_trace(
        state, "物料构造", "completed",
        f"物料ID={material['id']}, category={material['category']}",
        (time.perf_counter() - t0) * 1000
    )
    return state


def _node_similar_match(state: AgentState, registry: ToolRegistry) -> AgentState:
    """相似物料检索 — 通过 ToolRegistry 调用 tool_match_similar_material"""
    t0 = time.perf_counter()
    tool = registry.get("tool_match_similar_material")
    mat = state["material"]

    out = tool.execute(material_id=mat["id"], top_k=5)
    results = out.get("result", [])

    state["similar_materials"] = results
    _append_trace(
        state, "相似物料检索", "completed",
        f"Top-{len(results)}相似物料",
        (time.perf_counter() - t0) * 1000,
        tool_name=tool.name,
        tool_confidence=out.get("confidence"),
        tool_reasoning=out.get("reasoning"),
    )
    return state


def _node_price_predict(state: AgentState, registry: ToolRegistry) -> AgentState:
    """价格区间预测 — 通过 ToolRegistry 调用 tool_predict_price_range"""
    t0 = time.perf_counter()
    tool = registry.get("tool_predict_price_range")
    qd = state["quote_data"]
    mat = state["material"]

    out = tool.execute(material_id=mat["id"], quantity=qd.get("quantity", 10000))
    result = out.get("result", {})

    state["prediction"] = result
    _append_trace(
        state, "价格区间预测", "completed",
        f"P10=¥{result.get('p10', 'N/A')} / P50=¥{result.get('p50', 'N/A')} / P90=¥{result.get('p90', 'N/A')}",
        (time.perf_counter() - t0) * 1000,
        tool_name=tool.name,
        tool_confidence=out.get("confidence"),
        tool_reasoning=out.get("reasoning"),
    )
    return state


def _node_cost_analyze(state: AgentState, registry: ToolRegistry) -> AgentState:
    """成本结构拆解 — 通过 ToolRegistry 调用 tool_analyze_cost_structure"""
    t0 = time.perf_counter()
    tool = registry.get("tool_analyze_cost_structure")
    mat = state["material"]
    qd = state["quote_data"]

    out = tool.execute(material_id=mat["id"], supplier_quote=qd["supplier_quote"])
    result = out.get("result", {})

    state["cost_analysis"] = result
    _append_trace(
        state, "成本结构拆解", "completed",
        f"成本偏离={result.get('cost_deviation_score', 0)}分, 基准={result.get('benchmark_key', '')}",
        (time.perf_counter() - t0) * 1000,
        tool_name=tool.name,
        tool_confidence=out.get("confidence"),
        tool_reasoning=out.get("reasoning"),
    )
    return state


def _node_deviation_score(state: AgentState, registry: ToolRegistry) -> AgentState:
    """偏离度综合打分 — 通过 ToolRegistry 调用 tool_score_deviation"""
    t0 = time.perf_counter()
    tool = registry.get("tool_score_deviation")
    mat = state["material"]
    qd = state["quote_data"]

    out = tool.execute(
        material_id=mat["id"],
        supplier_quote=qd["supplier_quote"],
        prediction=state["prediction"],
        cost_analysis=state["cost_analysis"],
    )
    result = out.get("result", {})

    state["deviation"] = result
    _append_trace(
        state, "偏离度综合打分", "completed",
        f"综合偏离度={result.get('deviation_score', 0)}分 ({result.get('severity_level', '')})",
        (time.perf_counter() - t0) * 1000,
        tool_name=tool.name,
        tool_confidence=out.get("confidence"),
        tool_reasoning=out.get("reasoning"),
    )
    return state


# =============================================================================
# LLM 动态路由节点（ReAct 循环）
# =============================================================================

_REACT_SYSTEM_PROMPT = """你是一个专业的SMM报价分析助手（九安医疗采购策略专家）。

## 你的能力
你可以动态调用以下工具来获取分析所需的信息：
1. tool_match_similar_material - 检索历史相似物料，用于价格参考
2. tool_predict_price_range - 预测价格 P10/P50/P90 三分位区间
3. tool_analyze_cost_structure - 拆解供应商报价为5个成本项，与行业基准对比
4. tool_score_deviation - 综合评分（需要先有 prediction 和 cost_analysis）
5. tool_generate_solutions - 根据偏离度生成应对方案（需要先有 deviation）

## 工作流程
1. 首先调用 tool_predict_price_range 获取价格区间（需要 material_id 和 quantity）
2. 调用 tool_analyze_cost_structure 拆解成本（需要 material_id 和 supplier_quote）
3. 调用 tool_score_deviation 计算偏离度（需要 prediction 和 cost_analysis）
4. 调用 tool_match_similar_material 检索相似物料（可选，用于辅助参考）
5. 调用 tool_generate_solutions 生成应对方案（可选）
6. 当你收集到足够信息后，给出最终分析结论

## 重要规则
- 所有工具调用必须提供完整的必需参数
- 偏离度评分(tool_score_deviation)必须等 prediction 和 cost_analysis 都完成后才能调用
- 只有在收集了足够信息（至少要有价格预测或成本分析）后才能给出最终结论
- 最终结论必须包含：偏离度评分、严重级别、核心问题、可执行建议

## 当前报价信息
{quote_context}
"""


def _build_react_system_prompt(quote_data: Dict, material: Dict,
                               prediction: Dict, cost_analysis: Dict,
                               deviation: Dict, similar_materials: List) -> str:
    """构建 ReAct 系统提示词"""
    pred_text = (
        f"P10=¥{prediction.get('p10', 'N/A')} / P50=¥{prediction.get('p50', 'N/A')} / P90=¥{prediction.get('p90', 'N/A')}"
        if prediction else "尚未获取"
    )
    cost_items = cost_analysis.get("cost_items", []) if cost_analysis else []
    cost_text = "\n".join(
        f"  - {c['item']}: 供应商占比{c['supplier_pct']}% vs 基准{c['benchmark_pct']}% ({c['status']})"
        for c in cost_items
    ) if cost_items else "尚未获取"
    dev_text = (
        f"{deviation.get('deviation_score', 'N/A')}分（{deviation.get('severity_level', 'N/A')}）"
        if deviation else "尚未计算"
    )
    sims_text = "\n".join(
        f"  - {s['name']} | ¥{s['price']} | 相似度{s['similarity']}"
        for s in similar_materials[:3]
    ) if similar_materials else "尚未检索"

    context = f"""- 物料：{quote_data.get('material_name', '')} / {quote_data.get('category', '')}
- 供应商：{quote_data.get('supplier_name', '')}
- 报价：¥{quote_data.get('supplier_quote', '')}
- 数量：{quote_data.get('quantity', 0):,}件
- 工艺：{quote_data.get('processing', '')}
- 尺寸：{quote_data.get('dimensions', '')}

当前已获取的信息：
- 价格预测：{pred_text}
- 成本拆解：{cost_text}
- 偏离度评分：{dev_text}
- 相似物料：{sims_text}"""
    return _REACT_SYSTEM_PROMPT.format(quote_context=context)


def node_llm_router(state: AgentState, registry: ToolRegistry) -> AgentState:
    """
    LLM 路由节点 — ReAct 循环的核心
    调用 Kimi K2.5（带 function calling），让 LLM 决定：
    - 调用工具（返回 tool_calls）
    - 或直接给出最终结论（无 tool_calls，结束循环）
    """
    t0 = time.perf_counter()
    tools = [t.get_openai_function() for t in registry._tools.values()]

    messages = state.get("messages", [])
    system_prompt = _build_react_system_prompt(
        quote_data=state.get("quote_data", {}),
        material=state.get("material", {}),
        prediction=state.get("prediction", {}),
        cost_analysis=state.get("cost_analysis", {}),
        deviation=state.get("deviation", {}),
        similar_materials=state.get("similar_materials", []),
    )

    response = _call_kimi_with_tools(system_prompt, messages, tools)

    messages = list(messages) + [response]
    state["messages"] = messages

    if response.get("tool_calls"):
        state["final_answer"] = None
        _append_trace(
            state, "LLM路由(Kimi+tools)", "tool_call",
            f"LLM 选择调用 {len(response['tool_calls'])} 个工具: "
            + ", ".join(tc["function"]["name"] for tc in response["tool_calls"]),
            (time.perf_counter() - t0) * 1000,
        )
    else:
        state["final_answer"] = response.get("content", "")
        _append_trace(
            state, "LLM路由(Kimi+tools)", "final_answer",
            response.get("content", "")[:200],
            (time.perf_counter() - t0) * 1000,
        )

    return state


def node_execute_tool(state: AgentState, registry: ToolRegistry) -> AgentState:
    """
    工具执行节点 — 执行 LLM 选择的 tool_calls
    将工具结果以 tool role 消息追加到 messages，
    并将结果回填到 state 相应字段供下一步使用。
    """
    t0 = time.perf_counter()
    messages = list(state.get("messages", []))
    last_msg = messages[-1] if messages else {}
    tool_calls = last_msg.get("tool_calls", [])

    if not tool_calls:
        return state

    executed_names = []
    for call in tool_calls:
        tool_name = call["function"]["name"]
        try:
            args = json.loads(call["function"]["arguments"]) if isinstance(call["function"]["arguments"], str) else call["function"]["arguments"]
        except (json.JSONDecodeError, TypeError):
            args = {}

        try:
            tool = registry.get(tool_name)
            result = tool.execute(**args)
        except Exception as e:
            result = {
                "result": {},
                "confidence": 0.0,
                "reasoning": f"工具执行失败: {e}",
            }

        tool_msg = {
            "role": "tool",
            "tool_call_id": call["id"],
            "content": json.dumps(result, ensure_ascii=False),
        }
        messages.append(tool_msg)
        executed_names.append(tool_name)

        # 将结果回填到 state（供下一步 LLM 读取上下文）
        result_data = result.get("result", {})
        conf = result.get("confidence", 0.0)
        reasoning = result.get("reasoning", "")

        if tool_name == "tool_predict_price_range" and result_data:
            state["prediction"] = result_data
            _append_trace(state, f"工具执行:{tool_name}", "completed",
                          f"P10=¥{result_data.get('p10')} / P50=¥{result_data.get('p50')} / P90=¥{result_data.get('p90')}",
                          0, tool_name=tool_name, tool_confidence=conf, tool_reasoning=reasoning)
        elif tool_name == "tool_analyze_cost_structure" and result_data:
            state["cost_analysis"] = result_data
            _append_trace(state, f"工具执行:{tool_name}", "completed",
                          f"偏离分={result_data.get('cost_deviation_score', 0)}",
                          0, tool_name=tool_name, tool_confidence=conf, tool_reasoning=reasoning)
        elif tool_name == "tool_match_similar_material":
            state["similar_materials"] = result_data if isinstance(result_data, list) else []
            _append_trace(state, f"工具执行:{tool_name}", "completed",
                          f"检索到 {len(state['similar_materials'])} 条相似物料",
                          0, tool_name=tool_name, tool_confidence=conf, tool_reasoning=reasoning)
        elif tool_name == "tool_score_deviation" and result_data:
            state["deviation"] = result_data
            _append_trace(state, f"工具执行:{tool_name}", "completed",
                          f"偏离度={result_data.get('deviation_score', 0)}分",
                          0, tool_name=tool_name, tool_confidence=conf, tool_reasoning=reasoning)
        elif tool_name == "tool_generate_solutions" and isinstance(result_data, list):
            state["solutions"] = result_data
            _append_trace(state, f"工具执行:{tool_name}", "completed",
                          f"生成 {len(result_data)} 个方案",
                          0, tool_name=tool_name, tool_confidence=conf, tool_reasoning=reasoning)
        else:
            _append_trace(state, f"工具执行:{tool_name}", "completed",
                          reasoning[:100], 0, tool_name=tool_name,
                          tool_confidence=conf, tool_reasoning=reasoning)

    state["messages"] = messages
    return state


def should_continue(state: AgentState) -> Literal["node_execute_tool"]:
    """
    条件边 — 判断是否继续工具执行循环
    - 有 tool_calls：回到 node_execute_tool 继续执行
    - 无 tool_calls（已有 final_answer）：结束，交给 node_wait_human
    """
    messages = state.get("messages", [])
    if messages and messages[-1].get("tool_calls"):
        return "node_execute_tool"
    return END


def decide_route(state: AgentState) -> Literal["node_react_loop", "node_auto_approve"]:
    """
    条件路由节点
    score < 20  -> 自动通过
    score >= 20 -> 进入 LLM ReAct 动态路由循环（LLM 自主决定调用哪些工具）
    """
    score = state["deviation"].get("deviation_score", 0)

    if score < 20:
        return "node_auto_approve"
    else:
        return "node_react_loop"


def node_react_loop(state: AgentState, registry: ToolRegistry) -> AgentState:
    """
    ReAct 循环入口节点。
    调用 node_llm_router -> 条件边 -> node_execute_tool -> 回到 node_llm_router
    直到 LLM 给出 final_answer，然后流向 node_wait_human。
    """
    return node_llm_router(state, registry)


def node_auto_approve(state: AgentState) -> AgentState:
    """自动通过 — 偏离度 < 20"""
    t0 = time.perf_counter()
    qd = state["quote_data"]
    pred = state["prediction"]
    dev = state["deviation"]

    solutions = [{
        "id": f"SOL-{qd.get('id', 'Q-NEW')}-A",
        "title": "直接通过",
        "description": (
            f"报价¥{qd['supplier_quote']}在AI预测区间内(P10={pred['p10']}, P90={pred['p90']})，"
            f"偏离度仅{dev['deviation_score']}分。建议直接通过。"
        ),
        "confidence": round(0.92 + 0.05 * min(pred.get("confidence", 0.7) / 0.9, 1), 2),
        "estimated_savings": "¥0",
        "action": "accept",
        "generated_by": "rule",
    }]

    state["solutions"] = solutions
    _append_trace(
        state, "方案生成(自动通过)", "completed",
        f"1个方案: 直接通过 (置信度={solutions[0]['confidence']})",
        (time.perf_counter() - t0) * 1000
    )
    return state


def node_llm_generate(state: AgentState) -> AgentState:
    """
    LLM 方案生成 — 调用 Kimi K2.5
    偏离度 20-60：生成 2-3 个方案，然后中断等待人工确认
    """
    t0 = time.perf_counter()
    qd = state["quote_data"]
    dev = state["deviation"]
    pred = state["prediction"]
    cost = state["cost_analysis"]
    sims = state["similar_materials"]

    prompt = _build_llm_prompt(qd, dev, pred, cost, sims)
    llm_text = _call_kimi_llm(prompt)
    solutions = _parse_llm_solutions(llm_text, qd)
    state["solutions"] = solutions
    state["llm_solution_text"] = llm_text

    _append_trace(
        state, "LLM方案生成(Kimi K2.5)", "completed",
        f"生成{len(solutions)}个方案，LLM原始输出已保存",
        (time.perf_counter() - t0) * 1000
    )
    return state


def node_escalate(state: AgentState) -> AgentState:
    """升级处理 — 偏离度 >= 60，直接中断等待人工"""
    t0 = time.perf_counter()
    qd = state["quote_data"]
    dev = state["deviation"]
    pred = state["prediction"]

    target_price = pred.get("p50", qd["supplier_quote"] * 0.85)
    savings = (qd["supplier_quote"] - target_price) * qd.get("quantity", 0)

    solutions = [
        {
            "id": f"SOL-{qd.get('id', 'Q-NEW')}-A",
            "title": "直接议价",
            "description": (
                f"当前报价¥{qd['supplier_quote']} vs AI预测中位¥{pred.get('p50', 'N/A')}，"
                f"偏离+{dev.get('price_deviation', 0):.0f}%。"
                f"建议以¥{target_price:.2f}为目标进行议价，预计节省¥{savings:,.0f}。"
            ),
            "confidence": 0.85,
            "estimated_savings": f"¥{savings:,.0f}",
            "action": "negotiate",
            "generated_by": "rule",
        },
        {
            "id": f"SOL-{qd.get('id', 'Q-NEW')}-B",
            "title": "二次询价",
            "description": "单一供应商报价，无法判断是否具有代表性。建议向其他2-3家同类供应商发起二次询价。",
            "confidence": 0.72,
            "estimated_savings": "待定",
            "action": "requote",
            "generated_by": "rule",
        },
        {
            "id": f"SOL-{qd.get('id', 'Q-NEW')}-C",
            "title": "升级处理",
            "description": f"偏离度 {dev['deviation_score']} 分，超出工程师自主处理权限。建议上报采购经理，进行专项评审。",
            "confidence": 0.90,
            "estimated_savings": "需评审",
            "action": "escalate",
            "generated_by": "rule",
        },
    ]

    state["solutions"] = solutions
    state["interrupt_reason"] = (
        f"偏离度 {dev['deviation_score']} 分（{dev['severity_level']}），"
        f"已生成 {len(solutions)} 个应对方案，请人工审批。"
    )

    _append_trace(
        state, "方案生成(升级处理)", "completed",
        f"{len(solutions)}个方案: 直接议价/二次询价/升级处理",
        (time.perf_counter() - t0) * 1000
    )
    return state


def node_wait_human(state: AgentState) -> AgentState:
    """
    人工确认节点 — LangGraph interrupt
    LangGraph 在此节点自动暂停，等待外部调用 app.invoke(Command(resume=...))
    """
    reason = state.get(
        "interrupt_reason",
        "偏离度超出阈值，需人工确认后方可继续。"
    )
    state["interrupt_reason"] = reason

    feedback = interrupt({
        "type": "human_review_required",
        "reason": reason,
        "quote_id": state["quote_data"].get("id", "Q-NEW"),
        "solutions": state.get("solutions", []),
        "deviation": state.get("deviation", {}),
    })

    if feedback:
        state["human_feedback"] = feedback

    return state


def node_finalize(state: AgentState) -> AgentState:
    """最终汇总节点"""
    t0 = time.perf_counter()

    fb = state.get("human_feedback")
    if fb:
        for sol in state.get("solutions", []):
            sol["human_decision"] = fb.get("decision")
            sol["human_comment"] = fb.get("comment", "")

    _append_trace(
        state, "流程结束", "completed",
        f"最终确认方案数={len(state.get('solutions', []))}",
        (time.perf_counter() - t0) * 1000
    )
    return state


# =============================================================================
# LLM 相关辅助函数
# =============================================================================

def _build_llm_prompt(
    quote_data: Dict,
    deviation: Dict,
    prediction: Dict,
    cost_analysis: Dict,
    similar_materials: List[Dict],
) -> str:
    """构造发送给 Kimi K2.5 的 prompt"""

    sims_text = "\n".join(
        f"  - {s['name']} | 价格¥{s['price']} | 相似度{s['similarity']} | "
        f"供应商:{s['supplier']} | 日期:{s['date']}"
        for s in similar_materials[:3]
    ) if similar_materials else "  （无历史相似物料）"

    cost_items = cost_analysis.get("cost_items", [])
    cost_text = "\n".join(
        f"  - {c['item']}: 供应商占比{c['supplier_pct']}% vs 基准{c['benchmark_pct']}% ({c['status']})"
        for c in cost_items
    ) if cost_items else "  （无成本数据）"

    prompt = f"""你是九安医疗的采购策略专家，专注于BOM成本分析和供应商报价评审。

## 当前报价信息
- 物料名称：{quote_data['material_name']}
- 物料类别：{quote_data.get('category', '未知')}
- 供应商：{quote_data['supplier_name']}
- 报价金额：¥{quote_data['supplier_quote']}
- 订单数量：{quote_data.get('quantity', 0):,}件
- 工艺要求：{quote_data.get('processing', '未知')}
- 规格尺寸：{quote_data.get('dimensions', '未知')}

## AI 价格分析
- AI预测价格区间：P10=¥{prediction.get('p10', 'N/A')} / P50=¥{prediction.get('p50', 'N/A')} / P90=¥{prediction.get('p90', 'N/A')}
- 价格置信度：{prediction.get('confidence', 'N/A')}

## 偏离度分析
- 综合偏离度评分：{deviation.get('deviation_score', 0)}分（严重级别：{deviation.get('severity_level', '未知')}）
- 价格偏离：+{deviation.get('price_deviation', 0)}%（>0 表示报价偏高）
- 成本结构偏离：{deviation.get('cost_deviation', 0)}分
- 市场偏离：{deviation.get('market_deviation', 0)}%
- 综合评分权重：历史={deviation.get('weights', {}).get('alpha', 0)} / 成本={deviation.get('weights', {}).get('beta', 0)} / 市场={deviation.get('weights', {}).get('gamma', 0)}

## 成本结构拆解
{cost_text}

## 历史相似物料
{sims_text}

## 任务要求
请根据以上信息，生成 2-3 个具体可执行的应对方案。每个方案必须包含：
1. **方案编号**（如 SOL-A、SOL-B、SOL-C）
2. **方案标题**（一句话概括）
3. **核心策略**（具体操作步骤，3-5 句话）
4. **预期效果**（量化描述，如预计节省金额、降价幅度）
5. **优势**（为什么推荐这个方案）
6. **风险**（潜在问题或注意事项）

输出格式要求：
- 每个方案之间用分隔线 ===== 分隔
- 不要输出任何非方案内容，只输出方案列表
- 如果偏离度为正（报价偏高），重点给出议价类方案
- 如果偏离度为负（报价偏低），要提示质量/交付风险
"""
    return prompt


def _call_kimi_llm(prompt: str) -> str:
    """调用 Kimi K2.5 API"""
    api_key = os.environ.get("KIMI_API_KEY", "")
    base_url = os.environ.get("KIMI_BASE_URL", "https://ai-gateway.ailab.jiuan.com/v1")
    model = os.environ.get("KIMI_MODEL", "kimi-k2.5")

    if not api_key:
        return ""

    try:
        client_kwargs = {"api_key": api_key, "base_url": base_url}
        try:
            client = OpenAI(**client_kwargs)
        except TypeError:
            client_kwargs["timeout"] = 60.0
            client = OpenAI(**client_kwargs)
        response = client.chat.completions.create(
            model=model,
            messages=[{"role": "user", "content": prompt}],
            temperature=0.3,
            max_tokens=2000,
        )
        return response.choices[0].message.content or ""
    except Exception as e:
        print(f"[LangGraph] Kimi LLM 调用失败: {e}")
        return ""


def _call_kimi_with_tools(
    system_prompt: str,
    messages: List[Dict[str, Any]],
    tools: List[Dict[str, Any]],
) -> Dict[str, Any]:
    """
    调用 Kimi K2.5 API（支持 function calling / tool_calls）
    返回完整的 assistant 消息对象（可能包含 tool_calls）。
    """
    api_key = os.environ.get("KIMI_API_KEY", "")
    base_url = os.environ.get("KIMI_BASE_URL", "https://ai-gateway.ailab.jiuan.com/v1")
    model = os.environ.get("KIMI_MODEL", "kimi-k2.5")

    if not api_key:
        return {"role": "assistant", "content": "KIMI_API_KEY not set", "tool_calls": []}

    try:
        client_kwargs = {"api_key": api_key, "base_url": base_url}
        try:
            client = OpenAI(**client_kwargs)
        except TypeError:
            client_kwargs["timeout"] = 60.0
            client = OpenAI(**client_kwargs)

        full_messages = [{"role": "system", "content": system_prompt}] + list(messages)

        create_kwargs = {
            "model": model,
            "messages": full_messages,
            "tools": tools,
            "tool_choice": "auto",
            "temperature": 0.3,
            "max_tokens": 2048,
        }

        response = client.chat.completions.create(**create_kwargs)
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
        print(f"[LangGraph] Kimi LLM (tools) 调用失败: {e}")
        return {"role": "assistant", "content": f"LLM call failed: {e}", "tool_calls": []}


def _parse_llm_solutions(llm_text: str, quote_data: Dict) -> List[Dict[str, Any]]:
    """解析 LLM 输出，提取方案列表"""
    quote_id = quote_data.get("id", "Q-NEW")

    if llm_text.strip().startswith("["):
        try:
            items = json.loads(llm_text)
            solutions = []
            for idx, item in enumerate(items[:3]):
                sol = {
                    "id": f"SOL-{quote_id}-{'ABC'[idx]}",
                    "title": item.get("title", f"方案{'ABC'[idx]}"),
                    "description": item.get("strategy", item.get("description", "")),
                    "confidence": 0.80,
                    "estimated_savings": item.get("estimated_savings", "待计算"),
                    "action": _infer_action(item.get("title", "")),
                    "generated_by": "kimi_llm",
                }
                solutions.append(sol)
            return solutions
        except Exception:
            pass

    if "=====" in llm_text:
        segments = llm_text.split("=====")
        solutions = []
        for idx, seg in enumerate(segments[:3]):
            seg = seg.strip()
            if not seg:
                continue

            title_match = re.search(r"\*\*(.*?)\*\*|##\s*(.*?)$|^\d+[.、]\s*(.+)$", seg, re.MULTILINE)
            title = title_match.group(1) or title_match.group(2) or title_match.group(3) or f"方案{'ABC'[idx]}"
            title = title.strip()

            strategy_match = re.search(
                r"(?:核心策略|策略|建议)[:：]?\s*(.*?)(?=\n\n|##|\Z)",
                seg, re.DOTALL
            )
            strategy = strategy_match.group(1).strip() if strategy_match else seg[:300]

            savings_match = re.search(
                r"(?:预计|预期|节省|降价)[:：]?\s*(.*?)(?=\n|##|\Z)",
                seg, re.DOTALL
            )
            savings = savings_match.group(1).strip() if savings_match else "待计算"

            sol = {
                "id": f"SOL-{quote_id}-{'ABC'[idx]}",
                "title": title,
                "description": strategy,
                "estimated_savings": savings if len(savings) < 50 else "待计算",
                "confidence": 0.82,
                "action": _infer_action(title),
                "generated_by": "kimi_llm",
                "llm_raw_segment": seg[:500],
            }
            solutions.append(sol)

        return solutions

    return []


def _infer_action(title: str) -> str:
    """从方案标题推断 action"""
    t = title.lower()
    if any(k in t for k in ["议价", "谈判", "降价", "还价"]):
        return "negotiate"
    if any(k in t for k in ["询价", "二次", "多家"]):
        return "requote"
    if any(k in t for k in ["升级", "上报", "审批", "评审"]):
        return "escalate"
    if any(k in t for k in ["确认", "核实", "验证"]):
        return "verify"
    if any(k in t for k in ["通过", "接受", "同意"]):
        return "accept"
    if any(k in t for k in ["对比", "比较", "参考"]):
        return "compare"
    return "negotiate"


# =============================================================================
# 图构建（接收 ToolRegistry）
# =============================================================================

def build_quote_agent_graph(registry: ToolRegistry) -> StateGraph:
    """
    构建报价异常检测 Agent 的 LangGraph StateGraph

    路由策略（偏离度评分后）：
    - score < 20  -> node_auto_approve
    - score >= 20 -> 进入 LLM ReAct 动态路由循环（node_llm_router <-> node_execute_tool）
      - LLM 有 tool_calls -> node_execute_tool -> 回到 node_llm_router
      - LLM 无 tool_calls -> node_wait_human
    """

    def _bind_registry(fn):
        def wrapper(state):
            return fn(state, registry)
        return wrapper

    workflow = StateGraph(AgentState)

    # 基础数据节点
    workflow.add_node("node_build_material", node_build_material)
    workflow.add_node("node_similar_match", _bind_registry(_node_similar_match))
    workflow.add_node("node_price_predict", _bind_registry(_node_price_predict))
    workflow.add_node("node_cost_analyze", _bind_registry(_node_cost_analyze))
    workflow.add_node("node_deviation_score", _bind_registry(_node_deviation_score))

    # 结论节点
    workflow.add_node("node_auto_approve", node_auto_approve)
    workflow.add_node("node_escalate", node_escalate)
    workflow.add_node("node_wait_human", node_wait_human)
    workflow.add_node("node_finalize", node_finalize)

    # LLM ReAct 动态路由循环节点
    workflow.add_node("node_llm_router", _bind_registry(node_llm_router))
    workflow.add_node("node_execute_tool", _bind_registry(node_execute_tool))

    # 边定义
    workflow.add_edge(START, "node_build_material")
    workflow.add_edge("node_build_material", "node_similar_match")
    workflow.add_edge("node_similar_match", "node_price_predict")
    workflow.add_edge("node_price_predict", "node_cost_analyze")
    workflow.add_edge("node_cost_analyze", "node_deviation_score")

    # 条件路由
    workflow.add_conditional_edges(
        "node_deviation_score",
        decide_route,
        path_map={
            "node_auto_approve": "node_auto_approve",
            "node_react_loop": "node_llm_router",
            "node_escalate": "node_escalate",
        },
    )

    # ReAct 循环：router -> execute_tool 循环，直到 LLM 无 tool_calls
    workflow.add_edge("node_llm_router", "node_execute_tool")
    workflow.add_conditional_edges(
        "node_execute_tool",
        should_continue,
        path_map={
            "node_execute_tool": "node_llm_router",
            END: "node_wait_human",
        },
    )

    workflow.add_edge("node_auto_approve", "node_wait_human")
    workflow.add_edge("node_escalate", "node_wait_human")
    workflow.add_edge("node_wait_human", "node_finalize")
    workflow.add_edge("node_finalize", END)

    checkpointer = MemorySaver()
    app = workflow.compile(checkpointer=checkpointer)
    return app
