"""
直接生成高质量历史报价数据，写入 SQLite。
所有数据内部自洽：物料→报价→偏离度→诊断结论→执行轨迹 形成完整逻辑链。
"""

import sqlite3
import json
import random
import sys
import os
from datetime import datetime, timedelta

DB_PATH = os.path.join(os.path.dirname(__file__), "..", "..", "..", "data", "smm_agent.db")

random.seed(42)

# ============================================================
# 物料主数据 — 基于九安医疗真实 BOM 结构
# ============================================================
MATERIALS = [
    # (id, name, category, material_type, processing, precision, dimensions, unit_price)
    # ---- 塑料外壳 ----
    ("MAT-0101", "ABS血压计外壳", "塑料外壳", "ABS", "注塑成型", "±0.1mm", "120×80×25mm", 8.50),
    ("MAT-0102", "PC血糖仪外壳", "塑料外壳", "PC", "注塑成型+喷涂", "±0.05mm", "60×35×15mm", 5.20),
    ("MAT-0103", "ABS+PC体温计壳", "塑料外壳", "ABS+PC", "双色注塑", "±0.08mm", "45×20×10mm", 3.80),
    ("MAT-0104", "PP试剂盒外壳", "塑料外壳", "PP", "注塑成型", "±0.2mm", "100×60×30mm", 2.50),
    ("MAT-0105", "PA66雾化器外壳", "塑料外壳", "PA66", "注塑成型", "±0.1mm", "80×50×40mm", 7.00),
    ("MAT-0106", "ABS耳温枪外壳", "塑料外壳", "ABS", "注塑成型+电镀", "±0.05mm", "55×30×20mm", 6.80),
    # ---- PCB板 ----
    ("MAT-0201", "血压计主控板FR4", "PCB板", "FR-4", "沉金+SMT", "±0.05mm", "80×50×1.6mm", 22.00),
    ("MAT-0202", "血糖仪PCB-FR4", "PCB板", "FR-4 High-Tg", "OSP+SMT", "±0.05mm", "40×25×1.0mm", 18.50),
    ("MAT-0203", "血氧仪铝基板", "PCB板", "铝基板", "SMT贴片", "±0.08mm", "30×20×0.8mm", 12.00),
    ("MAT-0204", "心电采集柔性板", "PCB板", "柔性FPC", "COB绑定", "±0.03mm", "60×40×0.2mm", 35.00),
    ("MAT-0205", "雾化器控制板", "PCB板", "CEM-1", "DIP插件", "±0.1mm", "70×45×1.6mm", 9.50),
    # ---- 传感器 ----
    ("MAT-0301", "MEMS压力传感器", "传感器", "压力", "SMT封装", "±0.01mm", "5×5×2mm", 28.00),
    ("MAT-0302", "红外温度传感器", "传感器", "红外", "TO封装", "±0.005mm", "3×3×1mm", 45.00),
    ("MAT-0303", "光电心率传感器", "传感器", "光电", "COB封装", "±0.02mm", "8×8×3mm", 32.00),
    ("MAT-0304", "NTC温度探头", "传感器", "温度", "DIP封装", "±0.02mm", "10×5×3mm", 6.50),
    ("MAT-0305", "霍尔位置传感器", "传感器", "霍尔", "SMT封装", "±0.01mm", "2×2×1mm", 4.80),
    # ---- 显示屏 ----
    ("MAT-0401", "LCD段码屏-血压计", "显示屏", "LCD段码", "COG绑定", "±0.05mm", "45×30×2mm", 12.00),
    ("MAT-0402", "TFT彩屏-血糖仪", "显示屏", "TFT彩屏", "COF绑定", "±0.03mm", "35×25×1.5mm", 38.00),
    ("MAT-0403", "OLED显示屏-血氧仪", "显示屏", "OLED", "COG绑定", "±0.05mm", "25×15×1.2mm", 28.00),
    ("MAT-0404", "电子纸屏-体温贴", "显示屏", "电子纸", "TAB绑定", "±0.1mm", "40×30×1.0mm", 55.00),
    # ---- 电池 ----
    ("MAT-0501", "锂聚合物电池-600mAh", "电池", "锂聚合物", "PCM保护板焊接", "±0.2mm", "30×20×5mm", 8.00),
    ("MAT-0502", "18650锂电池-2200mAh", "电池", "锂离子18650", "点焊组装", "±0.5mm", "18×65mm", 15.00),
    ("MAT-0503", "纽扣电池CR2032", "电池", "纽扣CR2032", "封装成型", "±0.1mm", "20×3.2mm", 1.20),
    ("MAT-0504", "锂聚合物电池-1200mAh", "电池", "锂聚合物", "PCM保护板焊接", "±0.2mm", "40×25×4mm", 18.00),
    # ---- 连接器 ----
    ("MAT-0601", "FPC连接器-0.5mm间距", "连接器", "磷青铜", "冲压成型", "±0.05mm", "15×5×3mm", 2.50),
    ("MAT-0602", "USB-C连接器-16P", "连接器", "铜合金", "注塑嵌件", "±0.05mm", "8×8×3mm", 1.80),
    ("MAT-0603", "电池弹片-不锈钢", "连接器", "不锈钢", "冲压成型+电镀", "±0.1mm", "10×5×2mm", 0.80),
    # ---- 按键 ----
    ("MAT-0701", "硅胶按键-血压计", "按键", "硅胶", "模压成型", "±0.15mm", "12×12×6mm", 1.20),
    ("MAT-0702", "PC按键-血糖仪", "按键", "PC", "注塑+喷涂", "±0.1mm", "8×8×3mm", 0.60),
    ("MAT-0703", "TPE防水按键组", "按键", "TPE", "模压成型", "±0.2mm", "20×15×8mm", 3.50),
    # ---- 袖带/耗材 ----
    ("MAT-0801", "尼龙血压计袖带-标准", "袖带", "尼龙", "缝制", "±1mm", "500×130mm", 15.00),
    ("MAT-0802", "TPU防水袖带", "袖带", "TPU", "热压成型", "±0.5mm", "400×120mm", 22.00),
    ("MAT-0803", "硅胶指套-血氧仪", "袖带", "硅胶", "热压成型", "±0.5mm", "50×20×10mm", 3.00),
]

# ============================================================
# 供应商
# ============================================================
SUPPLIERS = [
    {"id": "SUP-001", "name": "华塑科技", "category": "塑料外壳", "price_factor": 1.05, "reliability": 0.92, "region": "深圳"},
    {"id": "SUP-002", "name": "鑫达注塑", "category": "塑料外壳", "price_factor": 0.95, "reliability": 0.88, "region": "东莞"},
    {"id": "SUP-003", "name": "深圳塑料厂", "category": "塑料外壳", "price_factor": 0.90, "reliability": 0.85, "region": "深圳"},
    {"id": "SUP-004", "name": "嘉和塑胶", "category": "塑料外壳", "price_factor": 0.98, "reliability": 0.90, "region": "佛山"},
    {"id": "SUP-005", "name": "精工电子", "category": "PCB板", "price_factor": 1.08, "reliability": 0.95, "region": "苏州"},
    {"id": "SUP-006", "name": "恒泰电子", "category": "PCB板", "price_factor": 1.02, "reliability": 0.93, "region": "惠州"},
    {"id": "SUP-007", "name": "盛达电子", "category": "PCB板/传感器", "price_factor": 1.10, "reliability": 0.94, "region": "东莞"},
    {"id": "SUP-008", "name": "新锐科技", "category": "传感器", "price_factor": 1.15, "reliability": 0.91, "region": "无锡"},
    {"id": "SUP-009", "name": "晶显电子", "category": "显示屏", "price_factor": 1.06, "reliability": 0.89, "region": "深圳"},
    {"id": "SUP-010", "name": "联创电子", "category": "显示屏", "price_factor": 1.12, "reliability": 0.87, "region": "广州"},
    {"id": "SUP-011", "name": "天工精密", "category": "传感器/连接器", "price_factor": 1.04, "reliability": 0.96, "region": "上海"},
    {"id": "SUP-012", "name": "博源精密", "category": "连接器/按键", "price_factor": 0.92, "reliability": 0.86, "region": "常州"},
]

# ============================================================
# 报价生成配置 —— 三条路径 × 多场景
# ============================================================

# 每个 (物料ID, 供应商名, 报价倍数, 数量) 决定了一条报价记录
# 报价倍数: 相对物料基准价的比例
# <0.8 → 异常低价, 0.9~1.1 → 正常, 1.2~1.5 → 中度偏离, 1.6~3.0 → 严重偏离
QUOTE_SPECS = [
    # ========== 正常报价 (快速通道, score<20) ≈ 25% ==========
    ("MAT-0101", "华塑科技", 1.02, 20000, 120),  # 大数量折扣
    ("MAT-0102", "鑫达注塑", 0.95, 10000, 90),
    ("MAT-0201", "精工电子", 0.98, 5000, 60),
    ("MAT-0202", "恒泰电子", 1.05, 10000, 75),
    ("MAT-0301", "天工精密", 0.97, 3000, 45),
    ("MAT-0401", "晶显电子", 1.03, 10000, 50),
    ("MAT-0501", "盛达电子", 0.96, 50000, 35),  # 超大数量
    ("MAT-0601", "博源精密", 0.99, 20000, 40),
    ("MAT-0701", "博源精密", 1.01, 50000, 30),
    ("MAT-0801", "深圳塑料厂", 0.94, 10000, 55),
    ("MAT-0304", "天工精密", 1.04, 20000, 50),
    ("MAT-0503", "盛达电子", 0.97, 100000, 25),
    ("MAT-0603", "博源精密", 1.02, 50000, 20),
    ("MAT-0104", "嘉和塑胶", 0.93, 20000, 45),

    # ========== 中度偏离 (标准诊断, 20≤score<60) ≈ 40% ==========
    # 供应商溢价型
    ("MAT-0103", "华塑科技", 1.35, 5000, 180),  # 小数量+高报价
    ("MAT-0106", "鑫达注塑", 1.28, 3000, 150),
    ("MAT-0203", "恒泰电子", 1.42, 1000, 200),  # 极小数量
    ("MAT-0204", "盛达电子", 1.25, 5000, 160),
    ("MAT-0302", "新锐科技", 1.38, 2000, 170),
    ("MAT-0303", "盛达电子", 1.32, 3000, 130),
    ("MAT-0402", "联创电子", 1.45, 1000, 190),  # TFT彩屏，联创偏高
    ("MAT-0403", "晶显电子", 1.30, 5000, 120),
    ("MAT-0502", "盛达电子", 1.35, 2000, 100),
    ("MAT-0504", "盛达电子", 1.40, 1000, 80),
    ("MAT-0602", "博源精密", 1.22, 5000, 65),
    ("MAT-0702", "博源精密", 1.50, 2000, 75),   # 小按键大偏离
    ("MAT-0802", "嘉和塑胶", 1.33, 3000, 140),
    ("MAT-0105", "华塑科技", 1.26, 5000, 110),
    ("MAT-0205", "恒泰电子", 1.20, 10000, 95),
    ("MAT-0305", "天工精密", 1.44, 1000, 125),
    ("MAT-0404", "联创电子", 1.48, 500, 210),    # 电子纸，联创虚高
    ("MAT-0601", "天工精密", 1.29, 3000, 85),
    ("MAT-0703", "博源精密", 1.36, 2000, 90),
    ("MAT-0803", "深圳塑料厂", 1.24, 10000, 60),

    # ========== 严重偏离 (紧急升级, score≥60) ≈ 25% ==========
    ("MAT-0101", "鑫达注塑", 2.20, 1000, 300),   # 供应商跳价
    ("MAT-0102", "深圳塑料厂", 1.85, 5000, 280),
    ("MAT-0201", "盛达电子", 2.50, 2000, 350),   # PCB极端报价
    ("MAT-0202", "盛达电子", 3.00, 500, 400),     # 极小量+严重偏离
    ("MAT-0301", "新锐科技", 1.95, 1000, 250),
    ("MAT-0302", "盛达电子", 2.80, 500, 380),     # 红外传感器天价
    ("MAT-0401", "联创电子", 2.15, 3000, 290),
    ("MAT-0402", "晶显电子", 2.40, 1000, 350),
    ("MAT-0501", "盛达电子", 1.90, 2000, 180),
    ("MAT-0502", "盛达电子", 2.60, 1000, 320),
    ("MAT-0106", "华塑科技", 2.05, 5000, 260),
    ("MAT-0204", "恒泰电子", 3.20, 300, 450),     # 极小量FPC
    ("MAT-0303", "天工精密", 1.88, 2000, 200),
    ("MAT-0801", "华塑科技", 2.30, 1000, 220),

    # ========== 偏低报价 (异常低价, 可能是恶意竞价或规格错误) ≈ 10% ==========
    ("MAT-0101", "深圳塑料厂", 0.52, 5000, 160),
    ("MAT-0201", "恒泰电子", 0.68, 10000, 170),
    ("MAT-0301", "天工精密", 0.45, 2000, 130),
    ("MAT-0401", "联创电子", 0.55, 5000, 110),
    ("MAT-0501", "盛达电子", 0.60, 10000, 80),
    ("MAT-0802", "深圳塑料厂", 0.48, 3000, 100),
]

# 时间分布：过去90天，按密度分布在近30天更多
def pick_date(index: int, total: int) -> str:
    """越靠后的条目越接近今天"""
    today = datetime.now()
    # 均匀分布在过去90天
    days_ago = int(90 * (1 - index / total)) + random.randint(-3, 3)
    days_ago = max(1, min(90, days_ago))
    return (today - timedelta(days=days_ago)).isoformat()


# ============================================================
# 偏离度评分逻辑 (模拟 Agent 第一阶段确定性计算)
# ============================================================
def compute_deviation(material: dict, supplier_quote: float, quantity: int) -> dict:
    """
    基于物料基准价、数量折扣、供应商溢价因子，模拟真实的偏离度计算
    两层打分：价格偏离 + 成本偏离 + 市场偏离
    """
    base_price = material["unit_price"]
    price_ratio = supplier_quote / base_price if base_price > 0 else 1.0

    # 供应商溢价因子 (查表)
    supplier_factor = 1.0
    for s in SUPPLIERS:
        if s["name"] == "某供应商":  # placeholder
            supplier_factor = s["price_factor"]
            break

    # 数量折扣因子
    if quantity >= 50000:
        qty_factor = 0.85
    elif quantity >= 20000:
        qty_factor = 0.92
    elif quantity >= 10000:
        qty_factor = 0.96
    elif quantity >= 5000:
        qty_factor = 1.00
    elif quantity <= 1000:
        qty_factor = 1.10
    elif quantity <= 3000:
        qty_factor = 1.05
    else:
        qty_factor = 1.00

    # 价格偏离 (相对于合理价 = base * qty_factor)
    reasonable_price = base_price * qty_factor
    price_dev = max(0, (supplier_quote - reasonable_price) / reasonable_price * 100)

    # 成本偏离 (基于品类行业基准)
    cat = material["category"]
    if cat in ("塑料外壳", "按键", "袖带"):
        cost_bench_pct = 0.35  # 原材料占比
        material_market_range = (base_price * 0.7, base_price * 1.3)
    elif cat in ("PCB板", "连接器"):
        cost_bench_pct = 0.50
        material_market_range = (base_price * 0.6, base_price * 1.5)
    elif cat in ("传感器", "显示屏"):
        cost_bench_pct = 0.60
        material_market_range = (base_price * 0.5, base_price * 2.0)
    else:  # 电池等
        cost_bench_pct = 0.45
        material_market_range = (base_price * 0.8, base_price * 1.2)

    # 成本偏离：报价中隐含的物料成本 vs 市场行情
    implied_material_cost = supplier_quote * cost_bench_pct
    market_midpoint = (material_market_range[0] + material_market_range[1]) / 2
    if supplier_quote > reasonable_price * 1.3:
        cost_dev = abs(implied_material_cost - market_midpoint) / market_midpoint * 100 * 1.5
    elif supplier_quote < reasonable_price * 0.7:
        cost_dev = abs(implied_material_cost - market_midpoint) / market_midpoint * 100 * 0.8
    else:
        cost_dev = abs(implied_material_cost - market_midpoint) / market_midpoint * 50

    # 市场偏离：品类外部参考价 vs 报价
    market_range = material_market_range
    if supplier_quote > market_range[1]:
        market_dev = (supplier_quote - market_range[1]) / market_range[1] * 100
    elif supplier_quote < market_range[0]:
        market_dev = (market_range[0] - supplier_quote) / market_range[0] * 100
    else:
        market_dev = abs(supplier_quote - market_midpoint) / market_midpoint * 30

    # 综合偏离度 = α×价格偏离 + β×成本偏离 + γ×市场偏离
    # 权重根据偏离类型调整
    if price_ratio > 1.3:
        alpha, beta, gamma = 0.5, 0.3, 0.2  # 高报价更关注价格偏离
    elif price_ratio < 0.7:
        alpha, beta, gamma = 0.4, 0.4, 0.2  # 低价更关注成本合理性
    else:
        alpha, beta, gamma = 0.4, 0.3, 0.3

    deviation_score = alpha * price_dev + beta * cost_dev + gamma * market_dev
    deviation_score = round(deviation_score, 1)

    # 严重级别
    if deviation_score < 20:
        severity = "正常"
        severity_color = "#10b981"
    elif deviation_score < 40:
        severity = "关注"
        severity_color = "#f59e0b"
    elif deviation_score < 60:
        severity = "警示"
        severity_color = "#f97316"
    else:
        severity = "紧急"
        severity_color = "#f43f5e"

    return {
        "deviation_score": deviation_score,
        "severity_level": severity,
        "severity_color": severity_color,
        "price_deviation": round(price_dev, 1),
        "cost_deviation": round(cost_dev, 1),
        "market_deviation": round(market_dev, 1),
        "weights": {"alpha": alpha, "beta": beta, "gamma": gamma},
        "phase": "fast_pass" if deviation_score < 20 else "diagnosis",
        "interrupt_severity": (
            "mandatory" if deviation_score >= 60
            else ("optional" if deviation_score >= 20 else None)
        ),
    }


# ============================================================
# 诊断结论生成 (模拟 Agent 第二阶段推理)
# ============================================================
def build_diagnosis(material: dict, supplier_name: str, supplier_quote: float, dev: dict, quantity: int) -> dict:
    """基于偏离模式生成自洽的诊断结论"""
    score = dev["deviation_score"]
    price_dev = dev["price_deviation"]
    market_dev = dev["market_deviation"]
    cost_dev = dev["cost_deviation"]

    if score < 20:
        return {
            "diagnosis_conclusion": {
                "root_cause": "报价正常，在预测区间内",
                "cause_category": "normal",
                "confidence": 0.95,
                "reasoning_chain": [],
                "llm_summary": None,
            },
            "diagnosis_investigations": [],
            "diagnosis_hypotheses": [],
            "decision_log": [],
        }

    # 找供应商信息
    supplier = next((s for s in SUPPLIERS if s["name"] == supplier_name), SUPPLIERS[0])

    # 生成假设
    hypotheses = []
    if price_dev > 15 and market_dev < 25:
        hypotheses.append({
            "hypothesis": "供应商系统性溢价",
            "prior_confidence": 0.6,
            "to_verify": f"调用 tool_get_supplier_profile 查看 {supplier_name} 历史偏离趋势",
            "conclusion": f"价格偏离 {price_dev:.0f}%，市场偏离仅 {market_dev:.0f}%，供应商溢价可能性高",
        })
    if market_dev > 15:
        hypotheses.append({
            "hypothesis": "原材料市场行情上涨",
            "prior_confidence": 0.5,
            "to_verify": "调用 tool_check_market_trend 查看原材料行情",
            "conclusion": f"市场偏离 {market_dev:.0f}%，需核实近期原材料行情变动",
        })
    if cost_dev > 20:
        hypotheses.append({
            "hypothesis": "工艺复杂度被低估或成本项异常",
            "prior_confidence": 0.4,
            "to_verify": "调用 tool_analyze_cost_anomaly 深度分析成本结构",
            "conclusion": f"成本偏离 {cost_dev:.0f}%，可能存在成本项异常或行业基准不匹配",
        })
    if not hypotheses:
        hypotheses.append({
            "hypothesis": "数据稀疏导致误判",
            "prior_confidence": 0.3,
            "to_verify": "检查历史数据量和参考数据可用性",
            "conclusion": "偏离指标均在阈值以下但综合分偏高，怀疑数据量不足",
        })

    # 生成调查过程
    investigations = []
    tools_to_run = []
    if price_dev > 15:
        tools_to_run.append("tool_get_supplier_profile")
    if market_dev > 15 or price_dev > 30:
        tools_to_run.append("tool_check_market_trend")
    if cost_dev > 15 or score > 40:
        tools_to_run.append("tool_analyze_cost_anomaly")
    if price_dev > 30:
        tools_to_run.append("tool_compare_peer_price")
    if not tools_to_run:
        tools_to_run = ["tool_get_supplier_profile", "tool_check_market_trend"]

    # 构造调查结果
    for step_num, tool_name in enumerate(tools_to_run, 1):
        if tool_name == "tool_get_supplier_profile":
            hist_dev = round(random.uniform(5, 25), 1)
            investigations.append({
                "step": step_num,
                "tool": tool_name,
                "args_summary": f"supplier_name: {supplier_name}, material_category: {material['category']}",
                "result_summary": (
                    f"供应商 {supplier_name} 近12个月采购{random.randint(5,30)}笔，"
                    f"历史均价偏离 {hist_dev}%，本次偏离 {price_dev:.0f}%，"
                    f"{'明显高于历史水平' if price_dev > hist_dev + 10 else '与历史水平接近'}"
                ),
                "confidence": round(random.uniform(0.65, 0.90), 2),
            })
        elif tool_name == "tool_check_market_trend":
            trend = random.choice(["上涨", "稳定", "微降"])
            investigations.append({
                "step": step_num,
                "tool": tool_name,
                "args_summary": f"material_category: {material['category']}",
                "result_summary": (
                    f"{material['category']} 市场行情：趋势{trend}，"
                    f"当前参考价区间 ¥{material['unit_price']*0.7:.1f}~¥{material['unit_price']*1.5:.1f}，"
                    f"{'行情上涨可部分解释偏离' if trend == '上涨' and market_dev < 20 else '行情变动不足以完全解释当前偏离'}"
                ),
                "confidence": round(random.uniform(0.50, 0.80), 2),
            })
        elif tool_name == "tool_compare_peer_price":
            peer_price = round(material["unit_price"] * random.uniform(0.85, 1.20), 2)
            premium = round((supplier_quote - peer_price) / peer_price * 100, 1)
            investigations.append({
                "step": step_num,
                "tool": tool_name,
                "args_summary": f"material_category: {material['category']}, current_supplier: {supplier_name}",
                "result_summary": (
                    f"品类 {material['category']} 同行均价 ¥{peer_price:.2f}，"
                    f"当前报价 ¥{supplier_quote:.2f}（溢价 {premium:.1f}%），"
                    f"{'明显高于同行' if premium > 15 else '略高于同行水平'}"
                ),
                "confidence": round(random.uniform(0.60, 0.85), 2),
            })
        elif tool_name == "tool_analyze_cost_anomaly":
            investigations.append({
                "step": step_num,
                "tool": tool_name,
                "args_summary": f"cost_analysis: 5项成本拆解",
                "result_summary": (
                    f"成本深度分析：原材料成本占比约{random.randint(30,60)}%，"
                    f"加工费占比约{random.randint(15,30)}%，"
                    f"{'原材料项明显偏高' if cost_dev > 25 else '各项成本分布基本合理'}"
                ),
                "confidence": round(random.uniform(0.55, 0.80), 2),
            })

    # 确定根因
    if price_dev > 30 and market_dev < 20:
        root_cause = f"供应商溢价：{supplier_name}历史均价偏高，当前报价超出同行水平{price_dev:.0f}%"
        cause_category = "supplier_premium"
    elif market_dev > 20:
        root_cause = f"市场行情驱动：{material['category']}品类原材料价格上涨传导"
        cause_category = "market_trend"
    elif cost_dev > 25:
        root_cause = f"成本结构异常：{material['category']}品类成本项偏离行业基准"
        cause_category = "cost_anomaly"
    elif score > 40:
        root_cause = f"多因素叠加：价格偏离{price_dev:.0f}% + 成本偏离{cost_dev:.0f}%，建议人工综合判断"
        cause_category = "combined_anomaly"
    else:
        root_cause = f"数据不足，部分诊断工具未返回有效数据，根因待确认"
        cause_category = "insufficient_data"

    confidence = round(min(sum(inv["confidence"] for inv in investigations) / len(investigations), 0.95), 2)

    return {
        "diagnosis_conclusion": {
            "root_cause": root_cause,
            "cause_category": cause_category,
            "confidence": confidence,
            "reasoning_chain": investigations,
            "llm_summary": None,
        },
        "diagnosis_investigations": investigations,
        "diagnosis_hypotheses": hypotheses,
        "decision_log": build_decision_log(material, investigations, root_cause, score),
    }


def build_decision_log(material: dict, investigations: list, root_cause: str, score: float) -> list:
    """构造 Agent 决策日志"""
    log = []
    for i, inv in enumerate(investigations):
        log.append({
            "timestamp": (datetime.now() - timedelta(seconds=len(investigations) - i)).isoformat(),
            "decision_point": f"诊断第{i+1}轮",
            "options_considered": [
                "tool_get_supplier_profile", "tool_compare_peer_price",
                "tool_check_market_trend", "tool_search_market_price",
                "tool_check_urgency", "tool_search_alternatives",
                "tool_analyze_cost_anomaly",
            ],
            "chosen_action": inv["tool"],
            "reasoning": f"偏离度 {score:.0f} 分，需通过 {inv['tool']} 收集证据以判断根因",
            "confidence": inv["confidence"],
            "source": "agent",
        })
    return log


# ============================================================
# 执行轨迹生成
# ============================================================
def build_execution_trace(material: dict, supplier_name: str, supplier_quote: float,
                          dev: dict, diag: dict, quantity: int) -> list:
    """构造完整的、自洽的执行轨迹"""
    t0 = datetime.now()
    trace = []
    step_time = 0.0

    # Phase 1: 体检
    trace.append({
        "step": "物料构造", "status": "completed",
        "timestamp": (t0 - timedelta(seconds=60)).isoformat(),
        "duration_ms": 0.5,
        "output": f"物料={material['name']}, 类别={material['category']}, 供应商={supplier_name}, 报价=¥{supplier_quote:.2f}",
    })
    step_time += 0.5

    p10 = round(material["unit_price"] * 0.7, 2)
    p50 = round(material["unit_price"], 2)
    p90 = round(material["unit_price"] * 1.5, 2)
    trace.append({
        "step": "价格预测", "status": "completed",
        "timestamp": (t0 - timedelta(seconds=59)).isoformat(),
        "duration_ms": 1.5,
        "output": f"P10=¥{p10} / P50=¥{p50} / P90=¥{p90}",
        "tool": "tool_predict_price_range",
        "tool_confidence": 0.85,
        "tool_reasoning": f"[bayesian] 类别 {material['category']} 有 {random.randint(20,80)} 条记录，预测区间 [P10=¥{p10}, P50=¥{p50}, P90=¥{p90}]",
    })
    step_time += 1.5

    trace.append({
        "step": "行情刷新(联网)", "status": "completed",
        "timestamp": (t0 - timedelta(seconds=40)).isoformat(),
        "duration_ms": 18500,
        "output": f"已更新 {material['category']} 市场行情数据",
        "tool": "tool_search_market_price",
    })
    step_time += 18500

    trace.append({
        "step": "成本拆解", "status": "completed",
        "timestamp": (t0 - timedelta(seconds=21)).isoformat(),
        "duration_ms": 2.0,
        "output": f"锚点=¥{p50}, 异常项={1 if dev['cost_deviation'] > 20 else 0}, 原材料交叉验证=已完成",
        "tool": "tool_analyze_cost_structure",
        "tool_confidence": 0.68,
        "tool_reasoning": f"基准=plastic_injection，锚点=贝叶斯P50，以贝叶斯合理价 ¥{p50} 为锚点计算各项基准",
    })
    step_time += 2.0

    trace.append({
        "step": "相似物料检索", "status": "completed",
        "timestamp": (t0 - timedelta(seconds=19)).isoformat(),
        "duration_ms": 0.3,
        "output": f"检索到 {random.randint(0, 3)} 条相似物料",
        "tool": "tool_match_similar_material",
        "tool_confidence": round(random.uniform(0.3, 0.7), 2),
        "tool_reasoning": f"物料 {material['name']} 在历史库中{'找到相似记录' if random.random() > 0.5 else '未找到高相似度匹配'}",
    })
    step_time += 0.3

    trace.append({
        "step": "偏离度评分", "status": "completed",
        "timestamp": (t0 - timedelta(seconds=18)).isoformat(),
        "duration_ms": 2.5,
        "output": (
            f"偏离度={dev['deviation_score']}分 ({dev['severity_level']})，"
            f"价格={dev['price_deviation']}% / 成本={dev['cost_deviation']}% / 市场={dev['market_deviation']}%"
        ),
        "tool": "tool_score_deviation",
        "tool_confidence": 0.85,
        "tool_reasoning": (
            f"第一层偏离度={dev['deviation_score']}（{dev['severity_level']}），"
            f"价格偏离={dev['price_deviation']}% / 成本偏离={dev['cost_deviation']}% / 市场偏离={dev['market_deviation']}%"
        ),
    })
    step_time += 2.5

    # Triage
    if dev["severity_level"] == "正常":
        trace.append({
            "step": "分流决策", "status": "completed",
            "timestamp": (t0 - timedelta(seconds=15)).isoformat(),
            "duration_ms": 0.5,
            "output": f"偏离度={dev['deviation_score']}分 → 快速通道（自动通过）",
        })
        trace.append({
            "step": "快速通道", "status": "completed",
            "timestamp": (t0 - timedelta(seconds=14)).isoformat(),
            "duration_ms": 0.2,
            "output": "自动通过，无需 LLM 诊断，无需人工确认",
        })
        step_time += 0.7
    else:
        trace.append({
            "step": "分流决策", "status": "completed",
            "timestamp": (t0 - timedelta(seconds=15)).isoformat(),
            "duration_ms": 0.5,
            "output": f"偏离度={dev['deviation_score']}分 → {'标准诊断' if dev['deviation_score'] < 60 else '紧急升级'}",
        })
        step_time += 0.5

        # Phase 2: 诊断
        hyps = diag.get("diagnosis_hypotheses", [])
        trace.append({
            "step": "诊断启动", "status": "completed",
            "timestamp": (t0 - timedelta(seconds=14)).isoformat(),
            "duration_ms": 0.3,
            "output": f"生成 {len(hyps)} 个初始假设: " + "; ".join(h["hypothesis"] for h in hyps),
            "conclusion_from_step": "; ".join(h.get("conclusion", h["hypothesis"]) for h in hyps),
        })
        step_time += 0.3

        # 每个调查步骤对应一轮 Agent决策 + 工具执行
        investigations = diag.get("diagnosis_investigations", [])
        for inv_idx, inv in enumerate(investigations):
            # Agent决策
            agent_thought_choices = [
                f"偏离度 {dev['deviation_score']:.0f} 分，价格偏离 {dev['price_deviation']:.0f}% "
                f"但市场偏离仅 {dev['market_deviation']:.0f}%，怀疑是供应商溢价而非行情问题。"
                f"决定调用 {inv['tool']} 来获取更多证据。",

                f"当前证据不足，需要进一步分析。"
                f"价格偏离模式显示可能存在供应商因素，"
                f"调用 {inv['tool']} 进行深入调查。",

                f"综合偏离度 {dev['deviation_score']:.0f} 分，"
                f"需要验证{'价格' if dev['price_deviation'] > dev['market_deviation'] else '市场'}异常的根本原因。"
                f"选择 {inv['tool']} 来收集关键信息。",
            ]
            trace.append({
                "step": "Agent决策", "status": "tool_call",
                "timestamp": (t0 - timedelta(seconds=int(14 - inv_idx * 3))).isoformat(),
                "duration_ms": round(random.uniform(3000, 8000), 1),
                "output": f"选择调用: {inv['tool']}",
                "agent_thought": random.choice(agent_thought_choices)[:300],
                "decision": inv["tool"],
                "conclusion_from_step": f"调取 {inv['tool']} 获取证据，验证当前假设",
            })
            step_time += 4000

            # 工具执行
            trace.append({
                "step": f"诊断工具:{inv['tool']}", "status": "completed",
                "timestamp": (t0 - timedelta(seconds=int(12 - inv_idx * 3))).isoformat(),
                "duration_ms": round(random.uniform(50, 500), 1),
                "tool": inv["tool"],
                "tool_confidence": inv["confidence"],
                "tool_reasoning": inv["result_summary"],
                "output": inv["result_summary"][:200],
                "conclusion_from_step": inv["result_summary"][:150],
            })
            step_time += 200

    # 方案生成
    solutions = build_solutions(material, supplier_quote, dev)
    trace.append({
        "step": "方案生成(兜底)", "status": "completed",
        "timestamp": (t0 - timedelta(seconds=2)).isoformat(),
        "duration_ms": round(random.uniform(100, 800), 1),
        "output": f"生成 {len(solutions)} 个方案",
        "tool": "tool_generate_solutions",
        "tool_confidence": round(random.uniform(0.75, 0.90), 2),
    })
    step_time += 500

    # 诊断结论
    if dev["severity_level"] != "正常":
        dc = diag.get("diagnosis_conclusion", {})
        trace.append({
            "step": "诊断结论", "status": "completed",
            "timestamp": t0.isoformat(),
            "duration_ms": 0.5,
            "output": f"根因={dc.get('root_cause', '')}，类别={dc.get('cause_category', '')}，置信度={dc.get('confidence', 0)}",
            "conclusion_from_step": dc.get("root_cause", ""),
        })
        step_time += 0.5

    return trace, step_time


# ============================================================
# 方案生成
# ============================================================
def build_solutions(material: dict, supplier_quote: float, dev: dict) -> list:
    score = dev["deviation_score"]
    if score < 20:
        return [{
            "id": "SOL-PASS",
            "title": "直接通过",
            "description": f"报价 ¥{supplier_quote:.2f} 在预测区间内，偏离度仅 {score:.0f} 分，建议直接通过。",
            "confidence": 0.95,
            "estimated_savings": "¥0",
            "action": "accept",
            "generated_by": "auto",
        }]
    elif score >= 60:
        return [
            {
                "id": "SOL-A",
                "title": "紧急议价",
                "description": f"报价严重偏高（偏离{score:.0f}分），建议立即与供应商协商，目标价 ¥{supplier_quote*0.75:.2f}",
                "confidence": 0.85,
                "estimated_savings": f"¥{supplier_quote*0.25:.0f}/件",
                "action": "negotiate",
            },
            {
                "id": "SOL-B",
                "title": "启动备选询价",
                "description": f"向2-3家替代供应商发送{material['name']}的RFQ，获取竞争性报价",
                "confidence": 0.78,
                "estimated_savings": "待定",
                "action": "requote",
            },
            {
                "id": "SOL-C",
                "title": "升级管理层",
                "description": f"偏离度过高（{score:.0f}分），建议升级到采购经理审批",
                "confidence": 0.90,
                "estimated_savings": "需评审",
                "action": "escalate",
            },
        ]
    else:
        return [
            {
                "id": "SOL-A",
                "title": "议价谈判",
                "description": f"报价 ¥{supplier_quote:.2f} 偏离 {score:.0f} 分，建议以目标价 ¥{supplier_quote*0.90:.2f} 进行谈判",
                "confidence": 0.82,
                "estimated_savings": f"¥{supplier_quote*0.10:.1f}/件",
                "action": "negotiate",
            },
            {
                "id": "SOL-B",
                "title": "多方比价",
                "description": f"建议获取至少2家同品类供应商报价进行比较",
                "confidence": 0.72,
                "estimated_savings": "待定",
                "action": "compare",
            },
        ]


# ============================================================
# 成本拆解
# ============================================================
def build_cost_breakdown(material: dict, supplier_quote: float, dev: dict) -> dict:
    cat = material["category"]
    if cat in ("塑料外壳", "按键", "袖带"):
        pcts = {"原材料": 40, "加工费": 25, "表面处理": 10, "包装物流": 5, "管理+利润": 20}
    elif cat in ("PCB板",):
        pcts = {"原材料": 50, "加工费": 20, "表面处理": 8, "包装物流": 5, "管理+利润": 17}
    elif cat in ("传感器",):
        pcts = {"原材料": 60, "加工费": 15, "表面处理": 5, "包装物流": 5, "管理+利润": 15}
    elif cat in ("显示屏",):
        pcts = {"原材料": 55, "加工费": 18, "表面处理": 5, "包装物流": 5, "管理+利润": 17}
    elif cat in ("电池",):
        pcts = {"原材料": 45, "加工费": 20, "表面处理": 5, "包装物流": 10, "管理+利润": 20}
    else:
        pcts = {"原材料": 40, "加工费": 25, "表面处理": 8, "包装物流": 7, "管理+利润": 20}

    items = []
    for item_name, pct in pcts.items():
        reasonable_amt = round(supplier_quote * pct / 100, 2)
        implied_amt = round(supplier_quote * pct / 100 * (1 + (dev["cost_deviation"] - 10) / 100), 2)
        items.append({
            "item": item_name,
            "benchmark_pct": pct,
            "reasonable_amount": reasonable_amt,
            "implied_amount": implied_amt,
            "deviation_from_reasonable": round(dev["cost_deviation"] - 10, 1) if dev["cost_deviation"] > 10 else 0,
            "status": "明显偏高" if dev["cost_deviation"] > 25 else ("参考值" if dev["cost_deviation"] > 10 else "正常"),
            "data_source": "行业基准",
            "independently_verified": item_name == "原材料",
        })

    return {
        "cost_items": items,
        "benchmark_key": "plastic_injection" if cat in ("塑料外壳", "按键") else "electronics_assembly",
        "data_quality": "with_anchor",
        "anchor_price": round(material["unit_price"], 2),
        "anchor_source": "贝叶斯P50",
        "cost_deviation_score": dev["cost_deviation"],
        "anomaly_count": 1 if dev["cost_deviation"] > 20 else 0,
        "note": f"以贝叶斯合理价 ¥{material['unit_price']} 为锚点计算各项基准",
    }


# ============================================================
# 主入口: 生成全部数据并写入DB
# ============================================================
def generate_all():
    db_path = DB_PATH
    if not os.path.exists(db_path):
        print(f"数据库不存在: {db_path}")
        sys.exit(1)

    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row

    # 清空旧报价
    existing = conn.execute("SELECT COUNT(*) as cnt FROM quotes").fetchone()["cnt"]
    if existing > 100:
        print(f"当前有 {existing} 条报价，将清空并重新生成")
        conn.execute("DELETE FROM quotes")
        conn.commit()

    today = datetime.now()
    total = len(QUOTE_SPECS)
    print(f"\n{'='*60}")
    print(f"开始生成 {total} 条高质量报价分析数据")
    print(f"{'='*60}\n")

    generated = 0
    for idx, (mat_id, supplier_name, multiplier, quantity, days_ago) in enumerate(QUOTE_SPECS):
        # 查找物料
        mat_row = None
        for m in MATERIALS:
            if m[0] == mat_id:
                mat_row = m
                break
        if not mat_row:
            print(f"  ⚠ 物料 {mat_id} 未找到，跳过")
            continue

        material = {
            "id": mat_row[0], "name": mat_row[1], "category": mat_row[2],
            "material_type": mat_row[3], "processing": mat_row[4],
            "precision": mat_row[5], "dimensions": mat_row[6], "unit_price": mat_row[7],
        }

        supplier_quote = round(material["unit_price"] * multiplier, 2)
        quote_date = (today - timedelta(days=days_ago)).isoformat()

        # 计算偏离度
        dev = compute_deviation(material, supplier_quote, quantity)

        # 生成诊断
        diag = build_diagnosis(material, supplier_name, supplier_quote, dev, quantity)

        # 生成执行轨迹
        trace, total_ms = build_execution_trace(material, supplier_name, supplier_quote, dev, diag, quantity)

        # 生成方案
        solutions = build_solutions(material, supplier_quote, dev)

        # 成本拆解
        cost = build_cost_breakdown(material, supplier_quote, dev)

        # 历史数据：所有报价都已有决策结果，无 pending
        status_weights = {"正常": [0.80, 0.15, 0.05],
                          "关注": [0.50, 0.25, 0.25],
                          "警示": [0.30, 0.30, 0.40],
                          "紧急": [0.10, 0.20, 0.70]}
        w = status_weights.get(dev["severity_level"], [0.50, 0.25, 0.25])
        status = random.choices(["approved", "negotiate", "rejected"], weights=w)[0]

        # RAG信息
        ref_low = round(material["unit_price"] * 0.4, 1)
        ref_high = round(material["unit_price"] * 2.5, 1)

        # 构建完整报价记录
        quote_id = f"Q-{today.strftime('%Y%m%d')}-{idx+1:03d}"
        record = {
            "id": quote_id,
            "material_id": material["id"],
            "material_name": material["name"],
            "supplier_quote": supplier_quote,
            "supplier_name": supplier_name,
            "quantity": quantity,
            "quote_date": "",
            "category": material["category"],
            "material_type": material["material_type"],
            "processing": material["processing"],
            "description": f"{material['category']} - {material['material_type']} - {material['processing']}",
            "ai_prediction_low": round(material["unit_price"] * 0.7, 2),
            "ai_prediction_mid": round(material["unit_price"], 2),
            "ai_prediction_high": round(material["unit_price"] * 1.5, 2),
            "deviation_score": dev["deviation_score"],
            "severity_level": dev["severity_level"],
            "severity_color": dev["severity_color"],
            "price_deviation": dev["price_deviation"],
            "cost_deviation": dev["cost_deviation"],
            "market_deviation": dev["market_deviation"],
            "composite_score": round(dev["deviation_score"] * 0.6, 1),
            "external_deviation": round(max(0, dev["market_deviation"] - 5), 1),
            "phase": dev["phase"],
            "interrupt_severity": dev["interrupt_severity"],
            "interrupt_reason": (
                f"偏离度 {dev['deviation_score']} 分（{dev['severity_level']}），"
                f"诊断结论：{diag['diagnosis_conclusion']['root_cause']}，"
                f"已生成 {len(solutions)} 个方案，请人工审批。"
            ) if dev["severity_level"] != "正常" else (
                f"偏离度 {dev['deviation_score']} 分（正常），建议直接通过。"
            ),
            "diagnosis_conclusion": json.dumps(diag["diagnosis_conclusion"], ensure_ascii=False),
            "diagnosis_investigations": json.dumps(diag["diagnosis_investigations"], ensure_ascii=False),
            "diagnosis_hypotheses": json.dumps(diag["diagnosis_hypotheses"], ensure_ascii=False),
            "decision_log": json.dumps(diag["decision_log"], ensure_ascii=False),
            "solutions": json.dumps(solutions, ensure_ascii=False),
            "cost_breakdown": json.dumps(cost, ensure_ascii=False),
            "similar_materials": json.dumps([], ensure_ascii=False),
            "rag_info": json.dumps({
                "ref_low": ref_low, "ref_high": ref_high,
                "source": "1688+B2B平台+行业报告", "available": True,
            }, ensure_ascii=False),
            "supplier_profile": json.dumps({}, ensure_ascii=False),
            "peer_benchmark": json.dumps({}, ensure_ascii=False),
            "market_context": json.dumps({}, ensure_ascii=False),
            "inventory_context": json.dumps(None, ensure_ascii=False),
            "alternatives": json.dumps([], ensure_ascii=False),
            "llm_summary": None,
            "execution_trace": json.dumps(trace, ensure_ascii=False),
            "total_duration_ms": round(total_ms, 1),
            "status": status,
            "human_decision": None,
            "decision_by": None,
            "decision_at": None,
            "override_price": None,
            "override_reason": None,
            "selected_solution_id": None,
            "created_at": quote_date,
        }

        # 写入DB
        _insert_quote(conn, record)
        generated += 1

        sev_icon = {"正常": "✓", "关注": "○", "警示": "△", "紧急": "⚠"}.get(dev["severity_level"], "?")
        print(f"  [{idx+1:3d}/{total}] {sev_icon} {quote_id} | {material['name'][:16]} | "
              f"¥{supplier_quote:.2f}(×{multiplier:.2f}) | "
              f"偏离{dev['deviation_score']:.0f}分 {dev['severity_level']} | "
              f"{dev['phase']} | {total_ms/1000:.0f}s")

    conn.commit()
    final_count = conn.execute("SELECT COUNT(*) as cnt FROM quotes").fetchone()["cnt"]
    conn.close()

    print(f"\n{'='*60}")
    print(f"✅ 生成完成！共 {generated} 条报价，数据库总数 {final_count} 条")
    print(f"{'='*60}\n")

    # 统计分布
    conn2 = sqlite3.connect(db_path)
    print("严重级别分布:")
    for row in conn2.execute("SELECT severity_level, COUNT(*) as n FROM quotes GROUP BY severity_level ORDER BY n DESC"):
        print(f"  {row[0]}: {row[1]} 条")
    conn2.close()


def _insert_quote(conn, quote: dict):
    """直接插入报价记录到SQLite"""
    fields = [
        "id", "material_id", "material_name", "supplier_quote", "supplier_name",
        "quantity", "quote_date", "category", "material_type", "processing",
        "description", "ai_prediction_low", "ai_prediction_mid", "ai_prediction_high",
        "deviation_score", "severity_level", "severity_color",
        "price_deviation", "cost_deviation", "market_deviation",
        "composite_score", "external_deviation", "phase",
        "interrupt_severity", "interrupt_reason",
        "diagnosis_conclusion", "diagnosis_investigations", "diagnosis_hypotheses",
        "decision_log", "solutions", "cost_breakdown", "similar_materials",
        "rag_info", "supplier_profile", "peer_benchmark", "market_context",
        "inventory_context", "alternatives", "llm_summary",
        "execution_trace", "total_duration_ms", "status",
        "human_decision", "decision_by", "decision_at",
        "override_price", "override_reason", "selected_solution_id", "created_at",
    ]
    placeholders = ", ".join(["?" for _ in fields])
    values = [quote.get(f) for f in fields]
    sql = f"INSERT INTO quotes ({', '.join(fields)}) VALUES ({placeholders})"
    conn.execute(sql, values)


if __name__ == "__main__":
    generate_all()
