# AI模型模块

本目录包含训练好的机器学习模型和模型训练代码。

## 目录结构

```
models/
├── price_predictor/          # 价格预测模型
│   ├── model.pkl            # 训练好的XGBoost模型
│   ├── scaler.pkl           # 特征标准化器
│   ├── feature_importance.png  # 特征重要性图
│   └── metadata.json        # 模型元数据（版本、训练时间、性能指标）
│
├── similarity_embedder/     # 相似度嵌入模型
│   ├── embedder.pkl         # 训练好的SentenceTransformer
│   ├── embeddings.npy       # 物料向量库
│   ├── index.faiss          # FANN索引（快速检索）
│   └── metadata.json
│
├── anomaly_detector/         # 异常检测模型
│   ├── model.pkl            # 孤立森林/LOF模型
│   ├── scaler.pkl           # 标准化器
│   └── metadata.json
│
└── training/                 # 模型训练代码
    ├── train_price_predictor.py
    ├── train_similarity_embedder.py
    ├── train_anomaly_detector.py
    └── utils.py             # 训练工具函数
```

## 模型说明

### 1. 价格预测模型 (price_predictor)

**输入特征：**
- category_encoded: 物料类别编码
- material_type_encoded: 材料类型编码
- processing_encoded: 加工工艺编码
- precision_encoded: 精度要求编码
- quantity: 采购数量
- month: 报价月份（季节性）
- year: 报价年份（通胀趋势）

**输出：**
- price_low: P10分位数（低价边界）
- price_mid: P50分位数（中位数预测）
- price_high: P90分位数（高价边界）

**算法：** XGBoost分位数回归

### 2. 相似度嵌入模型 (similarity_embedder)

**输入：** 物料属性文本（类别+材料+工艺+精度+尺寸）

**输出：** 768维向量

**算法：** Sentence-BERT (中文预训练模型)

### 3. 异常检测模型 (anomaly_detector)

**输入特征：**
- 价格偏离度
- 成本结构偏离度
- 市场偏离度
- 供应商历史异常率

**输出：** 异常概率

**算法：** 孤立森林 (Isolation Forest)

## 模型更新流程

```bash
# 1. 准备训练数据
cd ../../data/processed
python prepare_training_data.py

# 2. 训练模型
cd ../../backend/models/training
python train_price_predictor.py
python train_similarity_embedder.py
python train_anomaly_detector.py

# 3. 评估模型性能
python evaluate_models.py

# 4. 更新生产模型（手动或自动）
```

## 版本管理

模型版本遵循语义化版本：
- MAJOR: 架构重大变更
- MINOR: 性能显著提升（>5%）
- PATCH: Bug修复或数据更新

当前版本记录在各自模型的 metadata.json 中。
