# 数据处理模块

本目录包含数据预处理、特征工程和训练数据准备脚本。

## 目录结构

```
data/
├── raw/                      # 原始数据
│   ├── materials.json       # 历史物料数据
│   ├── quotes.json          # 历史报价数据
│   ├── external_references.json  # 外部参考数据
│   └── suppliers.json       # 供应商信息
│
├── processed/                # 处理后数据
│   ├── features/            # 特征工程输出
│   │   ├── material_features.parquet
│   │   ├── quote_features.parquet
│   │   └── supplier_features.parquet
│   ├── training/            # 训练数据集
│   │   ├── price_prediction/
│   │   │   ├── train.csv
│   │   │   ├── val.csv
│   │   │   └── test.csv
│   │   ├── similarity/
│   │   │   └── material_pairs.csv
│   │   └── anomaly_detection/
│   │       └── labeled_samples.csv
│   └── pipeline/            # 数据处理流水线缓存
│       ├── encoders.pkl     # 编码器
│       ├── scalers.pkl      # 标准化器
│       └── feature_config.json
│
└── scripts/                  # 数据处理脚本
    ├── preprocess.py        # 数据清洗和预处理
    ├── feature_engineering.py  # 特征工程
    ├── prepare_training_data.py  # 准备训练数据
    ├── data_validation.py   # 数据质量检查
    └── sync_from_erp.py     # 从ERP系统同步数据
```

## 数据流程

```
原始数据 (raw/)
    ↓
数据清洗 (preprocess.py)
    ↓
特征工程 (feature_engineering.py)
    ↓
训练数据 (processed/training/)
    ↓
模型训练
```

## 关键脚本说明

### 1. preprocess.py

数据清洗和标准化：
- 处理缺失值
- 统一单位（尺寸、价格）
- 去除异常值
- 数据格式标准化

### 2. feature_engineering.py

特征工程：
- 类别编码（LabelEncoder/OneHot）
- 数值标准化（StandardScaler）
- 时间特征提取（年月、季度）
- 交叉特征生成
- 文本特征提取（TF-IDF）

### 3. prepare_training_data.py

准备训练数据集：
- 划分训练/验证/测试集
- 生成价格预测样本
- 生成相似物料对
- 标注异常样本

### 4. sync_from_erp.py

从ERP系统同步数据：
- 连接九安医疗ERP数据库
- 增量同步历史数据
- 数据格式转换
- 更新raw/目录

## 数据质量检查

```bash
# 运行数据验证
python scripts/data_validation.py

# 检查项：
# - 缺失值比例
# - 异常值检测
# - 数据分布
# - 特征相关性
```

## 特征说明

### 物料特征 (material_features)

| 特征名 | 类型 | 说明 |
|--------|------|------|
| category_encoded | int | 物料类别编码 |
| material_type_encoded | int | 材料类型编码 |
| processing_encoded | int | 加工工艺编码 |
| precision_encoded | int | 精度要求编码 |
| volume_cm3 | float | 体积（立方厘米） |
| surface_area_cm2 | float | 表面积 |
| complexity_score | float | 复杂度评分 |

### 报价特征 (quote_features)

| 特征名 | 类型 | 说明 |
|--------|------|------|
| unit_price | float | 单价 |
| quantity | int | 数量 |
| month | int | 月份（1-12） |
| year | int | 年份 |
| supplier_history_count | int | 供应商历史交易次数 |
| supplier_avg_deviation | float | 供应商历史平均偏离度 |

## 更新频率

- **实时同步**: 新报价数据 → 触发模型重训练
- **每日同步**: ERP数据同步
- **每周更新**: 特征工程和数据验证
