import { useEffect, useMemo, useState, useCallback } from 'react'
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  Node,
  Edge,
  Position,
  Handle,
  NodeProps,
} from 'reactflow'
import 'reactflow/dist/style.css'
import {
  Database, Target, Wrench, TrendingUp, GitBranch, Brain,
  Search, CheckCircle, Shield, Zap, Activity, ChevronRight,
  Clock, User, BarChart3, Globe, Lightbulb,
} from 'lucide-react'
import type { TraceStep, Quote } from '../types'

// ===== Node type definitions =====
type NodeType = 'baseline' | 'diagnosis' | 'decision' | 'human' | 'fastpass' | 'start' | 'end'

interface DAGNodeData {
  label: string
  sublabel?: string
  nodeType: NodeType
  status: 'pending' | 'active' | 'completed' | 'skipped'
  duration?: number
  tool?: string
  agentThought?: string
  output?: string
  confidence?: number
  index?: number
}

const NODE_COLORS: Record<NodeType, { bg: string; border: string; text: string; icon: any }> = {
  start: { bg: '#e0e7ff', border: '#6366f1', text: '#4338ca', icon: Database },
  baseline: { bg: '#ede9fe', border: '#8b5cf6', text: '#6d28d9', icon: Activity },
  diagnosis: { bg: '#fef3c7', border: '#f59e0b', text: '#b45309', icon: Brain },
  decision: { bg: '#fef9c3', border: '#eab308', text: '#a16207', icon: Lightbulb },
  human: { bg: '#dcfce7', border: '#10b981', text: '#047857', icon: Shield },
  fastpass: { bg: '#f0fdf4', border: '#22c55e', text: '#15803d', icon: CheckCircle },
  end: { bg: '#f1f5f9', border: '#64748b', text: '#475569', icon: CheckCircle },
}

// ===== Custom Node Components =====

function BaselineNode({ data }: NodeProps<Node<DAGNodeData>>) {
  const cfg = NODE_COLORS.baseline
  return (
    <div className="px-3 py-2.5 rounded-xl border-2 shadow-sm min-w-[140px]" style={{ background: cfg.bg, borderColor: cfg.border }}>
      <Handle type="target" position={Position.Top} className="!w-2 !h-2 !rounded-full !border-2 !border-purple-400" />
      <div className="flex items-center gap-1.5 mb-1">
        <cfg.icon size={12} style={{ color: cfg.border }} />
        <span className="text-xs font-semibold" style={{ color: cfg.text }}>{data.label}</span>
      </div>
      {data.sublabel && <div className="text-[10px] text-gray-500">{data.sublabel}</div>}
      {data.duration != null && <div className="text-[10px] text-gray-400 mt-0.5">{data.duration.toFixed(0)}ms</div>}
      <Handle type="source" position={Position.Bottom} className="!w-2 !h-2 !rounded-full !border-2 !border-purple-400" />
    </div>
  )
}

function DiagnosisNode({ data }: NodeProps<Node<DAGNodeData>>) {
  const cfg = NODE_COLORS.diagnosis
  const isActive = data.status === 'active'
  return (
    <div
      className="px-3 py-2.5 rounded-xl border-2 shadow-sm min-w-[150px] transition-all"
      style={{
        background: cfg.bg,
        borderColor: isActive ? '#f97316' : cfg.border,
        boxShadow: isActive ? '0 0 12px rgba(249,115,22,0.4)' : undefined,
      }}
    >
      <Handle type="target" position={Position.Top} className="!w-2 !h-2 !rounded-full !border-2 !border-amber-400" />
      <div className="flex items-center gap-1.5 mb-1">
        <cfg.icon size={12} style={{ color: cfg.border }} />
        <span className="text-xs font-semibold" style={{ color: cfg.text }}>{data.label}</span>
      </div>
      {data.tool && <div className="text-[10px] text-gray-500">调用：{data.tool}</div>}
      {data.confidence != null && (
        <div className="flex items-center gap-1 mt-1">
          <div className="h-1 flex-1 bg-white/40 rounded-full overflow-hidden">
            <div className="h-full bg-amber-400 rounded-full" style={{ width: `${data.confidence * 100}%` }} />
          </div>
          <span className="text-[10px] text-amber-600">{(data.confidence * 100).toFixed(0)}%</span>
        </div>
      )}
      {data.sublabel && <div className="text-[10px] text-gray-500 mt-0.5">{data.sublabel}</div>}
      <Handle type="source" position={Position.Bottom} className="!w-2 !h-2 !rounded-full !border-2 !border-amber-400" />
    </div>
  )
}

function FastPassNode({ data }: NodeProps<Node<DAGNodeData>>) {
  const cfg = NODE_COLORS.fastpass
  return (
    <div className="px-3 py-2.5 rounded-xl border-2 shadow-sm min-w-[120px]" style={{ background: cfg.bg, borderColor: cfg.border }}>
      <Handle type="target" position={Position.Top} className="!w-2 !h-2 !rounded-full !border-2 !border-green-400" />
      <div className="flex items-center gap-1.5 mb-1">
        <cfg.icon size={12} style={{ color: cfg.border }} />
        <span className="text-xs font-semibold" style={{ color: cfg.text }}>{data.label}</span>
      </div>
      <div className="text-[10px] text-gray-500">{data.sublabel}</div>
      <Handle type="source" position={Position.Bottom} className="!w-2 !h-2 !rounded-full !border-2 !border-green-400" />
    </div>
  )
}

function HumanNode({ data }: NodeProps<Node<DAGNodeData>>) {
  const cfg = NODE_COLORS.human
  return (
    <div className="px-3 py-2.5 rounded-xl border-2 shadow-sm min-w-[120px]" style={{ background: cfg.bg, borderColor: cfg.border }}>
      <Handle type="target" position={Position.Top} className="!w-2 !h-2 !rounded-full !border-2 !border-green-400" />
      <div className="flex items-center gap-1.5 mb-1">
        <cfg.icon size={12} style={{ color: cfg.border }} />
        <span className="text-xs font-semibold" style={{ color: cfg.text }}>{data.label}</span>
      </div>
      <div className="text-[10px] text-gray-500">{data.sublabel}</div>
      <Handle type="source" position={Position.Bottom} className="!w-2 !h-2 !rounded-full !border-2 !border-green-400" />
    </div>
  )
}

function DecisionNode({ data }: NodeProps<Node<DAGNodeData>>) {
  const cfg = NODE_COLORS.decision
  return (
    <div className="px-3 py-2.5 rounded-xl border-2 shadow-sm min-w-[130px]" style={{ background: cfg.bg, borderColor: cfg.border }}>
      <Handle type="target" position={Position.Top} className="!w-2 !h-2 !rounded-full !border-2 !border-yellow-400" />
      <div className="flex items-center gap-1.5 mb-1">
        <cfg.icon size={12} style={{ color: cfg.border }} />
        <span className="text-xs font-semibold" style={{ color: cfg.text }}>{data.label}</span>
      </div>
      <div className="text-[10px] text-gray-500">{data.sublabel}</div>
      <Handle type="source" position={Position.Bottom} className="!w-2 !h-2 !rounded-full !border-2 !border-yellow-400" />
    </div>
  )
}

const nodeTypes = {
  baseline: BaselineNode,
  diagnosis: DiagnosisNode,
  fastpass: FastPassNode,
  human: HumanNode,
  decision: DecisionNode,
}

// ===== Build DAG from trace =====
function buildDAGFromTrace(trace: TraceStep[], currentStepIdx: number = -1) {
  const nodes: Node<DAGNodeData>[] = []
  const edges: Edge[] = []

  let yOffset = 0
  const stepHeight = 80

  // Start node
  nodes.push({
    id: 'start',
    type: 'baseline',
    position: { x: 300, y: 0 },
    data: { label: '开始分析', sublabel: '接收报价', nodeType: 'start', status: 'completed' },
  })

  // Phase 1 nodes (baseline steps)
  const phase1Steps = trace.filter(t =>
    !t.step.startsWith('诊断') && !t.step.startsWith('Agent') &&
    !t.step.startsWith('诊断工具') && !t.step.startsWith('方案生成') &&
    !t.step.startsWith('流程结束')
  )

  phase1Steps.forEach((step, i) => {
    const isPast = i < phase1Steps.length - 1
    const isCurrent = i === phase1Steps.length - 1 && currentStepIdx === -1
    yOffset += stepHeight
    nodes.push({
      id: `p1-${i}`,
      type: 'baseline',
      position: { x: 300, y: yOffset },
      data: {
        label: step.step,
        sublabel: step.output?.slice(0, 40),
        nodeType: 'baseline',
        status: isPast ? 'completed' : isCurrent ? 'active' : 'pending',
        duration: step.duration_ms,
        index: i,
      },
    })
    edges.push({
      id: `e-start-${i}`,
      source: i === 0 ? 'start' : `p1-${i - 1}`,
      target: `p1-${i}`,
      type: 'smoothstep',
      animated: isCurrent,
      style: { stroke: '#8b5cf6', strokeWidth: 2 },
    })
  })

  // Triage node
  yOffset += stepHeight
  const triageStep = trace.find(t => t.step.includes('分流') || t.step.includes('分流判断'))
  const phase = trace.find(t => t.step.includes('快速通道'))
  nodes.push({
    id: 'triage',
    type: 'baseline',
    position: { x: 300, y: yOffset },
    data: {
      label: '智能分流',
      sublabel: triageStep?.output?.slice(0, 40) || (phase ? '快速通道' : '进入诊断'),
      nodeType: 'baseline',
      status: 'completed',
      index: -1,
    },
  })
  edges.push({
    id: `e-to-triage-${phase1Steps.length}`,
    source: `p1-${phase1Steps.length - 1}`,
    target: 'triage',
    type: 'smoothstep',
    style: { stroke: '#8b5cf6', strokeWidth: 2 },
  })

  // Fast pass or diagnosis path
  const isFastPass = trace.some(t => t.step.includes('快速通道') || t.step.includes('fast_pass'))
  yOffset += stepHeight

  if (isFastPass) {
    nodes.push({
      id: 'fastpass',
      type: 'fastpass',
      position: { x: 300, y: yOffset },
      data: { label: '快速通道', sublabel: '自动通过', nodeType: 'fastpass', status: 'completed' },
    })
    edges.push({
      id: 'e-triage-fastpass',
      source: 'triage',
      target: 'fastpass',
      type: 'smoothstep',
      style: { stroke: '#22c55e', strokeWidth: 2 },
    })
  } else {
    // Phase 2 nodes
    const diagSteps = trace.filter(t =>
      t.step.startsWith('诊断启动') || t.step.startsWith('Agent决策') || t.step.startsWith('诊断工具')
    )

    // Start diagnosis
    nodes.push({
      id: 'diag-start',
      type: 'diagnosis',
      position: { x: 300, y: yOffset },
      data: { label: '诊断启动', sublabel: 'LLM 分析偏离模式', nodeType: 'diagnosis', status: 'completed' },
    })
    edges.push({
      id: 'e-triage-diag',
      source: 'triage',
      target: 'diag-start',
      type: 'smoothstep',
      style: { stroke: '#f59e0b', strokeWidth: 2 },
    })

    // Group diagnosis steps by round
    let currentRound: Node<DAGNodeData>[] = []
    let roundY = yOffset + stepHeight

    diagSteps.forEach((step, i) => {
      if (step.step === '诊断启动') {
        if (currentRound.length > 0) {
          const roundId = `round-${Math.floor(i / 3)}`
          nodes.push({
            id: roundId,
            type: 'diagnosis',
            position: { x: 300, y: roundY },
            data: {
              label: `推理轮次 ${Math.floor(i / 3) + 1}`,
              sublabel: currentRound[0]?.sublabel?.slice(0, 30),
              nodeType: 'diagnosis',
              status: 'completed',
            },
          })
          currentRound.forEach((n, j) => {
            edges.push({
              id: `e-${roundId}-${n.id}`,
              source: j === 0 ? 'diag-start' : `${roundId}-tool-${j - 1}`,
              target: n.id,
              type: 'smoothstep',
              style: { stroke: '#f59e0b', strokeWidth: 1.5, strokeDasharray: '5,3' },
            })
          })
          roundY += stepHeight + 20
          currentRound = []
        }
      } else if (step.step === 'Agent决策') {
        roundY += stepHeight
        nodes.push({
          id: `agent-${i}`,
          type: 'diagnosis',
          position: { x: 300, y: roundY },
          data: {
            label: 'Agent决策',
            sublabel: step.output?.slice(0, 40),
            nodeType: 'diagnosis',
            status: 'completed',
            agentThought: step.agent_thought,
            confidence: step.tool_confidence,
            index: i,
          },
        })
        if (currentRound.length > 0) {
          edges.push({
            id: `e-prev-${i}`,
            source: currentRound[currentRound.length - 1].id,
            target: `agent-${i}`,
            type: 'smoothstep',
            style: { stroke: '#f59e0b', strokeWidth: 2 },
          })
        } else {
          edges.push({
            id: `e-diag-start-${i}`,
            source: 'diag-start',
            target: `agent-${i}`,
            type: 'smoothstep',
            style: { stroke: '#f59e0b', strokeWidth: 2 },
          })
        }
        roundY += stepHeight
        currentRound = []
      } else if (step.step.startsWith('诊断工具') || step.step.startsWith('调用')) {
        roundY += stepHeight
        nodes.push({
          id: `tool-${i}`,
          type: 'diagnosis',
          position: { x: 300, y: roundY },
          data: {
            label: step.step.replace('诊断工具:', '').replace('调用 ', ''),
            sublabel: step.output?.slice(0, 40),
            nodeType: 'diagnosis',
            status: 'completed',
            tool: step.tool,
            duration: step.duration_ms,
            index: i,
          },
        })
        currentRound.push(nodes[nodes.length - 1])
      }
    })

    // Final round
    if (currentRound.length > 0) {
      const roundId = `round-final`
      nodes.push({
        id: roundId,
        type: 'diagnosis',
        position: { x: 300, y: roundY },
        data: {
          label: '诊断完成',
          nodeType: 'diagnosis',
          status: 'completed',
        },
      })
      currentRound.forEach((n, j) => {
        edges.push({
          id: `e-final-tool-${j}`,
          source: n.id,
          target: roundId,
          type: 'smoothstep',
          style: { stroke: '#f59e0b', strokeWidth: 1.5, strokeDasharray: '5,3' },
        })
      })
    }

    // Human confirm node
    roundY += stepHeight + 20
    nodes.push({
      id: 'human',
      type: 'human',
      position: { x: 300, y: roundY },
      data: { label: '人工确认', sublabel: 'Human-in-the-Loop', nodeType: 'human', status: 'completed' },
    })
    edges.push({
      id: 'e-final-human',
      source: 'diag-start',
      target: 'human',
      type: 'smoothstep',
      style: { stroke: '#10b981', strokeWidth: 2 },
    })
  }

  // End node
  yOffset = Math.max(yOffset, 400) + stepHeight
  nodes.push({
    id: 'end',
    type: 'baseline',
    position: { x: 300, y: yOffset },
    data: { label: '分析完成', sublabel: '产出诊断结论', nodeType: 'end', status: 'completed' },
  })
  edges.push({
    id: 'e-end',
    source: isFastPass ? 'fastpass' : 'human',
    target: 'end',
    type: 'smoothstep',
    style: { stroke: '#64748b', strokeWidth: 2 },
  })

  return { nodes, edges }
}

// ===== Main DAG Component =====
interface ExecutionDAGProps {
  trace: TraceStep[]
  currentStepIdx?: number
  onNodeClick?: (node: Node<DAGNodeData>, step?: TraceStep) => void
  height?: number
  showControls?: boolean
  showMinimap?: boolean
}

export default function ExecutionDAG({
  trace,
  currentStepIdx = -1,
  onNodeClick,
  height = 500,
  showControls = true,
  showMinimap = false,
}: ExecutionDAGProps) {
  const [selectedNode, setSelectedNode] = useState<string | null>(null)

  const { nodes: flowNodes, edges: flowEdges } = useMemo(
    () => buildDAGFromTrace(trace, currentStepIdx),
    [trace, currentStepIdx]
  )

  const onNodeClickHandler = useCallback(
    (_: React.MouseEvent, node: Node<DAGNodeData>) => {
      setSelectedNode(prev => prev === node.id ? null : node.id)
      if (onNodeClick) {
        onNodeClick(node)
      }
    },
    [onNodeClick]
  )

  return (
    <div className="relative" style={{ height }}>
      <ReactFlow
        nodes={flowNodes}
        edges={flowEdges}
        nodeTypes={nodeTypes}
        onNodeClick={onNodeClickHandler}
        fitView
        fitViewOptions={{ padding: 0.3 }}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={true}
        proOptions={{ hideAttribution: true }}
        style={{ background: 'transparent' }}
      >
        {showControls && (
          <Controls
            showZoom
            showFitView
            className="!rounded-lg !shadow-md !border !border-gray-200"
          />
        )}
        {showMinimap && (
          <MiniMap
            nodeColor={(n) => {
              const cfg = NODE_COLORS[(n.data as DAGNodeData)?.nodeType || 'baseline']
              return cfg?.border || '#8b5cf6'
            }}
            maskColor="rgba(0,0,0,0.05)"
            className="!rounded-lg !shadow-md !border !border-gray-200"
          />
        )}
        <Background color="#e5e7eb" gap={20} />
      </ReactFlow>

      {/* Legend */}
      <div className="absolute bottom-3 left-3 bg-white/90 backdrop-blur-sm rounded-lg px-3 py-2 shadow-sm border border-gray-200 text-xs space-y-1">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded border-2" style={{ background: NODE_COLORS.baseline.bg, borderColor: NODE_COLORS.baseline.border }} />
          <span className="text-gray-500">第一阶段（体检）</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded border-2" style={{ background: NODE_COLORS.diagnosis.bg, borderColor: NODE_COLORS.diagnosis.border }} />
          <span className="text-gray-500">第二阶段（诊断）</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded border-2" style={{ background: NODE_COLORS.human.bg, borderColor: NODE_COLORS.human.border }} />
          <span className="text-gray-500">人工节点</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded border-2" style={{ background: NODE_COLORS.fastpass.bg, borderColor: NODE_COLORS.fastpass.border }} />
          <span className="text-gray-500">快速通道</span>
        </div>
      </div>
    </div>
  )
}
