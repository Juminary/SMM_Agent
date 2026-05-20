# 模型推理模块

本目录包含模型推理封装代码，供Agent核心调用。

## 文件说明

### model_inference.py
统一的模型推理接口，封装三个AI模型：
- PricePredictor: 价格预测模型
- SimilarityEmbedder: 相似度嵌入模型
- AnomalyDetector: 异常检测模型

## 使用方式

```python
from app.models.model_inference import get_price_predictor, get_similarity_embedder, get_anomaly_detector

# 获取模型实例
price_model = get_price_predictor()
similarity_model = get_similarity_embedder()
anomaly_model = get_anomaly_detector()

# 价格预测
result = price_model.predict({
    'category_encoded': 1,
    'material_type_encoded': 2,
    'quantity': 10000,
    ...
})
# 返回: {'price_low': 4.5, 'price_mid': 5.2, 'price_high': 6.0, 'confidence': 0.85}

# 相似度检索
similar = similarity_model.find_similar("塑料外壳 ABS 注塑", top_k=5)
# 返回: [('MAT001', 0.92), ('MAT002', 0.88), ...]

# 异常检测
anomaly = anomaly_model.predict({
    'price_deviation': 0.6,
    'cost_deviation': 0.4,
    ...
})
# 返回: {'is_anomaly': True, 'anomaly_score': 0.75, 'confidence': 0.82}
```

## 模型回退机制

如果模型文件不存在，会自动使用规则引擎作为回退，确保系统可用性。
