"""
LangGraph Agent 核心模块 - 纯 ReAct 架构
基于 LangGraph 的有状态 Agent，LLM 从报价进入起完全自主决策工具调用顺序。

不再有固定编排节点（前4个固定调用），改为：
  START → node_build_material → node_llm_router ↔ node_execute_tool → node_wait_human → END

LLM 通过 function calling 自主决定：
  1. 调用 tool_predict_price_range  + tool_analyze_cost_structure（可并行）
  2. 调用 tool_score_deviation（等前两步完成后）
  3. 调用 tool_match_similar_material（辅助参考，可选）
  4. 调用 tool_generate_solutions（等偏离度完成后）
  5. 无 tool_calls → 给出最终结论

工具依赖关系在 system prompt 中说明，LLM 自行遵守。
"""

import os
import time
import json
import re
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
    quote_data: Dict[str, Any]
    material: Dict[str, Any]
    similar_materials: List[Dict[str, Any]]
    prediction: Optional[Dict[str, Any]]
    cost_analysis: Optional[Dict[str, Any]]
    deviation: Optional[Dict[str, Any]]
    composite_score: Optional[float]
    external_deviation: Optional[float]
    rag_info: Optional[Dict[str, Any]]
    solutions: List[Dict[str, Any]]
    execution_trace: List[Dict[str, Any]]
    interrupt_reason: Optional[str]
    human_feedback: Optional[Dict[str, Any]]
    llm_solution_text: Optional[str]
    # ReAct 专用
    messages: List[Dict[str, Any]]
    final_answer: Optional[str]
    # 记录 LLM 已调用过哪些工具（防止重复调用同一工具）
    tools_called: List[str]


# =============================================================================
# 辅助：执行轨迹记录
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
# 节点函数
# =============================================================================

def node_build_material(state: AgentState) -> AgentState:
    """构造物料对象（唯一的前置准备节点）"""
    t0 = time.perf_counter()
    qd = state["quote_data"]
    material = {
        "id": qd.get("material_id") or qd.get("id") or f"MAT-{datetime.now().strftime('%Y%m%d%H%M%S')}",
        "name": qd.get("material_name") or qd.get("name") or "未知物料",
        "category": qd.get("category", "塑料外壳"),
        "material_type": qd.get("material_type", "ABS"),
        "dimensions": qd.get("dimensions", "80x60x15mm"),
        "processing": qd.get("processing", "注塑成型"),
        "precision": qd.get("precision", "±0.1mm"),
        "supplier_id": "TEMP",
        "supplier_name": qd.get("supplier_name") or "未知供应商",
        "unit_price": qd.get("supplier_quote") or 0.0,
        "order_quantity": qd.get("quantity", 10000),
        "order_date": qd.get("quote_date", datetime.now().strftime("%Y-%m-%d")),
        "description": qd.get("description", ""),
    }
    state["material"] = material
    state["similar_materials"] = []
    state["prediction"] = None
    state["cost_analysis"] = None
    state["deviation"] = None
    state["solutions"] = []
    state["tools_called"] = []
    _append_trace(
        state, "物料构造", "completed",
        f"物料ID={material['id']}, category={material['category']}",
        (time.perf_counter() - t0) * 1000
    )
    return state


def node_llm_router(state: AgentState, registry: ToolRegistry) -> AgentState:
    """
    LLM ReAct 决策节点。
    LLM 根据当前 state 中的上下文（已有哪些结果），自主决定：
      - 调用下一个工具（返回 tool_calls）
      - 或直接给出最终结论（无 tool_calls，结束 ReAct 循环）
    """
    t0 = time.perf_counter()
    tools = [t.get_openai_function() for t in registry._tools.values()]
    messages = list(state.get("messages", []))

    system_prompt = _build_react_system_prompt(state)
    response = _call_kimi_with_tools(system_prompt, messages, tools)

    messages.append(response)
    state["messages"] = messages

    # 记录本次 LLM 选择调用的工具
    if response.get("tool_calls"):
        state["final_answer"] = None
        called_names = [tc["function"]["name"] for tc in response["tool_calls"]]
        called_set = set(state.get("tools_called", []))
        for name in called_names:
            called_set.add(name)
        state["tools_called"] = list(called_set)

        _append_trace(
            state, "LLM路由(Kimi+tools)", "tool_call",
            f"LLM 选择调用 {len(response['tool_calls'])} 个工具: " + ", ".join(called_names),
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
    工具执行节点。
    执行 LLM 选择的 tool_calls，将结果：
      1. 以 tool role 消息追加到 messages（供 LLM 读取）
      2. 回填到 state 字段（供后续工具使用）
    """
    t0 = time.perf_counter()
    messages = list(state.get("messages", []))
    last_msg = messages[-1] if messages else {}
    tool_calls = last_msg.get("tool_calls", [])

    if not tool_calls:
        return state

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
            state["composite_score"] = result_data.get("composite_score")
            state["external_deviation"] = result_data.get("external_deviation")
            state["rag_info"] = result_data.get("rag")
            _append_trace(state, f"工具执行:{tool_name}", "completed",
                f"偏离度={result_data.get('deviation_score', 0)}分 ({result_data.get('severity_level', '')})",
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


# =============================================================================
# 条件边
# =============================================================================

def should_continue(state: AgentState) -> Literal["node_llm_router", "node_final_decision"]:
    """判断 ReAct 循环是否继续 — 只看最新一条 assistant 消息是否有 tool_calls"""
    messages = state.get("messages", [])
    for msg in reversed(messages):
        if msg.get("role") == "assistant":
            if msg.get("tool_calls"):
                return "node_llm_router"
            return "node_final_decision"
    return "node_final_decision"


def node_final_decision(state: AgentState, registry: ToolRegistry) -> AgentState:
    """
    最终决策节点 — 判断偏离度，决定后续流程。
    作为普通节点（返回 AgentState），内部根据偏离度生成方案/设置中断原因。

    兜底机制：如果 LLM 没有调用关键工具（prediction / cost_analysis），
    则在此节点直接同步调用，确保流程不会因 LLM 跳过而中断。
    """
    qd = state.get("quote_data") or {}
    mat = state.get("material") or {}

    # ---- 兜底：如果 LLM 没有调用核心工具，直接补调用 ----
    if state.get("prediction") is None:
        tool = registry.get("tool_predict_price_range")
        out = tool.execute(
            material_id=mat.get("id", ""),
            quantity=qd.get("quantity", 10000),
            category=mat.get("category"),
            processing=mat.get("processing"),
            unit_price=qd.get("supplier_quote"),
        )
        state["prediction"] = out.get("result") or {}
        _append_trace(state, f"[兜底]tool_predict_price_range", "completed",
            f"P10=¥{out.get('result',{}).get('p10')} / P50=¥{out.get('result',{}).get('p50')} / P90=¥{out.get('result',{}).get('p90')}",
            0, tool_name="tool_predict_price_range",
            tool_confidence=out.get("confidence"), tool_reasoning=out.get("reasoning"))

    if state.get("cost_analysis") is None:
        tool = registry.get("tool_analyze_cost_structure")
        out = tool.execute(
            material_id=mat.get("id", ""),
            supplier_quote=qd.get("supplier_quote", 0),
            category=mat.get("category"),
            processing=mat.get("processing"),
        )
        state["cost_analysis"] = out.get("result") or {}
        _append_trace(state, f"[兜底]tool_analyze_cost_structure", "completed",
            f"成本偏离={out.get('result',{}).get('cost_deviation_score',0)}",
            0, tool_name="tool_analyze_cost_structure",
            tool_confidence=out.get("confidence"), tool_reasoning=out.get("reasoning"))

    if state.get("deviation") is None and state.get("prediction") and state.get("cost_analysis"):
        tool = registry.get("tool_score_deviation")
        out = tool.execute(
            material_id=mat.get("id", ""),
            supplier_quote=qd.get("supplier_quote", 0),
            prediction=state["prediction"],
            cost_analysis=state["cost_analysis"],
        )
        state["deviation"] = out.get("result") or {}
        _append_trace(state, f"[兜底]tool_score_deviation", "completed",
            f"偏离度={out.get('result',{}).get('deviation_score',0)}",
            0, tool_name="tool_score_deviation",
            tool_confidence=out.get("confidence"), tool_reasoning=out.get("reasoning"))

    # ---- 兜底：生成方案 ----
    if not state.get("solutions") and state.get("deviation"):
        dev = state.get("deviation")
        sims = state.get("similar_materials") or []
        tool = registry.get("tool_generate_solutions")
        out = tool.execute(
            quote_id=qd.get("id", "Q-NEW"),
            supplier_quote=qd.get("supplier_quote", 0),
            deviation_score=dev.get("deviation_score", 0),
            severity_level=dev.get("severity_level", "正常"),
            deviation_details=dev,
            similar_materials=sims,
        )
        state["solutions"] = out.get("result") or []
        _append_trace(state, "[兜底]tool_generate_solutions", "completed",
            f"生成 {len(state['solutions'])} 个方案",
            0, tool_name="tool_generate_solutions",
            tool_confidence=out.get("confidence"), tool_reasoning=out.get("reasoning"))

    # ---- 根据偏离度决定后续流程 ----
    dev = state.get("deviation") or {}
    score = dev.get("deviation_score", 0)
    pred = state.get("prediction") or {}

    if score < 20:
        solutions = [{
            "id": f"SOL-{qd.get('id', 'Q-NEW')}-A",
            "title": "直接通过",
            "description": (
                f"报价¥{qd.get('supplier_quote', 0)}在AI预测区间内，偏离度仅{score}分，"
                f"建议直接通过。"
            ),
            "confidence": round(0.92 + 0.05 * min(pred.get("confidence", 0.7) / 0.9, 1), 2),
            "estimated_savings": "¥0",
            "action": "accept",
            "generated_by": "rule",
        }]
        state["solutions"] = list(solutions)
        state["interrupt_reason"] = f"偏离度 {score} 分（正常），建议直接通过。"
        _append_trace(state, "方案生成(自动通过)", "completed", "1个方案: 直接通过", 0)
    else:
        sols = state.get("solutions") or []
        state["interrupt_reason"] = (
            f"偏离度 {score} 分（{dev.get('severity_level', '')}），"
            f"已生成 {len(sols)} 个应对方案，请人工审批。"
        )

    return state


def node_wait_human(state: AgentState) -> AgentState:
    """人工确认节点 — LangGraph interrupt 暂停，等待 resume"""
    reason = state.get("interrupt_reason", "需人工确认后方可继续。")
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
    fb = state.get("human_feedback")
    if fb:
        for sol in state.get("solutions", []):
            sol["human_decision"] = fb.get("decision")
            sol["human_comment"] = fb.get("comment", "")

    _append_trace(
        state, "流程结束", "completed",
        f"最终确认方案数={len(state.get('solutions', []))}",
        0
    )
    return state


# =============================================================================
# System Prompt（工具依赖关系在此说明）
# =============================================================================

def _build_react_system_prompt(state: AgentState) -> str:
    """根据当前 state 动态构建 ReAct system prompt"""
    qd = state.get("quote_data", {})
    pred = state.get("prediction")
    cost = state.get("cost_analysis")
    dev = state.get("deviation")
    rag_info = state.get("rag_info") or (dev.get("rag") if dev else None) or {}
    sims = state.get("similar_materials", [])

    # 当前已获取的结果摘要
    pred_text = (
        f"P10=¥{pred['p10']} / P50=¥{pred['p50']} / P90=¥{pred['p90']}"
        if pred else "尚未获取"
    )
    cost_items = cost.get("cost_items", []) if cost else []
    cost_text = "\n".join(
        f"  - {c['item']}: 供应商占比{c['supplier_pct']}% vs 基准{c['benchmark_pct']}% ({c['status']})"
        for c in cost_items
    ) if cost_items else "尚未获取"
    dev_text = (
        f"第一层偏离度={dev['deviation_score']}分（{dev['severity_level']}），"
        f"第二层综合打分={dev['composite_score']}，"
        f"外部偏离分={dev['external_deviation']}%"
        if dev else "尚未计算"
    )
    rag_text = (
        f"  - 外部参考: ¥{rag_info.get('ref_low', 0):.2f}~¥{rag_info.get('ref_high', 0):.2f}（{rag_info.get('source', '')}）"
        if rag_info.get("available") else "  （无外部数据）"
    )
    sims_text = "\n".join(
        f"  - {s['name']} | ¥{s['price']} | 相似度{s['similarity']}"
        for s in sims[:3]
    ) if sims else "尚未检索"

    already_called = state.get("tools_called", [])

    return f"""你是九安医疗的采购策略专家，专注于BOM成本分析和供应商报价评审。

## 你的能力（Tools）
你可以调用以下工具来完成报价分析：

1. **tool_predict_price_range** - 预测价格 P10/P50/P90 三分位区间
   - 依赖：无（直接调用）
   - 参数：material_id, quantity

2. **tool_analyze_cost_structure** - 拆解供应商报价为5个成本项
   - 依赖：无（直接调用）
   - 参数：material_id, supplier_quote, category, processing

3. **tool_score_deviation** - 综合评分（两层打分）
   - 依赖：必须等 tool_predict_price_range 和 tool_analyze_cost_structure 都完成后才能调用
   - 参数：material_id, supplier_quote, prediction, cost_analysis
   - 注：prediction 是 tool_predict_price_range 返回的 result 对象；cost_analysis 是 tool_analyze_cost_structure 返回的 result 对象

4. **tool_match_similar_material** - 检索历史相似物料（辅助参考）
   - 依赖：无（随时可调用）
   - 参数：material_id, top_k

5. **tool_generate_solutions** - 根据偏离度生成应对方案
   - 依赖：必须等 tool_score_deviation 完成后才能调用
   - 参数：quote_id, supplier_quote, deviation_score, severity_level, deviation_details, similar_materials

## 重要规则
- tool_score_deviation 必须同时提供 prediction 和 cost_analysis 才能正确执行
- tool_generate_solutions 必须同时提供 deviation_score、severity_level 和 deviation_details
- 工具执行结果会返回到"下一轮对话"中，请读取后再决定下一步
- 当你已经收集到足够信息并给出最终结论后，ReAct 循环将结束

## 当前报价信息
- 物料：{qd.get('material_name', '')} / {qd.get('category', '')}
- 供应商：{qd.get('supplier_name', '')}
- 报价：¥{qd.get('supplier_quote', '')}
- 数量：{qd.get('quantity', 0):,}件
- 工艺：{qd.get('processing', '')}
- 尺寸：{qd.get('dimensions', '')}

## 当前已获取的结果
- 价格预测：{pred_text}
- 成本拆解：{cost_text}
- 偏离度评分：{dev_text}
- RAG外部数据：{rag_text}
- 相似物料：{sims_text}

## 已调用过的工具
{', '.join(already_called) if already_called else '（无）'}

## 你的任务
1. 首先调用 tool_predict_price_range 和 tool_analyze_cost_structure 获取基础分析结果
2. 然后调用 tool_score_deviation 计算偏离度（需要等待前两步完成）
3. 可选：调用 tool_match_similar_material 获取历史参考
4. 根据偏离度结果，调用 tool_generate_solutions 生成应对方案
5. 最后给出最终分析结论（偏离度评分、严重级别、核心问题、可执行建议）

请开始分析。"""


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
        return {"role": "assistant", "content": "KIMI_API_KEY not set", "tool_calls": []}

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
        print(f"[LangGraph] Kimi LLM (tools) 调用失败: {e}")
        return {"role": "assistant", "content": f"LLM call failed: {e}", "tool_calls": []}


# =============================================================================
# 图构建
# =============================================================================

def build_quote_agent_graph(registry: ToolRegistry) -> StateGraph:
    """
    纯 ReAct 架构图：

    START → node_build_material → node_llm_router
                                          ↓（有tool_calls）
                                   node_execute_tool
                                          ↓
                                   node_decide_next
                                          ↓（无tool_calls）
                                    node_wait_human → node_finalize → END
    """

    def _bind_registry(fn):
        def wrapper(state):
            return fn(state, registry)
        return wrapper

    workflow = StateGraph(AgentState)

    workflow.add_node("node_build_material", node_build_material)
    workflow.add_node("node_llm_router", _bind_registry(node_llm_router))
    workflow.add_node("node_execute_tool", _bind_registry(node_execute_tool))
    workflow.add_node("node_final_decision", _bind_registry(node_final_decision))
    workflow.add_node("node_wait_human", node_wait_human)
    workflow.add_node("node_finalize", node_finalize)

    workflow.add_edge(START, "node_build_material")
    workflow.add_edge("node_build_material", "node_llm_router")

    workflow.add_edge("node_llm_router", "node_execute_tool")

    workflow.add_conditional_edges(
        "node_execute_tool",
        should_continue,
        path_map={
            "node_llm_router": "node_llm_router",
            "node_final_decision": "node_final_decision",
        },
    )

    workflow.add_edge("node_final_decision", "node_wait_human")
    workflow.add_edge("node_wait_human", "node_finalize")
    workflow.add_edge("node_finalize", END)

    checkpointer = MemorySaver()
    app = workflow.compile(checkpointer=checkpointer)
    return app
