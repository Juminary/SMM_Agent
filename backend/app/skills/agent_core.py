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
    """相似物料检索 Skill — embedding 向量相似度 + 规则兜底"""

    name = "tool_match_similar_material"
    description = (
        "根据当前报价物料的类别、材料类型、工艺、精度和尺寸，"
        "从历史物料库中检索最相似的 Top-K 条记录，用于价格参考。"
        "使用语义向量相似度（sentence-transformers），模型不可用时降级为规则匹配。"
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

    # 用于构建物料文本表示的字段
    TEXT_FIELDS = ['category', 'material_type', 'processing', 'precision', 'dimensions']

    def __init__(self, materials_data: List[Dict]):
        self.materials = [Material(**m) for m in materials_data]

        # 尝试加载 embedding 模型
        self._embed_model = None
        self._embeddings = None
        self._id_to_idx = {}
        self._load_embedding_model()

    def _load_embedding_model(self) -> None:
        """加载 embedding 模型并预计算所有物料的向量"""
        try:
            from sentence_transformers import SentenceTransformer
            # 中文优化模型，轻量（~24MB）
            for model_name in [
                'BAAI/bge-small-zh-v1.5',
                'paraphrase-multilingual-MiniLM-L12-v2',
                'all-MiniLM-L6-v2',
            ]:
                try:
                    self._embed_model = SentenceTransformer(model_name)
                    break
                except Exception:
                    continue

            if self._embed_model:
                texts = [self._material_to_text(m) for m in self.materials]
                self._embeddings = self._embed_model.encode(
                    texts, normalize_embeddings=True, show_progress_bar=False
                )
                self._id_to_idx = {m.id: i for i, m in enumerate(self.materials)}
                self.model_loaded = True
                print(f"[SimilarityMatcher] Embedding model loaded: {self._embed_model.get_sentence_embedding_dimension()}d")
        except Exception as e:
            print(f"[SimilarityMatcher] Embedding model unavailable: {e}, falling back to rule-based")

    def _material_to_text(self, mat) -> str:
        """将物料序列化为文本，用于 embedding"""
        return (
            f"品类:{mat.category}，材质:{mat.material_type}，"
            f"工艺:{mat.processing}，精度:{mat.precision}，尺寸:{mat.dimensions}"
        )

    # ===== Embedding 模式 =====

    def _find_similar_embedding(self, target: Material, top_k: int) -> List[Dict]:
        """基于余弦相似度的向量检索"""
        import numpy as np

        target_text = self._material_to_text(target)
        target_vec = self._embed_model.encode(
            [target_text], normalize_embeddings=True
        )[0]

        # 余弦相似度（已 L2 归一化，点积即余弦）
        scores = np.dot(target_vec, self._embeddings.T)

        # 取 Top-K，排除自身
        results = []
        for idx in np.argsort(scores)[::-1]:
            if len(results) >= top_k:
                break
            mat = self.materials[idx]
            if mat.id == target.id:
                continue
            results.append({
                'id': mat.id,
                'name': mat.name,
                'price': mat.unit_price,
                'similarity': round(float(scores[idx]), 3),
                'date': mat.order_date,
                'supplier': mat.supplier_name,
            })

        return results

    # ===== 规则兜底 =====

    def _find_similar_rule(self, target: Material, top_k: int) -> List[Dict]:
        """加权规则匹配（embedding 不可用时的兜底方案）"""
        weights = {
            'category': 0.25, 'material_type': 0.25, 'processing': 0.20,
            'precision': 0.15, 'dimensions': 0.15,
        }
        results = []
        for mat in self.materials:
            if mat.id == target.id:
                continue
            score = 0.0
            if mat.category == target.category:
                score += weights['category']
            if mat.material_type == target.material_type:
                score += weights['material_type']
            if mat.processing == target.processing:
                score += weights['processing']
            elif mat.processing.split('+')[0] == target.processing.split('+')[0]:
                score += weights['processing'] * 0.5
            if mat.precision == target.precision:
                score += weights['precision']
            # 尺寸相似度
            target_dims = self._parse_dims(target.dimensions)
            mat_dims = self._parse_dims(mat.dimensions)
            if target_dims and mat_dims:
                dim_sim = sum(
                    max(0, 1 - abs(a - b) / max(a, b, 1))
                    for a, b in zip(target_dims, mat_dims)
                ) / len(target_dims) if len(target_dims) == len(mat_dims) else 0.5
                score += weights['dimensions'] * dim_sim
            results.append({
                'id': mat.id, 'name': mat.name, 'price': mat.unit_price,
                'similarity': round(min(1.0, score), 3),
                'date': mat.order_date, 'supplier': mat.supplier_name,
            })
        results.sort(key=lambda x: x['similarity'], reverse=True)
        return results[:top_k]

    @staticmethod
    def _parse_dims(dims_str: str) -> List[float]:
        try:
            s = dims_str.lower().replace('×', 'x').replace('mm', '').replace('cm', '')
            return [float(x) for x in s.split('x')]
        except (ValueError, AttributeError):
            return []

    # ===== 对外接口 =====

    def execute(self, material_id: str, top_k: int = 5, **kwargs) -> Dict[str, Any]:
        """Tool 接口：检索相似物料（优先 embedding，不可用时规则兜底）"""
        matched = next((m for m in self.materials if m.id == material_id), None)
        if matched is None:
            return {
                "result": [],
                "confidence": 0.0,
                "reasoning": f"物料ID {material_id} 在历史库中未找到",
            }

        if self._embed_model and self._embeddings is not None:
            results = self._find_similar_embedding(matched, top_k)
            mode = "Embedding"
        else:
            results = self._find_similar_rule(matched, top_k)
            mode = "Rule"

        avg_sim = sum(r['similarity'] for r in results) / len(results) if results else 0
        return {
            "result": results,
            "confidence": round(self.confidence * (0.6 + 0.4 * avg_sim), 3),
            "reasoning": (
                f"[{mode}] 检索到 {len(results)} 条相似物料，"
                f"平均相似度 {avg_sim:.3f}，"
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
        """
        成本结构参照分析。

        由于供应商通常只提供总价而非逐项明细，无法直接计算各成本项的
        真实偏离度。这里做的是：
          1. 查询该品类的行业成本结构基准（原材料/加工/表面/包装/利润占比）
          2. 按总报价反推各项的"基准推算金额"
          3. 标注所有项为"参考值"，诚实告知需要供应商提供明细才能做逐项对比

        唯一能做真实对比的是：用外部市场参考价校验总价是否在合理区间。
        """
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
        for item_name, pct_key in [
            ('原材料', 'raw_material_pct'),
            ('加工费', 'processing_pct'),
            ('表面处理', 'surface_treatment_pct'),
            ('包装物流', 'packaging_pct'),
            ('管理+利润', 'management_profit_pct')
        ]:
            benchmark_pct = adjusted.get(pct_key, 0)
            benchmark_amount = round(quote * benchmark_pct / 100, 2)

            cost_items.append({
                'item': item_name,
                'benchmark_pct': benchmark_pct,
                'benchmark_amount': benchmark_amount,
                'supplier_pct': None,          # 供应商未提供明细，无法计算
                'deviation': None,             # 无法计算逐项偏离
                'status': '参考值',
                'data_source': '行业基准',
            })

        return {
            'cost_items': cost_items,
            'benchmark_key': benchmark_key,
            'data_quality': 'reference_only',
            'note': '供应商未提供成本明细，以下占比为行业平均参考。各成本项的"基准推算金额"系按总报价×行业占比反推，非供应商实际成本构成。如需逐项偏离分析，请要求供应商提供成本明细。',
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
        """Tool 接口：成本结构参照分析"""
        mat_category = category or "塑料外壳"
        mat = {"id": material_id, "category": mat_category, "processing": processing or ""}
        result = self.analyze(mat, supplier_quote)

        # 所有项均为参考值，数据质量标注
        data_quality = result.get("data_quality", "reference_only")

        return {
            "result": result,
            "confidence": round(self.confidence * 0.7, 3),  # 仅为行业参照，置信度降权
            "reasoning": (
                f"基准类型={result['benchmark_key']}，数据质量={data_quality}。"
                f"{result.get('note', '')}"
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


def _benchmark_key_to_category(benchmark_key: str) -> str:
    """将 benchmark_key 反推回品类中文名"""
    mapping = {
        "plastic_injection": "塑料外壳",
        "pcb": "PCB板",
        "sensor": "传感器",
        "silicone": "按键",
        "cuff": "袖带",
    }
    return mapping.get(benchmark_key, "塑料外壳")


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

        # 根据成本数据质量调整权重
        cost_data_quality = cost_analysis.get('data_quality', 'reference_only')

        if category in ['塑料外壳', 'PCB板']:
            if cost_data_quality == 'reference_only':
                alpha, beta, gamma = 0.65, 0.05, 0.30  # 成本仅为参照，降权
            else:
                alpha, beta, gamma = 0.50, 0.30, 0.20
        else:
            if cost_data_quality == 'reference_only':
                alpha, beta, gamma = 0.30, 0.05, 0.65
            else:
                alpha, beta, gamma = 0.20, 0.20, 0.60

        # ---- 第一层三个子分 ----
        pred_mid = prediction.get('p50', quote)
        price_deviation = abs(quote - pred_mid) / pred_mid * 100 if pred_mid > 0 else 0

        # 成本偏离：有真实数据时使用，否则为 0（参考值不可用于偏离计算）
        cost_deviation = cost_analysis.get('cost_deviation_score', 0)
        if cost_deviation is None:
            cost_deviation = 0

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

        # 优先使用传入的 category，否则从 benchmark_key 反推
        mat_category = kwargs.get("category") or _benchmark_key_to_category(
            cost_analysis.get("benchmark_key", "")
        )
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
# 诊断阶段 Skill 实现（第二阶段：Agent 自主调用）
# =============================================================================

class SupplierProfiler(Tool):
    """供应商画像查询 — 历史偏离趋势、合作年限、报价稳定性"""

    name = "tool_get_supplier_profile"
    description = (
        "查询指定供应商的历史报价记录和偏离趋势。"
        "返回：历史报价次数、平均偏离百分比、偏离趋势（上升/下降/稳定）、"
        "合作时间跨度、各品类报价分布。"
        "当怀疑供应商系统性溢价时调用此工具。"
    )
    input_schema = {
        "type": "object",
        "properties": {
            "supplier_name": {"type": "string", "description": "供应商名称"},
            "material_category": {"type": "string", "description": "物料品类（可选，用于筛选）"},
        },
        "required": ["supplier_name"],
    }
    confidence = 0.85
    model_loaded = False

    def __init__(self, materials_data: List[Dict]):
        self.materials = materials_data
        self._build_index()

    def _build_index(self):
        self._by_supplier: Dict[str, List[Dict]] = {}
        for m in self.materials:
            name = m.get("supplier_name", "")
            if name not in self._by_supplier:
                self._by_supplier[name] = []
            self._by_supplier[name].append(m)

    def execute(self, supplier_name: str, material_category: str = None, **kwargs) -> Dict[str, Any]:
        records = self._by_supplier.get(supplier_name, [])
        if not records:
            return {
                "result": {"available": False, "supplier_name": supplier_name, "message": "无该供应商的历史记录"},
                "confidence": 0.3,
                "reasoning": f"供应商 {supplier_name} 无历史采购记录，无法建立画像",
            }

        if material_category:
            records = [r for r in records if r.get("category") == material_category]
        if not records:
            return {
                "result": {"available": False, "supplier_name": supplier_name, "message": f"无 {material_category or ''} 品类记录"},
                "confidence": 0.3,
                "reasoning": f"供应商 {supplier_name} 在 {material_category or '全部品类'} 无记录",
            }

        prices = [r["unit_price"] for r in records]
        dates = sorted([r.get("order_date", "") for r in records])
        categories = list(set(r.get("category", "") for r in records))

        avg_price = sum(prices) / len(prices)
        price_std = (sum((p - avg_price) ** 2 for p in prices) / len(prices)) ** 0.5

        # 简单趋势判断
        if len(prices) >= 3:
            recent_avg = sum(prices[-3:]) / min(3, len(prices[-3:]))
            early_avg = sum(prices[:3]) / min(3, len(prices[:3]))
            if recent_avg > early_avg * 1.08:
                trend = "上升"
            elif recent_avg < early_avg * 0.92:
                trend = "下降"
            else:
                trend = "稳定"
        else:
            trend = "数据不足"

        result = {
            "available": True,
            "supplier_name": supplier_name,
            "quote_count": len(records),
            "categories_covered": categories,
            "avg_unit_price": round(avg_price, 2),
            "price_volatility": round(price_std / avg_price * 100, 1) if avg_price > 0 else 0,
            "price_trend": trend,
            "first_order": dates[0] if dates else "",
            "last_order": dates[-1] if dates else "",
            "sample_materials": [
                {"name": r["name"], "price": r["unit_price"], "date": r.get("order_date", "")}
                for r in records[:5]
            ],
        }

        return {
            "result": result,
            "confidence": round(self.confidence * min(len(records) / 10, 1.0), 3),
            "reasoning": (
                f"供应商 {supplier_name}：{len(records)} 条记录，"
                f"均价 ¥{avg_price:.2f}，趋势 {trend}，"
                f"覆盖品类：{', '.join(categories[:3])}"
            ),
        }


class PeerComparer(Tool):
    """同类供应商价格对比 — 同品类物料在不同供应商间的价格水平对比"""

    name = "tool_compare_peer_price"
    description = (
        "对比同类物料在不同供应商间的报价水平。"
        "输入物料品类和材质，返回各供应商的均价、最高/最低价、报价次数。"
        "用于判断当前报价是否明显高于同行。"
    )
    input_schema = {
        "type": "object",
        "properties": {
            "material_category": {"type": "string", "description": "物料品类"},
            "material_type": {"type": "string", "description": "材质类型（可选）"},
            "current_supplier": {"type": "string", "description": "当前供应商名称（用于高亮）"},
            "current_price": {"type": "number", "description": "当前报价金额"},
        },
        "required": ["material_category", "current_supplier", "current_price"],
    }
    confidence = 0.80
    model_loaded = False

    def __init__(self, materials_data: List[Dict]):
        self.materials = materials_data

    def execute(self, material_category: str, current_supplier: str,
                current_price: float, material_type: str = None, **kwargs) -> Dict[str, Any]:
        # 筛选同品类物料
        peers = [m for m in self.materials if m.get("category") == material_category]
        if material_type:
            type_filtered = [m for m in peers if m.get("material_type") == material_type]
            if type_filtered:
                peers = type_filtered

        # 排除当前供应商
        peers = [m for m in peers if m.get("supplier_name") != current_supplier]
        if not peers:
            return {
                "result": {"available": False, "message": "无同类供应商数据"},
                "confidence": 0.3,
                "reasoning": f"品类 {material_category} 无其他供应商记录，无法对比",
            }

        # 按供应商分组
        by_supplier: Dict[str, List[float]] = {}
        for m in peers:
            name = m.get("supplier_name", "")
            if name not in by_supplier:
                by_supplier[name] = []
            by_supplier[name].append(m["unit_price"])

        peer_summary = []
        all_prices = []
        for name, prices in by_supplier.items():
            avg = sum(prices) / len(prices)
            all_prices.extend(prices)
            peer_summary.append({
                "supplier": name,
                "avg_price": round(avg, 2),
                "min_price": min(prices),
                "max_price": max(prices),
                "quote_count": len(prices),
            })

        peer_summary.sort(key=lambda x: x["avg_price"])

        overall_avg = sum(all_prices) / len(all_prices)
        premium = (current_price - overall_avg) / overall_avg * 100 if overall_avg > 0 else 0

        result = {
            "available": True,
            "category": material_category,
            "material_type": material_type or "全部",
            "peer_count": len(peer_summary),
            "peer_avg_price": round(overall_avg, 2),
            "peer_min_price": round(min(all_prices), 2),
            "peer_max_price": round(max(all_prices), 2),
            "current_price": current_price,
            "current_premium_pct": round(premium, 1),
            "current_vs_peers": "明显偏高" if premium > 20 else ("略高" if premium > 10 else "正常"),
            "peer_details": peer_summary,
            "excluded_supplier": current_supplier,
        }

        return {
            "result": result,
            "confidence": round(self.confidence * min(len(peer_summary) / 3, 1.0), 3),
            "reasoning": (
                f"品类 {material_category} 共 {len(peer_summary)} 家同行，"
                f"均价 ¥{overall_avg:.2f}，当前报价 ¥{current_price}（{'偏高' if premium > 0 else '偏低'} {abs(premium):.0f}%）"
            ),
        }


class MarketTrendChecker(Tool):
    """市场行情查询 — 原材料价格走势、行业参考区间"""

    name = "tool_check_market_trend"
    description = (
        "查询原材料市场行情走势和行业参考价格区间。"
        "用于判断偏离是否由市场行情驱动。"
        "当前数据源为行业基准 + 外部参考，置信度取决于数据新鲜度。"
    )
    input_schema = {
        "type": "object",
        "properties": {
            "material_category": {"type": "string", "description": "物料品类"},
            "material_type": {"type": "string", "description": "材质类型（可选）"},
        },
        "required": ["material_category"],
    }
    confidence = 0.70
    model_loaded = False

    def __init__(self, external_refs: List[Dict], benchmarks: Dict):
        self.external_refs = {ref["material_category"]: ref for ref in external_refs}
        self.benchmarks = benchmarks

    def execute(self, material_category: str, material_type: str = None, **kwargs) -> Dict[str, Any]:
        ref = self.external_refs.get(material_category)
        if not ref:
            return {
                "result": {"available": False, "category": material_category, "message": "该品类无外部行情数据"},
                "confidence": 0.3,
                "reasoning": f"品类 {material_category} 无外部行情数据，无法判断市场趋势",
            }

        price_low = ref.get("price_low", 0)
        price_high = ref.get("price_high", 0)
        source = ref.get("source", "未知来源")
        count = ref.get("sample_count", 0)

        # 从 benchmark 中提取成本比例作为补充信息
        bench_key_map = {
            "塑料外壳": "plastic_injection",
            "PCB板": "pcb",
            "传感器": "sensor",
            "按键": "silicone",
            "袖带": "cuff",
        }
        bench_key = bench_key_map.get(material_category, "plastic_injection")
        bench = self.benchmarks.get(bench_key, {})

        result = {
            "available": True,
            "category": material_category,
            "material_type": material_type or "全部",
            "market_price_range": f"¥{price_low:.2f} ~ ¥{price_high:.2f}",
            "price_low": price_low,
            "price_high": price_high,
            "source": source,
            "sample_count": count,
            "data_freshness": "需确认更新时间",
            "trend": "需更多时序数据判断",
            "cost_structure_benchmark": bench,
            "note": "当前为静态参考数据，未接入实时行情",
        }

        return {
            "result": result,
            "confidence": round(self.confidence * min(count / 50, 1.0), 3),
            "reasoning": (
                f"品类 {material_category}：外部参考 ¥{price_low:.2f}~¥{price_high:.2f}（{source}），"
                f"样本量 {count}，{'数据充足' if count >= 20 else '数据有限，置信度较低'}"
            ),
        }


class UrgencyChecker(Tool):
    """采购紧急度查询 — 库存水位、采购紧急程度"""

    name = "tool_check_urgency"
    description = (
        "查询物料的库存水位和采购紧急程度。"
        "用于判断是否有时间进行议价或二次询价。"
        "当前为模拟数据，生产环境需对接 ERP/WMS。"
    )
    input_schema = {
        "type": "object",
        "properties": {
            "material_id": {"type": "string", "description": "物料ID"},
            "material_name": {"type": "string", "description": "物料名称（可选）"},
        },
        "required": ["material_id"],
    }
    confidence = 0.45  # 模拟数据，置信度低
    model_loaded = False

    def __init__(self):
        pass

    def execute(self, material_id: str, material_name: str = None, **kwargs) -> Dict[str, Any]:
        result = {
            "available": False,
            "material_id": material_id,
            "material_name": material_name or "",
            "inventory_level": "未知",
            "daily_consumption": "未知",
            "days_remaining": "未知",
            "urgency": "无法判断",
            "can_negotiate": "无法判断",
            "data_source": "模拟",
            "note": "库存数据需要对接 ERP/WMS 系统，当前为占位实现",
        }

        return {
            "result": result,
            "confidence": 0.3,
            "reasoning": (
                f"物料 {material_id}：库存数据不可用，无法判断紧急度。"
                "建议由采购人员人工判断是否可以延期议价。"
            ),
        }


class AlternativeSupplierFinder(Tool):
    """替代供应商检索 — 寻找可替代供应商"""

    name = "tool_search_alternatives"
    description = (
        "检索可提供同类物料的其他供应商。"
        "根据物料品类和工艺要求，从历史采购记录中查找替代供应商。"
        "用于方案生成前寻找备选供方。"
    )
    input_schema = {
        "type": "object",
        "properties": {
            "material_category": {"type": "string", "description": "物料品类"},
            "processing": {"type": "string", "description": "工艺要求（可选）"},
            "exclude_supplier": {"type": "string", "description": "排除的供应商（当前供应商）"},
        },
        "required": ["material_category"],
    }
    confidence = 0.75
    model_loaded = False

    def __init__(self, materials_data: List[Dict]):
        self.materials = materials_data

    def execute(self, material_category: str, exclude_supplier: str = None,
                processing: str = None, **kwargs) -> Dict[str, Any]:
        candidates = [m for m in self.materials if m.get("category") == material_category]
        if processing:
            proc_filtered = [m for m in candidates if processing in m.get("processing", "")]
            if proc_filtered:
                candidates = proc_filtered
        if exclude_supplier:
            candidates = [m for m in candidates if m.get("supplier_name") != exclude_supplier]

        if not candidates:
            return {
                "result": [],
                "confidence": 0.3,
                "reasoning": f"品类 {material_category} 无替代供应商（已排除 {exclude_supplier or '无'}）",
            }

        by_supplier: Dict[str, List[Dict]] = {}
        for m in candidates:
            name = m.get("supplier_name", "")
            if name not in by_supplier:
                by_supplier[name] = []
            by_supplier[name].append(m)

        alternatives = []
        for name, items in by_supplier.items():
            avg_price = sum(it["unit_price"] for it in items) / len(items)
            alternatives.append({
                "supplier_name": name,
                "material_count": len(items),
                "avg_price": round(avg_price, 2),
                "price_range": f"¥{min(it['unit_price'] for it in items):.2f}~¥{max(it['unit_price'] for it in items):.2f}",
                "sample_materials": [it["name"] for it in items[:3]],
            })

        alternatives.sort(key=lambda x: x["avg_price"])

        return {
            "result": alternatives,
            "confidence": round(self.confidence * min(len(alternatives) / 3, 1.0), 3),
            "reasoning": (
                f"品类 {material_category} 找到 {len(alternatives)} 家替代供应商"
                + (f"，工艺={processing}" if processing else "")
                + f"，均价范围 ¥{alternatives[0]['avg_price']:.2f}~¥{alternatives[-1]['avg_price']:.2f}"
            ),
        }


class CostAnomalyAnalyzer(Tool):
    """深度成本异常分析 — 定位具体异常成本项，给出解释和追问建议"""

    name = "tool_analyze_cost_anomaly"
    description = (
        "对第一阶段成本拆解结果进行深度分析。"
        "定位偏离最大的成本项，结合品类和工艺特征给出可能的解释，"
        "以及建议向供应商追问的具体问题。"
    )
    input_schema = {
        "type": "object",
        "properties": {
            "cost_analysis": {
                "type": "object",
                "description": "tool_analyze_cost_structure 返回的 result 对象",
            },
            "supplier_quote": {"type": "number", "description": "供应商报价金额"},
            "material_category": {"type": "string", "description": "物料品类"},
        },
        "required": ["cost_analysis", "supplier_quote", "material_category"],
    }
    confidence = 0.78
    model_loaded = False

    def __init__(self):
        self._explanation_templates = {
            "原材料": {
                "偏高": ["原材料等级高于行业标准", "供应商采购渠道成本偏高", "材料牌号使用了更贵的规格"],
                "偏低": ["使用了回收料或低等级材料", "大批量采购折扣", "供应商自有上游渠道"],
            },
            "加工费": {
                "偏高": ["模具复杂度高于同类物料", "工时估算偏高", "小批量导致换线成本高"],
                "偏低": ["自动化程度高", "大批量摊薄固定成本", "工艺简化"],
            },
            "表面处理": {
                "偏高": ["特殊处理工艺（如医疗级）", "外发加工增加成本"],
                "偏低": ["简化了表面处理工序"],
            },
            "包装物流": {
                "偏高": ["特殊包装要求", "远距离运输"],
                "偏低": ["近距离本地配送", "简易包装"],
            },
            "管理+利润": {
                "偏高": ["供应商利润率偏高", "品牌溢价", "代理商加价"],
                "偏低": ["供应商策略性低价（抢占份额）"],
            },
        }

    def execute(self, cost_analysis: Dict, supplier_quote: float,
                material_category: str, **kwargs) -> Dict[str, Any]:
        cost_items = cost_analysis.get("cost_items", [])
        if not cost_items:
            return {
                "result": {"available": False, "message": "无成本拆解数据"},
                "confidence": 0.0,
                "reasoning": "缺少成本拆解数据，无法进行深度分析",
            }

        # 按偏离程度排序
        abnormal = [c for c in cost_items if c.get("status") not in ("正常",)]
        abnormal.sort(key=lambda x: abs(x.get("deviation", 0)), reverse=True)

        analysis = []
        for item in abnormal[:3]:
            item_name = item.get("item", "")
            status = item.get("status", "")
            deviation = item.get("deviation", 0)

            direction = "偏高" if deviation > 0 else "偏低"
            templates = self._explanation_templates.get(item_name, {}).get(direction, ["需进一步分析"])

            analysis.append({
                "item": item_name,
                "deviation_pct": deviation,
                "direction": direction,
                "supplier_pct": item.get("supplier_pct", 0),
                "benchmark_pct": item.get("benchmark_pct", 0),
                "possible_explanations": templates,
                "suggested_questions": [
                    f"请供应商提供 {item_name} 的明细构成",
                    f"确认 {item_name} 是否有特殊要求导致成本{'增加' if deviation > 0 else '减少'}",
                ],
            })

        primary = analysis[0] if analysis else None
        result = {
            "available": True,
            "category": material_category,
            "total_anomaly_items": len(abnormal),
            "primary_anomaly": primary,
            "all_anomalies": analysis,
            "summary": (
                f"共 {len(abnormal)} 项异常，"
                + (f"最大异常项为 {primary['item']}（{primary['direction']} {abs(primary['deviation_pct']):.0f}%）"
                   if primary else "无显著异常")
            ),
        }

        return {
            "result": result,
            "confidence": round(self.confidence, 3),
            "reasoning": (
                f"成本深度分析：{result['summary']}。"
                + (f"可能原因：{'; '.join(primary['possible_explanations'][:2])}" if primary else "")
            ),
        }


# =============================================================================
# Agent 编排器
# =============================================================================

class AgentOrchestrator:
    """
    Agent编排器 - 两阶段 + 三条路径架构

    第一阶段（确定性体检，无 LLM）：
      build_material → run_baseline → score_deviation → triage

    第二阶段（Agent 诊断，LLM 自主）：
      start_diagnosis → agent_router ↔ execute_diagnostic_tool
      → conclude_diagnosis → wait_human → finalize

    三条路径：
      score < 20  → fast_pass（自动通过）
      20 ≤ score < 60 → 标准诊断 + 人工确认
      score ≥ 60 → 紧急诊断 + 强制确认
    """

    def __init__(self, materials_path: str = "", external_refs_path: str = ""):
        import uuid
        from app.db.database import (
            init_db, get_connection,
            get_all_materials, get_all_external_refs, get_all_benchmarks,
            create_checkpointer,
        )

        # 初始化数据库
        init_db()

        # 从数据库加载数据（使用临时连接，用完即关）
        conn = get_connection()
        try:
            self.materials = get_all_materials(conn)
            ext_refs_list = get_all_external_refs(conn)
            self.external_refs = ext_refs_list
            self.benchmarks = get_all_benchmarks(conn)
        finally:
            conn.close()

        # ===== 第一阶段 Skills（确定性体检） =====
        self.matcher = SimilarityMatcher(self.materials)
        self.predictor = PricePredictor(self.materials)
        self.cost_analyzer = CostAnalyzer(self.benchmarks)
        self.scorer = AnomalyScorer(self.external_refs)
        self.solution_gen = SolutionGenerator()

        # ===== 第二阶段 Skills（Agent 诊断工具） =====
        self.supplier_profiler = SupplierProfiler(self.materials)
        self.peer_comparer = PeerComparer(self.materials)
        self.market_checker = MarketTrendChecker(self.external_refs, self.benchmarks)
        self.urgency_checker = UrgencyChecker()
        self.alternative_finder = AlternativeSupplierFinder(self.materials)
        self.cost_anomaly_analyzer = CostAnomalyAnalyzer()

        # ===== 注册所有工具 =====
        from app.skills.tool_registry import ToolRegistry
        self.registry = ToolRegistry()

        # 第一阶段工具
        self.registry.register(self.matcher)
        self.registry.register(self.predictor)
        self.registry.register(self.cost_analyzer)
        self.registry.register(self.scorer)
        self.registry.register(self.solution_gen)

        # 第二阶段诊断工具
        self.registry.register(self.supplier_profiler)
        self.registry.register(self.peer_comparer)
        self.registry.register(self.market_checker)
        self.registry.register(self.urgency_checker)
        self.registry.register(self.alternative_finder)
        self.registry.register(self.cost_anomaly_analyzer)

        # 初始化 LangGraph Agent（使用 SQLite checkpointer）
        from app.agent.langgraph_agent import build_quote_agent_graph
        self._checkpointer = create_checkpointer()
        self._graph = build_quote_agent_graph(self.registry, self._checkpointer)

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
        处理报价异常检测全流程（两阶段 + 三条路径）

        第一阶段（确定性，无 LLM）：体检 → 分流
        第二阶段（LLM 自主）：偏离 ≥20 进入 Agent 诊断 → 人工确认
        偏离 <20：快速通道自动通过，不调 LLM，不等人
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

        output = self._format_output(result)

        # 持久化到数据库
        from app.db.database import get_db, insert_quote
        with get_db() as conn:
            insert_quote(conn, output)

        return output

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
        rag = dev.get("rag", {}) if dev else {}
        sims = result.get("similar_materials") or []
        sols = result.get("solutions") or []
        diagnosis = result.get("diagnosis_conclusion") or {}
        supplier = result.get("supplier_profile") or {}
        peer = result.get("peer_benchmark") or {}
        market = result.get("market_context") or {}

        trace = result.get("execution_trace", [])
        total_ms = sum(step.get("duration_ms", 0) for step in trace)

        return {
            # ===== 基本信息 =====
            "id": qd.get("id", f"Q-{datetime.now().strftime('%Y%m%d%H%M%S')}"),
            "material_id": qd.get("material_id", ""),
            "material_name": qd.get("material_name", ""),
            "supplier_quote": qd.get("supplier_quote", 0),
            "supplier_name": qd.get("supplier_name", ""),
            "quantity": qd.get("quantity", 0),
            # ===== 价格预测 =====
            "ai_prediction_low": pred.get("p10"),
            "ai_prediction_high": pred.get("p90"),
            "ai_prediction_mid": pred.get("p50"),
            # ===== 第一层偏离度 =====
            "deviation_score": dev.get("deviation_score", 0),
            "severity_level": dev.get("severity_level", "正常"),
            "severity_color": dev.get("severity_color", "#10b981"),
            "price_deviation": dev.get("price_deviation", 0),
            "cost_deviation": dev.get("cost_deviation", 0),
            "market_deviation": dev.get("market_deviation", 0),
            "weights": dev.get("weights", {}),
            # ===== 第二层综合打分 =====
            "composite_score": dev.get("composite_score", dev.get("deviation_score", 0)),
            "external_deviation": dev.get("external_deviation", 0),
            # ===== RAG 外部数据 =====
            "rag_info": {
                "ref_low": rag.get("ref_low", 0),
                "ref_high": rag.get("ref_high", 0),
                "source": rag.get("source", ""),
                "available": rag.get("available", False),
            },
            # ===== 流程阶段 =====
            "phase": result.get("phase", "baseline"),
            "interrupt_severity": result.get("interrupt_severity"),
            "interrupt_reason": result.get("interrupt_reason"),
            # ===== Agent 诊断结果 =====
            "diagnosis_conclusion": diagnosis,
            "diagnosis_investigations": result.get("diagnosis_investigations", []),
            "decision_log": result.get("decision_log", []),
            # ===== 诊断上下文 =====
            "supplier_profile": supplier,
            "peer_benchmark": peer,
            "market_context": market,
            "inventory_context": result.get("inventory_context"),
            "alternatives": result.get("alternatives", []),
            # ===== 方案 =====
            "solutions": sols,
            "llm_summary": result.get("llm_summary"),
            # ===== 成本 & 相似物料 =====
            "cost_breakdown": cost,
            "similar_materials": sims,
            # ===== 执行轨迹 =====
            "execution_trace": trace,
            "total_duration_ms": round(total_ms, 1),
            # ===== 状态 =====
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
    'SupplierProfiler',
    'PeerComparer',
    'MarketTrendChecker',
    'UrgencyChecker',
    'AlternativeSupplierFinder',
    'CostAnomalyAnalyzer',
    'AgentOrchestrator'
]
