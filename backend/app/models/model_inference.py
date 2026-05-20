"""
模型推理封装模块
提供统一的模型加载和推理接口
"""

import pickle
import json
import numpy as np
import os
from typing import List, Dict, Tuple, Optional


class PricePredictor:
    """价格预测模型封装"""

    def __init__(self, model_dir: str = None):
        if model_dir is None:
            model_dir = os.path.join(os.path.dirname(__file__), '..', 'models', 'price_predictor')

        self.model_dir = model_dir
        self.models = {}
        self.scaler = None
        self.feature_names = []
        self.metadata = {}

        self._load_models()

    def _load_models(self):
        """加载模型文件"""
        try:
            # 加载三个分位数模型
            for q in [0.1, 0.5, 0.9]:
                model_path = os.path.join(self.model_dir, f'model_{q}.pkl')
                if os.path.exists(model_path):
                    with open(model_path, 'rb') as f:
                        self.models[q] = pickle.load(f)

            # 加载标准化器
            scaler_path = os.path.join(self.model_dir, 'scaler.pkl')
            if os.path.exists(scaler_path):
                with open(scaler_path, 'rb') as f:
                    self.scaler = pickle.load(f)

            # 加载元数据
            metadata_path = os.path.join(self.model_dir, 'metadata.json')
            if os.path.exists(metadata_path):
                with open(metadata_path, 'r', encoding='utf-8') as f:
                    self.metadata = json.load(f)
                    self.feature_names = self.metadata.get('feature_names', [])

            print(f"价格预测模型加载成功: {len(self.models)} 个分位数模型")

        except Exception as e:
            print(f"模型加载失败: {e}")
            self.models = {}

    def is_ready(self) -> bool:
        """检查模型是否已加载"""
        return len(self.models) > 0 and self.scaler is not None

    def predict(self, features: Dict) -> Dict:
        """
        预测价格区间

        Args:
            features: 物料特征字典

        Returns:
            {
                'price_low': float,   # P10
                'price_mid': float,   # P50
                'price_high': float,  # P90
                'confidence': float   # 置信度
            }
        """
        if not self.is_ready():
            # 使用规则回退
            return self._rule_based_prediction(features)

        # 构建特征向量
        X = self._build_feature_vector(features)
        X_scaled = self.scaler.transform([X])

        # 预测三个分位数
        predictions = {}
        for q, model in self.models.items():
            pred = model.predict(X_scaled)[0]
            predictions[q] = max(0.01, pred)  # 确保价格为正

        return {
            'price_low': round(predictions.get(0.1, 0), 2),
            'price_mid': round(predictions.get(0.5, 0), 2),
            'price_high': round(predictions.get(0.9, 0), 2),
            'confidence': self._calculate_confidence(predictions)
        }

    def _build_feature_vector(self, features: Dict) -> List[float]:
        """构建特征向量"""
        # 简化版本，实际应根据训练时的特征工程
        return [
            features.get('category_encoded', 0),
            features.get('material_type_encoded', 0),
            features.get('processing_encoded', 0),
            features.get('precision_encoded', 0),
            features.get('quantity', 10000) / 10000.0,  # 归一化
            features.get('month', 6) / 12.0,
            features.get('year', 2024) - 2020,
            features.get('volume_cm3', 50) / 100.0,
            features.get('surface_area_cm2', 100) / 200.0,
            features.get('complexity_score', 0.5)
        ]

    def _calculate_confidence(self, predictions: Dict) -> float:
        """计算预测置信度"""
        # 区间越窄，置信度越高
        p10 = predictions.get(0.1, 0)
        p90 = predictions.get(0.9, 0)
        p50 = predictions.get(0.5, 1)

        if p50 <= 0:
            return 0.5

        range_ratio = (p90 - p10) / p50
        confidence = max(0.3, min(0.95, 1.0 - range_ratio * 0.5))
        return round(confidence, 2)

    def _rule_based_prediction(self, features: Dict) -> Dict:
        """基于规则的回退预测"""
        # 根据类别和数量估算
        base_price = 5.0
        quantity = features.get('quantity', 10000)

        # 数量折扣
        if quantity > 50000:
            base_price *= 0.85
        elif quantity > 20000:
            base_price *= 0.90

        return {
            'price_low': round(base_price * 0.8, 2),
            'price_mid': round(base_price, 2),
            'price_high': round(base_price * 1.2, 2),
            'confidence': 0.6
        }


class SimilarityEmbedder:
    """相似度嵌入模型封装"""

    def __init__(self, model_dir: str = None):
        if model_dir is None:
            model_dir = os.path.join(os.path.dirname(__file__), '..', 'models', 'similarity_embedder')

        self.model_dir = model_dir
        self.model = None
        self.index = None
        self.material_ids = []
        self.metadata = {}

        self._load_model()

    def _load_model(self):
        """加载模型"""
        try:
            from sentence_transformers import SentenceTransformer

            # 加载Sentence-BERT模型
            model_path = os.path.join(self.model_dir, 'embedder')
            if os.path.exists(model_path):
                self.model = SentenceTransformer(model_path)

            # 加载FAISS索引
            index_path = os.path.join(self.model_dir, 'index.faiss')
            if os.path.exists(index_path):
                import faiss
                self.index = faiss.read_index(index_path)

            # 加载物料ID映射
            ids_path = os.path.join(self.model_dir, 'material_ids.json')
            if os.path.exists(ids_path):
                with open(ids_path, 'r', encoding='utf-8') as f:
                    self.material_ids = json.load(f)

            # 加载元数据
            metadata_path = os.path.join(self.model_dir, 'metadata.json')
            if os.path.exists(metadata_path):
                with open(metadata_path, 'r', encoding='utf-8') as f:
                    self.metadata = json.load(f)

            print(f"相似度模型加载成功: {len(self.material_ids)} 个物料向量")

        except Exception as e:
            print(f"相似度模型加载失败: {e}")
            self.model = None

    def is_ready(self) -> bool:
        """检查模型是否已加载"""
        return self.model is not None

    def encode(self, text: str) -> np.ndarray:
        """编码文本为向量"""
        if not self.is_ready():
            return np.zeros(384)  # 默认维度
        return self.model.encode(text)

    def find_similar(self, query_text: str, top_k: int = 5) -> List[Tuple[str, float]]:
        """
        查找相似物料

        Args:
            query_text: 查询文本
            top_k: 返回数量

        Returns:
            [(material_id, similarity_score), ...]
        """
        if not self.is_ready() or self.index is None:
            return []

        # 编码查询
        query_vector = self.encode(query_text)
        query_vector = query_vector.reshape(1, -1).astype('float32')

        # 归一化
        import faiss
        faiss.normalize_L2(query_vector)

        # 搜索
        scores, indices = self.index.search(query_vector, min(top_k, len(self.material_ids)))

        # 返回结果
        results = []
        for idx, score in zip(indices[0], scores[0]):
            if idx < len(self.material_ids):
                results.append((self.material_ids[idx], float(score)))

        return results


class AnomalyDetector:
    """异常检测模型封装"""

    def __init__(self, model_dir: str = None):
        if model_dir is None:
            model_dir = os.path.join(os.path.dirname(__file__), '..', 'models', 'anomaly_detector')

        self.model_dir = model_dir
        self.model = None
        self.scaler = None
        self.metadata = {}

        self._load_model()

    def _load_model(self):
        """加载模型"""
        try:
            # 加载孤立森林模型
            model_path = os.path.join(self.model_dir, 'model.pkl')
            if os.path.exists(model_path):
                with open(model_path, 'rb') as f:
                    self.model = pickle.load(f)

            # 加载标准化器
            scaler_path = os.path.join(self.model_dir, 'scaler.pkl')
            if os.path.exists(scaler_path):
                with open(scaler_path, 'rb') as f:
                    self.scaler = pickle.load(f)

            # 加载元数据
            metadata_path = os.path.join(self.model_dir, 'metadata.json')
            if os.path.exists(metadata_path):
                with open(metadata_path, 'r', encoding='utf-8') as f:
                    self.metadata = json.load(f)

            print("异常检测模型加载成功")

        except Exception as e:
            print(f"异常检测模型加载失败: {e}")
            self.model = None

    def is_ready(self) -> bool:
        """检查模型是否已加载"""
        return self.model is not None and self.scaler is not None

    def predict(self, features: Dict) -> Dict:
        """
        预测异常概率

        Args:
            features: 特征字典
                - price_deviation: 价格偏离度
                - cost_deviation: 成本偏离度
                - market_deviation: 市场偏离度
                - supplier_history_count: 供应商历史交易数
                - supplier_avg_deviation: 供应商平均偏离度
                - material_complexity: 物料复杂度

        Returns:
            {
                'is_anomaly': bool,
                'anomaly_score': float,  # 异常分数（越高越异常）
                'confidence': float       # 置信度
            }
        """
        if not self.is_ready():
            # 使用规则回退
            return self._rule_based_detection(features)

        # 构建特征向量
        X = self._build_feature_vector(features)
        X_scaled = self.scaler.transform([X])

        # 预测 (-1表示异常, 1表示正常)
        prediction = self.model.predict(X_scaled)[0]
        # 获取异常分数（负数表示异常）
        score = self.model.score_samples(X_scaled)[0]

        # 转换为概率
        anomaly_prob = 1 / (1 + np.exp(score * 2))  # sigmoid转换

        return {
            'is_anomaly': prediction == -1,
            'anomaly_score': round(float(anomaly_prob), 3),
            'confidence': round(min(0.95, max(0.5, abs(score))), 2)
        }

    def _build_feature_vector(self, features: Dict) -> List[float]:
        """构建特征向量"""
        return [
            features.get('price_deviation', 0),
            features.get('cost_deviation', 0),
            features.get('market_deviation', 0),
            np.log1p(features.get('supplier_history_count', 1)) / 5.0,
            features.get('supplier_avg_deviation', 0),
            features.get('material_complexity', 0.5)
        ]

    def _rule_based_detection(self, features: Dict) -> Dict:
        """基于规则的回退检测"""
        price_dev = features.get('price_deviation', 0)
        cost_dev = features.get('cost_deviation', 0)

        # 综合偏离度
        combined = (price_dev + cost_dev) / 2

        is_anomaly = combined > 0.5
        anomaly_score = min(1.0, combined)

        return {
            'is_anomaly': is_anomaly,
            'anomaly_score': round(anomaly_score, 3),
            'confidence': 0.6
        }


# 全局模型实例
_price_predictor = None
_similarity_embedder = None
_anomaly_detector = None


def get_price_predictor() -> PricePredictor:
    """获取价格预测模型实例（单例）"""
    global _price_predictor
    if _price_predictor is None:
        _price_predictor = PricePredictor()
    return _price_predictor


def get_similarity_embedder() -> SimilarityEmbedder:
    """获取相似度模型实例（单例）"""
    global _similarity_embedder
    if _similarity_embedder is None:
        _similarity_embedder = SimilarityEmbedder()
    return _similarity_embedder


def get_anomaly_detector() -> AnomalyDetector:
    """获取异常检测模型实例（单例）"""
    global _anomaly_detector
    if _anomaly_detector is None:
        _anomaly_detector = AnomalyDetector()
    return _anomaly_detector
