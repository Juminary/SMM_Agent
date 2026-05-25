"""
数据迁移：JSON 文件 → SQLite

使用方式：
    python -m app.db.migrate
"""

import json
import os
import sys
from app.db.database import (
    init_db, get_db,
    insert_material, insert_quote,
    get_all_materials,
)

# 项目根目录
_PROJECT_ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..")
DATA_DIR = os.path.join(_PROJECT_ROOT, "data", "raw")


def migrate_from_json():
    """将 data/raw/*.json 数据迁移到 SQLite"""
    init_db()

    with get_db() as conn:
        # 1. 迁移物料数据
        materials_path = os.path.join(DATA_DIR, "materials.json")
        if os.path.exists(materials_path):
            with open(materials_path, "r", encoding="utf-8") as f:
                data = json.load(f)
            for m in data.get("materials", []):
                insert_material(conn, m)
            print(f"  ✓ materials: {len(data.get('materials', []))} 条")

        # 2. 迁移外部参考数据
        ext_refs_path = os.path.join(DATA_DIR, "external_references.json")
        if os.path.exists(ext_refs_path):
            with open(ext_refs_path, "r", encoding="utf-8") as f:
                data = json.load(f)

            for ref in data.get("external_references", []):
                conn.execute(
                    """INSERT OR REPLACE INTO external_references
                       (material_category, price_low, price_high, source, sample_count)
                       VALUES (?, ?, ?, ?, ?)""",
                    (
                        ref.get("material_category", ""),
                        ref.get("price_low", 0),
                        ref.get("price_high", 0),
                        ref.get("source", ""),
                        ref.get("sample_count", 0),
                    ),
                )
            print(f"  ✓ external_references: {len(data.get('external_references', []))} 条")

            for key, bench in data.get("industry_benchmarks", {}).items():
                conn.execute(
                    """INSERT OR REPLACE INTO industry_benchmarks
                       (benchmark_key, category_label, raw_material_pct, processing_pct,
                        surface_treatment_pct, packaging_pct, management_profit_pct)
                       VALUES (?, ?, ?, ?, ?, ?, ?)""",
                    (
                        key,
                        "",
                        bench.get("raw_material_pct", 0),
                        bench.get("processing_pct", 0),
                        bench.get("surface_treatment_pct", 0),
                        bench.get("packaging_pct", 0),
                        bench.get("management_profit_pct", 0),
                    ),
                )
            print(f"  ✓ industry_benchmarks: {len(data.get('industry_benchmarks', {}))} 条")

        # 3. 迁移报价数据（如果有）
        quotes_path = os.path.join(DATA_DIR, "quotes.json")
        if os.path.exists(quotes_path):
            with open(quotes_path, "r", encoding="utf-8") as f:
                data = json.load(f)
            for q in data.get("quotes", []):
                insert_quote(conn, q)
            print(f"  ✓ quotes: {len(data.get('quotes', []))} 条")

        # 4. 刷新供应商画像
        from app.db.database import refresh_supplier_profiles
        refresh_supplier_profiles(conn)
        print("  ✓ 供应商画像已刷新")

    print("✅ 数据迁移完成")


if __name__ == "__main__":
    migrate_from_json()
