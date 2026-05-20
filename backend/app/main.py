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

# 数据路径（相对于项目根目录 /Users/jrz/Desktop/SMM_Agent）
_BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))
_PROJECT_ROOT = os.path.join(_BACKEND_DIR, "..", "..")
DATA_DIR = os.path.join(_PROJECT_ROOT, "data", "raw")
MATERIALS_PATH = os.path.join(DATA_DIR, "materials.json")
QUOTES_PATH = os.path.join(DATA_DIR, "quotes.json")
EXTERNAL_REFS_PATH = os.path.join(DATA_DIR, "external_references.json")

# 初始化Agent
agent = AgentOrchestrator(MATERIALS_PATH, EXTERNAL_REFS_PATH)

# 内存存储（演示用）
quotes_db = {}
execution_traces_db = {}

# 加载已有报价数据
def load_quotes():
    try:
        with open(QUOTES_PATH, 'r', encoding='utf-8') as f:
            data = json.load(f)
            for quote in data.get('quotes', []):
                quotes_db[quote['id']] = quote
    except:
        pass

load_quotes()


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
        with open(MATERIALS_PATH, 'r', encoding='utf-8') as f:
            data = json.load(f)
            materials = data.get('materials', [])

        if category:
            materials = [m for m in materials if m['category'] == category]

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
        with open(MATERIALS_PATH, 'r', encoding='utf-8') as f:
            data = json.load(f)
            materials = data.get('materials', [])

        for m in materials:
            if m['id'] == material_id:
                return m

        raise HTTPException(status_code=404, detail="物料不存在")
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

        quotes_db[result['id']] = result
        execution_traces_db[result['id']] = result['execution_trace']

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
    quotes = list(quotes_db.values())

    if status:
        quotes = [q for q in quotes if q.get('status') == status]
    if severity:
        quotes = [q for q in quotes if q.get('severity_level') == severity]

    # 按时间倒序
    quotes.sort(key=lambda x: x.get('created_at', ''), reverse=True)

    return {
        "total": len(quotes),
        "quotes": quotes[:limit]
    }


@app.get("/api/quotes/{quote_id}")
async def get_quote(quote_id: str):
    """获取单个报价详情"""
    if quote_id not in quotes_db:
        raise HTTPException(status_code=404, detail="报价不存在")
    return quotes_db[quote_id]


@app.post("/api/quotes/{quote_id}/decision")
async def make_decision(quote_id: str, decision_input: DecisionInput):
    """提交人工决策"""
    if quote_id not in quotes_db:
        raise HTTPException(status_code=404, detail="报价不存在")

    quote = quotes_db[quote_id]

    # 标准化决策值
    decision_map = {
        'accept': 'approved',
        'reject': 'rejected',
        'negotiate': 'negotiate'
    }
    normalized_decision = decision_map.get(decision_input.decision, decision_input.decision)

    quote['status'] = normalized_decision
    quote['human_decision'] = decision_input.decision
    quote['decision_by'] = decision_input.decision_by
    quote['decision_at'] = datetime.now().isoformat()

    if decision_input.override_price:
        quote['override_price'] = decision_input.override_price
    if decision_input.override_reason:
        quote['override_reason'] = decision_input.override_reason
    if decision_input.selected_solution_id:
        quote['selected_solution_id'] = decision_input.selected_solution_id

    return quote


@app.get("/api/quotes/{quote_id}/trace")
async def get_execution_trace(quote_id: str):
    """获取执行轨迹"""
    if quote_id not in quotes_db:
        raise HTTPException(status_code=404, detail="报价不存在")

    quote = quotes_db[quote_id]
    return {
        "quote_id": quote_id,
        "execution_trace": quote.get('execution_trace', []),
        "total_duration_ms": sum(
            step.get('duration_ms', 0)
            for step in quote.get('execution_trace', [])
        )
    }


@app.post("/api/quotes/{quote_id}/rerun")
async def rerun_analysis(quote_id: str, rerun_input: RerunInput):
    """重跑分析（带参数调整）"""
    if quote_id not in quotes_db:
        raise HTTPException(status_code=404, detail="报价不存在")

    old_quote = quotes_db[quote_id]

    quote_input = {
        'material_id': old_quote['material_id'],
        'material_name': old_quote['material_name'],
        'supplier_quote': rerun_input.params.get('supplier_quote', old_quote['supplier_quote']),
        'supplier_name': old_quote['supplier_name'],
        'quantity': rerun_input.params.get('quantity', old_quote['quantity']),
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

    result['id'] = f"{quote_id}-rerun-{datetime.now().strftime('%Y%m%d%H%M%S')}"
    result['original_quote_id'] = quote_id
    result['rerun_params'] = rerun_input.params

    quotes_db[result['id']] = result

    return result


@app.get("/api/external-references")
async def get_external_references(
    category: Optional[str] = None
):
    """获取外部参考数据"""
    try:
        with open(EXTERNAL_REFS_PATH, 'r', encoding='utf-8') as f:
            data = json.load(f)
            refs = data.get('external_references', [])

        if category:
            refs = [r for r in refs if r['material_category'] == category]

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
        with open(EXTERNAL_REFS_PATH, 'r', encoding='utf-8') as f:
            data = json.load(f)
            return data.get('industry_benchmarks', {})
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/stats")
async def get_stats():
    """获取统计信息"""
    quotes = list(quotes_db.values())

    severity_counts = {}
    status_counts = {}
    total_potential_savings = 0

    for q in quotes:
        severity = q.get('severity_level', '未知')
        severity_counts[severity] = severity_counts.get(severity, 0) + 1

        status = q.get('status', 'pending')
        status_counts[status] = status_counts.get(status, 0) + 1

        # 计算潜在节省
        for sol in q.get('solutions', []):
            savings_str = sol.get('estimated_savings', '¥0')
            if savings_str.startswith('¥') and '待' not in savings_str:
                try:
                    savings = float(savings_str.replace('¥', '').replace(',', ''))
                    total_potential_savings += savings
                except:
                    pass

    return {
        "total_quotes": len(quotes),
        "severity_distribution": severity_counts,
        "status_distribution": status_counts,
        "total_potential_savings": round(total_potential_savings, 2),
        "avg_deviation_score": round(
            sum(q.get('deviation_score', 0) for q in quotes) / len(quotes), 2
        ) if quotes else 0
    }


# 健康检查
@app.get("/health")
async def health_check():
    return {"status": "healthy", "timestamp": datetime.now().isoformat()}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
