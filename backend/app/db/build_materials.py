"""
构建企业历史采购记录 (materials 表)
模拟九安医疗过去18个月的真实采购数据
"""

import sqlite3, json, random, os
from datetime import datetime, timedelta
from collections import defaultdict

DB_PATH = os.path.join(os.path.dirname(__file__), "..", "..", "..", "data", "smm_agent.db")
random.seed(42)

# ============================================================
# 物料主数据：医疗设备 BOM 常用物料
# ============================================================
MATERIAL_DEFS = [
    # (name, category, material_type, processing, precision, dimensions, typical_price)
    # ---- 塑料外壳 (血压计/血糖仪/体温计/雾化器外壳) ----
    ("ABS血压计外壳-标准款", "塑料外壳", "ABS", "注塑成型", "±0.1mm", "120×80×25mm", 8.50),
    ("ABS血压计外壳-大屏款", "塑料外壳", "ABS", "注塑成型", "±0.1mm", "140×90×30mm", 9.80),
    ("PC血糖仪外壳", "塑料外壳", "PC", "注塑成型+喷涂", "±0.05mm", "60×35×15mm", 5.20),
    ("ABS+PC体温计壳", "塑料外壳", "ABS+PC", "双色注塑", "±0.08mm", "45×20×10mm", 3.80),
    ("PP试剂盒外壳", "塑料外壳", "PP", "注塑成型", "±0.2mm", "100×60×30mm", 2.50),
    ("PA66雾化器外壳", "塑料外壳", "PA66", "注塑成型", "±0.1mm", "80×50×40mm", 7.00),
    ("ABS耳温枪外壳", "塑料外壳", "ABS", "注塑成型+电镀", "±0.05mm", "55×30×20mm", 6.80),
    ("PC血氧仪外壳", "塑料外壳", "PC", "注塑成型", "±0.05mm", "50×30×20mm", 4.90),

    # ---- PCB板 (主控板/采集板/控制板) ----
    ("血压计主控板FR4-双面板", "PCB板", "FR-4", "沉金+SMT", "±0.05mm", "80×50×1.6mm", 22.00),
    ("血压计主控板FR4-四层板", "PCB板", "FR-4 High-Tg", "沉金+SMT", "±0.05mm", "85×55×1.6mm", 28.00),
    ("血糖仪PCB-FR4", "PCB板", "FR-4 High-Tg", "OSP+SMT", "±0.05mm", "40×25×1.0mm", 18.50),
    ("血氧仪铝基板", "PCB板", "铝基板", "SMT贴片", "±0.08mm", "30×20×0.8mm", 12.00),
    ("心电采集柔性板", "PCB板", "柔性FPC", "COB绑定", "±0.03mm", "60×40×0.2mm", 35.00),
    ("雾化器控制板", "PCB板", "CEM-1", "DIP插件", "±0.1mm", "70×45×1.6mm", 9.50),
    ("额温枪控制板FR4", "PCB板", "FR-4", "SMT贴片", "±0.05mm", "50×35×1.2mm", 15.00),

    # ---- 传感器 ----
    ("MEMS压力传感器-血压计", "传感器", "压力", "SMT封装", "±0.01mm", "5×5×2mm", 28.00),
    ("MEMS压力传感器-高精度", "传感器", "压力", "SMT封装", "±0.005mm", "5×5×2mm", 42.00),
    ("红外温度传感器", "传感器", "红外", "TO封装", "±0.005mm", "3×3×1mm", 45.00),
    ("光电心率传感器", "传感器", "光电", "COB封装", "±0.02mm", "8×8×3mm", 32.00),
    ("NTC温度探头-10K", "传感器", "温度", "DIP封装", "±0.02mm", "10×5×3mm", 6.50),
    ("NTC温度探头-100K", "传感器", "温度", "DIP封装", "±0.02mm", "10×5×3mm", 8.50),
    ("霍尔位置传感器", "传感器", "霍尔", "SMT封装", "±0.01mm", "2×2×1mm", 4.80),

    # ---- 显示屏 ----
    ("LCD段码屏-血压计款", "显示屏", "LCD段码", "COG绑定", "±0.05mm", "45×30×2mm", 12.00),
    ("LCD段码屏-血糖仪款", "显示屏", "LCD段码", "COG绑定", "±0.03mm", "35×25×1.5mm", 15.00),
    ("TFT彩屏-血糖仪2.4寸", "显示屏", "TFT彩屏", "COF绑定", "±0.03mm", "35×25×1.5mm", 38.00),
    ("TFT彩屏-血压计3.5寸", "显示屏", "TFT彩屏", "COF绑定", "±0.05mm", "55×40×2mm", 55.00),
    ("OLED显示屏-血氧仪", "显示屏", "OLED", "COG绑定", "±0.05mm", "25×15×1.2mm", 28.00),
    ("电子纸屏-体温贴", "显示屏", "电子纸", "TAB绑定", "±0.1mm", "40×30×1.0mm", 55.00),

    # ---- 电池 ----
    ("锂聚合物电池-3.7V600mAh", "电池", "锂聚合物", "PCM保护板焊接", "±0.2mm", "30×20×5mm", 8.00),
    ("锂聚合物电池-3.7V1200mAh", "电池", "锂聚合物", "PCM保护板焊接", "±0.2mm", "40×25×4mm", 18.00),
    ("18650锂电池-2200mAh", "电池", "锂离子18650", "点焊组装", "±0.5mm", "18×65mm", 15.00),
    ("纽扣电池CR2032", "电池", "纽扣CR2032", "封装成型", "±0.1mm", "20×3.2mm", 1.20),

    # ---- 连接器 ----
    ("FPC连接器-0.5mm-20P", "连接器", "磷青铜", "冲压成型", "±0.05mm", "15×5×3mm", 2.50),
    ("FPC连接器-0.5mm-30P", "连接器", "磷青铜", "冲压成型", "±0.05mm", "20×5×3mm", 3.50),
    ("USB-C连接器-16P沉板", "连接器", "铜合金", "注塑嵌件", "±0.05mm", "8×8×3mm", 1.80),
    ("电池弹片-301不锈钢", "连接器", "不锈钢", "冲压成型+电镀", "±0.1mm", "10×5×2mm", 0.80),
    ("排针-2.54mm-1×10P", "连接器", "黄铜", "冲压成型", "±0.1mm", "25×5×8mm", 0.50),

    # ---- 按键 ----
    ("硅胶按键-血压计6键", "按键", "硅胶", "模压成型", "±0.15mm", "30×15×6mm", 2.80),
    ("硅胶按键-血糖仪3键", "按键", "硅胶", "模压成型", "±0.15mm", "15×10×4mm", 1.20),
    ("PC按键-血糖仪单键", "按键", "PC", "注塑+喷涂", "±0.1mm", "8×8×3mm", 0.60),
    ("TPE防水按键组-4键", "按键", "TPE", "模压成型", "±0.2mm", "20×15×8mm", 3.50),

    # ---- 袖带/耗材 ----
    ("尼龙血压计袖带-标准成人", "袖带", "尼龙", "缝制", "±1mm", "500×130mm", 15.00),
    ("尼龙血压计袖带-大号", "袖带", "尼龙", "缝制", "±1mm", "600×150mm", 18.00),
    ("TPU防水袖带-标准款", "袖带", "TPU", "热压成型", "±0.5mm", "400×120mm", 22.00),
    ("硅胶指套-血氧仪成人", "袖带", "硅胶", "热压成型", "±0.5mm", "50×20×10mm", 3.00),
    ("硅胶指套-血氧仪儿童", "袖带", "硅胶", "热压成型", "±0.5mm", "35×15×8mm", 2.50),
]

# ============================================================
# 供应商 (价格因子模拟不同供应商的定价策略)
# ============================================================
SUPPLIERS = [
    {"name": "华塑科技", "focus": ["塑料外壳", "按键", "袖带"], "factor_range": (1.00, 1.10), "quality": 0.92},
    {"name": "鑫达注塑", "focus": ["塑料外壳", "按键"], "factor_range": (0.90, 1.02), "quality": 0.88},
    {"name": "深圳塑料厂", "focus": ["塑料外壳", "袖带"], "factor_range": (0.85, 0.98), "quality": 0.85},
    {"name": "嘉和塑胶", "focus": ["塑料外壳", "袖带"], "factor_range": (0.95, 1.05), "quality": 0.90},
    {"name": "精工电子", "focus": ["PCB板", "连接器"], "factor_range": (1.02, 1.15), "quality": 0.95},
    {"name": "恒泰电子", "focus": ["PCB板"], "factor_range": (0.95, 1.08), "quality": 0.93},
    {"name": "盛达电子", "focus": ["PCB板", "传感器", "电池"], "factor_range": (0.98, 1.12), "quality": 0.91},
    {"name": "新锐科技", "focus": ["传感器"], "factor_range": (1.08, 1.20), "quality": 0.90},
    {"name": "晶显电子", "focus": ["显示屏"], "factor_range": (1.00, 1.10), "quality": 0.89},
    {"name": "联创电子", "focus": ["显示屏"], "factor_range": (1.05, 1.18), "quality": 0.87},
    {"name": "天工精密", "focus": ["传感器", "连接器", "按键"], "factor_range": (0.98, 1.08), "quality": 0.96},
    {"name": "博源精密", "focus": ["连接器", "按键"], "factor_range": (0.88, 1.00), "quality": 0.86},
    {"name": "永利达塑胶", "focus": ["塑料外壳"], "factor_range": (0.92, 1.05), "quality": 0.83},
    {"name": "宏达模具", "focus": ["塑料外壳", "按键"], "factor_range": (0.95, 1.08), "quality": 0.87},
]

# ============================================================
# 采购场景配置
# 每个 (物料名, 供应商区间, 年采购次数, 每次数量级, 基准价)
# ============================================================

def gen_materials():
    """生成18个月的采购历史"""
    today = datetime.now()
    start_date = today - timedelta(days=540)  # 18 months ago
    records = []

    for mat_def in MATERIAL_DEFS:
        name, category, mat_type, processing, precision, dims, base_price = mat_def

        # 找适合这个品类的供应商
        candidates = [s for s in SUPPLIERS if category in s["focus"]]
        if not candidates:
            candidates = SUPPLIERS[:4]  # fallback

        primary_supplier = random.choice(candidates)
        # 再找1-2家备选供应商
        alt_candidates = [s for s in candidates if s["name"] != primary_supplier["name"]]
        n_alt = min(2, len(alt_candidates))
        alt_suppliers = random.sample(alt_candidates, n_alt) if n_alt > 0 else []

        all_suppliers_used = [primary_supplier] + alt_suppliers

        # 这个物料在18个月内的采购次数 (高频物料每月买，低频每季度)
        if category in ("塑料外壳", "PCB板", "电池"):
            order_count = random.randint(10, 18)
        elif category in ("传感器", "连接器", "按键"):
            order_count = random.randint(6, 12)
        else:
            order_count = random.randint(4, 8)

        for i in range(order_count):
            # 时间均匀分布
            days_offset = int(540 * i / order_count) + random.randint(-10, 10)
            days_offset = max(1, min(540, days_offset))
            order_date = start_date + timedelta(days=days_offset)

            # 选供应商 (80% 主供, 20% 备用)
            if len(all_suppliers_used) == 1:
                supplier = all_suppliers_used[0]
            elif random.random() < 0.8:
                supplier = primary_supplier
            else:
                supplier = random.choice(alt_suppliers) if alt_suppliers else primary_supplier

            # 选数量
            quantity = random.choice([1000, 2000, 3000, 5000, 10000, 15000, 20000, 30000, 50000])

            # 价格 = 基准价 × 供应商因子 × 市场波动 × 数量折扣
            factor = random.uniform(*supplier["factor_range"])
            # 市场波动：整体趋势 + 随机噪声
            months_ago = (today - order_date).days / 30
            market_trend = 1.0 + (random.gauss(0, 0.02))  # ±2% per period
            # 数量折扣
            if quantity >= 50000:
                qty_discount = 0.82
            elif quantity >= 20000:
                qty_discount = 0.90
            elif quantity >= 10000:
                qty_discount = 0.95
            elif quantity <= 2000:
                qty_discount = 1.06
            elif quantity <= 5000:
                qty_discount = 1.02
            else:
                qty_discount = 1.00

            unit_price = round(base_price * factor * market_trend * qty_discount, 2)
            unit_price = max(0.1, unit_price)

            records.append({
                "id": f"MAT-{len(records)+1:04d}",
                "name": name,
                "category": category,
                "material_type": mat_type,
                "dimensions": dims,
                "processing": processing,
                "precision": precision,
                "supplier_id": f"SUP-{SUPPLIERS.index(supplier)+1:03d}",
                "supplier_name": supplier["name"],
                "unit_price": unit_price,
                "order_quantity": quantity,
                "order_date": order_date.strftime("%Y-%m-%d"),
                "description": f"{category} - {mat_type} - {processing}",
                "is_active": True,
            })

    return records


def write_db(records):
    conn = sqlite3.connect(DB_PATH)

    # 清空旧数据
    conn.execute("DELETE FROM materials")
    conn.commit()

    for rec in records:
        conn.execute(
            """INSERT INTO materials
               (id, name, category, material_type, dimensions, processing, precision,
                supplier_id, supplier_name, unit_price, order_quantity, order_date,
                description, is_active)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (rec["id"], rec["name"], rec["category"], rec["material_type"],
             rec["dimensions"], rec["processing"], rec["precision"],
             rec["supplier_id"], rec["supplier_name"], rec["unit_price"],
             rec["order_quantity"], rec["order_date"],
             rec["description"], rec["is_active"]),
        )

    conn.commit()

    # 统计
    cats = conn.execute(
        "SELECT category, COUNT(*) as n, ROUND(AVG(unit_price),2) as avg_p FROM materials GROUP BY category ORDER BY n DESC"
    ).fetchall()
    supps = conn.execute(
        "SELECT supplier_name, COUNT(*) as n FROM materials GROUP BY supplier_name ORDER BY n DESC"
    ).fetchall()

    print(f"写入 {len(records)} 条历史采购记录")
    print(f"\n品类分布:")
    for c in cats:
        print(f"  {c[0]:8s} | {c[1]:3d}条 | 均价¥{c[2]}")
    print(f"\n供应商分布:")
    for s in supps:
        print(f"  {s[0]:8s} | {s[1]:3d}条")

    # 时间跨度
    dates = conn.execute("SELECT MIN(order_date), MAX(order_date) FROM materials").fetchone()
    print(f"\n时间跨度: {dates[0]} ~ {dates[1]}")

    conn.close()


if __name__ == "__main__":
    records = gen_materials()
    write_db(records)
