"""
相似度嵌入模型训练脚本
使用Sentence-BERT生成物料语义向量
"""

import pandas as pd
import numpy as np
from sentence_transformers import SentenceTransformer, InputExample, losses
from torch.utils.data import DataLoader
import pickle
import json
from datetime import datetime
import os


def create_material_description(material):
    """生成物料描述文本"""
    parts = [
        f"物料类别：{material.get('category', '')}",
        f"材料类型：{material.get('material_type', '')}",
        f"加工工艺：{material.get('processing', '')}",
        f"精度要求：{material.get('precision', '')}",
        f"尺寸规格：{material.get('dimensions', '')}",
    ]
    return "，".join(parts)


def load_materials():
    """加载物料数据"""
    import json

    with open('../../data/raw/materials.json', 'r', encoding='utf-8') as f:
        data = json.load(f)

    materials = data.get('materials', [])
    return materials


def generate_training_pairs(materials, n_pairs=1000):
    """生成相似物料训练对"""
    from itertools import combinations
    import random

    pairs = []

    # 按类别分组
    category_groups = {}
    for m in materials:
        cat = m.get('category', '其他')
        if cat not in category_groups:
            category_groups[cat] = []
        category_groups[cat].append(m)

    # 生成正样本（同类物料）
    for cat, group in category_groups.items():
        if len(group) < 2:
            continue
        for m1, m2 in combinations(group[:10], 2):  # 限制每类组合数
            desc1 = create_material_description(m1)
            desc2 = create_material_description(m2)
            pairs.append(InputExample(texts=[desc1, desc2], label=0.8))

    # 生成负样本（不同类物料）
    categories = list(category_groups.keys())
    for _ in range(min(n_pairs, len(pairs))):
        cat1, cat2 = random.sample(categories, 2)
        m1 = random.choice(category_groups[cat1])
        m2 = random.choice(category_groups[cat2])
        desc1 = create_material_description(m1)
        desc2 = create_material_description(m2)
        pairs.append(InputExample(texts=[desc1, desc2], label=0.2))

    return pairs


def train_embedder(train_examples):
    """训练嵌入模型"""
    # 使用中文预训练模型
    model_name = 'paraphrase-multilingual-MiniLM-L12-v2'
    model = SentenceTransformer(model_name)

    # 数据加载器
    train_dataloader = DataLoader(train_examples, shuffle=True, batch_size=16)

    # 损失函数
    train_loss = losses.CosineSimilarityLoss(model)

    # 训练
    model.fit(
        train_objectives=[(train_dataloader, train_loss)],
        epochs=3,
        warmup_steps=100,
        show_progress_bar=True
    )

    return model


def build_faiss_index(model, materials):
    """构建FAISS索引"""
    import faiss

    # 生成所有物料的向量
    descriptions = [create_material_description(m) for m in materials]
    embeddings = model.encode(descriptions, show_progress_bar=True)

    # 创建FAISS索引
    dimension = embeddings.shape[1]
    index = faiss.IndexFlatIP(dimension)  # 内积索引（余弦相似度）

    # 归一化向量
    faiss.normalize_L2(embeddings)
    index.add(embeddings)

    return index, embeddings


def save_model(model, index, embeddings, materials):
    """保存模型和索引"""
    model_dir = '../models/similarity_embedder'
    os.makedirs(model_dir, exist_ok=True)

    # 保存模型
    model.save(f'{model_dir}/embedder')

    # 保存FAISS索引
    faiss.write_index(index, f'{model_dir}/index.faiss')

    # 保存向量
    np.save(f'{model_dir}/embeddings.npy', embeddings)

    # 保存物料ID映射
    material_ids = [m['id'] for m in materials]
    with open(f'{model_dir}/material_ids.json', 'w', encoding='utf-8') as f:
        json.dump(material_ids, f, ensure_ascii=False)

    # 保存元数据
    metadata = {
        'version': '1.0.0',
        'created_at': datetime.now().isoformat(),
        'model_name': 'paraphrase-multilingual-MiniLM-L12-v2',
        'embedding_dim': embeddings.shape[1],
        'num_materials': len(materials),
        'training_pairs': len(train_examples)
    }

    with open(f'{model_dir}/metadata.json', 'w', encoding='utf-8') as f:
        json.dump(metadata, f, ensure_ascii=False, indent=2)

    print(f"模型已保存到 {model_dir}")


def main():
    """主训练流程"""
    print("=" * 50)
    print("开始训练相似度嵌入模型")
    print("=" * 50)

    # 1. 加载物料数据
    print("\n[1/4] 加载物料数据...")
    materials = load_materials()
    print(f"共 {len(materials)} 条物料")

    # 2. 生成训练对
    print("\n[2/4] 生成训练样本对...")
    train_examples = generate_training_pairs(materials)
    print(f"生成 {len(train_examples)} 个训练对")

    # 3. 训练模型
    print("\n[3/4] 训练Sentence-BERT模型...")
    model = train_embedder(train_examples)

    # 4. 构建索引
    print("\n[4/4] 构建FAISS索引...")
    index, embeddings = build_faiss_index(model, materials)

    # 5. 保存模型
    print("\n保存模型...")
    save_model(model, index, embeddings, materials)

    print("\n" + "=" * 50)
    print("训练完成!")
    print("=" * 50)


if __name__ == '__main__':
    main()
