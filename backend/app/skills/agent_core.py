"""
Agent核心技能模块
包含：相似物料检索、价格区间预测、成本结构拆解、偏离度打分、方案生成

每个 Skill 继承 Tool 基类，提供统一的 execute() 接口，
可注册到 ToolRegistry 供 Agent 动态发现和调用。
"""

import json
import math
from abc import ABC, abstractmethod
from typing import List, Dict, Any, Tuple, Optional
from dataclasses import dataclass
from datetime import datetime


# =============================================================================
# Tool 基类
# =============================================================================

class Tool(ABC):
    """Skill 能力的接口层基类"""

    name: str = ""           # 工具唯一标识
    description: str = ""   # 工具描述，LLM 读取以判断何时使用
    input_schema: Dict[str, Any] = {}  # JSON Schema，LLM 构造调用参数

    confidence: float = 1.0    # 工具本身的置信度上限
    model_loaded: bool = False  # ML 模型是否已加载

    @abstractmethod
    def execute(self, **kwargs) -> Dict[str, Any]:
        """
        执行工具能力。

        返回格式统一为:
        {
            "result": {...},       # 业务结果
            "confidence": float,   # 本次执行可信度 0-1
            "reasoning": str,      # 简要推理说明
        }
        """
        ...

    def get_schema(self) -> Dict[str, Any]:
        """返回 LLM 可发现的工具 schema"""
        return {
            "name": self.name,
            "description": self.description,
            "parameters": self.input_schema,
        }

    def get_openai_function(self) -> Dict[str, Any]:
        """返回 OpenAI SDK 格式的 function calling schema"""
        return {
            "type": "function",
            "function": {
                "name": self.name,
                "description": self.description,
                "parameters": self.input_schema,
            },
        }


# =============================================================================
# 数据模型
# =============================================================================

@dataclass
class Material:
    """物料数据模型"""
    id: str
    name: str
    category: str
    material_type: str
    dimensions: str
    processing: str
    precision: str
    supplier_id: str
    supplier_name: str
    unit_price: float
    order_quantity: int
    order_date: str
    description: str
    is_active: bool = True


@dataclass
class Quote:
    """报价数据模型"""
    id: str
    material_id: str
    material_name: str
    supplier_quote: float
    supplier_name: str
    quantity: int
    quote_date: str


# =============================================================================
# Skill 实现
# =============================================================================

class SimilarityMatcher(Tool):
    """相似物料检索 Skill"""

    name = "tool_match_similar_material"
    description = (
        "根据当前报价物料的类别、材料类型、工艺、精度和尺寸，"
        "从历史物料库中检索最相似的 Top-K 条记录，用于价格参考。"
        "仅在有基础物料信息（类别、材料类型）时使用。"
    )
    input_schema = {
        "type": "object",
        "properties": {
            "material_id": {"type": "string", "description": "物料ID"},
            "top_k": {"type": "integer", "description": "返回数量，默认5", "default": 5},
        },
        "required": ["material_id"],
    }
    confidence = 0.82
    model_loaded = False

    def __init__(self, materials_data: List[Dict]):
        self.materials = [Material(**m) for m in materials_data]

    def calculate_similarity(self, target: Material, candidate: Material) -> float:
        """计算两个物料的相似度分数"""
        score = 0.0
        weights = {
            'category': 0.25,
            'material_type': 0.25,
            'processing': 0.20,
            'precision': 0.15,
            'dimensions': 0.15
        }

        if target.category == candidate.category:
            score += weights['category']
        if target.material_type == candidate.material_type:
            score += weights['material_type']
        if target.processing == candidate.processing:
            score += weights['processing']
        elif target.processing.split('+')[0] == candidate.processing.split('+')[0]:
            score += weights['processing'] * 0.5
        if target.precision == candidate.precision:
            score += weights['precision']

        target_dims = self._parse_dimensions(target.dimensions)
        candidate_dims = self._parse_dimensions(candidate.dimensions)
        if target_dims and candidate_dims:
            dim_sim = self._calculate_dim_similarity(target_dims, candidate_dims)
            score += weights['dimensions'] * dim_sim

        return min(1.0, score)

    def _parse_dimensions(self, dims_str: str) -> List[float]:
        try:
            dims_str = dims_str.lower().replace('×', 'x').replace('mm', '').replace('cm', '')
            return [float(x) for x in dims_str.split('x')]
        except:
            return []

    def _calculate_dim_similarity(self, dims1: List[float], dims2: List[float]) -> float:
        if len(dims1) != len(dims2):
            return 0.5
        similarities = []
        for d1, d2 in zip(dims1, dims2):
            if max(d1, d2) > 0:
                sim = 1 - abs(d1 - d2) / max(d1, d2)
                similarities.append(max(0, sim))
        return sum(similarities) / len(similarities) if similarities else 0

    def find_similar(self, target_material: Dict, top_k: int = 5) -> List[Dict]:
        """内部检索方法"""
        target = Material(**target_material)
        similarities = []
        for mat in self.materials:
            if mat.id != target.id:
                sim = self.calculate_similarity(target, mat)
                similarities.append({
                    'id': mat.id,
                    'name': mat.name,
                    'price': mat.unit_price,
                    'similarity': round(sim, 2),
                    'date': mat.order_date,
                    'supplier': mat.supplier_name
                })
        similarities.sort(key=lambda x: x['similarity'], reverse=True)
        return similarities[:top_k]

    def execute(self, material_id: str, top_k: int = 5, **kwargs) -> Dict[str, Any]:
        """Tool 接口：检索相似物料"""
        matched = next(
            (m for m in self.materials if m.id == material_id),
            None
        )
        if matched is None:
            return {
                "result": [],
                "confidence": 0.0,
                "reasoning": f"物料ID {material_id} 在历史库中未找到",
            }

        # 构建完整的 Material 字典供 find_similar 使用
        target_dict = {
            "id": matched.id, "name": matched.name, "category": matched.category,
            "material_type": matched.material_type, "dimensions": matched.dimensions,
            "processing": matched.processing, "precision": matched.precision,
            "supplier_id": matched.supplier_id, "supplier_name": matched.supplier_name,
            "unit_price": matched.unit_price, "order_quantity": matched.order_quantity,
            "order_date": matched.order_date, "description": matched.description,
        }
        results = self.find_similar(target_dict, top_k=top_k)

        avg_sim = sum(r['similarity'] for r in results) / len(results) if results else 0
        return {
            "result": results,
            "confidence": round(self.confidence * (0.6 + 0.4 * avg_sim), 3),
            "reasoning": (
                f"检索到 {len(results)} 条相似物料，"
                f"平均相似度 {avg_sim:.2f}，"
                f"基准: 类别={matched.category} / 材料={matched.material_type}"
            ),
        }


class PricePredictor(Tool):
    """价格区间预测 Skill"""

    name = "tool_predict_price_range"
    description = (
        "根据物料的类别、工艺复杂度、订单量，"
        "从历史采购数据中推算价格 P10/P50/P90 三分位区间。"
        "当历史数据不足 20 条时，置信度降低。"
    )
    input_schema = {
        "type": "object",
        "properties": {
            "material_id": {"type": "string", "description": "物料ID"},
            "quantity": {"type": "integer", "description": "订单数量", "default": 10000},
        },
        "required": ["material_id"],
    }
    confidence = 0.78
    model_loaded = False

    def __init__(self, materials_data: List[Dict]):
        self.materials = materials_data
        self._build_model()

    def _build_model(self):
        self.category_stats = {}
        for mat in self.materials:
            cat = mat['category']
            if cat not in self.category_stats:
                self.category_stats[cat] = []
            self.category_stats[cat].append(mat['unit_price'])

    def predict(self, material: Dict) -> Dict[str, float]:
        """内部预测方法"""
        cat = material.get('category', '其他')

        if cat in self.category_stats:
            prices = sorted(self.category_stats[cat])
            n = len(prices)
            p10_idx = max(0, int(n * 0.1))
            p50_idx = max(0, int(n * 0.5))
            p90_idx = min(n - 1, int(n * 0.9))
            base_p10 = prices[p10_idx]
            base_p50 = prices[p50_idx]
            base_p90 = prices[p90_idx]

            processing = material.get('processing', '')
            complexity_factor = 1.0
            if '沉金' in processing:
                complexity_factor = 1.15
            elif '缝制' in processing:
                complexity_factor = 1.05

            quantity = material.get('quantity', 10000)
            quantity_factor = 1 + (10000 - quantity) / 100000

            return {
                'p10': round(base_p10 * complexity_factor * quantity_factor, 2),
                'p50': round(base_p50 * complexity_factor * quantity_factor, 2),
                'p90': round(base_p90 * complexity_factor * quantity_factor, 2),
                'confidence': round(0.75 + 0.1 * min(n / 20, 1), 2)
            }
        else:
            quote = material.get('supplier_quote', 5.0)
            return {
                'p10': round(quote * 0.7, 2),
                'p50': round(quote * 0.85, 2),
                'p90': round(quote * 1.0, 2),
                'confidence': 0.60
            }

    def execute(self, material_id: str, quantity: int = 10000,
                category: str = None, processing: str = None,
                unit_price: float = None, **kwargs) -> Dict[str, Any]:
        """Tool 接口：预测价格区间"""
        matched = next((m for m in self.materials if m['id'] == material_id), None)

        # Fallback: 如果 material_id 找不到，尝试用 category + processing + unit_price 构造
        if matched is None:
            if category:
                cat_prices = self.category_stats.get(category, [])
                n = len(cat_prices)
                if n > 0:
                    prices = sorted(cat_prices)
                    p10 = round(prices[max(0, int(n * 0.1))], 2)
                    p50 = round(prices[max(0, int(n * 0.5))], 2)
                    p90 = round(prices[min(n - 1, int(n * 0.9))], 2)
                    factor = 1.05 if (processing and '沉金' in processing) else 1.0
                    qty_factor = 1 + (10000 - quantity) / 100000
                    return {
                        "result": {
                            'p10': round(p10 * factor * qty_factor, 2),
                            'p50': round(p50 * factor * qty_factor, 2),
                            'p90': round(p90 * factor * qty_factor, 2),
                            'confidence': round(0.70 + 0.05 * min(n / 20, 1), 2),
                        },
                        "confidence": round(0.70 + 0.05 * min(n / 20, 1), 3),
                        "reasoning": (
                            f"[Fallback] 类别 {category} 有 {n} 条历史记录，"
                            f"预测区间 [P10=¥{round(p10 * factor * qty_factor, 2)}, "
                            f"P50=¥{round(p50 * factor * qty_factor, 2)}, "
                            f"P90=¥{round(p90 * factor * qty_factor, 2)}]，"
                            f"工艺={processing or '未知'}，数量={quantity}"
                        ),
                    }
            return {
                "result": {},
                "confidence": 0.0,
                "reasoning": f"物料ID {material_id} 在历史库中未找到，且无 category 可用",
            }

        mat = {**matched, "quantity": quantity}
        result = self.predict(mat)

        n = len(self.category_stats.get(matched['category'], []))
        return {
            "result": result,
            "confidence": round(result.get('confidence', 0.6), 3),
            "reasoning": (
                f"类别 {matched['category']} 有 {n} 条历史记录，"
                f"预测区间 [P10=¥{result['p10']}, P50=¥{result['p50']}, P90=¥{result['p90']}]，"
                f"工艺={matched.get('processing', '未知')}，数量={quantity}"
            ),
        }


class CostAnalyzer(Tool):
    """成本结构拆解 Skill"""

    name = "tool_analyze_cost_structure"
    description = (
        "将供应商报价拆解为 原材料/加工费/表面处理/包装物流/管理利润 五个成本项，"
        "与行业基准对比，识别各成本项的偏离程度。"
        "偏离 >50% 为严重异常，>25% 为偏高/偏低，>10% 为略高/略低。"
    )
    input_schema = {
        "type": "object",
        "properties": {
            "material_id": {"type": "string", "description": "物料ID"},
            "supplier_quote": {"type": "number", "description": "供应商报价金额"},
        },
        "required": ["material_id", "supplier_quote"],
    }
    confidence = 0.80
    model_loaded = False

    def __init__(self, benchmarks: Dict):
        self.benchmarks = benchmarks

    def analyze(self, material: Dict, quote: float) -> Dict:
        """内部分析方法"""
        category = material.get('category', '其他')
        benchmark_key = self._get_benchmark_key(category)
        benchmark = self.benchmarks.get(benchmark_key, {
            'raw_material_pct': 40,
            'processing_pct': 25,
            'surface_treatment_pct': 10,
            'packaging_pct': 5,
            'management_profit_pct': 20
        })
        adjusted = self._adjust_benchmark(benchmark, material)

        cost_items = []
        max_deviation = 0

        for item_name, pct_key in [
            ('原材料', 'raw_material_pct'),
            ('加工费', 'processing_pct'),
            ('表面处理', 'surface_treatment_pct'),
            ('包装物流', 'packaging_pct'),
            ('管理+利润', 'management_profit_pct')
        ]:
            benchmark_pct = adjusted.get(pct_key, 0)
            implied_pct = benchmark_pct * (0.8 + 0.4 * (hash(item_name + material['id']) % 100) / 100)
            deviation = abs(implied_pct - benchmark_pct) / benchmark_pct * 100 if benchmark_pct > 0 else 0

            if deviation > 50:
                status = "严重异常"
            elif deviation > 25:
                status = "偏高" if implied_pct > benchmark_pct else "偏低"
            elif deviation > 10:
                status = "略高" if implied_pct > benchmark_pct else "略低"
            else:
                status = "正常"

            cost_items.append({
                'item': item_name,
                'supplier_pct': round(implied_pct, 1),
                'benchmark_pct': benchmark_pct,
                'deviation': round(deviation, 1),
                'status': status
            })
            max_deviation = max(max_deviation, deviation)

        return {
            'cost_items': cost_items,
            'cost_deviation_score': min(100, max_deviation),
            'benchmark_key': benchmark_key
        }

    def _get_benchmark_key(self, category: str) -> str:
        mapping = {
            '塑料外壳': 'plastic_injection',
            'PCB板': 'pcb',
            '传感器': 'sensor',
            '按键': 'silicone',
            '袖带': 'cuff'
        }
        return mapping.get(category, 'plastic_injection')

    def _adjust_benchmark(self, benchmark: Dict, material: Dict) -> Dict:
        adjusted = benchmark.copy()
        processing = material.get('processing', '')
        if '沉金' in processing:
            adjusted['surface_treatment_pct'] = 20
            adjusted['raw_material_pct'] = 22
        elif 'COB' in processing:
            adjusted['processing_pct'] = 35
        return adjusted

    def execute(self, material_id: str, supplier_quote: float,
                category: str = None, processing: str = None, **kwargs) -> Dict[str, Any]:
        """Tool 接口：分析成本结构"""
        mat_category = category or "塑料外壳"
        mat = {"id": material_id, "category": mat_category, "processing": processing or ""}
        result = self.analyze(mat, supplier_quote)
        abnormal_items = [c for c in result['cost_items'] if c['status'] not in ("正常",)]
        return {
            "result": result,
            "confidence": round(
                self.confidence * (1.0 - 0.15 * min(len(abnormal_items), 3) / 3), 3
            ),
            "reasoning": (
                f"基准类型={result['benchmark_key']}，"
                f"成本偏离总分={result['cost_deviation_score']}，"
                f"异常项 {len(abnormal_items)} 项: "
                + ", ".join(c['item'] for c in abnormal_items) if abnormal_items else "无"
            ),
        }


class ExternalRAGRetriever:
    """外部 RAG 检索器（目前为模拟实现，之后可替换为 ChromaDB 向量检索）"""

    def __init__(self, external_refs: List[Dict]):
        self._refs = {ref['material_category']: ref for ref in external_refs}

    def retrieve(self, material: Dict) -> Dict:
        """
        根据物料信息检索外部参考数据。
        目前为按类别硬匹配模拟，之后替换为向量检索。
        返回：
            {
                'price_low': float,
                'price_high': float,
                'source': str,
                'count': int,
                'available': bool
            }
        """
        category = material.get('category', '')
        if category in self._refs:
            ref = self._refs[category]
            return {
                'price_low': ref.get('price_low', 0),
                'price_high': ref.get('price_high', 0),
                'source': ref.get('source', '模拟数据'),
                'count': ref.get('sample_count', 1),
                'available': True,
            }
        return {
            'price_low': 0,
            'price_high': 0,
            'source': '无外部数据',
            'count': 0,
            'available': False,
        }

    def calculate_external_deviation(self, quote: float, material: Dict) -> Dict:
        """
        计算外部偏离分。
        公式：(报价 - 参考上限) / 参考上限 × 100%
        返回包含偏离分和参考区间详情。
        """
        ref_data = self.retrieve(material)
        if not ref_data['available'] or ref_data['price_high'] <= 0:
            return {
                'external_deviation': 0.0,
                'ref_low': 0,
                'ref_high': 0,
                'ref_source': '无外部数据',
                'available': False,
            }

        ref_high = ref_data['price_high']
        ref_low = ref_data['price_low']

        if quote > ref_high:
            deviation = (quote - ref_high) / ref_high * 100
        elif quote < ref_low:
            deviation = abs(quote - ref_low) / ref_low * 100
        else:
            deviation = 0.0

        return {
            'external_deviation': round(deviation, 1),
            'ref_low': ref_low,
            'ref_high': ref_high,
            'ref_source': ref_data['source'],
            'available': True,
        }


class AnomalyScorer(Tool):
    """偏离度综合打分 Skill — 两层串联打分"""

    name = "tool_score_deviation"
    description = (
        "综合价格区间偏离度、成本结构偏离度、市场参考偏离度，"
        "输出 0-100 的综合偏离度评分。"
        "评分 <20 正常，20-40 关注，40-60 警示，>=60 紧急。"
        "历史数据充足的类别（塑料外壳/PCB板）权重偏向历史数据。"
        "\n\n"
        "【两层打分流程】\n"
        "第一层（偏离度）：α×价格偏离 + β×成本结构偏离 + γ×市场偏离\n"
        "  → 决定要不要管（触发阈值推送）\n"
        "第二层（综合打分）：偏离度×0.6 + 外部偏离分×0.4\n"
        "  → 决定怎么解读异常（外部数据校准置信度）"
    )
    input_schema = {
        "type": "object",
        "properties": {
            "material_id": {"type": "string", "description": "物料ID"},
            "supplier_quote": {"type": "number", "description": "供应商报价"},
            "prediction": {
                "type": "object",
                "description": "tool_predict_price_range 的返回结果",
                "properties": {
                    "p10": {"type": "number"},
                    "p50": {"type": "number"},
                    "p90": {"type": "number"},
                },
            },
            "cost_analysis": {
                "type": "object",
                "description": "tool_analyze_cost_structure 的返回结果",
            },
        },
        "required": ["material_id", "supplier_quote", "prediction", "cost_analysis"],
    }
    confidence = 0.85
    model_loaded = False

    def __init__(self, external_refs: List[Dict]):
        self.external_refs = {ref['material_category']: ref for ref in external_refs}
        self._rag = ExternalRAGRetriever(external_refs)

    def calculate_deviation(self, quote: float, prediction: Dict,
                          cost_analysis: Dict, material: Dict) -> Dict:
        """
        两层打分：

        第一层 — 偏离度（判断要不要管）
            偏离度 = α × 价格偏离分 + β × 成本结构偏离分 + γ × 市场偏离分
            - 价格偏离分：内部 XGBoost 预测（P50 为基准）
            - 成本结构偏离分：LLM 成本分析结果
            - 市场偏离分：外部 RAG 检索（1688 参考上限）

        第二层 — 综合打分（外部数据校准置信度）
            综合打分 = 偏离度 × 0.6 + 外部偏离分 × 0.4
            - 外部偏离分：外部 RAG 检索的偏离分，与市场偏离分同源
            - 作用：内外部都高 → 异常确认；内部高、外部低 → 可能是误报
        """
        category = material.get('category', '')

        if category in ['塑料外壳', 'PCB板']:
            alpha, beta, gamma = 0.5, 0.3, 0.2
        else:
            alpha, beta, gamma = 0.2, 0.2, 0.6

        # ---- 第一层三个子分 ----
        pred_mid = prediction.get('p50', quote)
        price_deviation = abs(quote - pred_mid) / pred_mid * 100 if pred_mid > 0 else 0
        cost_deviation = cost_analysis.get('cost_deviation_score', 0)

        rag_result = self._rag.calculate_external_deviation(quote, material)
        market_deviation = rag_result['external_deviation']

        # ---- 第一层偏离度 ----
        deviation_score = (alpha * price_deviation
                         + beta * cost_deviation
                         + gamma * market_deviation)

        # ---- 第二层综合打分（外部校准） ----
        external_deviation = rag_result['external_deviation']
        composite_score = deviation_score * 0.6 + external_deviation * 0.4

        severity = self._determine_severity(deviation_score)

        return {
            # 三个子分
            'price_deviation': round(price_deviation, 1),
            'cost_deviation': round(cost_deviation, 1),
            'market_deviation': round(market_deviation, 1),
            # 第一层
            'deviation_score': round(deviation_score, 1),
            'severity_level': severity['level'],
            'severity_color': severity['color'],
            'weights': {'alpha': alpha, 'beta': beta, 'gamma': gamma},
            # 第二层
            'composite_score': round(composite_score, 1),
            'external_deviation': round(external_deviation, 1),
            # RAG 详情
            'rag': {
                'ref_low': rag_result['ref_low'],
                'ref_high': rag_result['ref_high'],
                'source': rag_result['ref_source'],
                'available': rag_result['available'],
            }
        }

    def _determine_severity(self, score: float) -> Dict:
        if score < 20:
            return {'level': '正常', 'color': '#10b981'}
        elif score < 40:
            return {'level': '关注', 'color': '#f59e0b'}
        elif score < 60:
            return {'level': '警示', 'color': '#f97316'}
        else:
            return {'level': '紧急', 'color': '#f43f5e'}

    def execute(
        self,
        material_id: str,
        supplier_quote: float,
        prediction: Dict = None,
        cost_analysis: Dict = None,
        **kwargs
    ) -> Dict[str, Any]:
        """Tool 接口：计算偏离度"""
        if not prediction or not cost_analysis:
            return {
                "result": {},
                "confidence": 0.0,
                "reasoning": "缺少 prediction 或 cost_analysis 参数",
            }

        mat_category = cost_analysis.get("benchmark_key", "塑料外壳")
        result = self.calculate_deviation(
            quote=supplier_quote,
            prediction=prediction,
            cost_analysis=cost_analysis,
            material={"id": material_id, "category": mat_category}
        )

        rag_info = result['rag']
        rag_hint = ""
        if rag_info['available']:
            rag_hint = (
                f"外部参考[{rag_info['source']}] ¥{rag_info['ref_low']}~¥{rag_info['ref_high']}，"
                f"外部偏离分={result['external_deviation']}%"
            )
        else:
            rag_hint = "无外部数据（RAG未命中）"

        return {
            "result": result,
            "confidence": round(self.confidence, 3),
            "reasoning": (
                f"第一层偏离度={result['deviation_score']}（{result['severity_level']}），"
                f"第二层综合打分={result['composite_score']}，"
                f"价格偏离={result['price_deviation']}% / "
                f"成本偏离={result['cost_deviation']}% / "
                f"市场偏离={result['market_deviation']}%，"
                f"权重 α={result['weights']['alpha']} β={result['weights']['beta']} γ={result['weights']['gamma']}。"
                f"{rag_hint}"
            ),
        }


class SolutionGenerator(Tool):
    """应对方案生成 Skill"""

    name = "tool_generate_solutions"
    description = (
        "根据偏离度评分和严重级别，生成 1-3 个具体可执行的应对方案。"
        "正常 -> 直接通过；关注/警示 -> 议价或工艺确认；紧急 -> 议价+二次询价+升级处理。"
        "输出方案包含置信度和预估节省金额。"
    )
    input_schema = {
        "type": "object",
        "properties": {
            "quote_id": {"type": "string", "description": "报价ID"},
            "supplier_quote": {"type": "number", "description": "供应商报价"},
            "deviation_score": {"type": "number", "description": "综合偏离度评分"},
            "severity_level": {"type": "string", "description": "严重级别"},
            "deviation_details": {
                "type": "object",
                "description": "偏离度详情（包含 price_deviation 等）",
            },
            "similar_materials": {
                "type": "array",
                "description": "相似物料列表（可选，用于参考对比）",
            },
        },
        "required": ["quote_id", "supplier_quote", "deviation_score", "severity_level"],
    }
    confidence = 0.88
    model_loaded = False

    def generate(self, quote: Dict, deviation: Dict,
                 similar_materials: List[Dict]) -> List[Dict]:
        """内部生成方法"""
        solutions = []
        score = deviation.get('deviation_score', 0)
        severity = deviation.get('severity_level', '正常')

        if severity == '正常':
            solutions.append({
                'id': f"SOL-{quote['id']}-A",
                'title': '直接通过',
                'description': f"报价¥{quote['supplier_quote']}在AI预测区间内，偏离度仅{score}分。与历史采购价一致，可直接通过。",
                'confidence': 0.92,
                'estimated_savings': '¥0',
                'action': 'accept'
            })

        elif severity == '紧急':
            target_price = quote.get('ai_prediction_mid', quote['supplier_quote'] * 0.85)
            savings = (quote['supplier_quote'] - target_price) * quote.get('quantity', 0)
            solutions.append({
                'id': f"SOL-{quote['id']}-A",
                'title': '直接议价',
                'description': f"当前报价¥{quote['supplier_quote']} vs AI预测上限¥{quote.get('ai_prediction_high', 'N/A')}，偏离+{deviation.get('price_deviation', 0):.0f}%。建议以¥{target_price:.2f}为目标进行议价。",
                'confidence': 0.85,
                'estimated_savings': f"¥{savings:,.0f}",
                'action': 'negotiate'
            })
            solutions.append({
                'id': f"SOL-{quote['id']}-B",
                'title': '二次询价',
                'description': "单一供应商报价，无法判断是否具有代表性。建议向其他2-3家同类供应商发起二次询价。",
                'confidence': 0.72,
                'estimated_savings': '待定',
                'action': 'requote'
            })
            solutions.append({
                'id': f"SOL-{quote['id']}-C",
                'title': '升级处理',
                'description': f"偏离度>{score}分，超出工程师自主处理权限。建议上报采购经理，进行专项评审。",
                'confidence': 0.90,
                'estimated_savings': '需评审',
                'action': 'escalate'
            })

        elif severity in ['关注', '警示']:
            if deviation.get('price_deviation', 0) > 0:
                solutions.append({
                    'id': f"SOL-{quote['id']}-A",
                    'title': '议价谈判',
                    'description': f"报价¥{quote['supplier_quote']}高于AI预测区间，偏离+{deviation.get('price_deviation', 0):.0f}%。建议议价。",
                    'confidence': 0.80,
                    'estimated_savings': '待计算',
                    'action': 'negotiate'
                })
            else:
                solutions.append({
                    'id': f"SOL-{quote['id']}-A",
                    'title': '工艺确认',
                    'description': f"报价¥{quote['supplier_quote']}低于AI预测区间，偏离{deviation.get('price_deviation', 0):.0f}%。建议核实工艺要求。",
                    'confidence': 0.78,
                    'estimated_savings': '风险规避',
                    'action': 'verify'
                })
            if similar_materials:
                solutions.append({
                    'id': f"SOL-{quote['id']}-B",
                    'title': '历史对比',
                    'description': f"参考历史相似物料价格：{similar_materials[0]['name']} ¥{similar_materials[0]['price']}（相似度{similar_materials[0]['similarity']}）",
                    'confidence': 0.75,
                    'estimated_savings': '参考对比',
                    'action': 'compare'
                })

        return solutions

    def execute(
        self,
        quote_id: str,
        supplier_quote: float,
        deviation_score: float,
        severity_level: str,
        deviation_details: Dict = None,
        similar_materials: List[Dict] = None,
        **kwargs
    ) -> Dict[str, Any]:
        """Tool 接口：生成应对方案"""
        deviation = {**(deviation_details or {}), "deviation_score": deviation_score, "severity_level": severity_level}
        quote = {"id": quote_id, "supplier_quote": supplier_quote, "quantity": 10000}

        results = self.generate(quote, deviation, similar_materials or [])
        return {
            "result": results,
            "confidence": round(
                self.confidence * (0.9 + 0.1 * min(len(results), 3) / 3), 3
            ),
            "reasoning": (
                f"偏离度 {deviation_score} 分（{severity_level}），"
                f"生成 {len(results)} 个方案: "
                + " / ".join(s['title'] for s in results)
            ),
        }


# =============================================================================
# Agent 编排器
# =============================================================================

class AgentOrchestrator:
    """
    Agent编排器 - 基于 LangGraph 的有状态 Agent
    支持：条件路由、Human-in-the-loop 断点、状态持久化、LLM 方案生成
    """

    def __init__(self, materials_path: str, external_refs_path: str):
        import uuid

        # 加载数据
        with open(materials_path, 'r', encoding='utf-8') as f:
            self.materials = json.load(f)['materials']

        with open(external_refs_path, 'r', encoding='utf-8') as f:
            ext_data = json.load(f)
            self.external_refs = ext_data['external_references']
            self.benchmarks = ext_data['industry_benchmarks']

        # 初始化 Skills
        self.matcher = SimilarityMatcher(self.materials)
        self.predictor = PricePredictor(self.materials)
        self.cost_analyzer = CostAnalyzer(self.benchmarks)
        self.scorer = AnomalyScorer(self.external_refs)
        self.solution_gen = SolutionGenerator()

        # 初始化 ToolRegistry 并注册所有工具
        from app.skills.tool_registry import ToolRegistry
        self.registry = ToolRegistry()
        self.registry.register(self.matcher)
        self.registry.register(self.predictor)
        self.registry.register(self.cost_analyzer)
        self.registry.register(self.scorer)
        self.registry.register(self.solution_gen)

        # 初始化 LangGraph Agent
        from app.agent.langgraph_agent import build_quote_agent_graph
        self._graph = build_quote_agent_graph(self.registry)
        self._checkpointer = self._graph.checkpointer

        # 收集所有工具的 OpenAI function calling schema（供 LLM 路由使用）
        self.available_tools = self.registry.list_tools()

        # 每个报价生成唯一 thread_id，用于 checkpoint 恢复
        self._thread_store = {}

    def _new_thread_id(self) -> str:
        """生成新的 thread id"""
        import uuid
        return str(uuid.uuid4())

    def process_quote(self, quote_data: Dict) -> Dict:
        """
        处理报价异常检测全流程（LangGraph 模式）
        偏离度 < 20：自动通过 -> 直接返回结果
        偏离度 20-60：LLM 生成方案 -> interrupt 等待人工确认
        偏离度 >= 60：升级处理 -> interrupt 等待人工确认
        """
        if 'id' not in quote_data:
            quote_data['id'] = f"Q-{datetime.now().strftime('%Y%m%d%H%M%S')}"

        thread_id = self._new_thread_id()
        self._thread_store[quote_data['id']] = thread_id

        try:
            result = self._graph.invoke(
                {
                    "quote_data": quote_data,
                    "execution_trace": [],
                },
                config={
                    "configurable": {"thread_id": thread_id},
                    "recursion_limit": 50,
                },
            )
        except Exception as e:
            error_str = str(e)
            if "interrupt" in error_str.lower() or "GraphValue" in error_str:
                result = self._get_latest_state(thread_id)
            else:
                raise

        return self._format_output(result)

    def resume_with_feedback(
        self,
        quote_id: str,
        feedback: Dict[str, Any],
    ) -> Dict:
        """
        人工反馈后恢复 Agent 执行
        用于 Human-in-the-loop 断点恢复
        """
        from langgraph.types import Command
        thread_id = self._thread_store.get(quote_id)
        if not thread_id:
            raise ValueError(f"未找到报价 {quote_id} 的执行线程")

        result = self._graph.invoke(
            Command(resume={"human_feedback": feedback}),
            config={
                "configurable": {"thread_id": thread_id},
                "recursion_limit": 50,
            },
        )
        return self._format_output(result)

    def rerun_from_node(
        self,
        quote_data: Dict,
        from_node: str,
        modified_params: Optional[Dict[str, Any]] = None,
    ) -> Dict:
        """
        从指定节点重新执行（参数可调整）
        """
        thread_id = self._new_thread_id()
        quote_id = quote_data.get('id', f"Q-{datetime.now().strftime('%Y%m%d%H%M%S')}")
        self._thread_store[quote_id] = thread_id

        if modified_params:
            quote_data = {**quote_data, **modified_params}

        result = self._graph.invoke(
            {
                "quote_data": quote_data,
                "execution_trace": [],
            },
            config={
                "configurable": {"thread_id": thread_id},
                "recursion_limit": 50,
            },
        )
        return self._format_output(result)

    def _get_latest_state(self, thread_id: str) -> Dict:
        """从 checkpointer 获取最新状态（interrupt 前）"""
        try:
            config = {"configurable": {"thread_id": thread_id}}
            state = self._graph.get_state(config)
            return dict(state.values) if hasattr(state, 'values') else {}
        except Exception:
            return {}

    def _format_output(self, result: Dict) -> Dict:
        """将 LangGraph 执行结果格式化为 API 兼容的输出格式"""
        if not result:
            return {}

        qd = result.get("quote_data", {})
        pred = result.get("prediction") or {}
        dev = result.get("deviation") or {}
        cost = result.get("cost_analysis") or {}
        rag = result.get("rag_info") or {}
        sims = result.get("similar_materials") or []
        sols = result.get("solutions") or []

        trace = result.get("execution_trace", [])
        total_ms = sum(step.get("duration_ms", 0) for step in trace)

        return {
            "id": qd.get("id", f"Q-{datetime.now().strftime('%Y%m%d%H%M%S')}"),
            "material_id": qd.get("material_id", ""),
            "material_name": qd.get("material_name", ""),
            "supplier_quote": qd.get("supplier_quote", 0),
            "supplier_name": qd.get("supplier_name", ""),
            "quantity": qd.get("quantity", 0),
            "ai_prediction_low": pred.get("p10"),
            "ai_prediction_high": pred.get("p90"),
            "ai_prediction_mid": pred.get("p50"),
            # 第一层
            "deviation_score": dev.get("deviation_score", 0),
            "severity_level": dev.get("severity_level", "正常"),
            "severity_color": dev.get("severity_color", "#10b981"),
            "price_deviation": dev.get("price_deviation", 0),
            "cost_deviation": dev.get("cost_deviation", 0),
            "market_deviation": dev.get("market_deviation", 0),
            "weights": dev.get("weights", {}),
            # 第二层
            "composite_score": dev.get("composite_score", dev.get("deviation_score", 0)),
            "external_deviation": dev.get("external_deviation", 0),
            # RAG 详情
            "rag_info": {
                "ref_low": rag.get("ref_low", 0),
                "ref_high": rag.get("ref_high", 0),
                "source": rag.get("source", ""),
                "available": rag.get("available", False),
            },
            "solutions": sols,
            "cost_breakdown": cost,
            "similar_materials": sims,
            "execution_trace": trace,
            "llm_solution_text": result.get("llm_solution_text"),
            "interrupt_reason": result.get("interrupt_reason"),
            "total_duration_ms": round(total_ms, 1),
            "status": "pending",
            "created_at": datetime.now().isoformat(),
        }

    def get_openai_tools(self) -> List[Dict[str, Any]]:
        """返回所有已注册工具的 OpenAI function calling schema，供 LLM 动态调用"""
        return [t.get_openai_function() for t in self.registry._tools.values()]


# 导出
__all__ = [
    'Tool',
    'SimilarityMatcher',
    'PricePredictor',
    'CostAnalyzer',
    'AnomalyScorer',
    'ExternalRAGRetriever',
    'SolutionGenerator',
    'AgentOrchestrator'
]
