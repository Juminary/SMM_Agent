"""
数据库连接管理 + Schema 初始化

SQLite（开发环境）：sqlite:///data/smm_agent.db
PostgreSQL（生产环境）：设置 DATABASE_URL 环境变量
"""

import os
import sqlite3
import json
from typing import Optional, List, Dict, Any
from contextlib import contextmanager
from datetime import datetime

# 项目根目录
_PROJECT_ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..")
_DATA_DIR = os.path.join(_PROJECT_ROOT, "data")

# 数据库 URL：优先使用环境变量，默认 SQLite
DATABASE_URL = os.environ.get(
    "DATABASE_URL",
    f"sqlite:///{os.path.join(_DATA_DIR, 'smm_agent.db')}"
)


def _is_sqlite() -> bool:
    return DATABASE_URL.startswith("sqlite")


def get_connection():
    """获取数据库连接"""
    if _is_sqlite():
        db_path = DATABASE_URL.replace("sqlite:///", "")
        os.makedirs(os.path.dirname(db_path), exist_ok=True)
        conn = sqlite3.connect(db_path, timeout=30)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA foreign_keys=ON")
        conn.execute("PRAGMA busy_timeout=10000")
        return conn
    else:
        import psycopg2  # type: ignore
        return psycopg2.connect(DATABASE_URL)


@contextmanager
def get_db():
    """上下文管理器：自动 commit / rollback"""
    conn = get_connection()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


# =============================================================================
# Schema DDL
# =============================================================================

SCHEMA_SQL = """
-- ===== 物料主数据 =====
CREATE TABLE IF NOT EXISTS materials (
    id              TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    category        TEXT NOT NULL,
    material_type   TEXT DEFAULT '',
    dimensions      TEXT DEFAULT '',
    processing      TEXT DEFAULT '',
    precision       TEXT DEFAULT '',
    supplier_id     TEXT DEFAULT '',
    supplier_name   TEXT DEFAULT '',
    unit_price      REAL DEFAULT 0,
    order_quantity  INTEGER DEFAULT 0,
    order_date      TEXT DEFAULT '',
    description     TEXT DEFAULT '',
    is_active       INTEGER DEFAULT 1,
    cost_breakdown  TEXT DEFAULT NULL,   -- JSON: {raw_material, processing, surface_treatment, packaging_logistics, management_profit}
    created_at      TEXT DEFAULT (datetime('now')),
    updated_at      TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_materials_category ON materials(category);
CREATE INDEX IF NOT EXISTS idx_materials_supplier ON materials(supplier_name);
CREATE INDEX IF NOT EXISTS idx_materials_material_type ON materials(material_type);

-- ===== 报价分析记录 =====
CREATE TABLE IF NOT EXISTS quotes (
    id                  TEXT PRIMARY KEY,
    material_id         TEXT DEFAULT '',
    material_name       TEXT DEFAULT '',
    supplier_quote      REAL DEFAULT 0,
    supplier_name       TEXT DEFAULT '',
    quantity            INTEGER DEFAULT 0,
    quote_date          TEXT DEFAULT '',
    category            TEXT DEFAULT '',
    material_type       TEXT DEFAULT '',
    processing          TEXT DEFAULT '',
    description         TEXT DEFAULT '',

    -- 第一阶段：体检结果
    ai_prediction_low   REAL,
    ai_prediction_mid   REAL,
    ai_prediction_high  REAL,
    deviation_score     REAL DEFAULT 0,
    severity_level      TEXT DEFAULT '正常',
    severity_color      TEXT DEFAULT '#10b981',
    price_deviation     REAL DEFAULT 0,
    cost_deviation      REAL DEFAULT 0,
    market_deviation    REAL DEFAULT 0,
    composite_score     REAL,
    external_deviation  REAL,

    -- 流程阶段
    phase               TEXT DEFAULT 'baseline',
    interrupt_severity  TEXT,
    interrupt_reason    TEXT,

    -- 第二阶段：诊断结果
    diagnosis_conclusion    TEXT DEFAULT NULL,   -- JSON
    diagnosis_investigations TEXT DEFAULT NULL,  -- JSON
    decision_log            TEXT DEFAULT NULL,   -- JSON

    -- 方案与上下文
    solutions           TEXT DEFAULT NULL,       -- JSON
    cost_breakdown      TEXT DEFAULT NULL,       -- JSON
    similar_materials   TEXT DEFAULT NULL,       -- JSON
    rag_info            TEXT DEFAULT NULL,       -- JSON
    supplier_profile    TEXT DEFAULT NULL,       -- JSON
    peer_benchmark      TEXT DEFAULT NULL,       -- JSON
    market_context      TEXT DEFAULT NULL,       -- JSON
    inventory_context   TEXT DEFAULT NULL,       -- JSON
    alternatives        TEXT DEFAULT NULL,       -- JSON
    llm_summary         TEXT,

    -- 执行轨迹
    execution_trace     TEXT DEFAULT NULL,       -- JSON
    total_duration_ms   REAL DEFAULT 0,

    -- 状态
    status              TEXT DEFAULT 'pending',
    human_decision      TEXT,
    decision_by         TEXT,
    decision_at         TEXT,
    override_price      REAL,
    override_reason     TEXT,
    selected_solution_id TEXT,

    created_at          TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_quotes_status ON quotes(status);
CREATE INDEX IF NOT EXISTS idx_quotes_severity ON quotes(severity_level);
CREATE INDEX IF NOT EXISTS idx_quotes_created ON quotes(created_at);
CREATE INDEX IF NOT EXISTS idx_quotes_material_id ON quotes(material_id);

-- ===== 外部参考数据 =====
CREATE TABLE IF NOT EXISTS external_references (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    material_category   TEXT NOT NULL,
    price_low           REAL DEFAULT 0,
    price_high          REAL DEFAULT 0,
    source              TEXT DEFAULT '',
    sample_count        INTEGER DEFAULT 0,
    updated_at          TEXT DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ext_ref_category ON external_references(material_category);

-- ===== 行业成本基准 =====
CREATE TABLE IF NOT EXISTS industry_benchmarks (
    id                      INTEGER PRIMARY KEY AUTOINCREMENT,
    benchmark_key           TEXT UNIQUE NOT NULL,
    category_label          TEXT DEFAULT '',
    raw_material_pct        REAL DEFAULT 0,
    processing_pct          REAL DEFAULT 0,
    surface_treatment_pct   REAL DEFAULT 0,
    packaging_pct           REAL DEFAULT 0,
    management_profit_pct   REAL DEFAULT 0,
    updated_at              TEXT DEFAULT (datetime('now'))
);

-- ===== 供应商画像（物化视图替代，定期刷新） =====
CREATE TABLE IF NOT EXISTS supplier_profiles (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    supplier_name   TEXT NOT NULL UNIQUE,
    total_quotes    INTEGER DEFAULT 0,
    avg_unit_price  REAL DEFAULT 0,
    price_volatility REAL DEFAULT 0,
    price_trend     TEXT DEFAULT '稳定',
    categories      TEXT DEFAULT '[]',   -- JSON array
    first_order_date TEXT DEFAULT '',
    last_order_date  TEXT DEFAULT '',
    updated_at      TEXT DEFAULT (datetime('now'))
);

-- ===== 原材料价格库 =====
CREATE TABLE IF NOT EXISTS raw_material_prices (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    material_type   TEXT NOT NULL,
    specification   TEXT DEFAULT '',
    unit            TEXT DEFAULT 'kg',
    unit_price      REAL DEFAULT 0,
    price_date      TEXT NOT NULL,
    source          TEXT DEFAULT '',
    created_at      TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_rmp_type_date ON raw_material_prices(material_type, price_date);

-- ===== 工艺费率库 =====
CREATE TABLE IF NOT EXISTS processing_rates (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    process_type    TEXT NOT NULL,
    machine_rate    REAL DEFAULT 0,
    standard_hours  REAL DEFAULT 0,
    unit            TEXT DEFAULT '元/小时',
    region          TEXT DEFAULT '',
    supplier_tier   TEXT DEFAULT '',
    created_at      TEXT DEFAULT (datetime('now'))
);

-- ===== 物料库存表 =====
CREATE TABLE IF NOT EXISTS inventory (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    material_id     TEXT NOT NULL,
    material_name   TEXT DEFAULT '',
    category        TEXT DEFAULT '',
    current_stock   INTEGER DEFAULT 0,
    safety_stock    INTEGER DEFAULT 0,
    daily_consumption INTEGER DEFAULT 0,
    days_remaining  INTEGER DEFAULT 0,
    urgency         TEXT DEFAULT '正常',
    last_restock_date TEXT DEFAULT '',
    supplier_name   TEXT DEFAULT '',
    note            TEXT DEFAULT '',
    updated_at      TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_inventory_material ON inventory(material_id);

-- ===== LangGraph Checkpoint 表 =====
CREATE TABLE IF NOT EXISTS checkpoints (
    thread_id       TEXT NOT NULL,
    checkpoint_ns   TEXT NOT NULL DEFAULT '',
    checkpoint_id   TEXT NOT NULL,
    parent_checkpoint_id TEXT,
    type            TEXT,
    checkpoint      BLOB,
    metadata        BLOB,
    created_at      TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id)
);

CREATE INDEX IF NOT EXISTS idx_checkpoints_thread ON checkpoints(thread_id);

CREATE TABLE IF NOT EXISTS checkpoint_writes (
    thread_id       TEXT NOT NULL,
    checkpoint_ns   TEXT NOT NULL DEFAULT '',
    checkpoint_id   TEXT NOT NULL,
    task_id         TEXT NOT NULL,
    idx             INTEGER NOT NULL,
    channel         TEXT NOT NULL,
    type            TEXT,
    value           BLOB,
    PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id, task_id, idx)
);
"""


def init_db():
    """初始化数据库 Schema"""
    conn = get_connection()
    try:
        conn.executescript(SCHEMA_SQL)
        conn.commit()
    finally:
        conn.close()


# =============================================================================
# CRUD 操作
# =============================================================================

# ---- Materials ----

def insert_material(conn, material: Dict[str, Any]) -> None:
    conn.execute(
        """INSERT OR REPLACE INTO materials
           (id, name, category, material_type, dimensions, processing, precision,
            supplier_id, supplier_name, unit_price, order_quantity, order_date,
            description, is_active, cost_breakdown, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))""",
        (
            material.get("id", ""),
            material.get("name", ""),
            material.get("category", ""),
            material.get("material_type", ""),
            material.get("dimensions", ""),
            material.get("processing", ""),
            material.get("precision", ""),
            material.get("supplier_id", ""),
            material.get("supplier_name", ""),
            material.get("unit_price", 0),
            material.get("order_quantity", 0),
            material.get("order_date", ""),
            material.get("description", ""),
            1 if material.get("is_active", True) else 0,
            json.dumps(material.get("cost_breakdown")) if material.get("cost_breakdown") else None,
        ),
    )


def get_all_materials(conn) -> List[Dict[str, Any]]:
    rows = conn.execute(
        """SELECT id, name, category, material_type, dimensions, processing,
                  precision, supplier_id, supplier_name, unit_price,
                  order_quantity, order_date, description, is_active
           FROM materials WHERE is_active = 1"""
    ).fetchall()
    return [_row_to_dict(row) for row in rows]


def get_material_by_id(conn, material_id: str) -> Optional[Dict[str, Any]]:
    row = conn.execute(
        """SELECT id, name, category, material_type, dimensions, processing,
                  precision, supplier_id, supplier_name, unit_price,
                  order_quantity, order_date, description, is_active
           FROM materials WHERE id = ?""", (material_id,)
    ).fetchone()
    return _row_to_dict(row) if row else None


def get_materials_by_category(conn, category: str) -> List[Dict[str, Any]]:
    rows = conn.execute(
        """SELECT id, name, category, material_type, dimensions, processing,
                  precision, supplier_id, supplier_name, unit_price,
                  order_quantity, order_date, description, is_active
           FROM materials WHERE category = ? AND is_active = 1""", (category,)
    ).fetchall()
    return [_row_to_dict(row) for row in rows]


# ---- Quotes ----

def insert_quote(conn, quote: Dict[str, Any]) -> None:
    json_fields = [
        "solutions", "cost_breakdown", "similar_materials", "rag_info",
        "supplier_profile", "peer_benchmark", "market_context",
        "inventory_context", "alternatives", "execution_trace",
        "diagnosis_conclusion", "diagnosis_investigations", "decision_log",
    ]
    values = {}
    for k, v in quote.items():
        if k in json_fields and v is not None:
            values[k] = json.dumps(v, ensure_ascii=False) if not isinstance(v, str) else v
        else:
            values[k] = v

    conn.execute(
        """INSERT OR REPLACE INTO quotes
           (id, material_id, material_name, supplier_quote, supplier_name,
            quantity, quote_date, category, material_type, processing, description,
            ai_prediction_low, ai_prediction_mid, ai_prediction_high,
            deviation_score, severity_level, severity_color,
            price_deviation, cost_deviation, market_deviation,
            composite_score, external_deviation,
            phase, interrupt_severity, interrupt_reason,
            diagnosis_conclusion, diagnosis_investigations, decision_log,
            solutions, cost_breakdown, similar_materials, rag_info,
            supplier_profile, peer_benchmark, market_context,
            inventory_context, alternatives, llm_summary,
            execution_trace, total_duration_ms,
            status, human_decision, decision_by, decision_at,
            override_price, override_reason, selected_solution_id,
            created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                   ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                   ?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            values.get("id", ""),
            values.get("material_id", ""),
            values.get("material_name", ""),
            values.get("supplier_quote", 0),
            values.get("supplier_name", ""),
            values.get("quantity", 0),
            values.get("quote_date", ""),
            values.get("category", ""),
            values.get("material_type", ""),
            values.get("processing", ""),
            values.get("description", ""),
            values.get("ai_prediction_low"),
            values.get("ai_prediction_mid"),
            values.get("ai_prediction_high"),
            values.get("deviation_score", 0),
            values.get("severity_level", "正常"),
            values.get("severity_color", "#10b981"),
            values.get("price_deviation", 0),
            values.get("cost_deviation", 0),
            values.get("market_deviation", 0),
            values.get("composite_score"),
            values.get("external_deviation"),
            values.get("phase", "baseline"),
            values.get("interrupt_severity"),
            values.get("interrupt_reason"),
            values.get("diagnosis_conclusion"),
            values.get("diagnosis_investigations"),
            values.get("decision_log"),
            values.get("solutions"),
            values.get("cost_breakdown"),
            values.get("similar_materials"),
            values.get("rag_info"),
            values.get("supplier_profile"),
            values.get("peer_benchmark"),
            values.get("market_context"),
            values.get("inventory_context"),
            values.get("alternatives"),
            values.get("llm_summary"),
            values.get("execution_trace"),
            values.get("total_duration_ms", 0),
            values.get("status", "pending"),
            values.get("human_decision"),
            values.get("decision_by"),
            values.get("decision_at"),
            values.get("override_price"),
            values.get("override_reason"),
            values.get("selected_solution_id"),
            values.get("created_at", datetime.now().isoformat()),
        ),
    )


def get_quote_by_id(conn, quote_id: str) -> Optional[Dict[str, Any]]:
    row = conn.execute("SELECT * FROM quotes WHERE id = ?", (quote_id,)).fetchone()
    return _unpack_quote(row) if row else None


def get_all_quotes(
    conn,
    status: Optional[str] = None,
    severity: Optional[str] = None,
    limit: int = 20,
) -> List[Dict[str, Any]]:
    query = "SELECT * FROM quotes WHERE 1=1"
    params: List[Any] = []
    if status:
        query += " AND status = ?"
        params.append(status)
    if severity:
        query += " AND severity_level = ?"
        params.append(severity)
    query += " ORDER BY created_at DESC LIMIT ?"
    params.append(limit)
    rows = conn.execute(query, params).fetchall()
    return [_unpack_quote(row) for row in rows]


def get_quote_stats(conn) -> Dict[str, Any]:
    quotes = conn.execute("SELECT * FROM quotes").fetchall()
    quotes = [_unpack_quote(row) for row in quotes]

    severity_counts: Dict[str, int] = {}
    status_counts: Dict[str, int] = {}
    total_savings = 0.0

    for q in quotes:
        sev = q.get("severity_level", "未知")
        severity_counts[sev] = severity_counts.get(sev, 0) + 1
        st = q.get("status", "pending")
        status_counts[st] = status_counts.get(st, 0) + 1
        for sol in q.get("solutions", []) or []:
            savings_str = sol.get("estimated_savings", "¥0")
            if isinstance(savings_str, str) and savings_str.startswith("¥"):
                try:
                    total_savings += float(savings_str.replace("¥", "").replace(",", ""))
                except ValueError:
                    pass

    return {
        "total_quotes": len(quotes),
        "severity_distribution": severity_counts,
        "status_distribution": status_counts,
        "total_potential_savings": round(total_savings, 2),
        "avg_deviation_score": round(
            sum(q.get("deviation_score", 0) for q in quotes) / len(quotes), 2
        ) if quotes else 0,
    }


def update_quote_decision(
    conn,
    quote_id: str,
    decision: str,
    decision_by: str,
    override_price: Optional[float] = None,
    override_reason: Optional[str] = None,
    selected_solution_id: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    decision_map = {"accept": "approved", "reject": "rejected", "negotiate": "negotiate"}
    normalized = decision_map.get(decision, decision)

    conn.execute(
        """UPDATE quotes SET status=?, human_decision=?, decision_by=?,
           decision_at=?, override_price=?, override_reason=?,
           selected_solution_id=?
           WHERE id=?""",
        (
            normalized, decision, decision_by, datetime.now().isoformat(),
            override_price, override_reason, selected_solution_id, quote_id,
        ),
    )
    conn.commit()
    return get_quote_by_id(conn, quote_id)


def append_human_feedback(
    conn,
    quote_id: str,
    feedback_type: str,
    content: str,
    reasoning: str = "",
    step_index: int = -1,
) -> Optional[Dict[str, Any]]:
    """将人工反馈追加到报价的 decision_log 中"""
    row = conn.execute("SELECT decision_log FROM quotes WHERE id=?", (quote_id,)).fetchone()
    if not row:
        return None

    log = json.loads(row["decision_log"]) if isinstance(row["decision_log"], str) and row["decision_log"] else []
    if not isinstance(log, list):
        log = []

    log.append({
        "timestamp": datetime.now().isoformat(),
        "decision_point": f"human_feedback_step_{step_index}" if step_index >= 0 else "human_feedback",
        "options_considered": [],
        "chosen_action": feedback_type,
        "reasoning": content[:500],
        "confidence": 1.0,
        "source": "human",
        "override_reasoning": reasoning[:500] if reasoning else "",
    })

    conn.execute("UPDATE quotes SET decision_log=? WHERE id=?", (json.dumps(log, ensure_ascii=False), quote_id))
    conn.commit()
    return get_quote_by_id(conn, quote_id)


def append_override_record(
    conn,
    quote_id: str,
    override_record: Dict[str, Any],
) -> Optional[Dict[str, Any]]:
    """将 Override 记录追加到报价的 decision_log 中，标记为 override 类型"""
    row = conn.execute("SELECT decision_log FROM quotes WHERE id=?", (quote_id,)).fetchone()
    if not row:
        return None

    log = json.loads(row["decision_log"]) if isinstance(row["decision_log"], str) and row["decision_log"] else []
    if not isinstance(log, list):
        log = []

    override_entry = {
        "timestamp": override_record.get("timestamp", datetime.now().isoformat()),
        "decision_point": f"override_step_{override_record.get('step_index', -1)}",
        "options_considered": [],
        "chosen_action": f"override_{override_record.get('override_type', 'unknown')}",
        "reasoning": override_record.get("override_reason", "")[:500],
        "confidence": 1.0,
        "source": "human",
        "override_type": override_record.get("override_type"),
        "override_value": override_record.get("override_value"),
        "is_override": True,
    }
    log.append(override_entry)

    conn.execute("UPDATE quotes SET decision_log=? WHERE id=?", (json.dumps(log, ensure_ascii=False), quote_id))
    conn.commit()
    return get_quote_by_id(conn, quote_id)


# ---- External References ----

def get_all_external_refs(conn) -> List[Dict[str, Any]]:
    rows = conn.execute("SELECT * FROM external_references").fetchall()
    return [_row_to_dict(row) for row in rows]


def get_external_refs_by_category(conn, category: Optional[str] = None) -> List[Dict[str, Any]]:
    if category:
        rows = conn.execute(
            "SELECT * FROM external_references WHERE material_category = ?", (category,)
        ).fetchall()
    else:
        rows = conn.execute("SELECT * FROM external_references").fetchall()
    return [_row_to_dict(row) for row in rows]


# ---- Industry Benchmarks ----

def get_all_benchmarks(conn) -> Dict[str, Dict[str, Any]]:
    rows = conn.execute("SELECT * FROM industry_benchmarks").fetchall()
    return {
        row["benchmark_key"]: {
            "raw_material_pct": row["raw_material_pct"],
            "processing_pct": row["processing_pct"],
            "surface_treatment_pct": row["surface_treatment_pct"],
            "packaging_pct": row["packaging_pct"],
            "management_profit_pct": row["management_profit_pct"],
        }
        for row in rows
    }


# ---- Supplier Profiles ----

def refresh_supplier_profiles(conn) -> None:
    """从 materials 表刷新供应商画像"""
    import statistics

    conn.execute("DELETE FROM supplier_profiles")

    rows = conn.execute(
        """SELECT supplier_name, unit_price, category, order_date
           FROM materials WHERE is_active = 1 AND supplier_name != ''
           ORDER BY supplier_name, order_date"""
    ).fetchall()

    # 按供应商分组
    groups: Dict[str, Dict[str, Any]] = {}
    for row in rows:
        name = row["supplier_name"]
        if name not in groups:
            groups[name] = {"prices": [], "categories": set(), "dates": []}
        groups[name]["prices"].append(row["unit_price"])
        groups[name]["categories"].add(row["category"])
        groups[name]["dates"].append(row["order_date"])

    for name, data in groups.items():
        prices = data["prices"]
        dates = data["dates"]
        avg_price = sum(prices) / len(prices)
        volatility = (statistics.stdev(prices) / avg_price * 100) if len(prices) >= 2 and avg_price > 0 else 0

        # 趋势判断
        if len(prices) >= 3:
            recent_avg = sum(prices[-3:]) / min(3, len(prices[-3:]))
            early_avg = sum(prices[:3]) / min(3, len(prices[:3]))
            if recent_avg > early_avg * 1.08:
                trend = "上升"
            elif recent_avg < early_avg * 0.92:
                trend = "下降"
            else:
                trend = "稳定"
        else:
            trend = "数据不足"

        conn.execute(
            """INSERT INTO supplier_profiles
               (supplier_name, total_quotes, avg_unit_price, price_volatility,
                price_trend, categories, first_order_date, last_order_date)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                name, len(prices), round(avg_price, 2), round(volatility, 1),
                trend, json.dumps(list(data["categories"])),
                min(dates) if dates else "", max(dates) if dates else "",
            ),
        )
    conn.commit()


def get_supplier_profile(conn, supplier_name: str) -> Optional[Dict[str, Any]]:
    row = conn.execute(
        "SELECT * FROM supplier_profiles WHERE supplier_name = ?", (supplier_name,)
    ).fetchone()
    if not row:
        return None
    d = _row_to_dict(row)
    try:
        d["categories"] = json.loads(d.get("categories", "[]"))
    except (json.JSONDecodeError, TypeError):
        d["categories"] = []
    return d


# ---- Raw Material Prices ----

def get_raw_material_prices(
    conn, material_type: str, limit: int = 10
) -> List[Dict[str, Any]]:
    rows = conn.execute(
        """SELECT * FROM raw_material_prices
           WHERE material_type = ? ORDER BY price_date DESC LIMIT ?""",
        (material_type, limit),
    ).fetchall()
    return [_row_to_dict(row) for row in rows]


# ---- Processing Rates ----

def get_processing_rates(
    conn, process_type: Optional[str] = None
) -> List[Dict[str, Any]]:
    if process_type:
        rows = conn.execute(
            "SELECT * FROM processing_rates WHERE process_type = ?", (process_type,)
        ).fetchall()
    else:
        rows = conn.execute("SELECT * FROM processing_rates").fetchall()
    return [_row_to_dict(row) for row in rows]


# ---- Helpers ----

def _row_to_dict(row) -> Dict[str, Any]:
    """sqlite3.Row → dict"""
    return dict(row)


def _unpack_quote(row) -> Dict[str, Any]:
    """将数据库行转为 Quote dict，JSON 字段自动反序列化"""
    d = dict(row)
    json_fields = [
        "solutions", "cost_breakdown", "similar_materials", "rag_info",
        "supplier_profile", "peer_benchmark", "market_context",
        "inventory_context", "alternatives", "execution_trace",
        "diagnosis_conclusion", "diagnosis_investigations", "decision_log",
    ]
    for field in json_fields:
        val = d.get(field)
        if isinstance(val, str):
            try:
                d[field] = json.loads(val)
            except (json.JSONDecodeError, TypeError):
                d[field] = None
        elif val is None:
            d[field] = None
    # SQLite stores REAL as float
    for num_field in [
        "supplier_quote", "deviation_score", "price_deviation",
        "cost_deviation", "market_deviation", "composite_score",
        "external_deviation", "total_duration_ms",
    ]:
        if d.get(num_field) is not None:
            d[num_field] = float(d[num_field])
    return d


# =============================================================================
# Checkpointer 工厂
# =============================================================================

def create_checkpointer():
    """创建 LangGraph checkpointer"""
    if _is_sqlite():
        from langgraph.checkpoint.sqlite import SqliteSaver
        db_path = DATABASE_URL.replace("sqlite:///", "")
        os.makedirs(os.path.dirname(db_path), exist_ok=True)
        conn = sqlite3.connect(db_path, check_same_thread=False, timeout=30)
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA busy_timeout=10000")
        return SqliteSaver(conn)
    else:
        # PostgreSQL（需要 langgraph-checkpoint-postgres）
        from langgraph.checkpoint.postgres import PostgresSaver
        return PostgresSaver.from_conn_string(DATABASE_URL)


if __name__ == "__main__":
    init_db()
    print(f"Database initialized at {DATABASE_URL}")
