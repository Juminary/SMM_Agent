import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import {
  ArrowLeft, Play, Pause, RotateCcw, Brain, Activity,
  Wrench, ChevronRight, Lightbulb, User, Search, BarChart3, Globe, Clock,
} from 'lucide-react'
import { fetchQuote } from '../utils/api'
import type { Quote } from '../types'

const TOOL_ICONS: Record<string, any> = {
  tool_get_supplier_profile: User,
  tool_compare_peer_price: BarChart3,
  tool_check_market_trend: Globe,
  tool_search_market_price: Globe,
  tool_check_urgency: Clock,
  tool_search_alternatives: Search,
  tool_analyze_cost_anomaly: Wrench,
  tool_generate_solutions: Lightbulb,
}

const PHASE_COLORS: Record<string, string> = {
  baseline: '#6366f1', diagnosis: '#f59e0b', fast_pass: '#10b981', resolution: '#3b82f6',
}

export default function ExecutionTrace() {
  const { id } = useParams<{ id: string }>()
  const [quote, setQuote] = useState<Quote | null>(null)
  const [loading, setLoading] = useState(true)
  const [playing, setPlaying] = useState(false)
  const [currentIdx, setCurrentIdx] = useState(-1)
  const [selectedStep, setSelectedStep] = useState<number | null>(null)

  useEffect(() => { if (id) loadQuote() }, [id])

  useEffect(() => {
    if (!playing) return
    const timer = setInterval(() => {
      setCurrentIdx(prev => {
        const total = getAllSteps().length
        if (prev >= total - 1) { setPlaying(false); return prev }
        return prev + 1
      })
    }, 800)
    return () => clearInterval(timer)
  }, [playing, quote])

  const loadQuote = async () => {
    try { setQuote(await fetchQuote(id!)) } catch (e) { console.error(e) } finally { setLoading(false) }
  }

  if (loading) return <div className="flex justify-center py-16"><div className="animate-spin h-8 w-8 border-2 border-blue-500 border-t-transparent rounded-full" /></div>
  if (!quote) return <div className="text-center py-16 text-gray-400">报价不存在</div>

  const trace = quote.execution_trace || []
  const investigations = quote.diagnosis_investigations || []
  const decisionLog = quote.decision_log || []

  function getAllSteps(): any[] {
    const p1 = trace.map(s => ({ ...s, type: 'trace', phase: 'baseline' }))
    const p2 = investigations.map(s => ({ ...s, type: 'investigation', phase: 'diagnosis' }))
    const dl = decisionLog.map(s => ({ ...s, type: 'decision', phase: 'diagnosis' }))
    return [...p1, ...p2, ...dl]
  }

  const allSteps = getAllSteps()
  const totalMs = trace.reduce((sum, s) => sum + (s.duration_ms || 0), 0)

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link to={`/quotes/${id}`} className="p-2 hover:bg-gray-100 rounded-lg"><ArrowLeft size={20} /></Link>
          <div>
            <h1 className="text-xl font-bold">执行轨迹</h1>
            <p className="text-sm text-gray-500">{quote.material_name} · ¥{quote.supplier_quote} · {quote.phase}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-sm text-gray-400">{allSteps.length}步 · {totalMs.toFixed(0)}ms · {quote.deviation_score}分</div>
          <button onClick={() => { setCurrentIdx(-1); setPlaying(false) }} className="p-2 hover:bg-gray-100 rounded-lg"><RotateCcw size={18} /></button>
          <button onClick={() => setPlaying(!playing)} className="p-2 hover:bg-gray-100 rounded-lg">
            {playing ? <Pause size={18} /> : <Play size={18} />}
          </button>
        </div>
      </div>

      <div className="flex gap-3">
        <Badge label="第一阶段：体检" count={trace.length} color={PHASE_COLORS.baseline} />
        <Badge label="第二阶段：诊断" count={investigations.length} color={PHASE_COLORS.diagnosis} />
        <Badge label="决策点" count={decisionLog.length} color="#8b5cf6" />
      </div>

      <div className="relative">
        <div className="absolute left-6 top-0 bottom-0 w-0.5 bg-gray-200" />
        <div className="space-y-1">
          {allSteps.map((step, i) => (
            <Step
              key={i} step={step} index={i}
              isActive={i === currentIdx} isPast={i <= currentIdx}
              onClick={() => setSelectedStep(selectedStep === i ? null : i)}
            />
          ))}
        </div>
      </div>

      {selectedStep != null && (
        <div className="bg-white rounded-xl border p-4">
          <h3 className="font-medium mb-2">步骤详情</h3>
          <pre className="text-xs bg-gray-50 p-3 rounded-lg overflow-auto max-h-64">
            {JSON.stringify(allSteps[selectedStep], null, 2)}
          </pre>
        </div>
      )}

      {quote.diagnosis_conclusion && (
        <div className="bg-white rounded-xl border p-4">
          <h3 className="font-medium mb-2 flex items-center gap-2"><Brain size={16} className="text-purple-500" />诊断结论</h3>
          <p className="text-sm text-gray-700">{quote.diagnosis_conclusion.root_cause}</p>
          <div className="flex gap-4 mt-2 text-xs text-gray-400">
            <span>类别：{quote.diagnosis_conclusion.cause_category}</span>
            <span>置信度：{(quote.diagnosis_conclusion.confidence * 100).toFixed(0)}%</span>
          </div>
        </div>
      )}
    </div>
  )
}

function Badge({ label, count, color }: { label: string; count: number; color: string }) {
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium" style={{ background: color + '15', color }}>
      <div className="w-2 h-2 rounded-full" style={{ background: color }} />{label} · {count}步
    </div>
  )
}

function Step({ step, isActive, isPast, onClick }: {
  step: any; index: number; isActive: boolean; isPast: boolean; onClick: () => void
}) {
  const Icon = step.type === 'trace' ? traceIcon(step.step) :
    step.type === 'investigation' ? (TOOL_ICONS[step.tool] || Search) : Brain
  const color = PHASE_COLORS[step.phase] || '#6366f1'
  const op = isPast || isActive ? 1 : 0.4

  return (
    <div className="flex items-start gap-4 pl-1 cursor-pointer hover:bg-gray-50 rounded-lg py-2 px-2"
      style={{ opacity: op }} onClick={onClick}>
      <div className="w-10 h-10 rounded-full flex items-center justify-center shrink-0"
        style={{ background: isActive ? color : (isPast ? color + '20' : '#f3f4f6') }}>
        <Icon size={16} style={{ color: isActive ? '#fff' : color }} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">
            {step.type === 'trace' ? step.step :
             step.type === 'investigation' ? step.tool : `决策: ${step.decision_point}`}
          </span>
          {step.type === 'trace' && step.tool && (
            <span className="text-xs text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">{step.tool}</span>
          )}
        </div>
        <div className="text-xs text-gray-500 mt-0.5">
          {(step.type === 'trace' ? (step.agent_thought || step.output || '') :
            step.type === 'investigation' ? (step.result_summary || '') :
            (step.reasoning || '')).slice(0, 120)}
        </div>
      </div>
      {step.duration_ms && <span className="text-xs text-gray-300 shrink-0">{step.duration_ms.toFixed(0)}ms</span>}
      {step.confidence && <span className="text-xs text-gray-300 shrink-0">{(step.confidence * 100).toFixed(0)}%</span>}
      {isActive && <ChevronRight size={14} className="text-blue-500 shrink-0" />}
    </div>
  )
}

function traceIcon(step: string) {
  if (step.includes('物料') || step.includes('构造')) return Activity
  if (step.includes('价格') || step.includes('预测')) return BarChart3
  if (step.includes('成本') || step.includes('拆解')) return Wrench
  if (step.includes('偏离') || step.includes('评分')) return Brain
  if (step.includes('分流') || step.includes('快速')) return ChevronRight
  if (step.includes('诊断') || step.includes('Agent') || step.includes('LLM')) return Brain
  if (step.includes('方案')) return Lightbulb
  if (step.includes('行情')) return Globe
  return Activity
}
