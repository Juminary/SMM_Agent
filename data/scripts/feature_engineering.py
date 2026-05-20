"""
特征工程脚本
生成模型训练所需的特征
"""

import pandas as pd
import numpy as np
import json
import pickle
import os
from sklearn.preprocessing import LabelEncoder, StandardScaler


def parse_dimensions(dims_str):
    """解析尺寸字符串，计算体积和表面积"""
    try:
        dims_str = str(dims_str).lower().replace('×', 'x').replace('mm', '').replace('cm', '')
        dims = [float(x) for x in dims_str.split('x')]

        if len(dims) >= 3:
            # 长方体体积
            volume = dims[0] * dims[1] * dims[2]
            # 表面积
            surface = 2 * (dims[0]*dims[1] + dims[1]*dims[2] + dims[0]*dims[2])
            return volume, surface
        elif len(dims) == 2:
            # 平面
            volume = dims[0] * dims[1] * 1.0
            surface = dims[0] * dims[1]
            return volume, surface
        else:
            return 0.0, 0.0
    except:
        return 0.0, 0.0


def calculate_complexity(row):
    """计算物料复杂度"""
    complexity = 0.5

    # 工艺复杂度
    processing = str(row.get('processing', ''))
    if '+' in processing:
        complexity += 0.2
    if '沉金' in processing or '镀金' in processing:
        complexity += 0.15
    if '多层' in processing:
        complexity += 0.1

    # 精度复杂度
    precision = str(row.get('precision', ''))
    if '±0.01' in precision:
        complexity += 0.15
    elif '±0.05' in precision:
        complexity += 0.1
    elif '±0.1' in precision:
        complexity += 0.05

    return min(1.0, complexity)


def engineer_material_features(df):
    """物料特征工程"""
    # 类别编码
    le_category = LabelEncoder()
    df['category_encoded'] = le_category.fit_transform(df['category'].fillna('其他'))

    le_material = LabelEncoder()
    df['material_type_encoded'] = le_material.fit_transform(df['material_type'].fillna('未知'))

    le_processing = LabelEncoder()
    df['processing_encoded'] = le_processing.fit_transform(df['processing'].fillna('未知'))

    le_precision = LabelEncoder()
    df['precision_encoded'] = le_precision.fit_transform(df['precision'].fillna('未知'))

    # 尺寸特征
    df[['volume_cm3', 'surface_area_cm2']] = df['dimensions'].apply(
        lambda x: pd.Series(parse_dimensions(x))
    )

    # 复杂度
    df['complexity_score'] = df.apply(calculate_complexity, axis=1)

    # 保存编码器
    encoders = {
        'category': le_category,
        'material_type': le_material,
        'processing': le_processing,
        'precision': le_precision
    }

    return df, encoders


def engineer_quote_features(df_quotes, df_materials):
    """报价特征工程"""
    # 提取时间特征
    df_quotes['quote_date'] = pd.to_datetime(df_quotes['quote_date'])
    df_quotes['year'] = df_quotes['quote_date'].dt.year
    df_quotes['month'] = df_quotes['quote_date'].dt.month
    df_quotes['quarter'] = df_quotes['quote_date'].dt.quarter

    # 计算供应商统计特征
    supplier_stats = df_quotes.groupby('supplier_name').agg({
        'supplier_quote': ['count', 'mean', 'std'],
        'deviation_score': 'mean'
    }).reset_index()
    supplier_stats.columns = ['supplier_name', 'history_count', 'avg_price', 'price_std', 'avg_deviation']

    # 合并到报价表
    df_quotes = df_quotes.merge(supplier_stats, on='supplier_name', how='left')

    # 填充缺失值
    df_quotes['history_count'] = df_quotes['history_count'].fillna(0)
    df_quotes['avg_deviation'] = df_quotes['avg_deviation'].fillna(0)

    return df_quotes


def save_features_and_encoders(material_df, quote_df, encoders, scalers):
    """保存特征和编码器"""
    processed_dir = '../../data/processed'
    features_dir = os.path.join(processed_dir, 'features')
    pipeline_dir = os.path.join(processed_dir, 'pipeline')

    os.makedirs(features_dir, exist_ok=True)
    os.makedirs(pipeline_dir, exist_ok=True)

    # 保存特征数据
    material_df.to_parquet(os.path.join(features_dir, 'material_features.parquet'), index=False)
    quote_df.to_parquet(os.path.join(features_dir, 'quote_features.parquet'), index=False)

    # 保存编码器
    with open(os.path.join(pipeline_dir, 'encoders.pkl'), 'wb') as f:
        pickle.dump(encoders, f)

    # 保存标准化器
    with open(os.path.join(pipeline_dir, 'scalers.pkl'), 'wb') as f:
        pickle.dump(scalers, f)

    # 保存特征配置
    feature_config = {
        'material_features': [
            'category_encoded', 'material_type_encoded', 'processing_encoded',
            'precision_encoded', 'volume_cm3', 'surface_area_cm2', 'complexity_score'
        ],
        'quote_features': [
            'category_encoded', 'material_type_encoded', 'processing_encoded',
            'precision_encoded', 'quantity', 'month', 'year',
            'volume_cm3', 'surface_area_cm2', 'complexity_score',
            'history_count', 'avg_deviation'
        ],
        'target': 'unit_price'
    }

    with open(os.path.join(pipeline_dir, 'feature_config.json'), 'w', encoding='utf-8') as f:
        json.dump(feature_config, f, ensure_ascii=False, indent=2)

    print(f"特征已保存到 {features_dir}")
    print(f"编码器已保存到 {pipeline_dir}")


def main():
    """主流程"""
    print("=" * 50)
    print("开始特征工程")
    print("=" * 50)

    # 1. 加载清洗后的数据
    print("\n[1/3] 加载清洗数据...")
    processed_dir = '../../data/processed'
    df_materials = pd.read_csv(os.path.join(processed_dir, 'materials.csv'))
    df_quotes = pd.read_csv(os.path.join(processed_dir, 'quotes.csv'))
    print(f"物料: {len(df_materials)} 条")
    print(f"报价: {len(df_quotes)} 条")

    # 2. 物料特征工程
    print("\n[2/3] 生成物料特征...")
    df_materials, encoders = engineer_material_features(df_materials)
    print(f"物料特征: {df_materials.shape[1]} 维")

    # 3. 报价特征工程
    print("\n[3/3] 生成报价特征...")
    df_quotes = engineer_quote_features(df_quotes, df_materials)
    print(f"报价特征: {df_quotes.shape[1]} 维")

    # 4. 标准化数值特征
    print("\n标准化数值特征...")
    scalers = {}
    numeric_cols = ['volume_cm3', 'surface_area_cm2', 'unit_price']
    for col in numeric_cols:
        if col in df_materials.columns:
            scaler = StandardScaler()
            df_materials[col] = scaler.fit_transform(df_materials[[col]])
            scalers[col] = scaler

    # 5. 保存
    print("\n保存特征...")
    save_features_and_encoders(df_materials, df_quotes, encoders, scalers)

    print("\n" + "=" * 50)
    print("特征工程完成!")
    print("=" * 50)


if __name__ == '__main__':
    main()
