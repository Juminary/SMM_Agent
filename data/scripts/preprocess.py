"""
数据预处理脚本
清洗和标准化原始数据
"""

import pandas as pd
import numpy as np
import json
import os
from datetime import datetime


def load_raw_data():
    """加载原始数据"""
    raw_dir = '../../data/raw'

    with open(os.path.join(raw_dir, 'materials.json'), 'r', encoding='utf-8') as f:
        materials_data = json.load(f)

    with open(os.path.join(raw_dir, 'quotes.json'), 'r', encoding='utf-8') as f:
        quotes_data = json.load(f)

    return materials_data, quotes_data


def clean_materials(materials):
    """清洗物料数据"""
    cleaned = []

    for m in materials:
        # 标准化尺寸格式
        dims = m.get('dimensions', '')
        dims = dims.replace('×', 'x').replace('mm', '').replace('cm', '')

        # 确保数值字段有效
        try:
            unit_price = float(m.get('unit_price', 0))
            if unit_price <= 0:
                unit_price = 5.0  # 默认值
        except:
            unit_price = 5.0

        try:
            order_quantity = int(m.get('order_quantity', 10000))
            if order_quantity <= 0:
                order_quantity = 10000
        except:
            order_quantity = 10000

        cleaned.append({
            'id': m.get('id', ''),
            'name': m.get('name', ''),
            'category': m.get('category', '其他'),
            'material_type': m.get('material_type', ''),
            'dimensions': dims,
            'processing': m.get('processing', ''),
            'precision': m.get('precision', ''),
            'supplier_id': m.get('supplier_id', ''),
            'supplier_name': m.get('supplier_name', ''),
            'unit_price': unit_price,
            'order_quantity': order_quantity,
            'order_date': m.get('order_date', '2024-01-01'),
            'description': m.get('description', ''),
            'is_active': m.get('is_active', True)
        })

    return cleaned


def clean_quotes(quotes):
    """清洗报价数据"""
    cleaned = []

    for q in quotes:
        try:
            supplier_quote = float(q.get('supplier_quote', 0))
            if supplier_quote <= 0:
                supplier_quote = 5.0
        except:
            supplier_quote = 5.0

        cleaned.append({
            'id': q.get('id', ''),
            'material_id': q.get('material_id', ''),
            'material_name': q.get('material_name', ''),
            'supplier_quote': supplier_quote,
            'supplier_name': q.get('supplier_name', ''),
            'quantity': q.get('quantity', 10000),
            'quote_date': q.get('quote_date', '2024-01-01'),
            'severity_level': q.get('severity_level', '正常'),
            'status': q.get('status', 'pending'),
            'deviation_score': q.get('deviation_score', 0),
            'ai_prediction_low': q.get('ai_prediction_low', 0),
            'ai_prediction_high': q.get('ai_prediction_high', 0)
        })

    return cleaned


def save_processed_data(materials, quotes):
    """保存清洗后的数据"""
    processed_dir = '../../data/processed'
    os.makedirs(processed_dir, exist_ok=True)

    # 保存为JSON
    with open(os.path.join(processed_dir, 'materials_cleaned.json'), 'w', encoding='utf-8') as f:
        json.dump({'materials': materials}, f, ensure_ascii=False, indent=2)

    with open(os.path.join(processed_dir, 'quotes_cleaned.json'), 'w', encoding='utf-8') as f:
        json.dump({'quotes': quotes}, f, ensure_ascii=False, indent=2)

    # 保存为CSV（方便数据分析）
    df_materials = pd.DataFrame(materials)
    df_materials.to_csv(os.path.join(processed_dir, 'materials.csv'), index=False, encoding='utf-8-sig')

    df_quotes = pd.DataFrame(quotes)
    df_quotes.to_csv(os.path.join(processed_dir, 'quotes.csv'), index=False, encoding='utf-8-sig')

    print(f"清洗后数据已保存到 {processed_dir}")
    print(f"物料: {len(materials)} 条")
    print(f"报价: {len(quotes)} 条")


def main():
    """主流程"""
    print("=" * 50)
    print("开始数据预处理")
    print("=" * 50)

    # 1. 加载原始数据
    print("\n[1/3] 加载原始数据...")
    materials_data, quotes_data = load_raw_data()
    materials = materials_data.get('materials', [])
    quotes = quotes_data.get('quotes', [])
    print(f"物料: {len(materials)} 条")
    print(f"报价: {len(quotes)} 条")

    # 2. 清洗数据
    print("\n[2/3] 清洗数据...")
    cleaned_materials = clean_materials(materials)
    cleaned_quotes = clean_quotes(quotes)

    # 3. 保存数据
    print("\n[3/3] 保存清洗后数据...")
    save_processed_data(cleaned_materials, cleaned_quotes)

    print("\n" + "=" * 50)
    print("预处理完成!")
    print("=" * 50)


if __name__ == '__main__':
    main()
