"""
异常检测模型训练脚本
使用孤立森林(Isolation Forest)检测异常报价
"""

import pandas as pd
import numpy as np
from sklearn.ensemble import IsolationForest
from sklearn.preprocessing import StandardScaler
from sklearn.model_selection import train_test_split
import pickle
import json
from datetime import datetime
import os


def load_training_data():
    """加载训练数据"""
    # 从报价数据中提取特征
    with open('../../data/raw/quotes.json', 'r', encoding='utf-8') as f:
        data = json.load(f)

    quotes = data.get('quotes', [])

    # 构建特征
    features = []
    for q in quotes:
        feature = {
            'quote_id': q['id'],
            'price_deviation': q.get('deviation_score', 0) / 100.0,  # 价格偏离度
            'cost_deviation': q.get('cost_deviation', 0) / 100.0,   # 成本偏离度
            'market_deviation': q.get('market_deviation', 0) / 100.0,  # 市场偏离度
            'supplier_history_count': np.random.randint(1, 50),  # 供应商历史交易次数
            'supplier_avg_deviation': np.random.uniform(0, 0.5),  # 供应商历史平均偏离度
            'material_complexity': np.random.uniform(0.3, 0.9),  # 物料复杂度
            'is_anomaly': 1 if q.get('severity_level') in ['紧急', '警示'] else 0
        }
        features.append(feature)

    df = pd.DataFrame(features)
    return df


def prepare_features(df):
    """准备特征矩阵"""
    feature_cols = [
        'price_deviation',
        'cost_deviation',
        'market_deviation',
        'supplier_history_count',
        'supplier_avg_deviation',
        'material_complexity'
    ]

    X = df[feature_cols].values
    y = df['is_anomaly'].values

    return X, y, feature_cols


def train_anomaly_detector(X_train, contamination=0.2):
    """训练孤立森林模型"""

    # 标准化
    scaler = StandardScaler()
    X_train_scaled = scaler.fit_transform(X_train)

    # 孤立森林
    model = IsolationForest(
        n_estimators=100,
        contamination=contamination,  # 异常样本比例
        max_samples='auto',
        random_state=42,
        n_jobs=-1
    )

    model.fit(X_train_scaled)

    return model, scaler


def evaluate_model(model, scaler, X_test, y_test):
    """评估模型性能"""
    X_test_scaled = scaler.transform(X_test)

    # 预测 (-1表示异常, 1表示正常)
    predictions = model.predict(X_test_scaled)
    y_pred = np.where(predictions == -1, 1, 0)  # 转换为0/1

    # 计算指标
    from sklearn.metrics import precision_score, recall_score, f1_score, accuracy_score

    precision = precision_score(y_test, y_pred)
    recall = recall_score(y_test, y_pred)
    f1 = f1_score(y_test, y_pred)
    accuracy = accuracy_score(y_test, y_pred)

    return {
        'precision': float(precision),
        'recall': float(recall),
        'f1': float(f1),
        'accuracy': float(accuracy)
    }


def save_model(model, scaler, feature_cols, metrics):
    """保存模型"""
    model_dir = '../models/anomaly_detector'
    os.makedirs(model_dir, exist_ok=True)

    # 保存模型
    with open(f'{model_dir}/model.pkl', 'wb') as f:
        pickle.dump(model, f)

    # 保存标准化器
    with open(f'{model_dir}/scaler.pkl', 'wb') as f:
        pickle.dump(scaler, f)

    # 保存元数据
    metadata = {
        'version': '1.0.0',
        'created_at': datetime.now().isoformat(),
        'algorithm': 'Isolation Forest',
        'n_estimators': 100,
        'contamination': 0.2,
        'feature_names': feature_cols,
        'metrics': metrics,
        'threshold': -0.3  # 异常分数阈值
    }

    with open(f'{model_dir}/metadata.json', 'w', encoding='utf-8') as f:
        json.dump(metadata, f, ensure_ascii=False, indent=2)

    print(f"模型已保存到 {model_dir}")
    print(f"性能指标: Precision={metrics['precision']:.3f}, Recall={metrics['recall']:.3f}, F1={metrics['f1']:.3f}")


def main():
    """主训练流程"""
    print("=" * 50)
    print("开始训练异常检测模型")
    print("=" * 50)

    # 1. 加载数据
    print("\n[1/4] 加载训练数据...")
    df = load_training_data()
    print(f"共 {len(df)} 条样本")
    print(f"异常样本: {df['is_anomaly'].sum()} 条")

    # 2. 准备特征
    print("\n[2/4] 准备特征...")
    X, y, feature_cols = prepare_features(df)
    print(f"特征维度: {len(feature_cols)}")
    print(f"特征列表: {', '.join(feature_cols)}")

    # 划分训练集和测试集
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=42, stratify=y
    )

    # 3. 训练模型
    print("\n[3/4] 训练孤立森林模型...")
    contamination = max(0.1, min(0.5, y_train.mean()))  # 根据数据调整
    model, scaler = train_anomaly_detector(X_train, contamination)
    print(f"异常比例设置: {contamination:.2f}")

    # 4. 评估模型
    print("\n[4/4] 评估模型性能...")
    metrics = evaluate_model(model, scaler, X_test, y_test)

    # 5. 保存模型
    print("\n保存模型...")
    save_model(model, scaler, feature_cols, metrics)

    print("\n" + "=" * 50)
    print("训练完成!")
    print("=" * 50)


if __name__ == '__main__':
    main()
