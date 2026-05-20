"""
Tool 基类定义
Skill 能力实现继承此类，统一 execute() 接口。
"""

from abc import ABC, abstractmethod
from typing import Any, Dict


class Tool(ABC):
    """Skill 能力的接口层基类"""

    name: str = ""           # 工具唯一标识，LLM 通过此名称调用
    description: str = ""    # 工具描述，LLM 读取以判断何时使用
    input_schema: Dict[str, Any] = {}  # JSON Schema，LLM 构造调用参数

    confidence: float = 1.0   # 工具本身的置信度上限
    model_loaded: bool = False  # ML 模型是否已加载

    @abstractmethod
    def execute(self, **kwargs) -> Dict[str, Any]:
        """
        执行工具能力。

        返回格式统一为:
        {
            "result": {...},      # 业务结果（具体类型因工具而异）
            "confidence": float,  # 本次执行可信度 0-1
            "reasoning": str,     # 简要推理说明
        }
        """
        ...

    def get_schema(self) -> Dict[str, Any]:
        """返回 LLM 可发现的工具 schema"""
        return {
            "name": self.name,
            "description": self.description,
            "parameters": self.input_schema,
        }

    def get_openai_function(self) -> Dict[str, Any]:
        """返回 OpenAI SDK 格式的 function calling schema"""
        return {
            "type": "function",
            "function": {
                "name": self.name,
                "description": self.description,
                "parameters": self.input_schema,
            },
        }
