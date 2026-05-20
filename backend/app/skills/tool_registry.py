"""
Tool 注册表
管理所有 Skill/工具的注册、查找和调用。
"""

from typing import Dict, List
from app.skills.tool_base import Tool


class ToolRegistry:
    """工具注册表 — Skill 能力的动态调度中心"""

    def __init__(self):
        self._tools: Dict[str, Tool] = {}

    def register(self, tool: Tool) -> None:
        """注册一个工具"""
        if not tool.name:
            raise ValueError(f"Tool must have a non-empty name, got: {tool}")
        self._tools[tool.name] = tool

    def get(self, name: str) -> Tool:
        """按名称获取工具，不存在则报错"""
        if name not in self._tools:
            raise KeyError(f"Tool '{name}' not found in registry. Available: {list(self._tools.keys())}")
        return self._tools[name]

    def list_tools(self) -> List[Dict]:
        """列出所有已注册工具的 schema（供 LLM 发现）"""
        return [t.get_schema() for t in self._tools.values()]

    def find(self, query: str) -> List[Tool]:
        """按关键词在 description 中模糊查找工具"""
        q = query.lower()
        return [t for t in self._tools.values() if q in t.description.lower()]
