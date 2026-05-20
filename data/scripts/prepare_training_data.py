"""
准备训练数据脚本
生成模型训练所需的数据集
"""

import pandas as pd
import numpy as np
import os
from sklearn.model_selection import train_test_split


def prepare_price_prediction_data(df_materials, df_quotes):
    """准备价格预测训练数据"""
    # 合并物料和报价特征
    df = df_quotes.merge(
        df_materials[['id', 'category_encoded', 'material_type_encoded',
                     'processing_encoded', 'precision_encoded',
                     'volume_cm3', 'surface_area_cm2', 'complexity_score']],
        left_on='material_id',
        right_on='id',
        how='left'
    )

    # 选择特征列
    feature_cols = [
        'category_encoded', 'material_type_encoded', 'processing_encoded',
        'precision_encoded', 'quantity', 'month', 'year',
        'volume_cm3', 'surface_area_cm2', 'complexity_score'
    ]

    # 目标变量
    target_col = 'supplier_quote'

    # 过滤有效数据
    df = df[df[target_col].notna()]
    df = df[df[target_col] > 0]

    # 构建训练集
    train_data = df[feature_cols + [target_col]].copy()
    train_data.columns = feature_cols + ['unit_price']

    # 划分训练/验证/测试集
    train_val, test = train_test_split(train_data, test_size=0.2, random_state=42)
    train, val = train_test_split(train_val, test_size=0.2, random_state=42)

    return train, val, test


def prepare_similarity_data(df_materials):
    """准备相似度训练数据"""
    # 生成物料对
    pairs = []

    # 同类物料对（正样本）
    categories = df_materials['category'].unique()
    for cat in categories:
        cat_materials = df_materials[df_materials['category'] == cat]
        if len(cat_materials) >= 2:
            for i in range(len(cat_materials)):
                for j in range(i+1, min(i+3, len(cat_materials))):
                    m1 = cat_materials.iloc[i]
                    m2 = cat_materials.iloc[j]
                    pairs.append({
                        'material_id_1': m1['id'],
                        'material_id_2': m2['id'],
                        'category_1': m1['category'],
                        'category_2': m2['category'],
                        'similarity': 0.8 if m1['material_type'] == m2['material_type'] else 0.6
                    })

    # 不同类物料对（负样本）
    for _ in range(min(50, len(pairs))):
        m1 = df_materials.sample(1).iloc[0]
        m2 = df_materials[df_materials['category'] != m1['category']].sample(1).iloc[0]
        pairs.append({
            'material_id_1': m1['id'],
            'material_id_2': m2['id'],
            'category_1': m1['category'],
            'category_2': m2['category'],
            'similarity': 0.2
        })

    df_pairs = pd.DataFrame(pairs)

    # 划分
    train, temp = train_test_split(df_pairs, test_size=0.3, random_state=42)
    val, test = train_test_split(temp, test_size=0.5, random_state=42)

    return train, val, test


def prepare_anomaly_detection_data(df_quotes):
    """准备异常检测训练数据"""
    # 基于偏离度标注异常
    df = df_quotes.copy()

    # 计算综合偏离度
    df['price_deviation'] = df['deviation_score'] / 100.0
    df['cost_deviation'] = np.random.uniform(0, 0.8, len(df))  # 模拟成本偏离
    df['market_deviation'] = np.random.uniform(0, 0.6, len(df))  # 模拟市场偏离

    # 供应商特征
    df['supplier_history_count'] = np.random.randint(1, 50, len(df))
    df['supplier_avg_deviation'] = np.random.uniform(0, 0.5, len(df))
    df['material_complexity'] = np.random.uniform(0.3, 0.9, len(df))

    # 标注异常（偏离度>40或严重级别为紧急/警示）
    df['is_anomaly'] = ((df['deviation_score'] > 40) |
                        (df['severity_level'].isin(['紧急', '警示']))).astype(int)

    # 选择特征
    feature_cols = [
        'price_deviation', 'cost_deviation', 'market_deviation',
        'supplier_history_count', 'supplier_avg_deviation', 'material_complexity'
    ]

    train_data = df[feature_cols + ['is_anomaly']].copy()

    # 划分
    train, temp = train_test_split(train_data, test_size=0.3, random_state=42, stratify=train_data['is_anomaly'])
    val, test = train_test_split(temp, test_size=0.5, random_state=42, stratify=temp['is_anomaly'])

    return train, val, test


def save_training_data(price_train, price_val, price_test,
                       sim_train, sim_val, sim_test,
                       anomaly_train, anomaly_val, anomaly_test):
    """保存训练数据"""
    processed_dir = '../../data/processed'

    # 价格预测数据
    price_dir = os.path.join(processed_dir, 'training', 'price_prediction')
    os.makedirs(price_dir, exist_ok=True)
    price_train.to_csv(os.path.join(price_dir, 'train.csv'), index=False, encoding='utf-8-sig')
    price_val.to_csv(os.path.join(price_dir, 'val.csv'), index=False, encoding='utf-8-sig')
    price_test.to_csv(os.path.join(price_dir, 'test.csv'), index=False, encoding='utf-8-sig')

    # 相似度数据
    sim_dir = os.path.join(processed_dir, 'training', 'similarity')
    os.makedirs(sim_dir, exist_ok=True)
    sim_train.to_csv(os.path.join(sim_dir, 'train.csv'), index=False, encoding='utf-8-sig')
    sim_val.to_csv(os.path.join(sim_dir, 'val.csv'), index=False, encoding='utf-8-sig')
    sim_test.to_csv(os.path.join(sim_dir, 'test.csv'), index=False, encoding='utf-8-sig')

    # 异常检测数据
    anomaly_dir = os.path.join(processed_dir, 'training', 'anomaly_detection')
    os.makedirs(anomaly_dir, exist_ok=True)
    anomaly_train.to_csv(os.path.join(anomaly_dir, 'train.csv'), index=False, encoding='utf-8-sig')
    anomaly_val.to_csv(os.path.join(anomaly_dir, 'val.csv'), index=False, encoding='utf-8-sig')
    anomaly_test.to_csv(os.path.join(anomaly_dir, 'test.csv'), index=False, encoding='utf-8-sig')

    print(f"训练数据已保存到 {processed_dir}/training/")
    print(f"\n价格预测: 训练{len(price_train)} / 验证{len(price_val)} / 测试{len(price_test)}")
    print(f"相似度: 训练{len(sim_train)} / 验证{len(sim_val)} / 测试{len(sim_test)}")
    print(f"异常检测: 训练{len(anomaly_train)} / 验证{len(anomaly_val)} / 测试{len(anomaly_test)}")


def main():
    """主流程"""
    print("=" * 50)
    print("开始准备训练数据")
    print("=" * 50)

    # 1. 加载特征数据
    print("\n[1/4] 加载特征数据...")
    features_dir = '../../data/processed/features'
    df_materials = pd.read_parquet(os.path.join(features_dir, 'material_features.parquet'))
    df_quotes = pd.read_parquet(os.path.join(features_dir, 'quote_features.parquet'))
    print(f"物料: {len(df_materials)} 条")
    print(f"报价: {len(df_quotes)} 条")

    # 2. 准备价格预测数据
    print("\n[2/4] 准备价格预测数据...")
    price_train, price_val, price_test = prepare_price_prediction_data(df_materials, df_quotes)

    # 3. 准备相似度数据
    print("\n[3/4] 准备相似度数据...")
    sim_train, sim_val, sim_test = prepare_similarity_data(df_materials)

    # 4. 准备异常检测数据
    print("\n[4/4] 准备异常检测数据...")
    anomaly_train, anomaly_val, anomaly_test = prepare_anomaly_detection_data(df_quotes)

    # 5. 保存
    print("\n保存训练数据...")
    save_training_data(price_train, price_val, price_test,
                       sim_train, sim_val, sim_test,
                       anomaly_train, anomaly_val, anomaly_test)

    print("\n" + "=" * 50)
    print("训练数据准备完成!")
    print("=" * 50)


if __name__ == '__main__':
    main()
