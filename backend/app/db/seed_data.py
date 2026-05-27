"""
大规模测试数据生成器

生成内容：
  - 物料主数据（~500 条，覆盖 8 个品类）
  - 报价分析记录（~200 条，含正常和异常）
  - 原材料价格数据（按品类和材质）
  - 工艺费率数据
  - 刷新供应商画像

使用方式：
    python -m app.db.seed_data
    python -m app.db.seed_data --reset   # 清空重新生成
"""

import os
import sys
import json
import random
from datetime import datetime, timedelta
from typing import List, Dict, Any


# =============================================================================
# 配置
# =============================================================================

CATEGORIES = {
    "塑料外壳": {
        "material_types": ["ABS", "PC", "ABS+PC", "PP", "PA66"],
        "processing": ["注塑成型", "注塑成型+喷涂", "注塑成型+电镀", "双色注塑"],
        "precision": ["±0.1mm", "±0.05mm", "±0.2mm", "±0.15mm"],
        "price_range": (1.5, 25.0),
        "dimensions_pool": ["80×60×15mm", "100×80×20mm", "60×40×10mm", "120×90×25mm", "45×30×8mm"],
    },
    "PCB板": {
        "material_types": ["FR-4", "FR-4 High-Tg", "铝基板", "柔性FPC", "CEM-1"],
        "processing": ["SMT贴片", "沉金+SMT", "OSP+SMT", "COB绑定", "DIP插件"],
        "precision": ["±0.05mm", "±0.1mm", "±0.03mm", "±0.08mm"],
        "price_range": (3.0, 80.0),
        "dimensions_pool": ["50×30×1.6mm", "80×60×1.6mm", "100×100×1.6mm", "30×20×0.8mm", "120×80×2.0mm"],
    },
    "传感器": {
        "material_types": ["光电", "压力", "温度", "霍尔", "红外"],
        "processing": ["COB封装", "SMT封装", "TO封装", "DIP封装"],
        "precision": ["±0.01mm", "±0.02mm", "±0.005mm"],
        "price_range": (5.0, 150.0),
        "dimensions_pool": ["5×5×2mm", "10×10×5mm", "3×3×1mm", "8×8×3mm", "15×10×5mm"],
    },
    "按键": {
        "material_types": ["硅胶", "PC", "ABS", "TPE", "P+R"],
        "processing": ["模压成型", "注塑+喷涂", "镭雕", "丝印"],
        "precision": ["±0.1mm", "±0.15mm", "±0.2mm"],
        "price_range": (0.3, 8.0),
        "dimensions_pool": ["10×10×5mm", "6×6×4mm", "12×12×6mm", "8×8×3mm", "15×15×8mm"],
    },
    "袖带": {
        "material_types": ["尼龙", "TPU", "硅胶", "涤纶"],
        "processing": ["缝制", "热压成型", "超声波焊接"],
        "precision": ["±1mm", "±0.5mm", "±2mm"],
        "price_range": (2.0, 35.0),
        "dimensions_pool": ["500×130mm", "400×120mm", "600×150mm", "350×100mm"],
    },
    "显示屏": {
        "material_types": ["LCD段码", "TFT彩屏", "OLED", "电子纸", "LED点阵"],
        "processing": ["COG绑定", "COF绑定", "TAB绑定"],
        "precision": ["±0.05mm", "±0.03mm", "±0.1mm"],
        "price_range": (8.0, 200.0),
        "dimensions_pool": ["45×30×2mm", "60×45×3mm", "35×25×1.5mm", "80×60×4mm"],
    },
    "电池": {
        "material_types": ["锂聚合物", "锂离子18650", "纽扣CR2032", "镍氢AAA"],
        "processing": ["PCM保护板焊接", "封装成型", "点焊组装"],
        "precision": ["±0.2mm", "±0.5mm", "±0.1mm"],
        "price_range": (1.0, 60.0),
        "dimensions_pool": ["50×30×5mm", "40×25×4mm", "18×65mm", "20×3.2mm"],
    },
    "连接器": {
        "material_types": ["铜合金", "磷青铜", "不锈钢", "黄铜"],
        "processing": ["冲压成型", "注塑嵌件", "电镀"],
        "precision": ["±0.03mm", "±0.05mm", "±0.1mm"],
        "price_range": (0.5, 15.0),
        "dimensions_pool": ["10×5×3mm", "15×8×4mm", "8×4×2mm", "20×10×5mm"],
    },
}

SUPPLIERS = [
    {"name": "华塑科技", "tier": 1, "price_factor": 0.95},   # 略低
    {"name": "精工电子", "tier": 1, "price_factor": 1.02},
    {"name": "鑫达注塑", "tier": 2, "price_factor": 1.10},   # 偏高
    {"name": "博源精密", "tier": 1, "price_factor": 0.92},   # 便宜
    {"name": "恒泰电子", "tier": 2, "price_factor": 1.08},
    {"name": "永利达塑胶", "tier": 3, "price_factor": 1.20}, # 贵
    {"name": "盛达电子", "tier": 1, "price_factor": 0.98},
    {"name": "天工精密", "tier": 2, "price_factor": 1.05},
    {"name": "宏达模具", "tier": 2, "price_factor": 1.12},
    {"name": "联创电子", "tier": 1, "price_factor": 0.97},
    {"name": "新锐科技", "tier": 3, "price_factor": 1.25},   # 很贵
    {"name": "嘉和塑胶", "tier": 2, "price_factor": 1.03},
]

EXTERNAL_MARKET_DATA = {
    "塑料外壳": {"low": 1.2, "high": 22.0, "source": "1688+B2B平台", "count": 200},
    "PCB板":    {"low": 2.5, "high": 75.0, "source": "华强北+1688", "count": 180},
    "传感器":   {"low": 4.0, "high": 140.0, "source": "1688+原厂报价", "count": 100},
    "按键":     {"low": 0.2, "high": 7.5, "source": "1688", "count": 300},
    "袖带":     {"low": 1.5, "high": 32.0, "source": "B2B平台+行业报告", "count": 80},
    "显示屏":   {"low": 6.0, "high": 190.0, "source": "屏厂报价+1688", "count": 120},
    "电池":     {"low": 0.8, "high": 55.0, "source": "1688+行业报价", "count": 150},
    "连接器":   {"low": 0.3, "high": 14.0, "source": "1688", "count": 250},
}

RAW_MATERIAL_MARKET = [
    {"type": "ABS", "spec": "通用级", "unit": "元/kg", "base_price": 15.0, "volatility": 0.08},
    {"type": "PC", "spec": "通用级", "unit": "元/kg", "base_price": 22.0, "volatility": 0.06},
    {"type": "PP", "spec": "通用级", "unit": "元/kg", "base_price": 9.0, "volatility": 0.10},
    {"type": "PA66", "spec": "通用级", "unit": "元/kg", "base_price": 28.0, "volatility": 0.07},
    {"type": "FR-4", "spec": "1.6mm板材", "unit": "元/m²", "base_price": 120.0, "volatility": 0.05},
    {"type": "铜箔", "spec": "1oz", "unit": "元/m²", "base_price": 85.0, "volatility": 0.12},
    {"type": "硅胶", "spec": "通用级", "unit": "元/kg", "base_price": 35.0, "volatility": 0.05},
    {"type": "尼龙", "spec": "PA6", "unit": "元/kg", "base_price": 18.0, "volatility": 0.08},
    {"type": "铜合金", "spec": "C2680", "unit": "元/kg", "base_price": 65.0, "volatility": 0.10},
    {"type": "TPU", "spec": "医疗级", "unit": "元/kg", "base_price": 45.0, "volatility": 0.06},
]

PROCESSING_RATE_DATA = [
    {"process": "注塑成型", "rate": 80, "hours": 0.002, "region": "珠三角", "tier": "标准"},
    {"process": "注塑成型+喷涂", "rate": 120, "hours": 0.003, "region": "珠三角", "tier": "标准"},
    {"process": "SMT贴片", "rate": 200, "hours": 0.001, "region": "深圳", "tier": "精密"},
    {"process": "COB绑定", "rate": 300, "hours": 0.0005, "region": "深圳", "tier": "精密"},
    {"process": "冲压成型", "rate": 100, "hours": 0.0015, "region": "东莞", "tier": "标准"},
    {"process": "注塑+电镀", "rate": 150, "hours": 0.004, "region": "珠三角", "tier": "中高端"},
    {"process": "缝制", "rate": 50, "hours": 0.05, "region": "珠三角", "tier": "标准"},
    {"process": "热压成型", "rate": 90, "hours": 0.008, "region": "珠三角", "tier": "标准"},
    {"process": "镭雕", "rate": 60, "hours": 0.0003, "region": "深圳", "tier": "精密"},
]


def _db():
    """延迟导入，避免循环依赖"""
    from app.db.database import (
        init_db, get_connection, get_all_materials,
        insert_material, insert_quote,
        refresh_supplier_profiles,
    )
    return (init_db, get_connection, get_all_materials,
            insert_material, insert_quote, refresh_supplier_profiles)


def seed(seed_val: int = 42, reset: bool = False):
    """主入口"""
    random.seed(seed_val)

    init_db, get_connection, get_all_materials, \
        insert_material, insert_quote, refresh_supplier_profiles = _db()

    init_db()
    conn = get_connection()

    try:
        existing = get_all_materials(conn)
        if reset or len(existing) < 20:

            if reset:
                conn.execute("DELETE FROM quotes")
                conn.execute("DELETE FROM materials")
                conn.execute("DELETE FROM external_references")
                conn.execute("DELETE FROM industry_benchmarks")
                conn.execute("DELETE FROM raw_material_prices")
                conn.execute("DELETE FROM processing_rates")
                conn.commit()
                print("已清空旧数据")

            print("=" * 60)
            print("开始生成测试数据...")
            print("=" * 60)

            # 1. 物料
            n_materials = generate_materials(conn, count=500)
            print(f"  ✓ 物料: {n_materials} 条")

            # 2. 报价
            n_quotes = generate_quotes(conn, count=200)
            print(f"  ✓ 报价分析: {n_quotes} 条")

            # 3. 原材料价格
            n_rm = generate_raw_material_prices(conn)
            print(f"  ✓ 原材料价格: {n_rm} 条")

            # 4. 工艺费率
            n_pr = generate_processing_rates(conn)
            print(f"  ✓ 工艺费率: {n_pr} 条")

            # 5. 外部参考
            n_ext = generate_external_references(conn)
            print(f"  ✓ 外部参考: {n_ext} 条")

            # 5.5 库存
            n_inv = generate_inventory(conn, materials_count=n_materials)
            print(f"  ✓ 库存: {n_inv} 条")

            # 6. 刷新供应商画像
            refresh_supplier_profiles(conn)
            print(f"  ✓ 供应商画像已刷新")

            print("=" * 60)
            print("数据生成完成")
            print("=" * 60)
        else:
            print(f"已有 {len(existing)} 条物料数据，跳过生成（使用 --reset 强制重新生成）")

    finally:
        conn.close()


def generate_materials(conn, count: int = 500) -> int:
    """生成物料主数据"""
    from app.db.database import insert_material
    materials_generated = 0
    today = datetime.now()

    for i in range(count):
        cat_name = random.choice(list(CATEGORIES.keys()))
        cat = CATEGORIES[cat_name]
        supplier = random.choice(SUPPLIERS)

        material_type = random.choice(cat["material_types"])
        processing = random.choice(cat["processing"])
        precision = random.choice(cat["precision"])
        dims = random.choice(cat["dimensions_pool"])

        # 基准价格（品类中位数附近）
        p_min, p_max = cat["price_range"]
        base_price = round(random.uniform(p_min + (p_max - p_min) * 0.2,
                                          p_min + (p_max - p_min) * 0.6), 2)

        # 供应商价格因子 + 随机波动
        unit_price = round(base_price * supplier["price_factor"] * random.uniform(0.85, 1.15), 2)
        unit_price = max(p_min * 0.8, min(p_max * 1.2, unit_price))

        qty = random.choice([1000, 3000, 5000, 10000, 20000, 50000, 100000])
        # 数量折扣
        if qty >= 50000:
            unit_price *= 0.85
        elif qty >= 20000:
            unit_price *= 0.92
        elif qty <= 3000:
            unit_price *= 1.08

        unit_price = round(unit_price, 2)

        order_date = (today - timedelta(days=random.randint(30, 730))).strftime("%Y-%m-%d")

        material = {
            "id": f"MAT-{i+1:04d}",
            "name": f"{cat_name[:2]}-{material_type}-{processing.split('+')[0][:2]}-{dims.split('×')[0]}",
            "category": cat_name,
            "material_type": material_type,
            "dimensions": dims,
            "processing": processing,
            "precision": precision,
            "supplier_id": f"SUP-{SUPPLIERS.index(supplier)+1:03d}",
            "supplier_name": supplier["name"],
            "unit_price": unit_price,
            "order_quantity": qty,
            "order_date": order_date,
            "description": f"{cat_name} - {material_type} - {processing}",
            "is_active": True,
        }
        insert_material(conn, material)
        materials_generated += 1

    conn.commit()
    return materials_generated


def generate_quotes(conn, count: int = 200) -> int:
    """生成报价分析记录"""
    from app.db.database import get_all_materials, insert_quote
    materials = get_all_materials(conn)

    if not materials:
        print("  ⚠ 无物料数据，跳过报价生成")
        return 0

    generated = 0
    today = datetime.now()

    statuses = ["pending"] * 40 + ["approved"] * 30 + ["rejected"] * 15 + ["negotiate"] * 15
    severities = ["正常"] * 30 + ["关注"] * 25 + ["警示"] * 25 + ["紧急"] * 20

    for i in range(count):
        mat = random.choice(materials)

        # 生成报价：要么正常要么偏离
        anomaly_type = random.choices(
            ["normal", "moderate", "extreme"],
            weights=[0.40, 0.40, 0.20]
        )[0]

        base_price = mat["unit_price"]
        if anomaly_type == "normal":
            supplier_quote = round(base_price * random.uniform(0.90, 1.10), 2)
        elif anomaly_type == "moderate":
            supplier_quote = round(base_price * random.uniform(1.15, 1.40), 2)
        else:
            supplier_quote = round(base_price * random.uniform(1.50, 2.50), 2)

        quantity = random.choice([1000, 5000, 10000, 20000, 50000])

        severity = random.choice(severities)
        status = random.choice(statuses)

        quote = {
            "id": f"Q-{i+1:04d}",
            "material_id": mat["id"],
            "material_name": mat["name"],
            "supplier_quote": supplier_quote,
            "supplier_name": random.choice(SUPPLIERS)["name"],
            "quantity": quantity,
            "quote_date": (today - timedelta(days=random.randint(0, 180))).strftime("%Y-%m-%d"),
            "category": mat["category"],
            "material_type": mat.get("material_type", ""),
            "processing": mat.get("processing", ""),
            "description": mat.get("description", ""),
            "deviation_score": random.uniform(5, 95) if anomaly_type != "normal" else random.uniform(0, 18),
            "severity_level": severity,
            "severity_color": {"正常": "#10b981", "关注": "#f59e0b", "警示": "#f97316", "紧急": "#f43f5e"}.get(severity, "#10b981"),
            "price_deviation": round(random.uniform(0, 200), 1) if anomaly_type != "normal" else round(random.uniform(0, 15), 1),
            "cost_deviation": round(random.uniform(0, 80), 1),
            "market_deviation": round(random.uniform(0, 150), 1) if anomaly_type == "extreme" else round(random.uniform(0, 30), 1),
            "phase": "fast_pass" if severity == "正常" else "diagnosis",
            "interrupt_severity": "mandatory" if severity == "紧急" else ("optional" if severity in ("关注", "警示") else None),
            "status": status,
            "solutions": json.dumps(generate_random_solutions(supplier_quote, severity), ensure_ascii=False),
            "execution_trace": json.dumps(generate_random_trace(severity), ensure_ascii=False),
            "total_duration_ms": random.uniform(500, 15000),
            "created_at": (today - timedelta(days=random.randint(0, 90))).isoformat(),
        }
        insert_quote(conn, quote)
        generated += 1

    conn.commit()
    return generated


def generate_random_solutions(price: float, severity: str) -> List[Dict]:
    solutions = []
    if severity == "正常":
        solutions.append({
            "id": "SOL-A", "title": "直接通过",
            "description": f"报价¥{price}在合理区间内",
            "confidence": 0.95, "estimated_savings": "¥0", "action": "accept"
        })
    elif severity == "紧急":
        solutions.extend([
            {"id": "SOL-A", "title": "紧急议价", "description": f"以¥{price*0.8:.2f}为目标谈判",
             "confidence": 0.85, "estimated_savings": f"¥{price*0.2:.0f}", "action": "negotiate"},
            {"id": "SOL-B", "title": "二次询价", "description": "向3家替代供应商询价",
             "confidence": 0.72, "estimated_savings": "待定", "action": "requote"},
            {"id": "SOL-C", "title": "升级处理", "description": "上报采购经理评审",
             "confidence": 0.90, "estimated_savings": "需评审", "action": "escalate"},
        ])
    else:
        solutions.append({
            "id": "SOL-A", "title": "议价谈判",
            "description": f"报价¥{price}高于预期，建议议价至¥{price*0.9:.2f}",
            "confidence": 0.80, "estimated_savings": f"¥{price*0.1:.0f}", "action": "negotiate"
        })
    return solutions


def generate_random_trace(severity: str) -> List[Dict]:
    trace = [
        {"step": "物料构造", "status": "completed", "duration_ms": 2.1,
         "output": "物料=测试物料, 类别=塑料外壳, 报价=¥12.5"},
        {"step": "价格预测", "status": "completed", "duration_ms": 3.5,
         "output": "P10=¥8.5 / P50=¥10.2 / P90=¥13.0"},
        {"step": "成本拆解", "status": "completed", "duration_ms": 2.8,
         "output": "成本偏离分=35.2, 异常项=2"},
        {"step": "相似物料检索", "status": "completed", "duration_ms": 1.5,
         "output": "检索到 5 条相似物料"},
        {"step": "偏离度评分", "status": "completed", "duration_ms": 4.2,
         "output": "偏离度=45.3分 (警示)，价格=68.5% / 成本=35.2% / 市场=12.0%"},
    ]

    if severity != "正常":
        trace.append({
            "step": "分流决策", "status": "completed", "duration_ms": 0.5,
            "output": f"偏离度=45.3分 → {severity}级诊断"
        })
        trace.append({
            "step": "诊断启动", "status": "completed", "duration_ms": 1.2,
            "output": "生成 2 个初始假设: 供应商系统性溢价; 原材料市场行情上涨"
        })

    return trace


def generate_raw_material_prices(conn) -> int:
    """生成原材料市场价格时序数据"""
    today = datetime.now()
    count = 0

    for item in RAW_MATERIAL_MARKET:
        base = item["base_price"]
        vol = item["volatility"]
        for week_offset in range(24):  # 24 weeks of data
            date = today - timedelta(weeks=week_offset)
            # 随机游走
            price = round(base * (1 + random.gauss(0, vol) + (week_offset - 12) * 0.002), 2)
            price = max(base * 0.7, min(base * 1.3, price))

            conn.execute(
                """INSERT INTO raw_material_prices (material_type, specification, unit, unit_price, price_date, source)
                   VALUES (?, ?, ?, ?, ?, ?)""",
                (item["type"], item["spec"], item["unit"], price,
                 date.strftime("%Y-%m-%d"), "1688+期货行情"),
            )
            count += 1

    conn.commit()
    return count


def generate_processing_rates(conn) -> int:
    """生成工艺费率数据"""
    for item in PROCESSING_RATE_DATA:
        conn.execute(
            """INSERT INTO processing_rates (process_type, machine_rate, standard_hours, unit, region, supplier_tier)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (item["process"], item["rate"], item["hours"], "元/小时", item["region"], item["tier"]),
        )
    conn.commit()
    return len(PROCESSING_RATE_DATA)


def generate_external_references(conn) -> int:
    """生成外部参考数据"""
    conn.execute("DELETE FROM external_references")
    for cat, data in EXTERNAL_MARKET_DATA.items():
        conn.execute(
            """INSERT INTO external_references (material_category, price_low, price_high, source, sample_count)
               VALUES (?, ?, ?, ?, ?)""",
            (cat, data["low"], data["high"], data["source"], data["count"]),
        )
    conn.commit()
    return len(EXTERNAL_MARKET_DATA)


def generate_inventory(conn, materials_count: int = 500) -> int:
    """为部分物料生成模拟库存数据"""
    today = datetime.now()
    count = 0

    # 取部分物料（~60%），模拟真实场景中不是所有物料都有库存记录
    materials = list(conn.execute(
        "SELECT id, name, category, supplier_name FROM materials LIMIT ?",
        (int(materials_count * 0.6),)
    ).fetchall())

    for m in materials:
        # 随机库存参数
        daily_use = random.choice([5, 10, 20, 50, 100, 200, 500])
        stock = random.randint(0, daily_use * random.choice([3, 7, 14, 30, 60]))
        safety = int(daily_use * random.choice([3, 5, 7, 10]))
        days = int(stock / daily_use) if daily_use > 0 else 0

        # 紧急度判定
        if days <= 3:
            urgency = "紧急"
        elif days <= 7:
            urgency = "关注"
        elif days <= 14:
            urgency = "正常"
        else:
            urgency = "充裕"

        last_restock = (today - timedelta(days=random.randint(5, 90))).strftime("%Y-%m-%d")

        conn.execute(
            """INSERT INTO inventory
               (material_id, material_name, category, current_stock, safety_stock,
                daily_consumption, days_remaining, urgency, last_restock_date,
                supplier_name, note)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                m["id"], m["name"], m["category"],
                stock, safety, daily_use, days, urgency, last_restock,
                m["supplier_name"],
                "模拟数据" if urgency == "紧急" else "",
            ),
        )
        count += 1

    conn.commit()
    return count


if __name__ == "__main__":
    reset = "--reset" in sys.argv
    seed(reset=reset)
