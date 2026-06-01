"""
FastAPI后端服务主入口
"""

from dotenv import load_dotenv
import os
load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from typing import List, Optional, Dict, Any
from datetime import datetime
import json
import os

from app.skills.agent_core import AgentOrchestrator

# 初始化FastAPI应用
app = FastAPI(
    title="供销计划异常协调Agent API",
    description="九安医疗 BOM 成本核算 AI Agent 后端服务",
    version="1.0.0"
)

# CORS配置
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 数据库初始化
from app.db.database import init_db, get_connection
from app.db.database import (
    get_all_quotes, get_quote_by_id, insert_quote,
    update_quote_decision, append_human_feedback,
    append_override_record, get_quote_stats,
    get_all_materials, get_material_by_id, get_materials_by_category,
    get_all_external_refs, get_external_refs_by_category,
    get_all_benchmarks,
)

init_db()

# 初始化Agent（不再需要传 JSON 路径，Agent 内部从 DB 读取）
agent = AgentOrchestrator()


# ============ Pydantic模型 ============

class QuoteInput(BaseModel):
    material_id: str
    material_name: str
    supplier_quote: float
    supplier_name: str
    quantity: int
    quote_date: str
    category: Optional[str] = "塑料外壳"
    material_type: Optional[str] = "ABS"
    dimensions: Optional[str] = "80×60×15mm"
    processing: Optional[str] = "注塑成型"
    precision: Optional[str] = "±0.1mm"
    description: Optional[str] = ""


class DecisionInput(BaseModel):
    decision: str  # accept, reject, negotiate, escalate
    decision_by: str
    override_price: Optional[float] = None
    override_reason: Optional[str] = None
    selected_solution_id: Optional[str] = None


class FeedbackInput(BaseModel):
    feedback_type: str  # agree, modify, override
    content: str
    reasoning: str = ""
    step_index: int = -1


class RerunInput(BaseModel):
    params: Dict[str, Any]  # 重跑参数


class OverrideInput(BaseModel):
    """Override 操作输入"""
    override_type: str  # "price" | "solution" | "model_param" | "flag"
    override_value: Any = None  # 具体值
    override_reason: str = ""
    step_index: int = -1  # 指向执行轨迹中的步骤索引，-1 表示整体
    modified_params: Optional[Dict[str, Any]] = None  # 修改后的参数（用于触发重跑）


# ============ API端点 ============

@app.get("/")
async def root():
    return {
        "message": "供销计划异常协调Agent API",
        "version": "1.0.0",
        "status": "running"
    }


@app.get("/api/materials")
async def get_materials(
    category: Optional[str] = None,
    limit: int = Query(default=50, le=100)
):
    """获取物料列表"""
    try:
        with get_connection() as conn:
            if category:
                materials = get_materials_by_category(conn, category)
            else:
                materials = get_all_materials(conn)
        return {
            "total": len(materials),
            "materials": materials[:limit]
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/materials/{material_id}")
async def get_material(material_id: str):
    """获取单个物料详情"""
    try:
        with get_connection() as conn:
            material = get_material_by_id(conn, material_id)
        if not material:
            raise HTTPException(status_code=404, detail="物料不存在")
        return material
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/quotes/analyze")
async def analyze_quote(quote_input: QuoteInput):
    """分析报价异常"""
    try:
        import asyncio
        result = await asyncio.wait_for(
            asyncio.to_thread(agent.process_quote, quote_input.dict()),
            timeout=120.0
        )
        # agent.process_quote 内部已持久化到数据库
        return result
    except asyncio.TimeoutError:
        raise HTTPException(status_code=504, detail="分析超时，请稍后重试")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/quotes")
async def get_quotes(
    status: Optional[str] = None,
    severity: Optional[str] = None,
    limit: int = Query(default=20, le=100)
):
    """获取报价异常列表"""
    with get_connection() as conn:
        quotes = get_all_quotes(conn, status=status, severity=severity, limit=limit)
        total = len(get_all_quotes(conn, status=status, severity=severity, limit=1000))

    return {
        "total": total,
        "quotes": quotes
    }


@app.get("/api/quotes/{quote_id}")
async def get_quote(quote_id: str):
    """获取单个报价详情"""
    with get_connection() as conn:
        quote = get_quote_by_id(conn, quote_id)
    if not quote:
        raise HTTPException(status_code=404, detail="报价不存在")
    return quote


@app.post("/api/quotes/{quote_id}/decision")
async def make_decision(quote_id: str, decision_input: DecisionInput):
    """提交人工决策"""
    with get_connection() as conn:
        quote = update_quote_decision(
            conn, quote_id, decision_input.decision,
            decision_input.decision_by,
            decision_input.override_price,
            decision_input.override_reason,
            decision_input.selected_solution_id,
        )
    if not quote:
        raise HTTPException(status_code=404, detail="报价不存在")
    return quote


@app.post("/api/quotes/{quote_id}/feedback")
async def submit_human_feedback(quote_id: str, feedback_input: FeedbackInput):
    """注入人工反馈（用于调试工作台）"""
    with get_connection() as conn:
        quote = append_human_feedback(
            conn, quote_id,
            feedback_type=feedback_input.feedback_type,
            content=feedback_input.content,
            reasoning=feedback_input.reasoning,
            step_index=feedback_input.step_index,
        )
    if not quote:
        raise HTTPException(status_code=404, detail="报价不存在")
    return quote


@app.get("/api/quotes/{quote_id}/trace")
async def get_execution_trace(quote_id: str):
    """获取执行轨迹"""
    with get_connection() as conn:
        quote = get_quote_by_id(conn, quote_id)
    if not quote:
        raise HTTPException(status_code=404, detail="报价不存在")

    trace = quote.get('execution_trace', [])
    return {
        "quote_id": quote_id,
        "execution_trace": trace if trace else [],
        "total_duration_ms": sum(
            step.get('duration_ms', 0)
            for step in (trace if trace else [])
        )
    }


@app.post("/api/quotes/{quote_id}/rerun")
async def rerun_analysis(quote_id: str, rerun_input: RerunInput):
    """重跑分析（带参数调整）"""
    with get_connection() as conn:
        old_quote = get_quote_by_id(conn, quote_id)
    if not old_quote:
        raise HTTPException(status_code=404, detail="报价不存在")

    quote_input = {
        'material_id': old_quote.get('material_id', ''),
        'material_name': old_quote.get('material_name', ''),
        'supplier_quote': rerun_input.params.get('supplier_quote', old_quote.get('supplier_quote', 0)),
        'supplier_name': old_quote.get('supplier_name', ''),
        'quantity': rerun_input.params.get('quantity', old_quote.get('quantity', 0)),
        'quote_date': old_quote.get('quote_date', datetime.now().strftime('%Y-%m-%d')),
        'category': rerun_input.params.get('category', '塑料外壳'),
        'material_type': rerun_input.params.get('material_type', 'ABS'),
        'dimensions': rerun_input.params.get('dimensions', '80×60×15mm'),
        'processing': rerun_input.params.get('processing', '注塑成型'),
        'precision': rerun_input.params.get('precision', '±0.1mm'),
        'description': rerun_input.params.get('description', '')
    }

    import asyncio
    try:
        result = await asyncio.wait_for(
            asyncio.to_thread(agent.process_quote, quote_input),
            timeout=120.0
        )
    except asyncio.TimeoutError:
        raise HTTPException(status_code=504, detail="分析超时，请稍后重试")

    # 标记为重跑结果
    result['id'] = f"{quote_id}-rerun-{datetime.now().strftime('%Y%m%d%H%M%S')}"
    result['original_quote_id'] = quote_id

    with get_connection() as conn:
        insert_quote(conn, result)

    return result


@app.post("/api/quotes/{quote_id}/override")
async def apply_override(quote_id: str, override_input: OverrideInput):
    """
    注入人工 Override（调试工作台核心功能）

    Override 类型：
    - price: 手动指定合理价格，AI 重新评估偏离度
    - solution: 从 AI 未生成的方案中手动补充
    - model_param: 调整打分权重 (α/β/γ)
    - flag: 标记为 AI 误判（用于反馈迭代）

    流程：写入 override 记录 → 触发重跑 → 返回 Diff 结果
    """
    from app.db.database import get_quote_by_id, append_override_record

    with get_connection() as conn:
        quote = get_quote_by_id(conn, quote_id)
    if not quote:
        raise HTTPException(status_code=404, detail="报价不存在")

    override_record = {
        "timestamp": datetime.now().isoformat(),
        "override_type": override_input.override_type,
        "override_value": override_input.override_value,
        "override_reason": override_input.override_reason,
        "step_index": override_input.step_index,
    }

    # 追加 override 记录
    with get_connection() as conn:
        append_override_record(conn, quote_id, override_record)

    # 如果有修改参数，触发重跑
    if override_input.modified_params and override_input.override_type == "price":
        rerun_input = RerunInput(params=override_input.modified_params)
        with get_connection() as conn:
            old_quote = get_quote_by_id(conn, quote_id)
        quote_input = {
            'material_id': old_quote.get('material_id', ''),
            'material_name': old_quote.get('material_name', ''),
            'supplier_quote': override_input.modified_params.get('supplier_quote', old_quote.get('supplier_quote', 0)),
            'supplier_name': old_quote.get('supplier_name', ''),
            'quantity': override_input.modified_params.get('quantity', old_quote.get('quantity', 0)),
            'quote_date': datetime.now().strftime('%Y-%m-%d'),
            'category': override_input.modified_params.get('category', '塑料外壳'),
            'material_type': override_input.modified_params.get('material_type', 'ABS'),
            'dimensions': override_input.modified_params.get('dimensions', ''),
            'processing': override_input.modified_params.get('processing', ''),
            'precision': override_input.modified_params.get('precision', ''),
            'description': override_input.modified_params.get('description', ''),
        }
        import asyncio
        try:
            result = await asyncio.wait_for(
                asyncio.to_thread(agent.process_quote, quote_input),
                timeout=120.0
            )
        except asyncio.TimeoutError:
            raise HTTPException(status_code=504, detail="重跑超时")
        result['id'] = f"{quote_id}-override-{datetime.now().strftime('%Y%m%d%H%M%S')}"
        result['original_quote_id'] = quote_id
        with get_connection() as conn:
            insert_quote(conn, result)
        return {
            "override_record": override_record,
            "original_quote": quote,
            "rerun_quote": result,
            "diff": _compute_diff(quote, result),
        }

    return {
        "override_record": override_record,
        "quote": quote,
    }


def _compute_diff(old: Dict, new: Dict) -> Dict:
    """计算两个报价分析结果的差异"""
    def safe(val):
        if val is None:
            return None
        if isinstance(val, (int, float)):
            return round(float(val), 4)
        return val

    diff = {}
    compare_fields = [
        "deviation_score", "severity_level", "phase",
        "ai_prediction_low", "ai_prediction_mid", "ai_prediction_high",
        "price_deviation", "cost_deviation", "market_deviation",
        "composite_score", "external_deviation",
    ]
    for field in compare_fields:
        old_val = safe(old.get(field))
        new_val = safe(new.get(field))
        if old_val is not None or new_val is not None:
            diff[field] = {"old": old_val, "new": new_val}
            if old_val is not None and new_val is not None:
                diff[field]["change"] = round(new_val - old_val, 4)

    # 比较诊断结论
    if old.get("diagnosis_conclusion") or new.get("diagnosis_conclusion"):
        diff["diagnosis_conclusion"] = {
            "old": old.get("diagnosis_conclusion"),
            "new": new.get("diagnosis_conclusion"),
        }

    # 比较方案
    old_sols = old.get("solutions") or []
    new_sols = new.get("solutions") or []
    if len(old_sols) != len(new_sols) or old_sols != new_sols:
        diff["solutions"] = {
            "old": old_sols,
            "new": new_sols,
        }

    return diff


@app.get("/api/quotes/{quote_id}/compare/{compare_id}")
async def compare_quotes(quote_id: str, compare_id: str):
    """对比两个报价分析结果（用于 Diff View）"""
    with get_connection() as conn:
        original = get_quote_by_id(conn, quote_id)
        compare_with = get_quote_by_id(conn, compare_id)
    if not original:
        raise HTTPException(status_code=404, detail="原始报价不存在")
    if not compare_with:
        raise HTTPException(status_code=404, detail="对比报价不存在")

    return {
        "original": original,
        "compare_with": compare_with,
        "diff": _compute_diff(original, compare_with),
    }


@app.get("/api/quotes/{quote_id}/history")
async def get_quote_history(quote_id: str):
    """获取报价的重跑/Override 历史"""
    import re
    pattern = rf"^{re.escape(quote_id)}(-rerun-|-override-|\-)"
    with get_connection() as conn:
        all_quotes = get_all_quotes(conn, limit=1000)

    related = []
    for q in all_quotes:
        qid = q.get("id", "")
        orig = q.get("original_quote_id", "")
        if orig == quote_id or (qid.startswith(quote_id) and qid != quote_id):
            related.append({
                "id": qid,
                "original_quote_id": orig,
                "deviation_score": q.get("deviation_score"),
                "severity_level": q.get("severity_level"),
                "status": q.get("status"),
                "created_at": q.get("created_at"),
            })

    return {"history": related}


@app.get("/api/external-references")
async def get_external_references(
    category: Optional[str] = None
):
    """获取外部参考数据"""
    try:
        with get_connection() as conn:
            refs = get_external_refs_by_category(conn, category)
        return {
            "total": len(refs),
            "references": refs
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/benchmarks")
async def get_benchmarks():
    """获取行业基准数据"""
    try:
        with get_connection() as conn:
            benchmarks = get_all_benchmarks(conn)
        return benchmarks
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/stats")
async def get_stats():
    """获取统计信息"""
    with get_connection() as conn:
        stats = get_quote_stats(conn)
    return stats


# 健康检查
@app.get("/health")
async def health_check():
    return {"status": "healthy", "timestamp": datetime.now().isoformat()}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
