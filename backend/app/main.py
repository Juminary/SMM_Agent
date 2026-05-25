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
    update_quote_decision, get_quote_stats,
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


class RerunInput(BaseModel):
    params: Dict[str, Any]  # 重跑参数


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
