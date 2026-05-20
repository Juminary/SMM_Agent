"""
LangGraph Checkpoint 和 interrupt 配置
"""

from langgraph.checkpoint.memory import MemorySaver

# 内存 Checkpointer——支持重跑和回放（进程重启后数据丢失，生产环境应换用 PostgreSQL/Redis）
checkpointer = MemorySaver()

# interrupt 配置说明：
# - interrupt_before: 在这些节点执行之前中断，等待外部 resume
# - interrupt_after:  在这些节点执行之后中断
#
# 当前设计：node_wait_human 是唯一的 interrupt 节点，
# 它内部调用 langgraph.types.interrupt() 暂停，
# 由外部 FastAPI 通过 Command(resume={...}) 恢复执行。
interrupt_before = []
interrupt_after = []

# LangGraph 版本兼容性
LANGGRAPH_VERSION = "0.0.x"
