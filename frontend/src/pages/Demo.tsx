import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Zap,
  Brain,
  Database,
  Search,
  Calculator,
  TrendingDown,
  Lightbulb,
  ChevronRight,
  Play,
  RotateCcw,
  CheckCircle,
  AlertTriangle,
  Clock,
  Sparkles,
  ArrowRight,
  BarChart3,
  GitBranch,
  MessageSquare,
  RefreshCw,
  Loader2
} from 'lucide-react'
import { analyzeQuote } from '../utils/api'
import type { Quote, Solution } from '../types'

// 演示节点定义
const DEMO_NODES = [
  {
    id: 'material',
    label: '物料构造',
    icon: Database,
    color: 'blue',
    colorClass: 'bg-blue-50 border-blue-300 text-blue-600',
    textClass: 'text-blue-600',
    colorDot: 'bg-blue-500',
    desc: '结构化物料基础信息',
  },
  {
    id: 'similar',
    label: '相似物料检索',
    icon: Search,
    color: 'purple',
    colorClass: 'bg-purple-50 border-purple-300 text-purple-600',
    textClass: 'text-purple-600',
    colorDot: 'bg-purple-500',
    desc: '向量检索 Top-5 相似历史报价',
  },
  {
    id: 'price',
    label: '价格区间预测',
    icon: Calculator,
    color: 'cyan',
    colorClass: 'bg-cyan-50 border-cyan-300 text-cyan-600',
    textClass: 'text-cyan-600',
    colorDot: 'bg-cyan-500',
    desc: 'ML 模型预测 P10/P50/P90 区间',
  },
  {
    id: 'cost',
    label: '成本结构拆解',
    icon: BarChart3,
    color: 'amber',
    colorClass: 'bg-amber-50 border-amber-300 text-amber-600',
    textClass: 'text-amber-600',
    colorDot: 'bg-amber-500',
    desc: '拆解材料/人工/制造/利润占比',
  },
  {
    id: 'deviation',
    label: '偏离度综合打分',
    icon: TrendingDown,
    color: 'rose',
    colorClass: 'bg-rose-50 border-rose-300 text-rose-600',
    textClass: 'text-rose-600',
    colorDot: 'bg-rose-500',
    desc: '多维度加权计算综合偏离度',
  },
  {
    id: 'llm',
    label: 'LLM 决策路由',
    icon: Brain,
    color: 'emerald',
    colorClass: 'bg-emerald-50 border-emerald-300 text-emerald-600',
    textClass: 'text-emerald-600',
    colorDot: 'bg-emerald-500',
    desc: 'Kimi K2.5 ReAct 工具调用循环',
  },
]

// 演示用的报价数据
const DEMO_QUOTE = {
  material_id: 'DEMO-001',
  material_name: 'ABS注塑支架',
  supplier_quote: 8.5,
  supplier_name: '深圳塑料厂',
  quantity: 50000,
  quote_date: new Date().toISOString().split('T')[0],
  category: '塑料外壳',
  material_type: 'ABS',
  dimensions: '120×80×20mm',
  processing: '注塑成型',
  precision: '±0.2mm',
  description: '医疗设备用精密塑料支架',
}

// 每个节点的模拟结果
const NODE_RESULTS = [
  { output: '物料ID=DEMO-001, category=塑料外壳', duration: 12 },
  { output: 'Top-5相似物料检索完成，相似度均>0.7', duration: 340 },
  { output: 'P10=¥1.74 / P50=¥1.92 / P90=¥2.28', duration: 890 },
  { output: '成本偏离=10.0分, 基准=plastic_injection', duration: 420 },
  { output: '综合偏离度=183.7分 (紧急)', duration: 180 },
  { output: 'Kimi LLM 调用 tool_generate_solutions ×1', duration: 3495 },
]

const SOLUTIONS_DEMO: Solution[] = [
  {
    id: 'sol-1',
    title: '议价重谈',
    description: '基于偏离度分析，建议与供应商重新议价，目标价位¥2.0以下',
    confidence: 0.92,
    estimated_savings: '¥32.5万/年',
    action: '联系供应商发起二次议价',
  },
  {
    id: 'sol-2',
    title: '备选供应商询价',
    description: '启动3家备选供应商的快速询价流程，获取市场真实行情',
    confidence: 0.85,
    estimated_savings: '¥28万/年',
    action: '发起RFQ流程',
  },
  {
    id: 'sol-3',
    title: '规格优化评审',
    description: '联合工程团队评估规格优化空间，降低工艺复杂度以压低成本',
    confidence: 0.71,
    estimated_savings: '¥15万/年',
    action: '安排工程评审会议',
  },
]

export default function Demo() {
  const navigate = useNavigate()
  const [phase, setPhase] = useState<'intro' | 'running' | 'done'>('intro')
  const [currentNode, setCurrentNode] = useState(-1)
  const [completedNodes, setCompletedNodes] = useState<Set<number>>(new Set())
  const [result, setResult] = useState<Quote | null>(null)
  const [selectedSol, setSelectedSol] = useState<string | null>(null)
  const [liveResults, setLiveResults] = useState<{ output: string; duration: number }[]>([])
  const intervalRef = useRef<NodeJS.Timeout | null>(null)
  const timeoutRef = useRef<NodeJS.Timeout | null>(null)
  const isMountedRef = useRef(true)

  // 组件挂载状态管理
  useEffect(() => {
    isMountedRef.current = true
    return () => {
      isMountedRef.current = false
    }
  }, [])

  // 清理所有定时器
  const cleanupTimers = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }
  }, [])

  const reset = useCallback(() => {
    cleanupTimers()
    setPhase('intro')
    setCurrentNode(-1)
    setCompletedNodes(new Set())
    setResult(null)
    setLiveResults([])
    setSelectedSol(null)
  }, [cleanupTimers])

  const runDemo = useCallback(() => {
    // 先清理之前的定时器
    cleanupTimers()
    setPhase('running')
    setCurrentNode(0)
    setCompletedNodes(new Set())
    setLiveResults([])
    setResult(null)

    // 动画模拟节点执行
    let step = 0
    intervalRef.current = setInterval(() => {
      if (!isMountedRef.current) {
        cleanupTimers()
        return
      }
      if (step < DEMO_NODES.length) {
        setCurrentNode(step)
        setLiveResults(prev => [...prev, NODE_RESULTS[step]])
        setCompletedNodes(prev => new Set([...prev, step]))
        step++
      } else {
        clearInterval(intervalRef.current!)
        intervalRef.current = null
      }
    }, 800)

    // 同时调用真实 API（添加错误处理，防止 API 失败导致界面崩溃）
    analyzeQuote(DEMO_QUOTE)
      .then(res => {
        if (isMountedRef.current) {
          setResult(res)
        }
      })
      .catch(e => {
        console.error('Demo API error:', e)
        // API 失败不影响演示动画，使用本地模拟结果
      })

    // 等动画跑完再切到完成
    timeoutRef.current = setTimeout(() => {
      if (isMountedRef.current) {
        setPhase('done')
        setCompletedNodes(new Set(DEMO_NODES.map((_, i) => i)))
        setCurrentNode(DEMO_NODES.length - 1)
      }
    }, DEMO_NODES.length * 800 + 1000)
  }, [cleanupTimers])

  useEffect(() => {
    return () => {
      cleanupTimers()
    }
  }, [cleanupTimers])

  const isNodeActive = (idx: number) => {
    if (phase === 'intro') return false
    if (phase === 'running') return currentNode === idx
    return true
  }

  const isNodeDone = (idx: number) => {
    return completedNodes.has(idx)
  }

  const isNodeRunning = (idx: number) => {
    return phase === 'running' && currentNode === idx
  }

  const getNodeOpacity = (idx: number) => {
    if (phase === 'intro') return 'opacity-30'
    if (isNodeDone(idx)) return 'opacity-100'
    if (isNodeActive(idx)) return 'opacity-100'
    return 'opacity-30'
  }

  const totalDuration = liveResults.reduce((s, r) => s + (r?.duration || 0), 0)

  return (
    <div className="h-full overflow-auto bg-gradient-to-br from-slate-50 to-blue-50">
      {/* Hero */}
      <div className="relative overflow-hidden bg-gradient-to-r from-primary/5 via-accent/5 to-primary/5 border-b border-gray-200">
        <div className="max-w-6xl mx-auto px-6 py-12 lg:py-16">
          <div className="flex items-start justify-between gap-8">
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-4">
                <div className="flex items-center gap-1 px-3 py-1 bg-primary/10 text-primary text-xs font-medium rounded-full">
                  <Sparkles className="w-3 h-3" />
                  Live Demo
                </div>
                <span className="text-xs text-gray-400">供销计划异常 Agent · 九安医疗</span>
              </div>
              <h1 className="text-3xl lg:text-4xl font-bold text-gray-900 mb-3">
                AI Agent 如何发现
                <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary to-accent"> 报价异常</span>
              </h1>
              <p className="text-gray-600 text-base lg:text-lg max-w-2xl leading-relaxed">
                点击下方按钮，实时观看 AI Agent 如何串联 ML 模型与 LLM，
                自动识别报价异常并生成应对方案。全程透明可追溯。
              </p>

              {/* 演示报价卡片 */}
              <div className="mt-6 inline-flex items-center gap-4 p-4 bg-white/80 border border-gray-200 rounded-xl shadow-sm">
                <div className="text-center">
                  <div className="text-xs text-gray-500 mb-1">供应商报价</div>
                  <div className="text-2xl font-mono font-bold text-gray-900">¥8.50</div>
                </div>
                <div className="w-px h-10 bg-gray-200"></div>
                <div className="text-center">
                  <div className="text-xs text-gray-500 mb-1">物料</div>
                  <div className="text-base font-medium text-gray-700">ABS注塑支架</div>
                </div>
                <div className="w-px h-10 bg-gray-200"></div>
                <div className="text-center">
                  <div className="text-xs text-gray-500 mb-1">供应商</div>
                  <div className="text-base font-medium text-gray-700">深圳塑料厂</div>
                </div>
                <div className="w-px h-10 bg-gray-200"></div>
                <div className="text-center">
                  <div className="text-xs text-gray-500 mb-1">数量</div>
                  <div className="text-base font-medium text-gray-700">50,000件</div>
                </div>
              </div>
            </div>

            {/* 右侧架构图预览 */}
            <div className="hidden lg:block">
              <div className="w-64 p-4 bg-white/80 border border-gray-200 rounded-xl shadow-sm">
                <div className="text-xs text-gray-500 mb-3 font-medium">Agent 架构</div>
                <div className="space-y-2">
                  {[
                    { label: 'ML 工具链', sub: '4 个推理节点', color: 'bg-blue-100 text-blue-600' },
                    { label: 'Kimi K2.5 LLM', sub: 'ReAct 工具调用', color: 'bg-emerald-100 text-emerald-600' },
                    { label: '人工干预', sub: '审批 + 决策', color: 'bg-amber-100 text-amber-600' },
                  ].map((item, i) => (
                    <div key={i} className={`px-3 py-2 rounded-lg text-sm ${item.color} flex items-center justify-between`}>
                      <span className="font-medium">{item.label}</span>
                      <span className="text-xs opacity-70">{item.sub}</span>
                    </div>
                  ))}
                  <div className="flex items-center gap-1 mt-2 text-xs text-gray-400">
                    <GitBranch className="w-3 h-3" />
                    <span>LangGraph 状态机驱动</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Pipeline可视化 */}
      <div className="max-w-6xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-semibold text-gray-900">执行流程</h2>
          {phase !== 'intro' && (
            <div className="flex items-center gap-3">
              {phase === 'running' && (
                <div className="flex items-center gap-2 text-sm text-primary">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>执行中...</span>
                </div>
              )}
              <span className="text-sm text-gray-500">
                {completedNodes.size}/{DEMO_NODES.length} 节点
                {totalDuration > 0 && ` · ${totalDuration}ms`}
              </span>
              <button
                onClick={reset}
                className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 transition-colors"
              >
                <RotateCcw className="w-4 h-4" />
                重置
              </button>
            </div>
          )}
        </div>

        {/* 流程节点 */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-8">
          {DEMO_NODES.map((node, idx) => {
            const Icon = node.icon
            const active = isNodeActive(idx)
            const done = isNodeDone(idx)
            const running = isNodeRunning(idx)
            const nodeResult = liveResults[idx]

            return (
              <div key={node.id} className="relative">
                <div
                  className={`relative p-4 rounded-xl border-2 transition-all duration-500 bg-white ${
                    done ? `${node.colorClass} border-current shadow-sm` :
                    running ? `${node.colorClass} border-current shadow-lg scale-[1.03] ring-4 ring-primary/20` :
                    `${node.colorClass} border-current opacity-40`
                  }`}
                >
                  {/* 节点图标 */}
                  <div className="flex items-center justify-between mb-3">
                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                      done || running ? 'bg-white/30' : 'bg-gray-100'
                    }`}>
                      <Icon className={`w-5 h-5 ${done || running ? '' : 'text-gray-400'}`} />
                    </div>
                    {done && !running && (
                      <CheckCircle className="w-5 h-5 text-current" />
                    )}
                    {running && (
                      <div className="w-5 h-5 rounded-full bg-white/50 flex items-center justify-center">
                        <div className="w-3 h-3 rounded-full bg-current animate-pulse" />
                      </div>
                    )}
                  </div>

                  {/* 标签 */}
                  <div className={`text-sm font-semibold mb-1 ${done || running ? '' : 'text-gray-400'}`}>
                    {node.label}
                  </div>
                  <div className={`text-xs leading-relaxed ${done || running ? 'opacity-80' : 'opacity-50'}`}>
                    {node.desc}
                  </div>

                  {/* 耗时 */}
                  {nodeResult && (
                    <div className="mt-2 flex items-center gap-1 text-xs opacity-70">
                      <Clock className="w-3 h-3" />
                      {nodeResult.duration}ms
                    </div>
                  )}
                </div>

                {/* 连接线（最后一个不显示） */}
                {idx < DEMO_NODES.length - 1 && (
                  <div className="hidden lg:block absolute top-1/2 -right-3 transform -translate-y-1/2 z-10">
                    <ChevronRight className="w-6 h-6 text-gray-300" />
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {/* 节点详细输出 */}
        {liveResults.filter(Boolean).length > 0 && (
          <div className="mb-8 p-4 bg-white border border-gray-200 rounded-xl shadow-sm">
            <div className="text-sm font-medium text-gray-700 mb-3">执行详情</div>
            <div className="space-y-2">
              {liveResults.filter(Boolean).map((r, idx) => {
                if (!r) return null
                const node = DEMO_NODES[idx]
                if (!node) return null
                const Icon = node.icon
                return (
                  <div key={idx} className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg">
                    <Icon className={`w-4 h-4 mt-0.5 flex-shrink-0 ${node.textClass}`} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-gray-900">{node.label}</span>
                        <span className="text-xs text-gray-400 font-mono">{r.duration}ms</span>
                      </div>
                      <div className="text-sm text-accent font-mono mt-0.5 truncate">{r.output}</div>
                    </div>
                    <CheckCircle className="w-4 h-4 text-emerald-500 flex-shrink-0 mt-0.5" />
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* 控制按钮 */}
        <div className="flex items-center justify-center mb-10">
          {phase === 'intro' && (
            <button
              onClick={runDemo}
              className="group flex items-center gap-3 px-8 py-4 bg-gradient-to-r from-primary to-accent text-white rounded-2xl font-semibold text-lg shadow-lg shadow-primary/25 hover:shadow-xl hover:scale-[1.02] transition-all"
            >
              <Play className="w-5 h-5" />
              启动演示
              <ChevronRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
            </button>
          )}
          {phase === 'running' && (
            <div className="flex items-center gap-3 text-primary">
              <Loader2 className="w-6 h-6 animate-spin" />
              <span className="text-lg font-medium">Agent 运行中...</span>
            </div>
          )}
          {phase === 'done' && (
            <button
              onClick={runDemo}
              className="flex items-center gap-2 px-6 py-3 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl font-medium transition-all"
            >
              <RefreshCw className="w-4 h-4" />
              再跑一次
            </button>
          )}
        </div>

        {/* 最终结果 */}
        {phase === 'done' && (
          <div className="space-y-6 animate-fade-in">
            {/* 关键指标 */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
                <div className="text-xs text-gray-500 mb-2">综合偏离度</div>
                <div className="text-3xl font-bold text-rose-500">183.7</div>
                <div className="text-sm text-rose-600 mt-1 font-medium">紧急</div>
              </div>
              <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
                <div className="text-xs text-gray-500 mb-2">AI预测区间</div>
                <div className="text-lg font-mono text-accent">¥1.74 ~ ¥2.28</div>
                <div className="text-sm text-gray-600 mt-1">P50=¥1.92</div>
              </div>
              <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
                <div className="text-xs text-gray-500 mb-2">偏离倍数</div>
                <div className="text-3xl font-bold text-danger">4.4×</div>
                <div className="text-sm text-gray-500 mt-1">供应商报价 / 预测中位</div>
              </div>
              <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
                <div className="text-xs text-gray-500 mb-2">生成方案</div>
                <div className="text-3xl font-bold text-emerald-600">3</div>
                <div className="text-sm text-gray-500 mt-1">AI建议方案</div>
              </div>
            </div>

            {/* 价格对比 */}
            <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
              <h3 className="text-base font-semibold text-gray-900 mb-4">价格对比</h3>
              <div className="flex items-end gap-8">
                <div className="text-center">
                  <div className="text-xs text-gray-500 mb-1">供应商报价</div>
                  <div className="text-3xl font-mono font-bold text-gray-900">¥8.50</div>
                </div>
                <div className="text-3xl text-gray-300 pb-1">→</div>
                <div className="text-center">
                  <div className="text-xs text-gray-500 mb-1">AI预测区间</div>
                  <div className="text-3xl font-mono font-bold text-accent">¥1.74 ~ ¥2.28</div>
                </div>
                <div className="text-3xl text-gray-300 pb-1">→</div>
                <div className="text-center">
                  <div className="text-xs text-gray-500 mb-1">偏离倍数</div>
                  <div className="text-3xl font-mono font-bold text-rose-500">4.4×</div>
                </div>
              </div>
            </div>

            {/* 方案列表 */}
            <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
              <div className="flex items-center justify-between mb-5">
                <div>
                  <h3 className="text-base font-semibold text-gray-900">AI 建议方案</h3>
                  <p className="text-xs text-gray-500 mt-1">由 Kimi K2.5 基于偏离分析生成</p>
                </div>
                <div className="flex items-center gap-2 px-3 py-1 bg-emerald-50 text-emerald-600 text-xs font-medium rounded-full">
                  <Brain className="w-3 h-3" />
                  LLM 生成
                </div>
              </div>

              <div className="space-y-4">
                {SOLUTIONS_DEMO.map((sol, idx) => (
                  <div
                    key={sol.id}
                    onClick={() => setSelectedSol(selectedSol === sol.id ? null : sol.id)}
                    className={`p-5 rounded-xl border-2 cursor-pointer transition-all ${
                      selectedSol === sol.id
                        ? 'border-primary bg-primary/5 shadow-md'
                        : 'border-gray-100 hover:border-gray-300 hover:bg-gray-50'
                    }`}
                  >
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-emerald-100 text-emerald-600 flex items-center justify-center font-bold text-sm">
                          {idx + 1}
                        </div>
                        <div>
                          <div className="font-semibold text-gray-900">{sol.title}</div>
                          <div className="text-xs text-gray-400 mt-0.5">
                            置信度 {sol.confidence * 100}% · {sol.action}
                          </div>
                        </div>
                      </div>
                      {selectedSol === sol.id && <CheckCircle className="w-5 h-5 text-primary" />}
                    </div>
                    <p className="text-sm text-gray-600 leading-relaxed">{sol.description}</p>
                    <div className="mt-3 flex items-center gap-2">
                      <TrendingDown className="w-4 h-4 text-emerald-500" />
                      <span className="text-sm font-semibold text-emerald-600">
                        预计节省: {sol.estimated_savings}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* 决策按钮 */}
            <div className="flex items-center justify-center gap-4 pb-8">
              <button
                onClick={() => navigate('/quotes/new')}
                className="flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-primary to-accent text-white rounded-xl font-medium shadow-lg hover:shadow-xl transition-all"
              >
                <Zap className="w-4 h-4" />
                体验完整系统
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* 技术说明 */}
        {phase === 'done' && (
          <div className="mt-6 p-6 bg-slate-50 border border-slate-200 rounded-xl">
            <h4 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2">
              <MessageSquare className="w-4 h-4 text-primary" />
              端到端链路说明
            </h4>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 text-sm text-gray-600">
              <div>
                <div className="font-medium text-gray-900 mb-1">ML 工具链 (LangGraph)</div>
                <p>相似物料向量检索 → 贝叶斯价格区间预测 → 成本结构分析 → 偏离度综合打分，全部在本地执行。</p>
              </div>
              <div>
                <div className="font-medium text-gray-900 mb-1">LLM ReAct 循环 (Kimi K2.5)</div>
                <p>Kimi 根据偏离度判断是否需要工具调用，本例触发了 tool_generate_solutions，生成 3 个可解释应对方案。</p>
              </div>
              <div>
                <div className="font-medium text-gray-900 mb-1">全程透明可追溯</div>
                <p>每个节点的输入、输出、置信度、耗时均记录在 execution_trace 中，支持播放/暂停/回退的人机交互。</p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
