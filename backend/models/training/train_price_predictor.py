"""
价格预测模型训练脚本
使用XGBoost进行分位数回归
"""

import pandas as pd
import numpy as np
import xgboost as xgb
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import StandardScaler, LabelEncoder
import pickle
import json
from datetime import datetime
import os


def load_training_data():
    """加载训练数据"""
    train_path = '../../data/processed/training/price_prediction/train.csv'
    val_path = '../../data/processed/training/price_prediction/val.csv'

    train_df = pd.read_csv(train_path)
    val_df = pd.read_csv(val_path)

    return train_df, val_df


def prepare_features(df):
    """准备特征矩阵"""
    feature_cols = [
        'category_encoded',
        'material_type_encoded',
        'processing_encoded',
        'precision_encoded',
        'quantity',
        'month',
        'year',
        'volume_cm3',
        'surface_area_cm2',
        'complexity_score'
    ]

    X = df[feature_cols].values
    y = df['unit_price'].values

    return X, y, feature_cols


def train_quantile_model(X_train, y_train, X_val, y_val, quantile=0.5):
    """训练分位数回归模型"""

    # 计算样本权重（价格高的样本权重更大）
    sample_weights = np.log1p(y_train) / np.mean(np.log1p(y_train))

    # XGBoost参数
    params = {
        'objective': 'reg:quantileerror',
        'quantile_alpha': quantile,
        'max_depth': 6,
        'learning_rate': 0.1,
        'n_estimators': 200,
        'subsample': 0.8,
        'colsample_bytree': 0.8,
        'random_state': 42
    }

    model = xgb.XGBRegressor(**params)
    model.fit(
        X_train, y_train,
        sample_weight=sample_weights,
        eval_set=[(X_val, y_val)],
        early_stopping_rounds=20,
        verbose=False
    )

    return model


def evaluate_model(model, X_test, y_test):
    """评估模型性能"""
    predictions = model.predict(X_test)

    mae = np.mean(np.abs(predictions - y_test))
    rmse = np.sqrt(np.mean((predictions - y_test) ** 2))
    mape = np.mean(np.abs((predictions - y_test) / y_test)) * 100

    return {
        'mae': float(mae),
        'rmse': float(rmse),
        'mape': float(mape)
    }


def save_models(models, scaler, feature_cols, metrics):
    """保存模型和元数据"""

    model_dir = '../models/price_predictor'
    os.makedirs(model_dir, exist_ok=True)

    # 保存三个分位数模型
    for quantile, model in models.items():
        model_path = f'{model_dir}/model_{quantile}.pkl'
        with open(model_path, 'wb') as f:
            pickle.dump(model, f)

    # 保存标准化器
    with open(f'{model_dir}/scaler.pkl', 'wb') as f:
        pickle.dump(scaler, f)

    # 保存特征重要性
    importance = models[0.5].feature_importances_
    feature_importance = dict(zip(feature_cols, importance.tolist()))

    # 保存元数据
    metadata = {
        'version': '1.0.0',
        'created_at': datetime.now().isoformat(),
        'algorithm': 'XGBoost Quantile Regression',
        'quantiles': [0.1, 0.5, 0.9],
        'feature_names': feature_cols,
        'feature_importance': feature_importance,
        'metrics': metrics,
        'training_samples': len(X_train),
        'validation_samples': len(X_val)
    }

    with open(f'{model_dir}/metadata.json', 'w', encoding='utf-8') as f:
        json.dump(metadata, f, ensure_ascii=False, indent=2)

    print(f"模型已保存到 {model_dir}")
    print(f"性能指标: MAE={metrics['mae']:.2f}, RMSE={metrics['rmse']:.2f}, MAPE={metrics['mape']:.2f}%")


def main():
    """主训练流程"""
    print("=" * 50)
    print("开始训练价格预测模型")
    print("=" * 50)

    # 1. 加载数据
    print("\n[1/5] 加载训练数据...")
    train_df, val_df = load_training_data()
    print(f"训练集: {len(train_df)} 样本")
    print(f"验证集: {len(val_df)} 样本")

    # 2. 特征工程
    print("\n[2/5] 准备特征...")
    X_train, y_train, feature_cols = prepare_features(train_df)
    X_val, y_val, _ = prepare_features(val_df)

    # 标准化
    scaler = StandardScaler()
    X_train_scaled = scaler.fit_transform(X_train)
    X_val_scaled = scaler.transform(X_val)

    # 3. 训练三个分位数模型
    print("\n[3/5] 训练分位数回归模型...")
    quantiles = [0.1, 0.5, 0.9]
    models = {}

    for q in quantiles:
        print(f"  训练 P{int(q*100)} 分位数模型...")
        models[q] = train_quantile_model(X_train_scaled, y_train, X_val_scaled, y_val, q)

    # 4. 评估模型
    print("\n[4/5] 评估模型性能...")
    # 使用P50模型评估
    metrics = evaluate_model(models[0.5], X_val_scaled, y_val)

    # 5. 保存模型
    print("\n[5/5] 保存模型...")
    save_models(models, scaler, feature_cols, metrics)

    print("\n" + "=" * 50)
    print("训练完成!")
    print("=" * 50)


if __name__ == '__main__':
    main()
