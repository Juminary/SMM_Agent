"""Database module — SQLite (dev) / PostgreSQL (prod)"""
from app.db.database import (
    get_db,
    init_db,
    get_connection,
    DATABASE_URL,
)
from app.db.migrate import migrate_from_json

__all__ = [
    "get_db",
    "init_db",
    "get_connection",
    "DATABASE_URL",
    "migrate_from_json",
]
