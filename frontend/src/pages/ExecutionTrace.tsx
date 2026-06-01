import { useEffect, useState, useMemo, useRef } from 'react'
import { useParams, Link } from 'react-router-dom'
import {
  ArrowLeft, Play, Pause, RotateCcw, SkipForward, SkipBack,
  Brain, Activity, Wrench, ChevronRight, Lightbulb, User,
  Search, BarChart3, Globe, Clock, Target, TrendingUp,
  MessageSquare, AlertTriangle, CheckCircle, XCircle,
  HelpCircle, Sparkles, GitBranch, BarChart2,
  RotateCcw as RerunIcon, SlidersHorizontal,
} from 'lucide-react'
import { fetchQuote, submitHumanFeedback } from '../utils/api'
import type { Quote, DiagnosisHypothesis, TraceStep } from '../types'
import OverrideModal from '../components/OverrideModal'
import DiffView from '../components/DiffView'
import ExecutionDAG from '../components/ExecutionDAG'

// ===== Tool icon mapping =====
const TOOL_ICONS: Record<string, any> = {
  tool_get_supplier_profile: User,
  tool_compare_peer_price: BarChart3,
  tool_check_market_trend: Globe,
  tool_search_market_price: Globe,
  tool_check_urgency: Clock,
  tool_search_alternatives: Search,
  tool_analyze_cost_anomaly: Wrench,
  tool_generate_solutions: Lightbulb,
  tool_predict_price_range: Target,
  tool_analyze_cost_structure: Wrench,
  tool_match_similar_material: Search,
  tool_score_deviation: TrendingUp,
}

const PHASE_COLORS: Record<string, string> = {
  baseline: '#6366f1',
  diagnosis: '#f59e0b',
  fast_pass: '#10b981',
  resolution: '#3b82f6',
}

// ===== Main page =====
export default function ExecutionTrace() {
  const { id } = useParams<{ id: string }>()
  const [quote, setQuote] = useState<Quote | null>(null)
  const [loading, setLoading] = useState(true)
  const [viewMode, setViewMode] = useState<'timeline' | 'dag'>('timeline')
  const [playing, setPlaying] = useState(false)
  const [currentIdx, setCurrentIdx] = useState(-1)
  const [selectedStep, setSelectedStep] = useState<number | null>(null)
  const [showOverride, setShowOverride] = useState(false)
  const [showDiff, setShowDiff] = useState(false)
  const [showFeedback, setShowFeedback] = useState<number | null>(null)
  const [speed, setSpeed] = useState(1)
  const [filterPhase2, setFilterPhase2] = useState(false)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => { if (id) loadQuote() }, [id])

  const loadQuote = async () => {
    try { setQuote(await fetchQuote(id!)) } catch (e) { console.error(e) } finally { setLoading(false) }
  }

  const hypotheses = quote?.diagnosis_hypotheses || []
  const investigations = quote?.diagnosis_investigations || []
  const trace = quote?.execution_trace || []
  const decisionLog = quote?.decision_log || []

  // Build reasoning rounds
  const reasoningRounds = useMemo(() => buildReasoningRounds(trace, investigations), [trace, investigations])

  // All steps for animation
  const allSteps = useMemo(() => {
    const baseline = trace.filter(t =>
      !t.step.startsWith('诊断') && !t.step.startsWith('Agent') &&
      !t.step.startsWith('诊断工具') && !t.step.startsWith('方案生成') &&
      !t.step.startsWith('流程结束')
    ).map(t => ({ type: 'baseline' as const, data: t }))
    const rounds = reasoningRounds.flatMap((r, i) =>
      r.steps.map(s => ({ type: 'reasoning' as const, round: i + 1, data: s }))
    )
    return [...baseline, ...rounds]
  }, [trace, reasoningRounds])

  const diagnosisSteps = reasoningRounds.flatMap((r, i) =>
    r.steps.map(s => ({ type: 'reasoning' as const, round: i + 1, data: s }))
  )

  const displaySteps = filterPhase2 && diagnosisSteps.length > 0 ? diagnosisSteps : allSteps
  const totalPhase1 = trace.filter(t =>
    !t.step.startsWith('诊断') && !t.step.startsWith('Agent') &&
    !t.step.startsWith('诊断工具') && !t.step.startsWith('方案生成') &&
    !t.step.startsWith('流程结束')
  ).length
  const totalDiagnosis = reasoningRounds.reduce((s, r) => s + r.steps.length, 0)
  const totalMs = trace.reduce((sum, s) => sum + (s.duration_ms || 0), 0)

  // Playback timer
  useEffect(() => {
    if (timerRef.current) clearInterval(timerRef.current)
    if (!playing) return
    timerRef.current = setInterval(() => {
      setCurrentIdx(prev => {
        if (prev >= displaySteps.length - 1) {
          setPlaying(false)
          return prev
        }
        return prev + 1
      })
    }, 900 / speed)
    return () => { if (timerRef.current) clearInterval(timerRef.current) }
  }, [playing, speed, displaySteps.length])

  // Jump to phase 2
  const jumpToPhase2 = () => {
    setFilterPhase2(true)
    setCurrentIdx(totalPhase1 - 1)
  }

  if (loading) return (
    <div className="h-full flex items-center justify-center">
      <div className="animate-spin h-10 w-10 border-2 border-indigo-500 border-t-transparent rounded-full" />
    </div>
  )
  if (!quote) return <div className="text-center py-16 text-gray-400">报价不存在</div>

  return (
    <div className="h-full overflow-auto bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 py-5 space-y-5">
        {/* ===== Header ===== */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <Link to={`/quotes/${id}`} className="p-2 hover:bg-white rounded-xl transition-colors shadow-sm">
              <ArrowLeft size={18} className="text-gray-500" />
            </Link>
            <div>
              <h1 className="text-lg font-bold text-gray-900">Agent 推理链工作台</h1>
              <p className="text-xs text-gray-400">
                {quote.material_name} · {quote.supplier_name} · ¥{quote.supplier_quote}
                {' · '}<span className={`font-medium ${
                  quote.severity_level === '紧急' ? 'text-red-500' :
                  quote.severity_level === '警示' ? 'text-orange-500' :
                  'text-gray-500'
                }`}>{quote.severity_level}</span>
              </p>
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowOverride(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-indigo-200 text-indigo-600 rounded-lg hover:bg-indigo-50 transition-colors bg-white shadow-sm"
            >
              <SlidersHorizontal size={13} />
              Override
            </button>
            <button
              onClick={() => setShowDiff(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-gray-300 text-gray-600 rounded-lg hover:bg-gray-50 transition-colors bg-white shadow-sm"
            >
              <BarChart2 size={13} />
              对比重跑
            </button>
          </div>
        </div>

        {/* ===== Controls bar ===== */}
        <div className="bg-white rounded-2xl border p-4 flex flex-wrap items-center justify-between gap-3 shadow-sm">
          <div className="flex items-center gap-3">
            {/* View mode tabs */}
            <div className="flex bg-gray-100 rounded-lg p-0.5">
              <button
                onClick={() => setViewMode('timeline')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                  viewMode === 'timeline'
                    ? 'bg-white shadow-sm text-indigo-600'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                <Activity size={13} />
                时间线
              </button>
              <button
                onClick={() => setViewMode('dag')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                  viewMode === 'dag'
                    ? 'bg-white shadow-sm text-indigo-600'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                <GitBranch size={13} />
                DAG 视图
              </button>
            </div>

            {/* Speed control */}
            <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-0.5">
              {[{ label: '0.5x', val: 0.5 }, { label: '1x', val: 1 }, { label: '2x', val: 2 }].map(s => (
                <button
                  key={s.val}
                  onClick={() => setSpeed(s.val)}
                  className={`px-2 py-1 rounded text-xs font-medium transition-all ${
                    speed === s.val ? 'bg-white shadow-sm text-indigo-600' : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>

            {/* Phase filter */}
            <button
              onClick={() => { setFilterPhase2(!filterPhase2); setCurrentIdx(-1) }}
              className={`text-xs px-2.5 py-1.5 rounded-lg border transition-colors font-medium ${
                filterPhase2
                  ? 'bg-amber-50 border-amber-300 text-amber-700'
                  : 'bg-white border-gray-200 text-gray-500 hover:bg-gray-50'
              }`}
            >
              {filterPhase2 ? '仅推理链' : '显示全部'}
            </button>

            {totalPhase1 > 0 && !filterPhase2 && (
              <button
                onClick={jumpToPhase2}
                className="text-xs px-2.5 py-1.5 rounded-lg border border-amber-200 text-amber-600 hover:bg-amber-50 transition-colors bg-white font-medium"
              >
                跳至诊断
              </button>
            )}
          </div>

          {/* Playback controls */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-400 bg-gray-100 px-2 py-1 rounded-lg font-mono">
              {currentIdx + 1}/{displaySteps.length} 步 · {totalMs.toFixed(0)}ms
            </span>
            <button onClick={() => { setCurrentIdx(-1); setPlaying(false) }}
              className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors" title="重置">
              <RotateCcw size={14} className="text-gray-500" />
            </button>
            <button onClick={() => setCurrentIdx(Math.max(currentIdx - 1, -1))}
              disabled={currentIdx <= -1}
              className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-30" title="上一步">
              <SkipBack size={14} className="text-gray-500" />
            </button>
            <button onClick={() => setPlaying(!playing)}
              className="p-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg transition-colors shadow-sm">
              {playing ? <Pause size={14} /> : <Play size={14} />}
            </button>
            <button onClick={() => setCurrentIdx(Math.min(currentIdx + 1, displaySteps.length - 1))}
              disabled={currentIdx >= displaySteps.length - 1}
              className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-30" title="下一步">
              <SkipForward size={14} className="text-gray-500" />
            </button>
          </div>
        </div>

        {/* ===== Badge row ===== */}
        <div className="flex items-center gap-3 flex-wrap">
          <Badge label="第一阶段" count={totalPhase1} color={PHASE_COLORS.baseline} />
          <Badge label="第二阶段" count={totalDiagnosis} color={PHASE_COLORS.diagnosis} />
          <Badge label="决策点" count={decisionLog.length} color="#8b5cf6" />
          {quote.phase === 'fast_pass' && (
            <span className="px-3 py-1 rounded-full text-xs font-medium bg-emerald-50 text-emerald-600 border border-emerald-200">
              快速通道
            </span>
          )}
        </div>

        {/* ===== Main content: Timeline or DAG ===== */}
        {viewMode === 'dag' ? (
          <div className="bg-white rounded-2xl border shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-700">执行链路 DAG</h3>
              <p className="text-xs text-gray-400">点击节点查看详情</p>
            </div>
            <ExecutionDAG
              trace={trace}
              currentStepIdx={currentIdx}
              onNodeClick={(node) => {
                const idx = allSteps.findIndex(s => {
                  if (node.id.startsWith('p1-')) {
                    const i = parseInt(node.id.split('-')[1])
                    return s.type === 'baseline' && s.data === trace.filter(t =>
                      !t.step.startsWith('诊断') && !t.step.startsWith('Agent') &&
                      !t.step.startsWith('诊断工具') && !t.step.startsWith('方案生成') &&
                      !t.step.startsWith('流程结束')
                    )[i]
                  }
                  return false
                })
                if (idx >= 0) setCurrentIdx(idx)
              }}
              height={450}
              showControls
            />
          </div>
        ) : (
          <>
            {/* Hypothesis Board */}
            {hypotheses.length > 0 && (
              <HypothesisBoard hypotheses={hypotheses} investigations={investigations} />
            )}

            {/* Timeline */}
            <div className="bg-white rounded-2xl border shadow-sm">
              <div className="px-5 py-4 border-b border-gray-100">
                <h3 className="text-sm font-semibold text-gray-700">执行时间线</h3>
              </div>
              <div className="px-5 py-3 relative">
                <div className="absolute left-[22px] top-8 bottom-8 w-0.5 bg-gray-200" />
                <div className="space-y-1">
                  {displaySteps.map((step, i) => (
                    <TimelineStep
                      key={i}
                      step={step}
                      index={i}
                      isActive={i === currentIdx}
                      isPast={i < currentIdx}
                      onClick={() => setCurrentIdx(prev => prev === i ? -1 : i)}
                      onOverride={() => setShowOverride(true)}
                      onFeedback={() => setShowFeedback(i)}
                      hypotheses={hypotheses}
                    />
                  ))}
                </div>
              </div>
            </div>
          </>
        )}

        {/* ===== Step Detail Panel ===== */}
        {selectedStep != null && displaySteps[selectedStep] && (
          <StepDetailPanel
            step={displaySteps[selectedStep]}
            onClose={() => setSelectedStep(null)}
            onOverride={() => setShowOverride(true)}
          />
        )}

        {/* ===== Diagnosis Conclusion ===== */}
        {quote.diagnosis_conclusion && (
          <ConclusionPanel conclusion={quote.diagnosis_conclusion} />
        )}

        {/* ===== Feedback Modal ===== */}
        {showFeedback != null && (
          <FeedbackModal
            quoteId={id!}
            step={displaySteps[showFeedback]}
            onClose={() => setShowFeedback(null)}
            onSubmit={async (feedback) => {
              try {
                await submitHumanFeedback(id!, {
                  feedback_type: feedback.feedbackType,
                  content: feedback.additionalInfo,
                  reasoning: feedback.overrideReasoning,
                  step_index: showFeedback,
                })
                await loadQuote()
              } catch (e) { console.error('Failed to submit feedback:', e) }
              setShowFeedback(null)
            }}
          />
        )}

        {/* ===== Override Modal ===== */}
        {showOverride && quote && (
          <OverrideModal
            quote={quote}
            stepIndex={selectedStep ?? -1}
            stepLabel={selectedStep != null ? displaySteps[selectedStep]?.data?.step || `步骤 ${selectedStep}` : '整体'}
            onClose={() => setShowOverride(false)}
            onSuccess={(result) => {
              setShowOverride(false)
              if (result.rerun_quote) {
                setQuote(result.rerun_quote)
              }
            }}
          />
        )}

        {/* ===== Diff View Modal ===== */}
        {showDiff && quote && (
          <DiffView
            original={quote}
            onClose={() => setShowDiff(false)}
            onRerun={async (params) => {
              const { rerunAnalysis } = await import('../utils/api')
              const result = await rerunAnalysis(quote.id, params)
              setQuote(result)
            }}
          />
        )}
      </div>
    </div>
  )
}

// ===== Sub-components =====

function Badge({ label, count, color }: { label: string; count: number; color: string }) {
  return (
    <div
      className="flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium"
      style={{ background: color + '18', color }}
    >
      <div className="w-2 h-2 rounded-full" style={{ background: color }} />
      {label} · {count}步
    </div>
  )
}

function TimelineStep({ step, index, isActive, isPast, onClick, onOverride, onFeedback, hypotheses }: {
  step: { type: string; round?: number; data: any }
  index: number
  isActive: boolean
  isPast: boolean
  onClick: () => void
  onOverride: () => void
  onFeedback: () => void
  hypotheses: DiagnosisHypothesis[]
}) {
  const data = step.data
  const isBaseline = step.type === 'baseline'

  if (isBaseline) {
    const Icon = traceIcon(data.step)
    const color = PHASE_COLORS.baseline
    return (
      <div
        className={`flex items-start gap-4 py-2 px-3 rounded-xl cursor-pointer transition-all group ${
          isActive ? 'bg-indigo-50 ring-1 ring-indigo-200' : 'hover:bg-gray-50'
        }`}
        style={{ opacity: isPast || isActive ? 1 : 0.45 }}
        onClick={onClick}
      >
        <div className="relative z-10">
          <div
            className="w-10 h-10 rounded-full flex items-center justify-center shrink-0 shadow-sm"
            style={{ background: isActive ? color : (isPast ? color + '22' : '#f3f4f6') }}
          >
            <Icon size={15} style={{ color: isActive ? '#fff' : color }} />
          </div>
        </div>
        <div className="flex-1 min-w-0 py-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-gray-800">{data.step}</span>
            {data.tool && (
              <span className="text-xs text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">{data.tool}</span>
            )}
          </div>
          <p className="text-xs text-gray-500 mt-0.5">{data.output?.slice(0, 120)}</p>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {data.duration_ms ? (
            <span className="text-xs text-gray-300 font-mono">{data.duration_ms.toFixed(0)}ms</span>
          ) : null}
          {isActive && <ChevronRight size={14} className="text-indigo-500 animate-pulse" />}
        </div>
      </div>
    )
  }

  // Reasoning step (Phase 2)
  const color = PHASE_COLORS.diagnosis
  const roundNum = step.round || 0
  const hasThought = data.agentThought || data.agent_thought
  const hasTools = data.tools?.length > 0

  return (
    <div
      className={`rounded-xl border p-4 transition-all cursor-pointer ${
        isActive ? 'border-amber-300 bg-amber-50/50 ring-1 ring-amber-200' :
        isPast ? 'border-gray-200 bg-white' : 'border-gray-100 bg-white opacity-45'
      }`}
      style={{ opacity: isPast || isActive ? 1 : 0.45 }}
      onClick={onClick}
    >
      {/* Round header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold"
            style={{ background: color }}>
            {roundNum}
          </div>
          <span className="text-sm font-semibold text-gray-800">推理轮次 {roundNum}</span>
          {data.confidence != null && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 font-medium">
              {(data.confidence * 100).toFixed(0)}%
            </span>
          )}
          {data.decision && (
            <span className="text-xs text-gray-400">{data.decision.slice(0, 40)}</span>
          )}
        </div>
        <div className="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
          <button onClick={(e) => { e.stopPropagation(); onFeedback() }}
            className="p-1.5 hover:bg-blue-100 rounded-lg text-blue-500 transition-colors" title="注入反馈">
            <MessageSquare size={13} />
          </button>
          <button onClick={(e) => { e.stopPropagation(); onOverride() }}
            className="p-1.5 hover:bg-indigo-100 rounded-lg text-indigo-500 transition-colors" title="Override">
            <SlidersHorizontal size={13} />
          </button>
        </div>
      </div>

      {/* Agent thought */}
      {hasThought && (
        <div className="bg-purple-50 rounded-lg p-3 mb-2 border-l-2 border-purple-300">
          <div className="flex items-center gap-1.5 mb-1.5">
            <Brain size={12} className="text-purple-500" />
            <span className="text-xs font-semibold text-purple-600">Agent 思考</span>
          </div>
          <p className="text-sm text-gray-700 leading-relaxed">
            {typeof hasThought === 'string' ? hasThought.slice(0, 280) : ''}
          </p>
        </div>
      )}

      {/* Tools */}
      {hasTools && (
        <div className="space-y-1.5 mb-2">
          {data.tools.map((tool: any, i: number) => {
            const Icon = TOOL_ICONS[tool.name] || Wrench
            return (
              <div key={i} className="flex items-start gap-2 bg-gray-50 rounded-lg p-2.5">
                <Icon size={13} className="text-gray-400 mt-0.5 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-gray-700">{tool.name}</span>
                    {tool.confidence != null && (
                      <span className="text-xs text-gray-400">{(tool.confidence * 100).toFixed(0)}%</span>
                    )}
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5">{tool.result?.slice(0, 180)}</p>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Conclusion */}
      {data.conclusion && (
        <div className="text-xs text-emerald-700 bg-emerald-50 rounded px-2.5 py-1.5 border border-emerald-100">
          ← {data.conclusion.slice(0, 120)}
        </div>
      )}
    </div>
  )
}

function StepDetailPanel({ step, onClose, onOverride }: {
  step: { type: string; data: any }
  onClose: () => void
  onOverride: () => void
}) {
  return (
    <div className="bg-white rounded-2xl border shadow-sm">
      <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
        <h3 className="text-sm font-semibold text-gray-700">步骤详情</h3>
        <div className="flex items-center gap-2">
          <button onClick={onOverride}
            className="text-xs px-2.5 py-1 border border-indigo-200 text-indigo-600 rounded-lg hover:bg-indigo-50 transition-colors">
            Override
          </button>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded-lg">
            <XCircle size={14} className="text-gray-400" />
          </button>
        </div>
      </div>
      <pre className="text-xs p-5 overflow-auto max-h-72 font-mono leading-relaxed bg-gray-50 text-gray-700">
        {JSON.stringify(step.data || step, null, 2)}
      </pre>
    </div>
  )
}

function HypothesisBoard({ hypotheses, investigations }: {
  hypotheses: DiagnosisHypothesis[]
  investigations: any[]
}) {
  const results = hypotheses.map(h => {
    const relevant = investigations.filter(inv =>
      h.to_verify?.includes(inv.tool) ||
      inv.result_summary?.toLowerCase().includes(h.hypothesis.slice(0, 6).toLowerCase())
    )
    const confirmed = relevant.some(inv => inv.confidence > 0.6)
    const refuted = relevant.some(inv => inv.confidence < 0.2)
    return {
      ...h,
      updated_confidence: relevant.length > 0
        ? relevant.reduce((s: number, inv: any) => s + (inv.confidence ?? 0), 0) / relevant.length
        : h.prior_confidence,
      confirmed,
      refuted,
      verified_by: relevant.map((inv: any) => inv.tool).join(', '),
    }
  })

  return (
    <div className="bg-white rounded-2xl border shadow-sm">
      <div className="px-5 py-3 border-b border-gray-100">
        <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
          <Brain size={14} className="text-purple-500" />
          Agent 假设与验证
        </h3>
      </div>
      <div className="p-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
        {results.map((h, i) => (
          <div key={i} className={`rounded-xl border p-3 ${
            h.confirmed ? 'border-emerald-200 bg-emerald-50' :
            h.refuted ? 'border-red-200 bg-red-50' :
            'border-gray-200 bg-gray-50'
          }`}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-bold text-gray-800">H{i + 1}</span>
              {h.confirmed ? <CheckCircle size={14} className="text-emerald-500" /> :
               h.refuted ? <XCircle size={14} className="text-red-400" /> :
               <HelpCircle size={14} className="text-gray-400" />}
            </div>
            <p className="text-xs text-gray-600 mb-3 leading-relaxed">{h.hypothesis}</p>
            <div className="flex items-center justify-between text-xs font-semibold">
              <span className={h.prior_confidence > 0.5 ? 'text-indigo-600' : 'text-gray-400'}>
                {(h.prior_confidence * 100).toFixed(0)}%
              </span>
              <ChevronRight size={10} className="text-gray-300" />
              <span className={
                h.updated_confidence > h.prior_confidence ? 'text-emerald-600' :
                h.updated_confidence < h.prior_confidence ? 'text-red-500' : 'text-gray-500'
              }>
                {(h.updated_confidence * 100).toFixed(0)}%
              </span>
            </div>
            {h.verified_by && (
              <div className="text-[10px] text-gray-400 mt-1.5 truncate">证据: {h.verified_by}</div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

function ConclusionPanel({ conclusion }: { conclusion: NonNullable<Quote['diagnosis_conclusion']> }) {
  const conf = conclusion.confidence ?? 0.5
  const confColor = conf > 0.7 ? '#10b981' : conf > 0.4 ? '#f59e0b' : '#ef4444'
  return (
    <div className="bg-gradient-to-r from-purple-50 to-blue-50 rounded-2xl border border-purple-200 shadow-sm">
      <div className="px-5 py-4 border-b border-purple-100 flex items-center gap-2">
        <Sparkles size={16} className="text-yellow-500" />
        <h3 className="font-bold text-gray-900">诊断结论</h3>
        <span className="ml-auto text-sm font-bold" style={{ color: confColor }}>
          {(conf * 100).toFixed(0)}%
        </span>
      </div>
      <div className="p-5">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <div className="text-xs text-gray-400 mb-1">根因</div>
            <p className="text-sm font-semibold text-gray-900 leading-relaxed">{conclusion.root_cause}</p>
            <div className="flex gap-3 mt-2">
              <span className="text-xs text-gray-500">类别：{conclusion.cause_category}</span>
            </div>
          </div>
          <div className="flex flex-col items-end">
            <div className="text-3xl font-bold" style={{ color: confColor }}>
              {(conf * 100).toFixed(0)}%
            </div>
            <div className="text-xs text-gray-400 mb-1">置信度</div>
            <div className="w-full max-w-[140px] bg-gray-200 rounded-full h-2 mt-1">
              <div className="h-2 rounded-full transition-all" style={{ width: `${conf * 100}%`, background: confColor }} />
            </div>
          </div>
        </div>
        {conclusion.llm_summary && (
          <div className="mt-4 pt-3 border-t border-purple-100">
            <div className="text-xs text-gray-400 mb-1">LLM 摘要</div>
            <p className="text-sm text-gray-600 leading-relaxed">{conclusion.llm_summary.slice(0, 400)}</p>
          </div>
        )}
      </div>
    </div>
  )
}

function FeedbackModal({ quoteId, step, onClose, onSubmit }: {
  quoteId: string
  step: any
  onClose: () => void
  onSubmit: (feedback: any) => void
}) {
  const [feedbackType, setFeedbackType] = useState('agree')
  const [additionalInfo, setAdditionalInfo] = useState('')
  const [overrideReasoning, setOverrideReasoning] = useState('')

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-[100]" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-[480px] max-h-[80vh] overflow-y-auto p-6" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-lg font-bold text-gray-900">人工干预 - 注入反馈</h3>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg">
            <XCircle size={18} className="text-gray-400" />
          </button>
        </div>

        <div className="bg-gray-50 rounded-lg p-3 mb-4 text-xs text-gray-500">
          <span className="font-medium text-gray-600">当前步骤：</span>
          {step?.type === 'reasoning' ? `推理轮次 ${step.round || '?'}` : step?.data?.step || ''}
        </div>

        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium text-gray-700 mb-2 block">反馈类型</label>
            <div className="grid grid-cols-3 gap-2">
              {[
                { value: 'agree', label: '同意', icon: CheckCircle, activeClass: 'border-emerald-500 bg-emerald-50 text-emerald-700' },
                { value: 'modify', label: '修正', icon: AlertTriangle, activeClass: 'border-amber-500 bg-amber-50 text-amber-700' },
                { value: 'override', label: '否决', icon: XCircle, activeClass: 'border-red-500 bg-red-50 text-red-700' },
              ].map(opt => (
                <button key={opt.value} onClick={() => setFeedbackType(opt.value)}
                  className={`flex items-center justify-center gap-1.5 py-2 rounded-lg border text-sm font-medium transition-colors ${
                    feedbackType === opt.value ? opt.activeClass : 'border-gray-200 text-gray-500 hover:bg-gray-50'
                  }`}>
                  <opt.icon size={13} />
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-sm font-medium text-gray-700 mb-1.5 block">补充信息</label>
            <textarea
              value={additionalInfo}
              onChange={e => setAdditionalInfo(e.target.value)}
              placeholder="输入你认为 Agent 遗漏的信息或你的判断依据..."
              rows={3}
              className="w-full border border-gray-300 rounded-lg p-2.5 text-sm focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-200 resize-none"
            />
          </div>

          <div>
            <label className="text-sm font-medium text-gray-700 mb-1.5 block">修改推理（可选）</label>
            <textarea
              value={overrideReasoning}
              onChange={e => setOverrideReasoning(e.target.value)}
              placeholder="如果你不同意 Agent 的判断，请说明你的推理..."
              rows={2}
              className="w-full border border-gray-300 rounded-lg p-2.5 text-sm focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-200 resize-none"
            />
          </div>

          <div className="flex gap-2 pt-1">
            <button onClick={onClose}
              className="flex-1 py-2.5 border border-gray-300 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors">
              取消
            </button>
            <button onClick={() => onSubmit({ feedbackType, additionalInfo, overrideReasoning })}
              className="flex-1 py-2.5 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors">
              提交反馈
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function buildReasoningRounds(trace: TraceStep[], investigations: any[]) {
  const diagTrace = trace.filter(t =>
    t.step.startsWith('诊断启动') || t.step.startsWith('Agent决策') || t.step.startsWith('诊断工具')
  )

  const rounds: any[] = []
  let current: any = null

  for (const t of diagTrace) {
    if (t.step === '诊断启动') {
      current = {
        round: 0, agentThought: t.output || '开始诊断', decision: '初始化',
        confidence: 0.5, tools: [], conclusion: undefined,
      }
      rounds.push(current)
      current = null
    } else if (t.step === 'Agent决策') {
      if (current) rounds.push(current)
      current = {
        round: rounds.length + 1,
        agentThought: t.agent_thought || t.output || '',
        decision: t.decision || (t.output?.includes('调用') ? t.output : ''),
        confidence: t.tool_confidence || 0.7,
        tools: [],
        conclusion: t.conclusion_from_step,
      }
    } else if (t.step.startsWith('诊断工具') && current) {
      current.tools.push({
        name: t.tool || t.step.replace('诊断工具:', ''),
        result: t.tool_reasoning || t.output || '',
        confidence: t.tool_confidence || 0.5,
      })
    }
  }
  if (current) rounds.push(current)

  let invIdx = 0
  for (const round of rounds) {
    for (const tool of round.tools) {
      const inv = investigations[invIdx]
      if (inv && inv.tool === tool.name) {
        tool.result = inv.result_summary || tool.result
        tool.confidence = inv.confidence || tool.confidence
        invIdx++
      }
    }
  }
  return rounds
}

function traceIcon(step: string): any {
  if (step.includes('物料') || step.includes('构造')) return Activity
  if (step.includes('价格') || step.includes('预测')) return Target
  if (step.includes('成本') || step.includes('拆解')) return Wrench
  if (step.includes('偏离') || step.includes('评分') || step.includes('分流')) return TrendingUp
  if (step.includes('分流') || step.includes('快速')) return GitBranch
  if (step.includes('诊断') || step.includes('Agent')) return Brain
  if (step.includes('方案')) return Lightbulb
  if (step.includes('行情') || step.includes('市场')) return Globe
  return Activity
}
