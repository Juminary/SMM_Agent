import { useEffect, useState, useMemo, useRef } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import {
  ArrowLeft, Play, Pause, RotateCcw, SkipForward, SkipBack,
  Brain, Activity, Wrench, ChevronRight, Lightbulb, User,
  Search, BarChart3, Globe, Clock, Target, TrendingUp,
  MessageSquare, AlertTriangle, CheckCircle, XCircle,
  HelpCircle, Sparkles, GitBranch, BarChart2,
  SlidersHorizontal,
} from 'lucide-react'
import { fetchQuote, submitHumanFeedback } from '../utils/api'
import type { Quote, DiagnosisHypothesis, TraceStep, DecisionLogEntry } from '../types'
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

type DisplayStep = { type: 'baseline' | 'reasoning'; round?: number; data: TraceStep }

// ===== Main page =====
export default function ExecutionTrace() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
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
  const [simpleView, setSimpleView] = useState(false)
  const [actionNotice, setActionNotice] = useState<{ tone: 'success' | 'error' | 'info'; message: string } | null>(null)
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
  const baselineSteps = useMemo(() => trace.filter(t =>
    !t.step.startsWith('诊断') && !t.step.startsWith('Agent') &&
    !t.step.startsWith('诊断工具') && !t.step.startsWith('方案生成') &&
    !t.step.startsWith('流程结束')
  ), [trace])

  // All steps for animation
  const allSteps = useMemo(() => {
    const baseline = baselineSteps.map(t => ({ type: 'baseline' as const, data: t }))
    const rounds = reasoningRounds.flatMap((r, i) =>
      r.steps.map((s: TraceStep) => ({ type: 'reasoning' as const, round: i + 1, data: s }))
    )
    return [...baseline, ...rounds]
  }, [baselineSteps, reasoningRounds])

  const diagnosisSteps = reasoningRounds.flatMap((r, i) =>
    r.steps.map((s: TraceStep) => ({ type: 'reasoning' as const, round: i + 1, data: s }))
  )

  const displaySteps = filterPhase2 && diagnosisSteps.length > 0 ? diagnosisSteps : allSteps
  const totalPhase1 = baselineSteps.length
  const totalDiagnosis = reasoningRounds.reduce((s, r) => s + r.steps.length, 0)
  const totalMs = trace.reduce((sum, s) => sum + (s.duration_ms || 0), 0)
  const selectedDisplayStep = selectedStep != null ? displaySteps[selectedStep] : null
  const currentDisplayStep = currentIdx >= 0 ? displaySteps[currentIdx] : null
  const actionStepIndex = selectedStep != null ? selectedStep : currentIdx >= 0 ? currentIdx : null
  const actionDisplayStep = actionStepIndex != null ? displaySteps[actionStepIndex] : null
  const actionFeedbackContext = useMemo(
    () => getLatestFeedbackContext(quote?.decision_log, actionStepIndex ?? -1),
    [quote?.decision_log, actionStepIndex]
  )
  const pendingHumanDecision = quote?.status === 'pending' && quote?.phase !== 'fast_pass'
  const awaitingSolutionSelection = pendingHumanDecision && quote?.phase !== 'resolution' && !quote?.selected_solution_id
  const followUpInProgress = quote?.status === 'pending' && quote?.phase === 'resolution' && !!quote?.selected_solution_id
  const keySignals = [
    { label: '价格偏离', value: `${quote?.price_deviation?.toFixed?.(1) ?? quote?.price_deviation ?? 0}%`, tone: (quote?.price_deviation ?? 0) > 60 ? 'danger' : (quote?.price_deviation ?? 0) > 20 ? 'warn' : 'ok' },
    { label: '同行溢价', value: quote?.peer_benchmark?.current_premium_pct != null ? `${quote.peer_benchmark.current_premium_pct.toFixed(1)}%` : '暂无', tone: quote?.peer_benchmark?.current_premium_pct && quote.peer_benchmark.current_premium_pct > 50 ? 'danger' : 'neutral' },
    { label: '库存窗口', value: quote?.inventory_context?.days_remaining != null ? `${quote.inventory_context.days_remaining}天` : '未知', tone: quote?.inventory_context?.days_remaining != null && quote.inventory_context.days_remaining < 7 ? 'warn' : 'neutral' },
    { label: '结论置信度', value: quote?.diagnosis_conclusion?.confidence != null ? `${(quote.diagnosis_conclusion.confidence * 100).toFixed(0)}%` : '待生成', tone: (quote?.diagnosis_conclusion?.confidence ?? 0) >= 0.7 ? 'ok' : 'warn' },
  ] as const
  const recommendedAction = awaitingSolutionSelection
    ? '当前处于方案选择阶段，可先补充反馈或 Override，再回到详情页采纳一个执行方案。'
    : followUpInProgress
    ? (quote?.interrupt_reason || '当前方案已进入跟进阶段，请结合执行进展决定最终通过或驳回。')
    : quote?.phase === 'fast_pass'
    ? '本单已进入快速通道，优先确认第一阶段证据是否充分即可。'
    : '当前分析已完成，建议结合重跑对比确认是否需要修正结论。'
  const currentTaskTitle = awaitingSolutionSelection
    ? '等待选择方案'
    : followUpInProgress
    ? '方案跟进中'
    : quote?.phase === 'fast_pass'
    ? '快速通道复核'
    : '复盘诊断结果'
  const evidenceCoverage = Math.min(
    100,
    (baselineSteps.length > 0 ? 30 : 0) +
    Math.min(reasoningRounds.length * 20, 40) +
    Math.min(investigations.length * 5, 20) +
    (quote?.diagnosis_conclusion ? 10 : 0)
  )

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

        {actionNotice && (
          <InlineNotice tone={actionNotice.tone} message={actionNotice.message} />
        )}

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

            {/* Simple/Expert view toggle */}
            <button
              onClick={() => setSimpleView(!simpleView)}
              className={`flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border transition-colors font-medium ${
                simpleView
                  ? 'bg-emerald-50 border-emerald-300 text-emerald-700'
                  : 'bg-white border-gray-200 text-gray-500 hover:bg-gray-50'
              }`}
            >
              {simpleView ? '业务视图' : '技术视图'}
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

        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
          <SummaryStatCard
            label="当前任务"
            value={currentTaskTitle}
            caption={recommendedAction}
            accent={pendingHumanDecision ? '#f59e0b' : quote.phase === 'fast_pass' ? '#10b981' : '#6366f1'}
            icon={pendingHumanDecision ? AlertTriangle : quote.phase === 'fast_pass' ? CheckCircle : Brain}
          />
          <SummaryStatCard
            label="证据覆盖度"
            value={`${evidenceCoverage}%`}
            caption={`${totalPhase1} 个体检步骤 · ${totalDiagnosis} 个推理步骤`}
            accent="#0f766e"
            icon={Search}
          />
          <SummaryStatCard
            label="当前结论"
            value={quote.diagnosis_conclusion?.cause_category || (quote.phase === 'fast_pass' ? 'normal' : '待确认')}
            caption={quote.diagnosis_conclusion?.root_cause?.slice(0, 48) || '尚未形成诊断结论'}
            accent="#7c3aed"
            icon={Sparkles}
          />
          <SummaryStatCard
            label="人工处理状态"
            value={awaitingSolutionSelection ? '待选方案' : followUpInProgress ? '跟进中' : pendingHumanDecision ? '待处理' : quote.human_decision || '已完成'}
            caption={quote.decision_by ? `最近处理人：${quote.decision_by}` : '尚未记录人工决策'}
            accent={pendingHumanDecision ? '#dc2626' : '#2563eb'}
            icon={MessageSquare}
          />
        </div>

        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
          <div className="space-y-5">
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

            {viewMode === 'dag' ? (
              <div className="bg-white rounded-2xl border shadow-sm overflow-hidden">
                <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-semibold text-gray-700">执行链路 DAG</h3>
                    <p className="text-xs text-gray-400 mt-0.5">先看整体链路，再点击节点核对证据和动作。</p>
                  </div>
                  <p className="text-xs text-gray-400">点击节点查看详情</p>
                </div>
                <ExecutionDAG
                  trace={trace}
                  currentStepIdx={currentIdx}
                  onNodeClick={(node) => {
                    const idx = allSteps.findIndex(s => {
                      if (node.id.startsWith('p1-')) {
                        const i = parseInt(node.id.split('-')[1])
                        return s.type === 'baseline' && s.data === baselineSteps[i]
                      }
                      return false
                    })
                    if (idx >= 0) setCurrentIdx(idx)
                  }}
                  height={500}
                  showControls
                />
              </div>
            ) : (
              <>
                {hypotheses.length > 0 && (
                  <HypothesisBoard hypotheses={hypotheses} investigations={investigations} />
                )}

                <div className="bg-white rounded-2xl border shadow-sm">
                  <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
                    <div>
                      <h3 className="text-sm font-semibold text-gray-700">执行时间线</h3>
                      <p className="text-xs text-gray-400 mt-0.5">
                        按时间核对 AI 做了什么、看到了什么、为什么得出当前结论。
                      </p>
                    </div>
                    <div className="text-xs text-gray-400">
                      {filterPhase2 ? '当前聚焦第二阶段推理链' : '当前显示完整流程'}
                    </div>
                  </div>
                  <div className="px-5 py-3 relative">
                    <div className="absolute left-[22px] top-8 bottom-8 w-0.5 bg-gray-200" />
                    <div className="space-y-1">
                      {displaySteps.map((step, i) => (
                        <TimelineStep
                          key={i}
                          step={step}
                          isActive={i === currentIdx}
                          isPast={i < currentIdx}
                          onClick={() => {
                            setCurrentIdx(prev => prev === i ? -1 : i)
                            setSelectedStep(prev => prev === i ? null : i)
                          }}
                          onOverride={() => setShowOverride(true)}
                          onFeedback={() => setShowFeedback(i)}
                          simpleView={simpleView}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              </>
            )}

            {decisionLog.length > 0 && (
              <DecisionLogPanel entries={decisionLog} />
            )}
          </div>

          <div className="space-y-5 xl:sticky xl:top-5 self-start">
            <TaskGuideCard
              pendingHumanDecision={pendingHumanDecision}
              currentTaskTitle={currentTaskTitle}
              taskStateLabel={awaitingSolutionSelection ? '待选方案' : followUpInProgress ? '跟进中' : pendingHumanDecision ? '待处理' : '可复盘'}
              recommendedAction={recommendedAction}
              currentStep={actionDisplayStep}
              hasActionStep={actionStepIndex != null}
              onJumpToCurrent={() => {
                if (actionStepIndex != null) {
                  setSelectedStep(actionStepIndex)
                }
              }}
              onOpenFeedback={() => {
                if (actionStepIndex != null) {
                  setShowFeedback(actionStepIndex)
                }
              }}
              onOpenOverride={() => setShowOverride(true)}
              onOpenDiff={() => setShowDiff(true)}
            />

            <SignalsPanel signals={keySignals} />

            {selectedDisplayStep ? (
              <StepDetailPanel
                step={selectedDisplayStep}
                onClose={() => setSelectedStep(null)}
                onOverride={() => setShowOverride(true)}
              />
            ) : (
              <EmptyFocusPanel
                currentStep={currentDisplayStep}
                onFocus={() => {
                  if (currentIdx >= 0) {
                    setSelectedStep(currentIdx)
                  }
                }}
              />
            )}

            {quote.diagnosis_conclusion && (
              <ConclusionPanel conclusion={quote.diagnosis_conclusion} />
            )}
          </div>
        </div>

        {/* ===== Feedback Modal ===== */}
        {showFeedback != null && (
          <FeedbackModal
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
                setActionNotice({
                  tone: 'success',
                  message: `已记录对步骤“${displaySteps[showFeedback]?.data?.step || showFeedback}”的人工反馈。继续执行 Override 时会自动复用这条反馈。`,
                })
              } catch (e: any) {
                console.error('Failed to submit feedback:', e)
                setActionNotice({
                  tone: 'error',
                  message: e?.response?.data?.detail || e?.message || '提交反馈失败',
                })
              }
              setShowFeedback(null)
            }}
          />
        )}

        {/* ===== Override Modal ===== */}
        {showOverride && quote && (
          <OverrideModal
            quote={quote}
            stepIndex={actionStepIndex ?? -1}
            stepLabel={actionStepIndex != null ? displaySteps[actionStepIndex]?.data?.step || `步骤 ${actionStepIndex}` : '整体'}
            feedbackContext={actionFeedbackContext}
            onClose={() => setShowOverride(false)}
            onSuccess={(result) => {
              setShowOverride(false)
              if (result.rerun_quote?.id) {
                setActionNotice({
                  tone: 'success',
                  message: '人工干预已触发重跑，正在切换到新的分析结果。',
                })
                navigate(`/quotes/${result.rerun_quote.id}/trace`)
                return
              }
              setActionNotice({
                tone: 'success',
                message: '人工干预已记录到当前报价。',
              })
              loadQuote()
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

function SummaryStatCard({
  label,
  value,
  caption,
  accent,
  icon: Icon,
}: {
  label: string
  value: string
  caption: string
  accent: string
  icon: any
}) {
  return (
    <div className="bg-white rounded-2xl border shadow-sm p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs text-gray-400">{label}</div>
          <div className="text-base font-semibold text-gray-900 mt-1">{value}</div>
        </div>
        <div
          className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
          style={{ background: `${accent}18`, color: accent }}
        >
          <Icon size={16} />
        </div>
      </div>
      <p className="text-xs text-gray-500 mt-2 leading-relaxed">{caption}</p>
    </div>
  )
}

function InlineNotice({
  tone,
  message,
}: {
  tone: 'success' | 'error' | 'info'
  message: string
}) {
  const toneClass = {
    success: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    error: 'border-red-200 bg-red-50 text-red-700',
    info: 'border-blue-200 bg-blue-50 text-blue-700',
  } as const

  return (
    <div className={`rounded-2xl border px-4 py-3 text-sm ${toneClass[tone]}`}>
      {message}
    </div>
  )
}

function TaskGuideCard({
  pendingHumanDecision,
  currentTaskTitle,
  taskStateLabel,
  recommendedAction,
  currentStep,
  hasActionStep,
  onJumpToCurrent,
  onOpenFeedback,
  onOpenOverride,
  onOpenDiff,
}: {
  pendingHumanDecision: boolean
  currentTaskTitle: string
  taskStateLabel: string
  recommendedAction: string
  currentStep: DisplayStep | null
  hasActionStep: boolean
  onJumpToCurrent: () => void
  onOpenFeedback: () => void
  onOpenOverride: () => void
  onOpenDiff: () => void
}) {
  return (
    <div className="bg-white rounded-2xl border shadow-sm p-4 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-xs text-gray-400">当前任务</div>
          <div className="text-sm font-semibold text-gray-900 mt-1">
            {currentTaskTitle}
          </div>
        </div>
        <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${
          pendingHumanDecision
            ? 'bg-amber-50 text-amber-700 border border-amber-200'
            : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
        }`}>
          {taskStateLabel}
        </span>
      </div>

      <p className="text-sm text-gray-600 leading-relaxed">{recommendedAction}</p>

      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={onJumpToCurrent}
          disabled={!hasActionStep}
          className="px-3 py-2 rounded-xl border border-gray-200 text-sm text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          聚焦当前步骤
        </button>
        <button
          onClick={onOpenFeedback}
          disabled={!hasActionStep}
          className="px-3 py-2 rounded-xl border border-blue-200 text-sm text-blue-700 hover:bg-blue-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          注入反馈
        </button>
        <button
          onClick={onOpenOverride}
          className="px-3 py-2 rounded-xl border border-indigo-200 text-sm text-indigo-700 hover:bg-indigo-50 transition-colors"
        >
          执行 Override
        </button>
        <button
          onClick={onOpenDiff}
          className="px-3 py-2 rounded-xl border border-emerald-200 text-sm text-emerald-700 hover:bg-emerald-50 transition-colors"
        >
          对比重跑
        </button>
      </div>

      <div className="rounded-xl bg-gray-50 border border-gray-200 p-3">
        <div className="text-xs text-gray-400 mb-1">当前焦点</div>
        <div className="text-sm font-medium text-gray-800">
          {currentStep?.data.step || '尚未选中步骤'}
        </div>
        <p className="text-xs text-gray-500 mt-1 leading-relaxed">
          {currentStep?.data.output?.slice(0, 120) || '点击时间线中的任意步骤，再进行反馈或 Override，这样动作会明确挂到具体证据节点上。'}
        </p>
      </div>
    </div>
  )
}

function SignalsPanel({
  signals,
}: {
  signals: ReadonlyArray<{ label: string; value: string; tone: 'danger' | 'warn' | 'ok' | 'neutral' }>
}) {
  const toneMap = {
    danger: 'border-red-200 bg-red-50 text-red-700',
    warn: 'border-amber-200 bg-amber-50 text-amber-700',
    ok: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    neutral: 'border-gray-200 bg-gray-50 text-gray-700',
  } as const

  return (
    <div className="bg-white rounded-2xl border shadow-sm p-4">
      <div className="flex items-center gap-2 mb-3">
        <TrendingUp size={14} className="text-indigo-500" />
        <h3 className="text-sm font-semibold text-gray-700">关键信号</h3>
      </div>
      <div className="space-y-2">
        {signals.map(signal => (
          <div key={signal.label} className={`rounded-xl border px-3 py-2 ${toneMap[signal.tone]}`}>
            <div className="text-[11px] opacity-75">{signal.label}</div>
            <div className="text-sm font-semibold mt-0.5">{signal.value}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

function EmptyFocusPanel({
  currentStep,
  onFocus,
}: {
  currentStep: DisplayStep | null
  onFocus: () => void
}) {
  return (
    <div className="bg-white rounded-2xl border shadow-sm p-4">
      <div className="flex items-center gap-2 mb-2">
        <Activity size={14} className="text-indigo-500" />
        <h3 className="text-sm font-semibold text-gray-700">步骤详情</h3>
      </div>
      <p className="text-sm text-gray-600 leading-relaxed">
        {currentStep
          ? '当前已有播放焦点，但还没有锁定到右侧详情。点击下方按钮即可固定查看。'
          : '点击时间线中的步骤后，这里会显示该步骤的关键字段、输出摘要和原始数据。'}
      </p>
      {currentStep && (
        <button
          onClick={onFocus}
          className="mt-3 w-full px-3 py-2 rounded-xl border border-indigo-200 text-sm text-indigo-700 hover:bg-indigo-50 transition-colors"
        >
          固定当前步骤
        </button>
      )}
    </div>
  )
}

function TimelineStep({ step, isActive, isPast, onClick, onOverride, onFeedback, simpleView }: {
  step: DisplayStep
  isActive: boolean
  isPast: boolean
  onClick: () => void
  onOverride: () => void
  onFeedback: () => void
  simpleView?: boolean
}) {
  const data = step.data
  const isBaseline = step.type === 'baseline'
  const displayStep = simpleView ? simpleLabel(data.step || '') : (data.step || '')
  const displayOutput = simpleView ? simplifyOutput(data.output || '') : (data.output || '')

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
            <span className="text-sm font-medium text-gray-800">{displayStep}</span>
            {data.tool && (
              <span className="text-xs text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">
                {simpleView ? simpleLabel(data.tool) : data.tool}
              </span>
            )}
          </div>
          <p className="text-xs text-gray-500 mt-0.5">{displayOutput}</p>
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
  const hasThought = data.agent_thought
  const hasTool = Boolean(data.tool)

  return (
    <div
      className={`rounded-xl border p-4 transition-all cursor-pointer group ${
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
          {data.tool_confidence != null && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 font-medium">
              {(data.tool_confidence * 100).toFixed(0)}%
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
      {hasTool && (
        <div className="space-y-1.5 mb-2">
          <div className="flex items-start gap-2 bg-gray-50 rounded-lg p-2.5">
            {(() => {
              const Icon = TOOL_ICONS[data.tool || ''] || Wrench
              return <Icon size={13} className="text-gray-400 mt-0.5 shrink-0" />
            })()}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-gray-700">
                  {simpleView ? simpleLabel(data.tool || '') : data.tool}
                </span>
                {data.tool_confidence != null && (
                  <span className="text-xs text-gray-400">{(data.tool_confidence * 100).toFixed(0)}%</span>
                )}
              </div>
              <p className="text-xs text-gray-500 mt-0.5">{data.output?.slice(0, 180)}</p>
            </div>
          </div>
        </div>
      )}

      {/* Conclusion */}
      {data.conclusion_from_step && (
        <div className="text-xs text-emerald-700 bg-emerald-50 rounded px-2.5 py-1.5 border border-emerald-100">
          ← {data.conclusion_from_step.slice(0, 120)}
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
  const detail = step.data
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
      <div className="p-4 space-y-3">
        <div className="rounded-xl bg-gray-50 border border-gray-200 p-3">
          <div className="text-xs text-gray-400 mb-1">步骤名</div>
          <div className="text-sm font-semibold text-gray-900">{detail.step || '未命名步骤'}</div>
          {detail.tool && (
            <div className="text-xs text-gray-500 mt-1">调用工具：{detail.tool}</div>
          )}
        </div>
        {(detail.output || detail.conclusion_from_step) && (
          <div className="rounded-xl border border-gray-200 p-3">
            <div className="text-xs text-gray-400 mb-1">核心输出</div>
            <p className="text-sm text-gray-700 leading-relaxed">
              {(detail.conclusion_from_step || detail.output || '').slice(0, 220)}
            </p>
          </div>
        )}
        <details className="rounded-xl border border-gray-200 overflow-hidden">
          <summary className="px-3 py-2 text-sm font-medium text-gray-700 bg-gray-50 cursor-pointer">
            查看原始数据
          </summary>
          <pre className="text-xs p-4 overflow-auto max-h-72 font-mono leading-relaxed bg-white text-gray-700">
            {JSON.stringify(detail || step, null, 2)}
          </pre>
        </details>
      </div>
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

function DecisionLogPanel({ entries }: { entries: any[] }) {
  const [expanded, setExpanded] = useState(false)
  const displayEntries = expanded ? entries : entries.slice(-3)

  if (!entries || entries.length === 0) return null

  return (
    <div className="bg-white rounded-2xl border shadow-sm">
      <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
        <div className="flex items-center gap-2">
          <GitBranch size={14} className="text-violet-500" />
          <h3 className="text-sm font-semibold text-gray-700">AI 决策时间线</h3>
          <span className="text-xs px-2 py-0.5 rounded-full bg-violet-100 text-violet-600 font-medium">
            {entries.length} 步
          </span>
        </div>
        {entries.length > 3 && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-xs text-indigo-500 hover:text-indigo-600 font-medium"
          >
            {expanded ? '收起' : `查看全部 ${entries.length} 步`}
          </button>
        )}
      </div>
      <div className="p-4 space-y-3">
        {displayEntries.map((entry: any, i: number) => (
          <div key={i} className="flex gap-3">
            {/* Timeline connector */}
            <div className="flex flex-col items-center">
              <div className={`w-6 h-6 rounded-full flex items-center justify-center text-white text-[10px] font-bold ${
                entry.chosen_action === 'approve' || entry.chosen_action === 'accept' || entry.chosen_action === 'approved'
                  ? 'bg-emerald-500'
                  : entry.source === 'human'
                  ? 'bg-blue-500'
                  : 'bg-violet-500'
              }`}>
                {entry.source === 'human' ? 'H' : 'AI'}
              </div>
              {i < displayEntries.length - 1 && (
                <div className="w-0.5 flex-1 bg-gray-200 my-1" />
              )}
            </div>
            {/* Content */}
            <div className="flex-1 pb-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-gray-700">
                  {entry.decision_point}
                </span>
                <span className="text-[10px] text-gray-400 font-mono">
                  {entry.timestamp ? new Date(entry.timestamp).toLocaleTimeString() : ''}
                </span>
              </div>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-xs px-1.5 py-0.5 rounded font-medium bg-gray-100 text-gray-600">
                  {entry.chosen_action}
                </span>
                {entry.is_override && (
                  <span className="text-xs px-1.5 py-0.5 rounded font-medium bg-orange-100 text-orange-600">
                    Override
                  </span>
                )}
                {entry.confidence != null && entry.source !== 'human' && (
                  <span className="text-[10px] text-gray-400">
                    {(entry.confidence * 100).toFixed(0)}%
                  </span>
                )}
              </div>
              {entry.reasoning && (
                <p className="text-xs text-gray-500 mt-1 leading-relaxed line-clamp-3">
                  {entry.reasoning}
                </p>
              )}
              {entry.override_reasoning && (
                <p className="text-xs text-orange-600 mt-1 italic">
                  人工修正: {entry.override_reasoning.slice(0, 200)}
                </p>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function FeedbackModal({ step, onClose, onSubmit }: {
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

// ===== Simple/Expert View Translation =====

const SIMPLE_LABELS: Record<string, string> = {
  // Step names
  '物料构造': '读取物料信息',
  '价格预测': 'AI估算合理价格区间',
  '行情刷新(联网)': '联网查询最新市场价',
  '成本拆解': '分析成本构成',
  '相似物料检索': '对比历史采购记录',
  '偏离度评分': '评估价格异常程度',
  '分流决策': '判断是否需要审核',
  '诊断启动': 'AI开始分析异常原因',
  'Agent决策': 'AI选择分析工具',
  '诊断结论': 'AI得出分析结论',
  '快速通道': '价格正常，自动通过',
  '流程结束': '分析完成',
  '方案生成(兜底)': '生成应对方案',
  // Tool names
  'tool_get_supplier_profile': '查看供应商历史',
  'tool_compare_peer_price': '对比同行价格',
  'tool_check_market_trend': '分析市场趋势',
  'tool_search_market_price': '查询最新市场价格',
  'tool_check_urgency': '查看库存紧急度',
  'tool_search_alternatives': '查找替代供应商',
  'tool_analyze_cost_anomaly': '深入分析成本异常',
  'tool_generate_solutions': '生成应对方案',
  'tool_predict_price_range': '价格预测',
  'tool_analyze_cost_structure': '成本拆解',
  'tool_match_similar_material': '历史对比',
  'tool_score_deviation': '异常评分',
  // Severity
  '正常': '正常 - 无需关注',
  '关注': '轻度异常 - 建议关注',
  '警示': '中度异常 - 需要处理',
  '紧急': '严重异常 - 立即处理',
}

function simpleLabel(key: string): string {
  return SIMPLE_LABELS[key] || key
}

function simplifyOutput(output: string): string {
  if (!output) return ''
  const replacements: [RegExp, string][] = [
    [/P10=¥[\d.]+ \/ P50=¥[\d.]+ \/ P90=¥[\d.]+/g, 'AI预测价格区间'],
    [/P\d+=\s*¥[\d.]+/g, ''],
    [/z-score=[\d.-]+/g, '偏离同行水平'],
    [/deviation_score/g, '异常分'],
    [/deviation/g, '偏离'],
  ]
  let result = output
  for (const [pattern, replacement] of replacements) {
    result = result.replace(pattern, replacement).trim()
  }
  return result.slice(0, 150)
}

function buildReasoningRounds(trace: TraceStep[], investigations: any[]) {
  const diagTrace = trace.filter(t =>
    t.step.startsWith('诊断启动') || t.step.startsWith('Agent决策') || t.step.startsWith('诊断工具')
  )

  const rounds: Array<{ round: number; steps: TraceStep[] }> = []
  let currentRound: { round: number; steps: TraceStep[] } | null = null
  let invIdx = 0

  const enrichStep = (step: TraceStep): TraceStep => {
    if (!step.step.startsWith('诊断工具')) return step
    const inv = investigations[invIdx]
    if (!inv || inv.tool !== step.tool) return step
    invIdx += 1
    return {
      ...step,
      output: inv.result_summary || step.output,
      tool_confidence: inv.confidence ?? step.tool_confidence,
    }
  }

  for (const rawStep of diagTrace) {
    const step = enrichStep(rawStep)

    if (step.step === '诊断启动') {
      if (currentRound?.steps.length) {
        rounds.push(currentRound)
      }
      currentRound = {
        round: rounds.length + 1,
        steps: [step],
      }
      continue
    }

    if (!currentRound) {
      currentRound = {
        round: rounds.length + 1,
        steps: [],
      }
    }

    if (step.step === 'Agent决策' && currentRound.steps.length > 0) {
      rounds.push(currentRound)
      currentRound = {
        round: rounds.length + 1,
        steps: [step],
      }
      continue
    }

    currentRound.steps.push(step)
  }

  if (currentRound?.steps.length) {
    rounds.push(currentRound)
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

function getLatestFeedbackContext(decisionLog: DecisionLogEntry[] | undefined, stepIndex: number) {
  if (!decisionLog?.length) {
    return null
  }

  for (const entry of [...decisionLog].reverse()) {
    if (entry.source !== 'human' || !entry.decision_point?.startsWith('human_feedback')) {
      continue
    }

    let entryStep = -1
    if (entry.decision_point.startsWith('human_feedback_step_')) {
      const parsed = Number(entry.decision_point.replace('human_feedback_step_', ''))
      entryStep = Number.isFinite(parsed) ? parsed : -1
    }

    if (stepIndex >= 0 && entryStep !== -1 && entryStep !== stepIndex) {
      continue
    }

    return {
      feedback_type: entry.chosen_action,
      additional_info: entry.reasoning,
      override_reasoning: entry.override_reasoning,
      step_index: entryStep,
      timestamp: entry.timestamp,
    }
  }

  return null
}
