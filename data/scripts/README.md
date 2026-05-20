# 数据处理脚本

本目录包含数据预处理和训练数据准备脚本。

## 使用流程

```bash
# 1. 数据预处理
python preprocess.py

# 2. 特征工程
python feature_engineering.py

# 3. 准备训练数据
python prepare_training_data.py

# 4. 数据验证
python data_validation.py
```

## 脚本说明

### preprocess.py
数据清洗：处理缺失值、统一单位、去除异常值

### feature_engineering.py
特征工程：类别编码、数值标准化、时间特征、文本特征

### prepare_training_data.py
生成训练数据集：划分训练/验证/测试集

### data_validation.py
数据质量检查：缺失值比例、异常值检测、分布检查
