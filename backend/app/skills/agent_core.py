"""
Agent核心技能模块
包含：相似物料检索、价格区间预测、成本结构拆解、偏离度打分、方案生成

每个 Skill 继承 Tool 基类，提供统一的 execute() 接口，
可注册到 ToolRegistry 供 Agent 动态发现和调用。
"""

import json
import math
import os
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
        """加载 embedding 模型并预计算所有物料的向量

        默认使用 scikit-learn TF-IDF char n-gram（无额外依赖，中文友好）。
        sentence-transformers 可用时自动升级为语义向量（可选）。
        """
        texts = [self._material_to_text(m) for m in self.materials]
        self._id_to_idx = {m.id: i for i, m in enumerate(self.materials)}

        # 默认: scikit-learn TF-IDF
        from sklearn.feature_extraction.text import TfidfVectorizer
        from sklearn.preprocessing import normalize

        self._vectorizer = TfidfVectorizer(
            analyzer='char_wb', ngram_range=(2, 4), max_features=512,
        )
        tfidf = self._vectorizer.fit_transform(texts)
        self._embeddings = normalize(tfidf, norm='l2').toarray()
        self._embed_model = 'tfidf'
        self.model_loaded = True
        print(f"[SimilarityMatcher] TF-IDF loaded: {self._embeddings.shape[1]}d")

        # 可选: sentence-transformers 语义模型（需要兼容的 PyTorch 版本）
        try:
            from sentence_transformers import SentenceTransformer
            for model_name in [
                'BAAI/bge-small-zh-v1.5',
                'paraphrase-multilingual-MiniLM-L12-v2',
            ]:
                try:
                    self._embed_model = SentenceTransformer(model_name)
                    self._embeddings = self._embed_model.encode(
                        texts, normalize_embeddings=True, show_progress_bar=False,
                    )
                    print(f"[SimilarityMatcher] Upgraded to ST: {self._embed_model.get_sentence_embedding_dimension()}d")
                    return
                except Exception:
                    continue
        except Exception:
            pass  # TF-IDF already loaded, no action needed

    def _material_to_text(self, mat) -> str:
        """将物料序列化为文本，用于 embedding"""
        return (
            f"品类:{mat.category}，材质:{mat.material_type}，"
            f"工艺:{mat.processing}，精度:{mat.precision}，尺寸:{mat.dimensions}"
        )

    # ===== Embedding 模式 =====

    def _find_similar_embedding(self, target: Material, top_k: int) -> List[Dict]:
        """基于余弦相似度的向量检索（支持 ST / TF-IDF）"""
        import numpy as np
        from sklearn.preprocessing import normalize

        target_text = self._material_to_text(target)

        if self._embed_model == 'tfidf':
            tfidf_vec = self._vectorizer.transform([target_text])
            target_vec = normalize(tfidf_vec, norm='l2').toarray()[0]
        else:
            target_vec = self._embed_model.encode(
                [target_text], normalize_embeddings=True,
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
    """价格区间预测 Skill — 层次贝叶斯模型 + 分位数兜底"""

    name = "tool_predict_price_range"
    description = (
        "根据物料的类别、供应商、订单量，用层次贝叶斯模型预测合理价格区间。"
        "模型结构：log_price ~ category_intercept + supplier_random_effect + quantity_discount。"
        "新供应商自动向品类均值收缩，小样本品类后验区间自然加宽。"
        "贝叶斯模型不可用时降级为分位数统计。"
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

        # 始终建分位数模型作为兜底
        self._build_quantile_fallback()

        # 尝试加载/拟合层次贝叶斯模型
        try:
            if self._load_cache():
                self._model_type = "bayesian"
                self.model_loaded = True
            else:
                self._fit_bayesian_model()
                self._save_cache()
                self._model_type = "bayesian"
                self.model_loaded = True
        except Exception as e:
            print(f"[PricePredictor] Bayesian model failed: {e}, using quantile fallback")
            self._model_type = "quantile"

    # ===== 磁盘缓存 =====

    @staticmethod
    def _cache_path() -> str:
        import os
        data_dir = os.path.join(
            os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", "data",
        )
        return os.path.join(data_dir, "bayesian_model_cache.npz")

    def _data_fingerprint(self) -> str:
        """用物料数量和价格哈希判断数据是否变化"""
        import hashlib
        prices = sorted(str(m['unit_price']) for m in self.materials)
        return hashlib.md5(f"{len(self.materials)}:{','.join(prices)}".encode()).hexdigest()

    def _save_cache(self) -> None:
        import numpy as np
        import os
        params = self._bayes_params
        os.makedirs(os.path.dirname(self._cache_path()), exist_ok=True)
        np.savez(
            self._cache_path(),
            alpha_cat=params['alpha_cat'],
            beta_supp=params['beta_supp'],
            gamma=np.array(params['gamma']),
            sigma=np.array(params['sigma']),
            sigma_cat=np.array(params['sigma_cat']),
            sigma_supp=np.array(params['sigma_supp']),
            mu_global=np.array(params['mu_global']),
            log_qty_mean=np.array(params['log_qty_mean']),
            n_obs=np.array(params['n_obs']),
            cat_labels=np.array(self._cat_labels),
            supp_labels=np.array(self._supp_labels),
            fingerprint=np.array(self._data_fingerprint()),
        )
        print(f"[PricePredictor] Cache saved to {self._cache_path()}")

    def _load_cache(self) -> bool:
        import numpy as np
        import os
        path = self._cache_path()
        if not os.path.exists(path):
            print(f"[PricePredictor] No cache found, training needed")
            return False

        try:
            data = np.load(path, allow_pickle=True)
            if str(data['fingerprint']) != self._data_fingerprint():
                print(f"[PricePredictor] Data changed, retraining needed")
                return False

            self._bayes_params = {
                'alpha_cat': data['alpha_cat'],
                'beta_supp': data['beta_supp'],
                'gamma': float(data['gamma']),
                'sigma': float(data['sigma']),
                'sigma_cat': float(data['sigma_cat']),
                'sigma_supp': float(data['sigma_supp']),
                'mu_global': float(data['mu_global']),
                'log_qty_mean': float(data['log_qty_mean']),
                'n_obs': int(data['n_obs']),
            }
            self._cat_labels = list(data['cat_labels'])
            self._supp_labels = list(data['supp_labels'])
            self._cat_to_idx = {c: i for i, c in enumerate(self._cat_labels)}
            self._supp_to_idx = {s: i for i, s in enumerate(self._supp_labels)}
            print(f"[PricePredictor] Cache loaded: {self._bayes_params['n_obs']} obs, "
                  f"{len(self._cat_labels)} categories, {len(self._supp_labels)} suppliers")
            return True
        except Exception as e:
            print(f"[PricePredictor] Cache load failed: {e}, retraining needed")
            return False

    # ===== 层次贝叶斯模型 =====

    def _fit_bayesian_model(self) -> None:
        import numpy as np
        import pymc as pm

        # 编码分类变量
        cats = sorted(set(m['category'] for m in self.materials))
        supps = sorted(set(m.get('supplier_name', '') for m in self.materials))
        self._cat_to_idx = {c: i for i, c in enumerate(cats)}
        self._supp_to_idx = {s: i for i, s in enumerate(supps)}
        self._cat_labels = cats
        self._supp_labels = supps

        n = len(self.materials)
        cat_idx = np.array([self._cat_to_idx[m['category']] for m in self.materials])
        supp_idx = np.array([self._supp_to_idx.get(m.get('supplier_name', ''), 0) for m in self.materials])
        log_qty = np.array([np.log(max(m.get('order_quantity', 10000), 1)) for m in self.materials])
        log_qty_mean = log_qty.mean()
        log_qty_c = log_qty - log_qty_mean
        log_price = np.array([np.log(max(m['unit_price'], 0.01)) for m in self.materials])

        n_cats = len(cats)
        n_supps = len(supps)

        with pm.Model() as model:
            # 全局均值
            mu_global = pm.Normal('mu_global', mu=np.log(np.median([m['unit_price'] for m in self.materials])), sigma=2)

            # 品类级随机截距（向全局均值收缩）
            sigma_cat = pm.HalfNormal('sigma_cat', sigma=1)
            alpha_cat_offset = pm.Normal('alpha_cat_offset', mu=0, sigma=1, shape=n_cats)
            alpha_cat = pm.Deterministic('alpha_cat', mu_global + alpha_cat_offset * sigma_cat)

            # 供应商随机效应（向 0 收缩）
            sigma_supp = pm.HalfNormal('sigma_supp', sigma=0.5)
            beta_supp = pm.Normal('beta_supp', mu=0, sigma=sigma_supp, shape=n_supps)

            # 数量折扣弹性（对数-对数，预期 -0.03 ~ -0.08）
            gamma = pm.Normal('gamma', mu=-0.05, sigma=0.1)

            # 残差
            sigma = pm.HalfNormal('sigma', sigma=0.5)

            # 线性预测
            mu = alpha_cat[cat_idx] + beta_supp[supp_idx] + gamma * log_qty_c

            # 似然
            pm.Normal('obs', mu=mu, sigma=sigma, observed=log_price)

            # MCMC 采样
            trace = pm.sample(
                draws=1000, tune=1000, chains=2,
                target_accept=0.9, progressbar=False,
            )

        # 缓存后验均值
        self._bayes_params = {
            'alpha_cat': trace.posterior['alpha_cat'].mean(dim=('chain', 'draw')).values,
            'beta_supp': trace.posterior['beta_supp'].mean(dim=('chain', 'draw')).values,
            'gamma': float(trace.posterior['gamma'].mean()),
            'sigma': float(trace.posterior['sigma'].mean()),
            'sigma_cat': float(trace.posterior['sigma_cat'].mean()),
            'sigma_supp': float(trace.posterior['sigma_supp'].mean()),
            'mu_global': float(trace.posterior['mu_global'].mean()),
            'log_qty_mean': float(log_qty_mean),
            'n_obs': n,
        }
        print(f"[PricePredictor] Bayesian model fitted: {n} obs, {n_cats} categories, {n_supps} suppliers")

    def _predict_bayesian(self, material: Dict) -> Dict[str, float]:
        """用后验参数做点推断（毫秒级）"""
        import numpy as np
        params = self._bayes_params

        cat = material.get('category', '')
        supp = material.get('supplier_name', '')
        qty = material.get('quantity', material.get('order_quantity', 10000))

        # 品类截距（未知品类 → 全局均值）
        cat_idx = self._cat_to_idx.get(cat)
        alpha = float(params['alpha_cat'][cat_idx]) if cat_idx is not None else params['mu_global']

        # 供应商效应（未知供应商 → 0，即完全收缩到品类均值）
        supp_idx = self._supp_to_idx.get(supp)
        beta = float(params['beta_supp'][supp_idx]) if supp_idx is not None else 0.0

        # 数量效应
        gamma = params['gamma']
        qty_effect = gamma * (np.log(max(qty, 1)) - params['log_qty_mean'])

        # 预测 log_price
        mu_log = alpha + beta + qty_effect

        # 不确定性：已知供应商低，新供应商高
        pred_sd = params['sigma'] if supp_idx is not None else \
            float(np.sqrt(params['sigma']**2 + params['sigma_supp']**2))

        p50 = round(float(np.exp(mu_log)), 2)
        p10 = round(float(np.exp(mu_log - 1.28 * pred_sd)), 2)
        p90 = round(float(np.exp(mu_log + 1.28 * pred_sd)), 2)

        # 置信度：品类数据量越多置信度越高
        n_cat = sum(1 for m in self.materials if m['category'] == cat)
        confidence = round(0.70 + 0.15 * min(n_cat / 30, 1.0), 2)

        return {
            'p10': max(p10, 0.01), 'p50': p50, 'p90': p90,
            'confidence': confidence,
            'model': 'bayesian',
        }

    # ===== 分位数兜底 =====

    def _build_quantile_fallback(self):
        self._cat_prices: Dict[str, List[float]] = {}
        for mat in self.materials:
            cat = mat['category']
            if cat not in self._cat_prices:
                self._cat_prices[cat] = []
            self._cat_prices[cat].append(mat['unit_price'])

    def _predict_quantile(self, material: Dict) -> Dict[str, float]:
        cat = material.get('category', '其他')
        prices = self._cat_prices.get(cat, [])
        if not prices:
            return {'p10': 0, 'p50': 0, 'p90': 0, 'confidence': 0.50, 'model': 'quantile'}

        prices_sorted = sorted(prices)
        n = len(prices_sorted)
        p10 = prices_sorted[max(0, int(n * 0.1))]
        p50 = prices_sorted[max(0, int(n * 0.5))]
        p90 = prices_sorted[min(n - 1, int(n * 0.9))]

        qty = material.get('quantity', 10000)
        qty_factor = 1 + (10000 - qty) / 100000

        return {
            'p10': round(p10 * qty_factor, 2),
            'p50': round(p50 * qty_factor, 2),
            'p90': round(p90 * qty_factor, 2),
            'confidence': round(0.65 + 0.1 * min(n / 20, 1.0), 2),
            'model': 'quantile',
        }

    def predict(self, material: Dict) -> Dict[str, float]:
        if self._model_type == "bayesian":
            return self._predict_bayesian(material)
        return self._predict_quantile(material)

    # ===== Tool 接口 =====

    def execute(self, material_id: str, quantity: int = 10000,
                category: str = None, processing: str = None,
                unit_price: float = None, **kwargs) -> Dict[str, Any]:
        """Tool 接口：预测价格区间"""
        matched = next((m for m in self.materials if m['id'] == material_id), None)

        if matched is None:
            if category:
                mat = {
                    'category': category, 'supplier_name': kwargs.get('supplier_name', ''),
                    'quantity': quantity, 'order_quantity': quantity,
                }
                result = self.predict(mat)
                n_cat = len(self._cat_prices.get(category, []))
                return {
                    "result": result,
                    "confidence": round(result.get('confidence', 0.6), 3),
                    "reasoning": (
                        f"[{self._model_type}] 类别 {category} 有 {n_cat} 条记录，"
                        f"预测区间 [P10=¥{result['p10']}, P50=¥{result['p50']}, P90=¥{result['p90']}]"
                    ),
                }
            return {
                "result": {},
                "confidence": 0.0,
                "reasoning": f"物料ID {material_id} 在历史库中未找到，且无 category 可用",
            }

        mat = {
            **matched, 'quantity': quantity, 'order_quantity': quantity,
            'supplier_name': matched.get('supplier_name', ''),
        }
        result = self.predict(mat)
        n_cat = len(self._cat_prices.get(matched['category'], []))

        return {
            "result": result,
            "confidence": round(result.get('confidence', 0.6), 3),
            "reasoning": (
                f"[{self._model_type}] 类别 {matched['category']} 有 {n_cat} 条记录，"
                f"预测区间 [P10=¥{result['p10']}, P50=¥{result['p50']}, P90=¥{result['p90']}]，"
                f"工艺={matched.get('processing', '未知')}，数量={quantity}"
            ),
        }


class CostAnalyzer(Tool):
    """成本结构拆解 Skill — 贝叶斯合理价锚定 + 原材料市场交叉验证"""

    name = "tool_analyze_cost_structure"
    description = (
        "将供应商报价拆解为 原材料/加工费/表面处理/包装物流/管理利润 五个成本项。"
        "以贝叶斯模型预测的合理价（P50）为锚点计算各项基准金额，"
        "再与供应商报价隐含金额对比。"
        "原材料项可与外部市场参考价交叉验证，其他项标注为参考值。"
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

    def __init__(self, benchmarks: Dict, external_refs: List[Dict] = None):
        self.benchmarks = benchmarks
        # 外部市场参考缓存在内存，但每次 execute 会从 DB 重读以获取最新数据
        self._market_refs: Dict[str, Dict] = {}
        if external_refs:
            for ref in external_refs:
                self._market_refs[ref.get('material_category', '')] = ref

    def _refresh_market_refs(self) -> None:
        """从数据库重新加载市场参考数据（获取最新的联网刷新结果）"""
        try:
            from app.db.database import get_connection
            conn = get_connection()
            try:
                rows = conn.execute(
                    "SELECT * FROM external_references"
                ).fetchall()
                for row in rows:
                    d = dict(row)
                    self._market_refs[d['material_category']] = d
            finally:
                conn.close()
        except Exception:
            pass  # DB 不可用时保持内存缓存

    def analyze(self, material: Dict, quote: float, prediction_p50: float = None) -> Dict:
        """
        成本结构参照分析。

        以贝叶斯合理价 P50 为锚点：
          - 合理价 × 基准% = 合理各项金额（anchor）
          - 供应商报价 × 基准% = 隐含各项金额（what supplier is asking）
          - 偏离 = (隐含 - 合理) / 合理 × 100%

        原材料可独立交叉验证市场行情，其他项标注为参考值。
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

        # 锚点价格：优先用贝叶斯 P50，否则用供应商报价
        anchor = prediction_p50 if prediction_p50 else quote
        has_anchor = prediction_p50 is not None

        cost_items = []
        anomaly_count = 0
        total_deviation = 0.0

        for item_name, pct_key in [
            ('原材料', 'raw_material_pct'),
            ('加工费', 'processing_pct'),
            ('表面处理', 'surface_treatment_pct'),
            ('包装物流', 'packaging_pct'),
            ('管理+利润', 'management_profit_pct')
        ]:
            benchmark_pct = adjusted.get(pct_key, 0)
            reasonable_amount = round(anchor * benchmark_pct / 100, 2)
            implied_amount = round(quote * benchmark_pct / 100, 2)
            deviation = round((implied_amount - reasonable_amount) / reasonable_amount * 100, 1) if reasonable_amount > 0 else 0

            # 只有原材料能交叉验证市场数据
            if item_name == '原材料' and has_anchor:
                market_check = self._check_against_market(category, implied_amount, reasonable_amount)
                status = market_check['status']
                data_source = market_check['source']
                if market_check['is_anomalous']:
                    anomaly_count += 1
                    total_deviation += abs(deviation)
            elif has_anchor:
                # 其他项：有锚点可算偏离，但无法独立验证
                if deviation > 30:
                    status = "可能偏高"
                    anomaly_count += 1
                    total_deviation += deviation
                elif deviation < -30:
                    status = "可能偏低"
                else:
                    status = "参考值"
                data_source = f"行业基准（锚点=¥{anchor:.2f}）"
            else:
                status = "参考值"
                data_source = "行业基准（无锚点）"

            cost_items.append({
                'item': item_name,
                'benchmark_pct': benchmark_pct,
                'reasonable_amount': reasonable_amount,   # 合理价下的金额
                'implied_amount': implied_amount,         # 供应商报价隐含金额
                'deviation_from_reasonable': deviation,
                'status': status,
                'data_source': data_source,
                'independently_verified': item_name == '原材料' and has_anchor,
            })

        data_quality = "with_anchor" if has_anchor else "reference_only"
        cost_deviation_score = round(min(100, total_deviation / max(anomaly_count, 1)), 1) if anomaly_count > 0 else 0

        return {
            'cost_items': cost_items,
            'benchmark_key': benchmark_key,
            'data_quality': data_quality,
            'anchor_price': anchor,
            'anchor_source': '贝叶斯P50' if has_anchor else '供应商报价（无合理价预测）',
            'cost_deviation_score': cost_deviation_score if has_anchor else None,
            'anomaly_count': anomaly_count,
            'note': (
                f"以{'贝叶斯合理价 ¥' + str(anchor) if has_anchor else '供应商报价'}为锚点计算各项基准。"
                "原材料可独立交叉验证市场数据，其余项为行业基准参照。"
            ),
        }

    def _check_against_market(self, category: str, implied_amount: float,
                               reasonable_amount: float) -> Dict:
        """原材料成本交叉验证市场行情 + 合理价偏离"""
        ref = self._market_refs.get(category)
        if not ref:
            return {'status': '参考值（无市场数据）', 'source': '行业基准', 'is_anomalous': False}

        low, high = ref.get('price_low', 0), ref.get('price_high', 0)
        source = ref.get('source', '未知')

        if high <= 0:
            return {'status': '参考值（市场数据无效）', 'source': source, 'is_anomalous': False}

        # 判断合理价锚点是否在市场范围内
        anchor_ok = low <= reasonable_amount <= high

        # 供应商隐含金额 vs 市场区间
        if implied_amount > high * 1.3:
            status = '明显偏高'
            is_anomalous = True
        elif implied_amount > high:
            status = '略高于市场'
            is_anomalous = True
        elif implied_amount < low * 0.7:
            status = '明显偏低'
            is_anomalous = True
        elif implied_amount < low:
            status = '略低于市场'
            is_anomalous = False
        else:
            status = '在市场范围内'
            is_anomalous = False

        # 补充偏离合理价的提示
        deviation_from_anchor = (implied_amount - reasonable_amount) / reasonable_amount * 100 if reasonable_amount > 0 else 0
        if deviation_from_anchor > 50 and not is_anomalous:
            status += f'，但偏离合理锚点 {deviation_from_anchor:.0f}%（总价偏高驱动，非原材料独立异常）'

        return {
            'status': status,
            'source': f'{source}（市场 ¥{low:.1f}~¥{high:.1f}）',
            'is_anomalous': is_anomalous,
            'detail': (
                f"供应商隐含原材料 ¥{implied_amount:.1f} vs 市场 ¥{low:.1f}~¥{high:.1f}"
                f"（{'✓' if anchor_ok else '✗'}合理锚点 ¥{reasonable_amount:.1f}{'在市场内' if anchor_ok else '不在市场内'}）"
            ),
        }

    def _get_benchmark_key(self, category: str) -> str:
        mapping = {
            '塑料外壳': 'plastic_injection',
            'PCB板': 'pcb',
            '传感器': 'sensor',
            '按键': 'silicone',
            '袖带': 'cuff',
            '显示屏': 'display_module',
            '电池': 'battery_pack',
            '连接器': 'metal_connector',
        }
        return mapping.get(category, 'plastic_injection')

    def _adjust_benchmark(self, benchmark: Dict, material: Dict) -> Dict:
        adjusted = benchmark.copy()
        processing = material.get('processing', '')
        material_type = material.get('material_type', '')
        if '沉金' in processing:
            adjusted['surface_treatment_pct'] = 20
            adjusted['raw_material_pct'] = 22
        elif 'COB' in processing:
            adjusted['processing_pct'] = 35
        elif '电镀' in processing:
            adjusted['surface_treatment_pct'] = max(12, adjusted.get('surface_treatment_pct', 0))

        if material_type in {'OLED', 'TFT彩屏'}:
            adjusted['raw_material_pct'] = max(62, adjusted.get('raw_material_pct', 0))
            adjusted['processing_pct'] = max(16, adjusted.get('processing_pct', 0))
        elif material_type in {'锂聚合物', '锂离子18650'}:
            adjusted['raw_material_pct'] = max(70, adjusted.get('raw_material_pct', 0))
            adjusted['management_profit_pct'] = min(12, adjusted.get('management_profit_pct', 0))
        return adjusted

    def execute(self, material_id: str, supplier_quote: float,
                category: str = None, processing: str = None, **kwargs) -> Dict[str, Any]:
        """Tool 接口：成本结构参照分析（支持贝叶斯锚点 + 自动刷新行情）"""
        mat_category = category or "塑料外壳"
        mat = {"id": material_id, "category": mat_category, "processing": processing or ""}

        # 从 DB 刷新市场参考数据（获取 Phase 1.5 联网更新的最新行情）
        self._refresh_market_refs()

        # 从 kwargs 取贝叶斯 P50 作为锚点
        prediction_p50 = kwargs.get('prediction_p50')

        result = self.analyze(mat, supplier_quote, prediction_p50=prediction_p50)

        anomaly_count = result.get('anomaly_count', 0)
        data_quality = result.get('data_quality', 'reference_only')

        return {
            "result": result,
            "confidence": round(
                self.confidence * (0.85 if data_quality == 'with_anchor' else 0.60)
                * (0.9 ** anomaly_count), 3
            ),
            "reasoning": (
                f"基准={result['benchmark_key']}，锚点={result['anchor_source']}，"
                f"异常项={anomaly_count}，原材料交叉验证={'已完成' if result['cost_items'][0].get('independently_verified') else '未完成'}。"
                f"{result.get('note', '')}"
            ),
        }


class MarketPriceLookup(Tool):
    """实时市场行情查询 — LLM 驱动 + DB 缓存"""

    name = "tool_search_market_price"
    description = (
        "搜索原材料和品类的当前市场价格行情。"
        "输入物料品类和材质，返回市场价格区间、近期趋势、信息来源。"
        "用于验证供应商报价是否受市场行情驱动，或判断原材料成本是否合理。"
        "当怀疑原材料行情波动导致报价偏高时调用此工具。"
    )
    input_schema = {
        "type": "object",
        "properties": {
            "material_category": {"type": "string", "description": "物料品类（如 塑料外壳、PCB板）"},
            "material_type": {"type": "string", "description": "材质类型（如 ABS、FR-4），可选"},
        },
        "required": ["material_category"],
    }
    confidence = 0.72
    model_loaded = False

    def __init__(self):
        self._api_key = os.environ.get("KIMI_API_KEY", "")
        self._base_url = os.environ.get("KIMI_BASE_URL", "https://ai-gateway.ailab.jiuan.com/v1")
        self._model = os.environ.get("KIMI_MODEL", "kimi-k2.5")

    def execute(self, material_category: str, material_type: str = None,
                **kwargs) -> Dict[str, Any]:
        """查询市场行情（LLM 知识 + DB 缓存）"""
        import json as _json

        # 先查 DB 缓存
        db_result = self._check_db_cache(material_category, material_type)
        if db_result and db_result.get('fresh'):
            return db_result

        # 调用 LLM 获取市场行情
        if self._api_key:
            llm_result = self._query_llm(material_category, material_type)
            # 写入 DB 缓存
            if llm_result.get('available'):
                self._save_to_db(material_category, material_type, llm_result)
            # 联网返回空价格时回退到 DB 缓存
            data = llm_result.get('result', {})
            if (data.get('price_low') in (None, 0) or data.get('price_high') in (None, 0)) and db_result:
                cached = db_result.get('result', {})
                data['price_low'] = cached.get('price_low') or data.get('price_low')
                data['price_high'] = cached.get('price_high') or data.get('price_high')
                data['source'] = cached.get('source', 'DB缓存')
                data['note'] = (data.get('note', '') + ' | 联网无有效价格，回退缓存').strip(' |')
                llm_result['confidence'] = max(llm_result['confidence'], db_result.get('confidence', 0.45))
            return llm_result

        # LLM 不可用时返回 DB 数据（即使不新鲜也比没有好）
        if db_result:
            db_result['result']['freshness'] = 'stale'
            return db_result

        return {
            "result": {"available": False, "message": "无法查询市场行情（LLM 不可用且无缓存）"},
            "confidence": 0.2,
            "reasoning": "无法获取市场行情数据",
        }

    def _query_llm(self, category: str, material_type: str = None) -> Dict[str, Any]:
        """DuckDuckGo 搜索 + Kimi 提取结构化行情数据"""
        import json as _json
        import httpx
        from openai import OpenAI

        type_hint = f" {material_type}" if material_type else ""
        search_query = f"{category}{type_hint} 采购价格 行情 2025"

        # Step 1: 联网搜索
        search_snippets = self._web_search(search_query)

        # Step 2: Kimi 从搜索结果中提取结构化数据
        if search_snippets:
            context = "\n".join(f"- {s}" for s in search_snippets[:8])
            prompt = f"""根据以下搜索结果，提取{category}{type_hint}的当前市场行情。注意区分原材料价格（元/吨、元/kg）和成品价格（元/件），优先提取成品采购价。返回 JSON：

搜索结果：
{context}

返回格式：
{{"price_low": 价格下限数字, "price_high": 价格上限数字, "unit": "元/件",
  "trend": "上涨/稳定/下跌", "trend_detail": "趋势说明",
  "source": "数据来源", "confidence": 0.0-1.0, "note": "价格说明"}}

价格提取规则（按优先级）：
1. 成品采购价（元/件）最优
2. 如只有原材料价（元/kg、元/吨），在note注明原料价，price_low/high填原料价，unit填对应单位
3. 如只有趋势无具体价格，price_low/high填0，confidence=0.3
4. 完全无有效信息时 confidence=0.2
价格必须为数字，不能为null。
只返回 JSON。"""
        else:
            # 无搜索结果，用 LLM 知识兜底
            prompt = f"""请查询{category}{type_hint}的当前市场行情。返回 JSON（不要其他内容）：

{{"price_low": 最低市场价（元/件）, "price_high": 最高市场价（元/件）, "unit": "计价单位",
  "trend": "上涨/稳定/下跌", "trend_detail": "趋势说明", "source": "LLM知识库",
  "confidence": 0.0-1.0, "note": "无联网数据，基于训练知识估计"}}

只返回 JSON。"""

        try:
            client = OpenAI(
                api_key=self._api_key,
                base_url=self._base_url,
                timeout=httpx.Timeout(20.0, connect=5.0),
            )
            response = client.chat.completions.create(
                model=self._model,
                messages=[{"role": "user", "content": prompt}],
                temperature=0.2,
                max_tokens=400,
            )
            content = response.choices[0].message.content or ""
            content = content.strip()
            if content.startswith("```"):
                content = content.split("\n", 1)[1].rsplit("\n", 1)[0]
            data = _json.loads(content)

            price_low_val = data.get("price_low", 0)
            price_high_val = data.get("price_high", 0)

            # 价格为空时填 0，由 execute 层做 DB 回退
            return {
                "result": {
                    "available": True,
                    "category": category,
                    "material_type": material_type or "全部",
                    "price_low": price_low_val,
                    "price_high": price_high_val,
                    "unit": data.get("unit", "元/件"),
                    "trend": data.get("trend", "未知"),
                    "trend_detail": data.get("trend_detail", ""),
                    "source": data.get("source", "LLM知识库"),
                    "confidence": data.get("confidence", 0.7),
                    "note": data.get("note", ""),
                    "query_time": datetime.now().isoformat(),
                    "searched": bool(search_snippets),
                },
                "confidence": round(data.get("confidence", 0.7), 3),
                "reasoning": (
                    f"{category} 市场行情：¥{data.get('price_low', '?')}~¥{data.get('price_high', '?')}"
                    f"（{data.get('trend', '未知')}），来源：{data.get('source', 'LLM')}"
                ),
            }
        except Exception as e:
            print(f"[MarketPriceLookup] LLM query failed: {e}")
            return {
                "result": {"available": False, "message": f"查询失败: {e}"},
                "confidence": 0.0,
                "reasoning": f"市场行情查询失败: {e}",
            }

    def _web_search(self, query: str, max_results: int = 8) -> List[str]:
        """DuckDuckGo 搜索，返回文本摘要列表"""
        try:
            from ddgs import DDGS
            with DDGS() as ddgs:
                results = list(ddgs.text(query, max_results=max_results))
                snippets = []
                for r in results:
                    title = (r.get('title') or '')[:100]
                    body = (r.get('body') or '')[:200]
                    if body:
                        snippets.append(f"{title}: {body}")
                return snippets
        except Exception as e:
            print(f"[MarketPriceLookup] Web search failed: {e}")
            return []

    def _check_db_cache(self, category: str, material_type: str = None) -> Optional[Dict[str, Any]]:
        """检查数据库缓存（24 小时内有效）"""
        try:
            from app.db.database import get_connection
            conn = get_connection()
            try:
                row = conn.execute(
                    """SELECT * FROM external_references
                       WHERE material_category = ?
                       ORDER BY updated_at DESC LIMIT 1""",
                    (category,),
                ).fetchone()
                if not row:
                    return None

                d = dict(row)
                updated = d.get('updated_at', '')
                fresh = False
                if updated:
                    try:
                        age = (datetime.now() - datetime.fromisoformat(updated)).total_seconds()
                        fresh = age < 86400  # 24 小时
                    except (ValueError, TypeError):
                        pass

                return {
                    "result": {
                        "available": True,
                        "category": category,
                        "material_type": material_type or "全部",
                        "price_low": d['price_low'],
                        "price_high": d['price_high'],
                        "source": d.get('source', 'DB缓存'),
                        "trend": "未知（缓存数据）",
                        "freshness": "fresh" if fresh else "stale",
                        "query_time": updated,
                    },
                    "confidence": 0.65 if fresh else 0.45,
                    "reasoning": (
                        f"{category} 行情（{'24h内缓存' if fresh else '历史缓存'}）："
                        f"¥{d['price_low']}~¥{d['price_high']}，来源：{d.get('source', '')}"
                    ),
                }
            finally:
                conn.close()
        except Exception:
            return None

    def _save_to_db(self, category: str, material_type: str,
                    result: Dict[str, Any]) -> None:
        """将查询结果写入数据库缓存（仅当有有效价格时）"""
        data = result.get('result', {})
        price_low = data.get('price_low')
        price_high = data.get('price_high')

        # 无有效价格不覆盖旧数据
        if price_low is None or price_high is None:
            return

        try:
            from app.db.database import get_connection
            conn = get_connection()
            try:
                conn.execute(
                    """INSERT OR REPLACE INTO external_references
                       (material_category, price_low, price_high, source, sample_count, updated_at)
                       VALUES (?, ?, ?, ?, ?, datetime('now'))""",
                    (
                        category,
                        price_low,
                        price_high,
                        f"{data.get('source', 'LLM')} | {data.get('trend_detail', '')}",
                        data.get('confidence', 70),
                    ),
                )
                conn.commit()
            finally:
                conn.close()
        except Exception as e:
            print(f"[MarketPriceLookup] DB save failed: {e}")


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
        self._rag = ExternalRAGRetriever(list(self.external_refs.values()))

    def _refresh_external_refs(self) -> None:
        """从数据库重载外部参考数据（获取 Phase 1.5 联网刷新后的最新行情）"""
        try:
            from app.db.database import get_connection
            conn = get_connection()
            try:
                rows = conn.execute("SELECT * FROM external_references").fetchall()
                refs = [dict(row) for row in rows]
                self.external_refs = {ref['material_category']: ref for ref in refs}
                self._rag = ExternalRAGRetriever(refs)
            finally:
                conn.close()
        except Exception:
            pass

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
        """Tool 接口：计算偏离度（自动刷新外部数据）"""
        # 从 DB 重载最新行情数据（Phase 1.5 联网刷新的结果）
        self._refresh_external_refs()

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
        quantity = int(quote.get('quantity', 0) or 0)
        supplier_ctx = quote.get('supplier_profile') or {}
        inventory_ctx = quote.get('inventory_context') or {}
        peer_ctx = quote.get('peer_benchmark') or {}
        alternatives = quote.get('alternatives') or []
        cost_ctx = quote.get('cost_analysis') or {}
        urgency = inventory_ctx.get('urgency', '未知')
        can_negotiate = inventory_ctx.get('can_negotiate', True)
        days_remaining = inventory_ctx.get('days_remaining')
        risk_level = supplier_ctx.get('risk_level', '低')
        premium = peer_ctx.get('current_premium_pct')
        anomaly_count = cost_ctx.get('anomaly_count', 0)
        ai_mid = quote.get('ai_prediction_mid') or quote['supplier_quote'] * 0.9

        def money(value: float) -> str:
            return f"¥{value:,.0f}"

        def savings(target_price: float) -> str:
            if quantity <= 0:
                return '待测算'
            return money(max(0, (quote['supplier_quote'] - target_price) * quantity))

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
            urgent_target = max(ai_mid, quote['supplier_quote'] * 0.9)
            if urgency in {'紧急', '关注'} and not can_negotiate:
                window_text = f"{days_remaining}天" if days_remaining is not None else "短窗口"
                solutions.append({
                    'id': f"SOL-{quote['id']}-A",
                    'title': '保供采购+限时议价',
                    'description': (
                        f"库存窗口仅{window_text}，应先锁定供货避免断供，同时以¥{urgent_target:.2f}为底线目标进行限时议价。"
                        f" 当前供应商风险：{supplier_ctx.get('risk_assessment', '待确认')}。"
                    ),
                    'confidence': 0.91,
                    'estimated_savings': savings(urgent_target),
                    'action': 'secure_supply'
                })
            else:
                solutions.append({
                    'id': f"SOL-{quote['id']}-A",
                    'title': '直接议价',
                    'description': (
                        f"当前报价¥{quote['supplier_quote']}明显偏高，建议以¥{ai_mid:.2f}为目标强议价。"
                        + (f" 同行溢价约{premium:.0f}%。" if premium is not None else "")
                    ),
                    'confidence': 0.86,
                    'estimated_savings': savings(ai_mid),
                    'action': 'negotiate'
                })

            requote_desc = (
                f"建议优先联系备选供应商 {alternatives[0].get('supplier_name', '')} 进行二次询价。"
                if alternatives else
                "建议同步向2-3家同类供应商发起二次询价，验证当前报价是否存在系统性溢价。"
            )
            solutions.append({
                'id': f"SOL-{quote['id']}-B",
                'title': '启动备选询价',
                'description': requote_desc,
                'confidence': 0.78 if alternatives else 0.72,
                'estimated_savings': '待询价',
                'action': 'requote'
            })

            escalation_signals = []
            if risk_level in {'高', '极高'}:
                escalation_signals.append(f"供应商风险{risk_level}")
            if anomaly_count >= 2:
                escalation_signals.append('成本结构异常项较多')
            if urgency in {'紧急', '关注'}:
                escalation_signals.append(f"库存{urgency}")
            solutions.append({
                'id': f"SOL-{quote['id']}-C",
                'title': '升级审批',
                'description': f"{'；'.join(escalation_signals) or f'偏离度{score}分'}，建议上报采购经理或供应链负责人专项评审。",
                'confidence': 0.90,
                'estimated_savings': '需评审',
                'action': 'escalate'
            })

        elif severity in ['关注', '警示']:
            if deviation.get('price_deviation', 0) > 0:
                if urgency in {'紧急', '关注'} and not can_negotiate:
                    solutions.append({
                        'id': f"SOL-{quote['id']}-A",
                        'title': '先保供后追价',
                        'description': (
                            f"库存{urgency}，当前不适合因议价拖延交付。建议先确认交期并下保供订单，"
                            f"后续以¥{max(ai_mid, quote['supplier_quote'] * 0.92):.2f}附近重新追价。"
                        ),
                        'confidence': 0.84,
                        'estimated_savings': savings(max(ai_mid, quote['supplier_quote'] * 0.92)),
                        'action': 'secure_then_negotiate'
                    })
                else:
                    solutions.append({
                        'id': f"SOL-{quote['id']}-A",
                        'title': '议价谈判',
                        'description': (
                            f"报价¥{quote['supplier_quote']}高于AI预测区间，建议以¥{ai_mid:.2f}为目标价开展议价。"
                            + (f" 同行溢价约{premium:.0f}%。" if premium is not None else "")
                        ),
                        'confidence': 0.82,
                        'estimated_savings': savings(ai_mid),
                        'action': 'negotiate'
                    })
            else:
                solutions.append({
                    'id': f"SOL-{quote['id']}-A",
                    'title': '低价真实性核验',
                    'description': (
                        f"报价¥{quote['supplier_quote']}低于AI预测区间，需核实报价单位、BOM完整性和关键工艺是否遗漏，"
                        "避免后续质量或交付风险。"
                    ),
                    'confidence': 0.81,
                    'estimated_savings': '风险规避',
                    'action': 'verify'
                })

            if risk_level in {'高', '极高'}:
                solutions.append({
                    'id': f"SOL-{quote['id']}-B",
                    'title': '供应商风险复核',
                    'description': (
                        f"该供应商画像显示 {supplier_ctx.get('risk_assessment', '存在风险信号')}，"
                        f"建议采用 {supplier_ctx.get('recommended_procurement_mode', '补充审批和成本拆解')}。"
                    ),
                    'confidence': 0.79,
                    'estimated_savings': '降低误采风险',
                    'action': 'review_supplier'
                })
            elif similar_materials:
                solutions.append({
                    'id': f"SOL-{quote['id']}-B",
                    'title': '历史对比',
                    'description': f"参考历史相似物料价格：{similar_materials[0]['name']} ¥{similar_materials[0]['price']}（相似度{similar_materials[0]['similarity']}）",
                    'confidence': 0.75,
                    'estimated_savings': '参考对比',
                    'action': 'compare'
                })

            if alternatives and len(solutions) < 3:
                solutions.append({
                    'id': f"SOL-{quote['id']}-C",
                    'title': '备选供应商验证',
                    'description': f"可同步联系备选供应商 {alternatives[0].get('supplier_name', '其他供方')}，用真实询价验证当前价格是否具备市场竞争力。",
                    'confidence': 0.74,
                    'estimated_savings': '待询价',
                    'action': 'requote'
                })

        return solutions[:3]

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
        quote = {
            "id": quote_id,
            "supplier_quote": supplier_quote,
            "quantity": kwargs.get("quantity", 10000),
            "supplier_profile": kwargs.get("supplier_profile", {}),
            "inventory_context": kwargs.get("inventory_context", {}),
            "peer_benchmark": kwargs.get("peer_benchmark", {}),
            "market_context": kwargs.get("market_context", {}),
            "alternatives": kwargs.get("alternatives", []),
            "cost_analysis": kwargs.get("cost_analysis", {}),
            "ai_prediction_mid": kwargs.get("ai_prediction_mid"),
            "ai_prediction_high": kwargs.get("ai_prediction_high"),
        }

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
    """供应商画像查询 — materials 采购历史 + quotes 分析记录"""

    name = "tool_get_supplier_profile"
    description = (
        "查询指定供应商的完整画像：采购历史 + 偏离分析记录。"
        "返回：采购次数、均价、价格趋势、历史偏离均值、异常频率、"
        "最近报价是否持续异常。"
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

    def execute(self, supplier_name: str, material_category: str = None,
                **kwargs) -> Dict[str, Any]:
        records = self._by_supplier.get(supplier_name, [])
        if not records:
            return {
                "result": {"available": False, "supplier_name": supplier_name,
                           "message": "无该供应商的历史记录"},
                "confidence": 0.3,
                "reasoning": f"供应商 {supplier_name} 无历史采购记录，无法建立画像",
            }

        if material_category:
            records = [r for r in records if r.get("category") == material_category]
        if not records:
            return {
                "result": {"available": False, "supplier_name": supplier_name,
                           "message": f"无 {material_category or ''} 品类记录"},
                "confidence": 0.3,
                "reasoning": f"供应商 {supplier_name} 在 {material_category or '全部品类'} 无记录",
            }

        # === materials 表：采购历史 ===
        prices = [r["unit_price"] for r in records]
        dates = sorted([r.get("order_date", "") for r in records])
        categories = list(set(r.get("category", "") for r in records))

        avg_price = sum(prices) / len(prices)
        price_std = (sum((p - avg_price) ** 2 for p in prices) / len(prices)) ** 0.5
        volatility = round(price_std / avg_price * 100, 1) if avg_price > 0 else 0

        # 价格趋势
        if len(prices) >= 4:
            recent_avg = sum(prices[-4:]) / min(4, len(prices[-4:]))
            early_avg = sum(prices[:4]) / min(4, len(prices[:4]))
            if recent_avg > early_avg * 1.05:
                trend = "上升"
            elif recent_avg < early_avg * 0.95:
                trend = "下降"
            else:
                trend = "稳定"
        else:
            trend = "数据不足"

        result = {
            "available": True,
            "supplier_name": supplier_name,
            "purchase_count": len(records),
            "categories_covered": categories,
            "avg_unit_price": round(avg_price, 2),
            "price_volatility_pct": volatility,
            "price_trend": trend,
            "first_order": dates[0] if dates else "",
            "last_order": dates[-1] if dates else "",
        }

        # === quotes 表：偏离分析历史 ===
        deviation_stats = self._load_deviation_history(supplier_name, material_category)
        result.update(deviation_stats)

        result["sample_materials"] = [
            {"name": r["name"], "price": r["unit_price"],
             "date": r.get("order_date", "")}
            for r in records[:5]
        ]

        # 综合评级
        result["risk_level"] = self._classify_risk_level(result)
        result["pricing_behavior"] = self._classify_pricing_behavior(result)
        result["risk_assessment"] = self._assess_risk(result)
        result["recommended_procurement_mode"] = self._recommend_mode(result)

        data_points = len(records) + result.get("analyzed_quotes", 0)
        return {
            "result": result,
            "confidence": round(self.confidence * min(data_points / 15, 1.0), 3),
            "reasoning": (
                f"供应商 {supplier_name}：{len(records)} 次采购，"
                f"均价 ¥{avg_price:.2f}，趋势 {trend}，"
                f"{result.get('deviation_summary', '')}"
            ),
        }

    def _load_deviation_history(self, supplier_name: str,
                                 category: str = None) -> Dict:
        """从 quotes 表加载该供应商的历史偏离分析"""
        try:
            from app.db.database import get_connection
            conn = get_connection()
            try:
                if category:
                    rows = conn.execute(
                        """SELECT deviation_score, severity_level, created_at
                           FROM quotes WHERE supplier_name = ? AND category = ?
                           ORDER BY created_at DESC LIMIT 50""",
                        (supplier_name, category),
                    ).fetchall()
                else:
                    rows = conn.execute(
                        """SELECT deviation_score, severity_level, created_at
                           FROM quotes WHERE supplier_name = ?
                           ORDER BY created_at DESC LIMIT 50""",
                        (supplier_name,),
                    ).fetchall()

                if not rows:
                    return {"analyzed_quotes": 0, "deviation_summary": "无分析记录"}

                scores = [r["deviation_score"] for r in rows if r["deviation_score"]]
                anomalies = [r for r in rows
                             if r["severity_level"] in ("警示", "紧急")]

                if not scores:
                    return {"analyzed_quotes": len(rows), "deviation_summary": "无偏离数据"}

                avg_dev = sum(scores) / len(scores)

                # 偏离趋势：最近 vs 整体
                recent_scores = scores[:min(5, len(scores))]
                recent_avg = sum(recent_scores) / len(recent_scores)

                if recent_avg > avg_dev * 1.2:
                    dev_trend = "恶化"
                elif recent_avg < avg_dev * 0.8:
                    dev_trend = "改善"
                else:
                    dev_trend = "持平"

                return {
                    "analyzed_quotes": len(rows),
                    "avg_deviation_score": round(avg_dev, 1),
                    "recent_avg_deviation": round(recent_avg, 1),
                    "deviation_trend": dev_trend,
                    "anomaly_count": len(anomalies),
                    "anomaly_rate_pct": round(len(anomalies) / len(rows) * 100, 1),
                    "deviation_summary": (
                        f"历史偏离均值 {avg_dev:.0f} 分，"
                        f"异常率 {len(anomalies)/len(rows)*100:.0f}%，"
                        f"趋势 {dev_trend}"
                    ),
                }
            finally:
                conn.close()
        except Exception:
            return {"analyzed_quotes": 0, "deviation_summary": "加载失败"}

    def _assess_risk(self, profile: Dict) -> str:
        """综合风险评估"""
        risks = []
        if profile.get("price_trend") == "上升":
            risks.append("价格持续上升")
        if profile.get("deviation_trend") == "恶化":
            risks.append("偏离趋势恶化")
        anomaly_rate = profile.get("anomaly_rate_pct", 0)
        if anomaly_rate > 30:
            risks.append(f"异常率高({anomaly_rate}%)")
        if profile.get("price_volatility_pct", 0) > 25:
            risks.append("价格波动大")

        if not risks:
            return "低风险"
        elif len(risks) == 1:
            return f"中低风险：{risks[0]}"
        elif len(risks) == 2:
            return f"中风险：{risks[0]}，{risks[1]}"
        else:
            return f"高风险：{'；'.join(risks)}"

    def _classify_risk_level(self, profile: Dict) -> str:
        anomaly_rate = profile.get("anomaly_rate_pct", 0)
        volatility = profile.get("price_volatility_pct", 0)
        avg_dev = profile.get("avg_deviation_score", 0)

        if anomaly_rate >= 50 or avg_dev >= 65:
            return "极高"
        if anomaly_rate >= 30 or volatility >= 25 or avg_dev >= 45:
            return "高"
        if anomaly_rate >= 15 or volatility >= 15 or avg_dev >= 25:
            return "中"
        return "低"

    def _classify_pricing_behavior(self, profile: Dict) -> str:
        anomaly_rate = profile.get("anomaly_rate_pct", 0)
        trend = profile.get("price_trend", "")
        volatility = profile.get("price_volatility_pct", 0)

        if anomaly_rate >= 35 and trend == "上升":
            return "系统性偏高且持续上涨"
        if trend == "上升":
            return "近期报价走高"
        if volatility >= 25:
            return "报价波动较大"
        if anomaly_rate <= 10:
            return "报价相对稳定"
        return "偶发异常"

    def _recommend_mode(self, profile: Dict) -> str:
        risk_level = profile.get("risk_level", "低")
        behavior = profile.get("pricing_behavior", "")

        if risk_level in {"极高", "高"}:
            return "二供询价 + 经理审批 + 要求成本拆解"
        if "上涨" in behavior:
            return "保留供货窗口，同时锁定目标价再议价"
        if "稳定" in behavior:
            return "常规议价或年度框架复核"
        return "补充证据后再决策"


class PeerComparer(Tool):
    """同类供应商价格对比 — 四分位分布 + 统计显著性"""

    name = "tool_compare_peer_price"
    description = (
        "对比同类物料在不同供应商间的价格水平。"
        "返回：同行四分位分布（Q1/Q2/Q3）、IQR 异常检测、"
        "当前报价的 z-score 和百分位排名。"
        "用于判断当前报价是否在统计意义上显著偏高。"
    )
    input_schema = {
        "type": "object",
        "properties": {
            "material_category": {"type": "string", "description": "物料品类"},
            "material_type": {"type": "string", "description": "材质类型（可选）"},
            "current_supplier": {"type": "string", "description": "当前供应商名称"},
            "current_price": {"type": "number", "description": "当前报价金额"},
        },
        "required": ["material_category", "current_supplier", "current_price"],
    }
    confidence = 0.82
    model_loaded = False

    def __init__(self, materials_data: List[Dict]):
        self.materials = materials_data

    def execute(self, material_category: str, current_supplier: str,
                current_price: float, material_type: str = None,
                **kwargs) -> Dict[str, Any]:
        import numpy as np

        peers = [m for m in self.materials if m.get("category") == material_category]
        if material_type:
            filtered = [m for m in peers if m.get("material_type") == material_type]
            if filtered:
                peers = filtered

        peers = [m for m in peers if m.get("supplier_name") != current_supplier]
        if not peers:
            return {
                "result": {"available": False, "message": "无同类供应商数据"},
                "confidence": 0.3,
                "reasoning": f"品类 {material_category} 无其他供应商记录",
            }

        # 按供应商分组统计
        by_supplier: Dict[str, List[float]] = {}
        for m in peers:
            name = m.get("supplier_name", "")
            if name not in by_supplier:
                by_supplier[name] = []
            by_supplier[name].append(m["unit_price"])

        peer_summary = []
        all_prices = []
        for name, prices in by_supplier.items():
            arr = np.array(prices)
            all_prices.extend(prices)
            peer_summary.append({
                "supplier": name,
                "avg_price": round(float(np.mean(arr)), 2),
                "median_price": round(float(np.median(arr)), 2),
                "min_price": float(np.min(arr)),
                "max_price": float(np.max(arr)),
                "std": round(float(np.std(arr)), 2),
                "quote_count": len(prices),
            })
        peer_summary.sort(key=lambda x: x["avg_price"])

        # 四分位分析
        all_arr = np.array(all_prices)
        q1 = float(np.percentile(all_arr, 25))
        q2 = float(np.percentile(all_arr, 50))
        q3 = float(np.percentile(all_arr, 75))
        iqr = q3 - q1
        upper_fence = q3 + 1.5 * iqr
        lower_fence = q1 - 1.5 * iqr

        # z-score
        mean = float(np.mean(all_arr))
        std = float(np.std(all_arr))
        z_score = round((current_price - mean) / std, 2) if std > 0 else 0

        # 百分位排名
        percentile = round(float(np.sum(all_arr < current_price) / len(all_arr) * 100), 1)

        # 异常判定
        if z_score > 2.0:
            outlier_level = "显著偏高（z > 2.0）"
            is_outlier = True
        elif current_price > upper_fence:
            outlier_level = f"偏高（超 Q3+1.5×IQR = ¥{upper_fence:.1f}）"
            is_outlier = True
        elif z_score > 1.0:
            outlier_level = "略高于同行均值"
            is_outlier = False
        elif z_score < -2.0:
            outlier_level = "显著偏低"
            is_outlier = True
        else:
            outlier_level = "在正常范围内"
            is_outlier = False

        # 同行均价
        overall_avg = mean
        premium = (current_price - overall_avg) / overall_avg * 100 if overall_avg > 0 else 0

        result = {
            "available": True,
            "category": material_category,
            "material_type": material_type or "全部",
            "peer_count": len(peer_summary),
            "data_points": len(all_prices),
            # 基本对比
            "peer_avg_price": round(overall_avg, 2),
            "peer_median_price": round(q2, 2),
            "peer_min_price": round(float(np.min(all_arr)), 2),
            "peer_max_price": round(float(np.max(all_arr)), 2),
            # 分布统计
            "quartiles": {"Q1": round(q1, 2), "Q2": round(q2, 2), "Q3": round(q3, 2)},
            "iqr": round(iqr, 2),
            "upper_fence": round(upper_fence, 2),
            # 当前报价统计位置
            "current_price": current_price,
            "current_premium_pct": round(premium, 1),
            "z_score": z_score,
            "percentile_rank": percentile,
            "outlier_level": outlier_level,
            "is_statistical_outlier": is_outlier,
            # 同行明细
            "peer_details": peer_summary,
            "excluded_supplier": current_supplier,
        }

        return {
            "result": result,
            "confidence": round(self.confidence * min(len(peer_summary) / 3, 1.0), 3),
            "reasoning": (
                f"品类 {material_category}：{len(peer_summary)} 家同行，"
                f"Q1=¥{q1:.1f} Q2=¥{q2:.1f} Q3=¥{q3:.1f}，"
                f"当前报价 ¥{current_price}（z={z_score}，P{percentile:.0f}），"
                f"{outlier_level}"
            ),
        }


class MarketTrendChecker(Tool):
    """市场行情查询 — 时序数据分析 + 趋势回归"""

    name = "tool_check_market_trend"
    description = (
        "查询原材料市场价格走势，基于时序数据做线性回归趋势判断。"
        "返回：近 24 周价格趋势（上涨/下跌/稳定）、趋势斜率、当前价格区间。"
        "用于判断供应商报价偏离是否由原材料行情驱动。"
    )
    input_schema = {
        "type": "object",
        "properties": {
            "material_category": {"type": "string", "description": "物料品类"},
            "material_type": {"type": "string", "description": "材质类型（可选，用于精确匹配）"},
        },
        "required": ["material_category"],
    }
    confidence = 0.75
    model_loaded = False

    # 品类到原材料的映射（用于查 raw_material_prices）
    CATEGORY_TO_MATERIAL = {
        "塑料外壳": ["ABS", "PC", "PP", "PA66"],
        "PCB板": ["FR-4", "铜箔"],
        "按键": ["硅胶", "TPU"],
        "袖带": ["尼龙", "TPU"],
        "连接器": ["铜合金"],
    }

    def __init__(self, external_refs: List[Dict], benchmarks: Dict):
        self.external_refs = {ref["material_category"]: ref for ref in external_refs}
        self.benchmarks = benchmarks

    def execute(self, material_category: str, material_type: str = None,
                **kwargs) -> Dict[str, Any]:
        # 1. 从时序表读取原材料价格数据
        ts_data = self._load_time_series(material_category, material_type)

        # 2. 从 external_references 读取最新参考价（可能已被联网刷新）
        ref = self.external_refs.get(material_category, {})

        result = {
            "available": True,
            "category": material_category,
            "material_type": material_type or "全部",
            "price_low": ref.get("price_low"),
            "price_high": ref.get("price_high"),
            "source": ref.get("source", "行业基准"),
        }

        if ts_data:
            trend_result = self._analyze_trend(ts_data)
            result.update(trend_result)
            result["data_freshness"] = f"最新 {ts_data[-1]['date']}"
            confidence = trend_result.get("confidence", 0.6)
        else:
            result["trend"] = "无时序数据"
            result["trend_detail"] = "raw_material_prices 表中无该品类的原材料数据"
            result["current_price"] = ref.get("price_low")
            confidence = 0.4

        return {
            "result": result,
            "confidence": round(self.confidence * confidence, 3),
            "reasoning": (
                f"{material_category}："
                f"{result.get('trend_detail', '无趋势数据')}，"
                f"参考价 ¥{result.get('price_low', '?')}~¥{result.get('price_high', '?')}"
            ),
        }

    def _load_time_series(self, category: str, material_type: str = None) -> List[Dict]:
        """从 raw_material_prices 表加载时序数据"""
        try:
            from app.db.database import get_connection
            # 品类 → 材料类型映射
            mat_types = self.CATEGORY_TO_MATERIAL.get(category, [])
            if material_type and material_type not in mat_types:
                mat_types.append(material_type)

            if not mat_types:
                return []

            conn = get_connection()
            try:
                placeholders = ",".join("?" for _ in mat_types)
                rows = conn.execute(
                    f"""SELECT material_type, unit_price, price_date, unit
                        FROM raw_material_prices
                        WHERE material_type IN ({placeholders})
                        ORDER BY price_date ASC""",
                    mat_types,
                ).fetchall()
                return [{"type": r["material_type"], "price": r["unit_price"],
                         "date": r["price_date"], "unit": r["unit"]}
                        for r in rows]
            finally:
                conn.close()
        except Exception:
            return []

    def _analyze_trend(self, data: List[Dict]) -> Dict:
        """线性回归趋势分析"""
        import numpy as np

        if len(data) < 4:
            return {"trend": "数据不足", "trend_detail": f"仅 {len(data)} 个数据点",
                    "confidence": 0.3}

        # 按周聚合均价
        prices = np.array([d["price"] for d in data])
        weeks = np.arange(len(prices))

        # 线性回归
        slope, intercept = np.polyfit(weeks, prices, 1)
        trend_strength = abs(slope) / (np.mean(prices) / len(prices)) * 100 if np.mean(prices) > 0 else 0

        # 趋势判定
        if trend_strength > 2:
            trend = "上涨" if slope > 0 else "下跌"
        elif trend_strength > 0.5:
            trend = "小幅上涨" if slope > 0 else "小幅下跌"
        else:
            trend = "稳定"

        # 最近 4 周 vs 最早 4 周的变化
        recent = np.mean(prices[-4:]) if len(prices) >= 4 else np.mean(prices)
        early = np.mean(prices[:4])
        change_pct = (recent - early) / early * 100 if early > 0 else 0

        current = float(prices[-1])
        avg = float(np.mean(prices))
        low = float(np.min(prices))
        high = float(np.max(prices))

        return {
            "trend": trend,
            "trend_detail": (
                f"{data[0]['type']}：近 {len(data)} 周 {'↑' if slope > 0 else '↓'}"
                f"{abs(change_pct):.1f}%（¥{early:.2f}→¥{recent:.2f}），"
                f"当前 ¥{current:.2f}/{data[0]['unit']}"
            ),
            "current_price": current,
            "avg_price": avg,
            "price_range_24w": f"¥{low:.2f}~¥{high:.2f}",
            "change_pct_24w": round(change_pct, 1),
            "trend_slope_per_week": round(float(slope), 4),
            "data_points": len(data),
            "confidence": round(min(0.9, 0.5 + len(data) / 100), 2),
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

    def execute(self, material_id: str, material_name: str = None,
                **kwargs) -> Dict[str, Any]:
        # 从 inventory 表查询（多级回退：ID → 名称 → 品类）
        inv = self._query_inventory(material_id, material_name,
                                     kwargs.get("category", ""))

        if inv:
            days = inv["days_remaining"]
            urgency = inv["urgency"]

            if days <= 3:
                can_negotiate = False
                suggestion = "库存仅够3天，必须立即采购，无议价空间"
            elif days <= 7:
                can_negotiate = False
                suggestion = "库存紧张，优先保障供应，议价空间有限"
            elif days <= 14:
                can_negotiate = True
                suggestion = "库存尚可，有1-2周时间进行议价或二次询价"
            else:
                can_negotiate = True
                suggestion = f"库存充裕（{days}天），有充足时间谈判或寻找替代供应商"

            result = {
                "available": True,
                "material_id": material_id,
                "material_name": inv.get("material_name", material_name or ""),
                "current_stock": inv["current_stock"],
                "safety_stock": inv["safety_stock"],
                "daily_consumption": inv["daily_consumption"],
                "days_remaining": days,
                "urgency": urgency,
                "can_negotiate": can_negotiate,
                "suggestion": suggestion,
                "last_restock_date": inv.get("last_restock_date", ""),
                "data_source": "inventory表（模拟数据）",
            }
            confidence = 0.45  # 模拟数据
        else:
            result = {
                "available": False,
                "material_id": material_id,
                "material_name": material_name or "",
                "inventory_level": "未知",
                "urgency": "无法判断",
                "can_negotiate": True,
                "suggestion": "无库存数据，建议由采购人员人工判断紧急程度",
                "data_source": "无",
            }
            confidence = 0.2

        return {
            "result": result,
            "confidence": confidence,
            "reasoning": (
                f"物料 {material_id}：{result.get('suggestion', '')}"
            ),
        }

    def _query_inventory(self, material_id: str, material_name: str = "",
                           category: str = "") -> Optional[Dict]:
        try:
            from app.db.database import get_connection
            conn = get_connection()
            try:
                # 1. 精确匹配 ID
                row = conn.execute(
                    "SELECT * FROM inventory WHERE material_id = ? LIMIT 1",
                    (material_id,),
                ).fetchone()
                # 2. 按名称关键词匹配
                if not row and material_name:
                    keywords = material_name.replace('-', ' ').replace('_', ' ').split()[:3]
                    for kw in keywords:
                        if len(kw) >= 2:
                            row = conn.execute(
                                "SELECT * FROM inventory WHERE material_name LIKE ? LIMIT 1",
                                (f"%{kw}%",),
                            ).fetchone()
                            if row: break
                # 3. ID作为名称关键字再试（LLM可能用name当id传）
                if not row:
                    kw = material_id.replace('-', ' ').replace('_', ' ').split()[0]
                    if len(kw) >= 2:
                        row = conn.execute(
                            "SELECT * FROM inventory WHERE material_name LIKE ? LIMIT 1",
                            (f"%{kw}%",),
                        ).fetchone()
                # 4. 按品类取任意一条（兜底）
                if not row and category:
                    row = conn.execute(
                        "SELECT * FROM inventory WHERE category = ? LIMIT 1",
                        (category,),
                    ).fetchone()
                return dict(row) if row else None
            finally:
                conn.close()
        except Exception:
            return None


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
    """深度成本异常分析 — LLM 动态分析 + 上下文感知"""

    name = "tool_analyze_cost_anomaly"
    description = (
        "对成本拆解结果进行深度分析，结合供应商画像、同行对比、市场行情，"
        "由 LLM 动态生成针对性的异常解释和谈判建议。"
        "当成本项出现异常或需要制定具体谈判策略时调用。"
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
        self._api_key = os.environ.get("KIMI_API_KEY", "")
        self._base_url = os.environ.get("KIMI_BASE_URL",
                                         "https://ai-gateway.ailab.jiuan.com/v1")
        self._model = os.environ.get("KIMI_MODEL", "kimi-k2.5")

    def execute(self, cost_analysis: Dict = None, supplier_quote: float = 0,
                material_category: str = "", **kwargs) -> Dict[str, Any]:
        # 处理可能的嵌套格式
        if cost_analysis is None:
            cost_analysis = {}
        # 如果传入的是 execute 层的包装结果，解包
        if "cost_items" not in cost_analysis and "result" in cost_analysis:
            cost_analysis = cost_analysis.get("result", {})
        cost_items = cost_analysis.get("cost_items", [])
        if not cost_items:
            return {
                "result": {"available": False, "message": "无成本拆解数据，可能尚未执行成本分析"},
                "confidence": 0.0,
                "reasoning": "缺少成本拆解数据，无法进行深度分析。请确保已调用 tool_analyze_cost_structure",
            }

        # 异常项：排除纯参考值，保留有偏离信息的项
        abnormal = [c for c in cost_items
                    if c.get("status") not in ("参考值",)
                    and "参考值" not in str(c.get("status", ""))]
        if not abnormal:
            # 无明确异常时，选取偏离最大的项
            abnormal = sorted(
                [c for c in cost_items if c.get("deviation_from_reasonable")],
                key=lambda x: abs(x.get("deviation_from_reasonable", 0)),
                reverse=True,
            )[:3]
        else:
            abnormal.sort(key=lambda x: abs(x.get("deviation_from_reasonable", 0)),
                          reverse=True)

        # 提取上下文（从 kwargs 获取诊断阶段已收集的信息）
        supplier_ctx = kwargs.get("supplier_profile", {})
        peer_ctx = kwargs.get("peer_benchmark", {})
        market_ctx = kwargs.get("market_context", {})

        # LLM 动态分析
        if self._api_key and abnormal:
            llm_analysis = self._query_llm_analysis(
                cost_items, abnormal, supplier_quote, material_category,
                supplier_ctx, peer_ctx, market_ctx,
            )
        else:
            llm_analysis = None

        if llm_analysis:
            result = llm_analysis
            result["available"] = True
            result["analysis_method"] = "LLM"
        else:
            # 兜底：简化版规则分析
            simplified = []
            for item in abnormal[:3]:
                simplified.append({
                    "item": item["item"],
                    "status": item["status"],
                    "deviation": item.get("deviation_from_reasonable", 0),
                    "possible_reasons": [
                        "供应商报价整体偏高，建议对比同行价格",
                        "要求供应商提供该项目的成本明细",
                    ],
                })
            result = {
                "available": True,
                "category": material_category,
                "total_anomaly_items": len(abnormal),
                "anomalies": simplified,
                "analysis_method": "rule",
                "summary": f"共 {len(abnormal)} 项异常，需供应商提供成本明细进一步分析",
            }

        return {
            "result": result,
            "confidence": round(self.confidence * (0.9 if llm_analysis else 0.6), 3),
            "reasoning": (
                f"成本深度分析（{'LLM' if llm_analysis else '规则'}）："
                f"{result.get('summary', '')}"
            ),
        }

    def _query_llm_analysis(self, cost_items: List, abnormal: List,
                             quote: float, category: str,
                             supplier_ctx: Dict, peer_ctx: Dict,
                             market_ctx: Dict) -> Optional[Dict]:
        """调用 LLM 做上下文感知的成本异常分析"""
        import json as _json
        import httpx
        from openai import OpenAI

        # 构造上下文
        items_text = "\n".join(
            f"- {c['item']}: 合理=¥{c.get('reasonable_amount','?')} "
            f"隐含=¥{c.get('implied_amount','?')} "
            f"偏离={c.get('deviation_from_reasonable','?')}% "
            f"状态={c.get('status','?')} "
            f"验证={'✓' if c.get('independently_verified') else '✗'}"
            for c in cost_items
        )
        supplier_text = (
            f"采购{ supplier_ctx.get('purchase_count','?')}次，"
            f"历史偏离均值{supplier_ctx.get('avg_deviation_score','?')}分，"
            f"风险{supplier_ctx.get('risk_assessment','?')}"
            if supplier_ctx else "无供应商画像"
        )
        peer_text = (
            f"同行{peer_ctx.get('peer_count','?')}家，"
            f"Q1=¥{peer_ctx.get('quartiles',{}).get('Q1','?')} "
            f"Q3=¥{peer_ctx.get('quartiles',{}).get('Q3','?')}，"
            f"当前z-score={peer_ctx.get('z_score','?')}"
            if peer_ctx else "无同行对比"
        )
        market_text = (
            f"行情{market_ctx.get('trend','?')}，"
            f"{market_ctx.get('trend_detail','')}"
            if market_ctx else "无市场行情"
        )

        prompt = f"""你是一位采购成本分析师。请分析以下报价的成本结构异常。

## 报价信息
品类: {category}，总价: ¥{quote}

## 成本拆解
{items_text}

## 背景信息
- 供应商: {supplier_text}
- 同行对比: {peer_text}
- 市场行情: {market_text}

## 要求
返回 JSON（不要 markdown）：
{{
  "summary": "一句话总结核心发现（30字）",
  "root_cause_analysis": "根因分析（60字），结合供应商画像、同行对比、市场行情",
  "anomalies": [
    {{"item": "成本项", "severity": "高/中/低", "explanation": "具体解释（20字）",
      "negotiation_tip": "谈判建议（30字）"}}
  ],
  "negotiation_strategy": "整体谈判策略建议（50字）"
}}

只返回 JSON。"""

        try:
            client = OpenAI(api_key=self._api_key, base_url=self._base_url,
                          timeout=httpx.Timeout(20.0, connect=5.0))
            resp = client.chat.completions.create(
                model=self._model,
                messages=[{"role": "user", "content": prompt}],
                temperature=0.3, max_tokens=500,
            )
            content = resp.choices[0].message.content or ""
            content = content.strip()
            if content.startswith("```"):
                content = content.split("\n", 1)[1].rsplit("\n", 1)[0]
            return _json.loads(content)
        except Exception as e:
            print(f"[CostAnomalyAnalyzer] LLM failed: {e}")
            return None


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
        self.cost_analyzer = CostAnalyzer(self.benchmarks, self.external_refs)
        self.scorer = AnomalyScorer(self.external_refs)
        self.solution_gen = SolutionGenerator()

        # ===== 第二阶段 Skills（Agent 诊断工具） =====
        self.supplier_profiler = SupplierProfiler(self.materials)
        self.peer_comparer = PeerComparer(self.materials)
        self.market_checker = MarketTrendChecker(self.external_refs, self.benchmarks)
        self.market_price_lookup = MarketPriceLookup()
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
        self.registry.register(self.market_price_lookup)
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
        # Thread mapping 持久化到 agent_threads 表，服务器重启后仍可恢复

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

        # 持久化线程映射到 SQLite（服务器重启后可恢复）
        from app.db.database import get_connection, save_thread_mapping
        conn = get_connection()
        try:
            save_thread_mapping(conn, quote_data['id'], thread_id)
        finally:
            conn.close()

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
        from app.db.database import get_connection, get_thread_mapping
        conn = get_connection()
        try:
            thread_id = get_thread_mapping(conn, quote_id)
        finally:
            conn.close()
        if not thread_id:
            raise ValueError(f"未找到报价 {quote_id} 的执行线程")

        result = self._graph.invoke(
            Command(resume=feedback),
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

        # 持久化线程映射
        from app.db.database import get_connection, save_thread_mapping
        conn = get_connection()
        try:
            save_thread_mapping(conn, quote_id, thread_id)
        finally:
            conn.close()

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
            "diagnosis_hypotheses": result.get("diagnosis_hypotheses", []),
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
    'MarketPriceLookup',
    'UrgencyChecker',
    'AlternativeSupplierFinder',
    'CostAnomalyAnalyzer',
    'AgentOrchestrator'
]
