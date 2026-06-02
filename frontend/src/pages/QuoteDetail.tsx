import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import {
  ArrowLeft, AlertTriangle, CheckCircle, Clock, TrendingUp,
  Activity, Search, Brain, Lightbulb, FileSpreadsheet,
  FileText, Shield, BarChart3, Target, Zap, ChevronRight,
  User, Building2, LineChart, Package, GitBranch,
  BarChart2, SlidersHorizontal, Loader2, MessageSquare,
} from 'lucide-react'
import { fetchQuote, selectQuoteSolution, submitDecision } from '../utils/api'
import type { Quote, Solution, CostItem, DiagnosisInvestigation, DecisionLogEntry } from '../types'
import ExecutionDAG from '../components/ExecutionDAG'
import DiffView from '../components/DiffView'
import OverrideModal from '../components/OverrideModal'
import * as XLSX from 'xlsx'

const SEVERITY_ICON: Record<string, typeof AlertTriangle> = {
  '正常': CheckCircle, '关注': AlertTriangle, '警示': Activity, '紧急': Zap,
}

export default function QuoteDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [quote, setQuote] = useState<Quote | null>(null)
  const [loading, setLoading] = useState(true)
  const [selectedSolution, setSelectedSolution] = useState<string | null>(null)
  const [showDiff, setShowDiff] = useState(false)
  const [showDAGPreview, setShowDAGPreview] = useState(false)
  const [showOverride, setShowOverride] = useState(false)
  const [solutionNote, setSolutionNote] = useState('')
  const [finalDecisionNote, setFinalDecisionNote] = useState('')
  const [solutionLoading, setSolutionLoading] = useState(false)
  const [decisionLoading, setDecisionLoading] = useState<string | null>(null)
  const [decisionError, setDecisionError] = useState('')
  const [actionNotice, setActionNotice] = useState<{ tone: 'success' | 'info' | 'error'; message: string } | null>(null)
  const decisionPanelRef = useRef<HTMLDivElement | null>(null)
  const selectedSolutionData = useMemo(
    () => quote?.solutions?.find(sol => sol.id === selectedSolution) || null,
    [quote, selectedSolution]
  )
  const latestFeedbackContext = useMemo(
    () => getLatestFeedbackContext(quote?.decision_log),
    [quote?.decision_log]
  )

  useEffect(() => {
    if (id) {
      loadQuote()
    }
  }, [id])

  useEffect(() => {
    if (!quote?.solutions?.length) {
      if (selectedSolution !== null) {
        setSelectedSolution(null)
      }
      return
    }

    const preferredSolutionId = quote.selected_solution_id || selectedSolution
    const currentStillExists = quote.solutions.some(sol => sol.id === preferredSolutionId)
    if (!currentStillExists) {
      setSelectedSolution(quote.solutions[0].id)
      return
    }
    if (preferredSolutionId !== selectedSolution) {
      setSelectedSolution(preferredSolutionId)
    }
  }, [quote?.solutions, selectedSolution])

  const loadQuote = async () => {
    try {
      const res = await fetchQuote(id!)
      setQuote(res)
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  const handleDecision = async (decision: string) => {
    try {
      if (quote?.phase !== 'fast_pass' && !quote?.selected_solution_id) {
        setDecisionError('请先选择并采纳一个执行方案，再提交最终通过或驳回。')
        return
      }
      setDecisionLoading(decision)
      setDecisionError('')
      setActionNotice(null)
      const updated = await submitDecision(id!, {
        decision,
        decision_by: '当前用户',
        selected_solution_id: quote?.selected_solution_id || selectedSolution || undefined,
        override_reason: finalDecisionNote || undefined,
      })
      setQuote(updated)
      setActionNotice({
        tone: 'success',
        message: `已提交${decisionLabel(decision)}，当前状态已更新为 ${statusLabel(updated.status)}。`,
      })
    } catch (e: any) {
      console.error(e)
      setDecisionError(e.response?.data?.detail || e.message || '提交决策失败，请稍后重试')
    } finally {
      setDecisionLoading(null)
    }
  }

  const handleApplySolution = async () => {
    if (!selectedSolution) {
      setDecisionError('请先从方案列表中选择一条执行方案。')
      return
    }

    try {
      setSolutionLoading(true)
      setDecisionError('')
      setActionNotice(null)
      const updated = await selectQuoteSolution(id!, {
        selected_solution_id: selectedSolution,
        selected_by: '当前用户',
        note: solutionNote || '',
      })
      setQuote(updated)
      setActionNotice({
        tone: 'success',
        message: '已采纳方案并进入跟进阶段。接下来请等待执行进展，再决定最终通过或驳回。',
      })
    } catch (e: any) {
      console.error(e)
      setDecisionError(e.response?.data?.detail || e.message || '提交方案失败，请稍后重试')
    } finally {
      setSolutionLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin h-8 w-8 border-2 border-indigo-500 border-t-transparent rounded-full" />
      </div>
    )
  }

  if (!quote) {
    return <div className="text-center py-16 text-gray-400">报价不存在</div>
  }

  const severityIcon = SEVERITY_ICON[quote.severity_level] || AlertTriangle
  const committedSolution = quote.solutions?.find(sol => sol.id === quote.selected_solution_id) || null
  const pendingHumanDecision = quote.status === 'pending' && quote.phase !== 'fast_pass'
  const awaitingSolutionSelection = pendingHumanDecision && quote.phase !== 'resolution' && !quote.selected_solution_id
  const followUpInProgress = quote.status === 'pending' && quote.phase === 'resolution' && !!quote.selected_solution_id
  const lastHumanEntry = [...(quote.decision_log || [])].reverse().find(entry => entry.source === 'human')
  const recommendedAction = quote.phase === 'fast_pass'
    ? '这是一条快速通道单据，确认价格区间和关键指标后即可直接通过。'
    : awaitingSolutionSelection
    ? '先从右侧选择一个执行方案，Agent 会进入跟进阶段；待跟进结果明确后，再提交最终通过或驳回。'
    : followUpInProgress
    ? quote.interrupt_reason || '当前方案已进入跟进阶段，请结合最新执行进展决定最终通过或驳回。'
    : '这条单据已经有人工处理结果，仍可复盘证据并重新调整判断。'

  return (
    <div className="max-w-7xl mx-auto px-4 py-6 space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3 flex-wrap">
          <Link to="/quotes" className="p-2 bg-white hover:bg-gray-100 rounded-xl shadow-sm border transition-colors">
            <ArrowLeft size={20} className="text-gray-500" />
          </Link>
          <div>
            <h1 className="text-xl font-bold text-gray-900">{quote.material_name}</h1>
            <p className="text-sm text-gray-500">{quote.supplier_name} · ¥{quote.supplier_quote} · {quote.quantity}件</p>
          </div>
          <span
            className="px-2.5 py-1 rounded-lg text-sm font-semibold"
            style={{ background: (quote.severity_color || '#6366f1') + '18', color: quote.severity_color || '#6366f1' }}
          >
            {quote.severity_level} · {quote.deviation_score}分
          </span>
          {quote.phase === 'fast_pass' && (
            <span className="px-2.5 py-1 rounded-lg text-sm font-medium bg-emerald-50 text-emerald-600 border border-emerald-200">
              快速通道
            </span>
          )}
          {!pendingHumanDecision && quote.human_decision && (
            <span className="px-2.5 py-1 rounded-lg text-sm font-medium bg-blue-50 text-blue-700 border border-blue-200">
              已处理 · {decisionLabel(quote.human_decision)}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => setShowOverride(true)}
            className="flex items-center gap-1.5 px-3 py-2 text-sm border border-indigo-200 text-indigo-600 rounded-xl hover:bg-indigo-50 transition-colors bg-white shadow-sm"
          >
            <SlidersHorizontal size={14} /> 人工干预
          </button>
          <button
            onClick={() => setShowDiff(true)}
            className="flex items-center gap-1.5 px-3 py-2 text-sm border border-gray-300 text-gray-600 rounded-xl hover:bg-gray-50 transition-colors bg-white shadow-sm"
          >
            <BarChart2 size={14} /> 重跑对比
          </button>
          <Link
            to={`/quotes/${id}/trace`}
            className="flex items-center gap-1.5 px-3 py-2 text-sm border border-indigo-200 text-indigo-600 rounded-xl hover:bg-indigo-50 transition-colors bg-white shadow-sm"
          >
            <Activity size={14} /> 推理工作台
          </Link>
          <button
            onClick={() => exportExcel(quote)}
            className="flex items-center gap-1.5 px-3 py-2 text-sm border border-gray-300 text-gray-600 rounded-xl hover:bg-gray-50 transition-colors bg-white shadow-sm"
          >
            <FileSpreadsheet size={14} /> 导出
          </button>
          <button
            onClick={() => decisionPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
            className="flex items-center gap-1.5 px-4 py-2 text-sm bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 transition-colors shadow-sm font-medium"
          >
            <CheckCircle size={14} /> 处理流程
          </button>
        </div>
      </div>

      {(actionNotice || decisionError) && (
        <InlineNotice
          tone={decisionError ? 'error' : actionNotice?.tone || 'info'}
          message={decisionError || actionNotice?.message || ''}
        />
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px] gap-4">
        <div className="rounded-2xl border bg-white shadow-sm px-4 py-4">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <div className="text-xs text-gray-400">当前任务</div>
              <div className="text-base font-semibold text-gray-900 mt-1">
                {awaitingSolutionSelection
                  ? '等待选择执行方案'
                  : followUpInProgress
                  ? '方案跟进中'
                  : pendingHumanDecision
                  ? '等待人工确认'
                  : '已完成人工处理'}
              </div>
              <p className="text-sm text-gray-600 mt-2 max-w-3xl leading-relaxed">{recommendedAction}</p>
            </div>
            <div className="grid grid-cols-2 gap-2 min-w-[250px]">
              <MiniMetric
                label="状态"
                value={followUpInProgress ? '跟进中' : awaitingSolutionSelection ? '待选方案' : statusLabel(quote.status)}
                tone={pendingHumanDecision ? 'warn' : 'ok'}
              />
              <MiniMetric
                label="已选方案"
                value={committedSolution?.title || selectedSolutionData?.title || (quote.solutions?.length ? '待选择' : '暂无候选')}
                tone={committedSolution || selectedSolutionData ? 'ok' : 'warn'}
              />
              <MiniMetric
                label="最近人工动作"
                value={lastHumanEntry?.chosen_action || '暂无'}
                tone={lastHumanEntry ? 'neutral' : 'warn'}
              />
              <MiniMetric label="推理工作台" value="可继续干预" tone="neutral" />
            </div>
          </div>
        </div>

        <div className="rounded-2xl border bg-white shadow-sm px-4 py-4">
          <div className="flex items-center gap-2 mb-3">
            <MessageSquare size={15} className="text-violet-500" />
            <h2 className="text-sm font-semibold text-gray-800">人工干预入口</h2>
          </div>
          <div className="grid grid-cols-1 gap-2">
            <button
              onClick={() => setShowOverride(true)}
              className="w-full px-3 py-2.5 rounded-xl border border-indigo-200 text-sm text-indigo-700 hover:bg-indigo-50 transition-colors"
            >
              执行 Override
            </button>
            <Link
              to={`/quotes/${id}/trace`}
              className="w-full px-3 py-2.5 rounded-xl border border-blue-200 text-sm text-blue-700 hover:bg-blue-50 transition-colors text-center"
            >
              去推理工作台注入反馈
            </Link>
          </div>
          <p className="text-xs text-gray-500 mt-3 leading-relaxed">
            Override 适合直接修正参数或结论；反馈更适合在推理步骤上补充你的判断依据。
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 xl:grid-cols-5 gap-3">
        <Kpi label="偏离度" value={`${quote.deviation_score}分`} color={quote.severity_color} Icon={severityIcon} />
        <Kpi label="贝叶斯P50" value={`¥${quote.ai_prediction_mid ?? '?'}`} color="#6366f1" Icon={Target} />
        <Kpi label="价格偏离" value={`${quote.price_deviation}%`} color="#f59e0b" Icon={TrendingUp} />
        <Kpi label="同行z-score" value={quote.peer_benchmark?.z_score?.toFixed(1) ?? '?'} color="#8b5cf6" Icon={BarChart3} />
        <Kpi label="供应商风险" value={quote.supplier_profile?.risk_assessment ?? '?'} color="#ec4899" Icon={Shield} />
      </div>

      {quote.execution_trace && quote.execution_trace.length > 0 && (
        <div className="bg-white rounded-2xl border shadow-sm overflow-hidden">
          <button
            onClick={() => setShowDAGPreview(!showDAGPreview)}
            className="w-full flex items-center justify-between px-5 py-3 border-b border-gray-100 hover:bg-gray-50 transition-colors"
          >
            <div className="flex items-center gap-2">
              <GitBranch size={14} className="text-indigo-500" />
              <span className="text-sm font-semibold text-gray-700">执行链路总览</span>
              <span className="text-xs text-gray-400">点击查看 DAG</span>
            </div>
            <ChevronRight size={14} className={`text-gray-400 transition-transform ${showDAGPreview ? 'rotate-90' : ''}`} />
          </button>
          {showDAGPreview && (
            <div className="p-4">
              <ExecutionDAG
                trace={quote.execution_trace}
                height={280}
                showControls
                showMinimap
              />
            </div>
          )}
        </div>
      )}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <Card title="价格信息" icon={<Building2 size={15} />}>
            <div className="space-y-2">
              <div className="flex justify-between"><span className="text-gray-500">供应商报价</span><span className="font-bold text-lg text-gray-900">¥{quote.supplier_quote}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">贝叶斯P50</span><span className="text-indigo-600 font-medium">¥{quote.ai_prediction_mid ?? '?'}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">预测区间</span><span className="text-gray-700">¥{quote.ai_prediction_low ?? '?'} ~ ¥{quote.ai_prediction_high ?? '?'}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">市场偏离</span><span className="text-gray-700">{quote.market_deviation}%</span></div>
            </div>
          </Card>

          {quote.supplier_profile?.available && (
            <Card title="供应商画像" icon={<User size={15} />}>
              <div className="space-y-1 text-sm">
                <div className="flex justify-between"><span>采购次数</span><span className="font-medium">{quote.supplier_profile.purchase_count}</span></div>
                <div className="flex justify-between"><span>历史偏离均值</span><span className="font-medium">{quote.supplier_profile.avg_deviation_score}分</span></div>
                <div className="flex justify-between"><span>异常率</span><span className="font-medium text-orange-600">{quote.supplier_profile.anomaly_rate_pct}%</span></div>
                <div className="flex justify-between"><span>风险评估</span><span className="font-semibold">{quote.supplier_profile.risk_assessment}</span></div>
              </div>
            </Card>
          )}

          {quote.peer_benchmark?.available && (
            <Card title="同行对比" icon={<BarChart3 size={15} />}>
              <div className="space-y-1 text-sm">
                <div className="flex justify-between"><span>同行家数</span><span className="font-medium">{quote.peer_benchmark.peer_count}</span></div>
                <div className="flex justify-between"><span>Q1 ~ Q3</span><span>¥{quote.peer_benchmark.quartiles?.Q1} ~ ¥{quote.peer_benchmark.quartiles?.Q3}</span></div>
                <div className="flex justify-between">
                  <span>z-score</span>
                  <span className={quote.peer_benchmark.is_statistical_outlier ? 'text-red-600 font-semibold' : 'text-gray-700'}>
                    {quote.peer_benchmark.z_score}
                  </span>
                </div>
                <div className="flex justify-between"><span>判定</span><span className="font-medium">{quote.peer_benchmark.outlier_level}</span></div>
              </div>
            </Card>
          )}

          {quote.similar_materials && quote.similar_materials.length > 0 && (
            <Card title="相似物料" icon={<Search size={15} />}>
              {quote.similar_materials.slice(0, 4).map((m: any) => (
                <div key={m.id} className="flex justify-between text-sm py-1.5 border-b last:border-0">
                  <span className="truncate flex-1">{m.name}</span>
                  <span className="text-gray-400 mx-2">{(m.similarity * 100).toFixed(0)}%</span>
                  <span className="font-medium">¥{m.price}</span>
                </div>
              ))}
            </Card>
          )}

          {quote.cost_breakdown && (
            <Card title="成本结构拆解" icon={<Package size={15} />}>
              <div className="text-xs text-gray-400 mb-3 px-3 py-2 bg-gray-50 rounded-lg">
                锚点：{quote.cost_breakdown.anchor_source} ¥{quote.cost_breakdown.anchor_price} · {quote.cost_breakdown.data_quality === 'with_anchor' ? '有锚点' : '仅参考'}
              </div>
              {quote.cost_breakdown.cost_items?.map((item: CostItem) => (
                <CostBar key={item.item} item={item} />
              ))}
              <div className="text-xs text-gray-400 mt-2">{quote.cost_breakdown.note?.slice(0, 100)}</div>
            </Card>
          )}

          {quote.market_context?.available && (
            <Card title="市场行情" icon={<LineChart size={15} />}>
              <div className="space-y-1 text-sm">
                <div className="flex justify-between"><span>趋势</span><span className="font-medium">{quote.market_context.trend}</span></div>
                {quote.market_context.trend_detail && <div className="text-xs text-gray-500">{quote.market_context.trend_detail}</div>}
                {quote.market_context.price_range_24w && <div className="flex justify-between"><span>24周区间</span><span>{quote.market_context.price_range_24w}</span></div>}
                {quote.market_context.change_pct_24w != null && (
                  <div className="flex justify-between">
                    <span>变化</span>
                    <span className={quote.market_context.change_pct_24w > 0 ? 'text-red-500' : 'text-emerald-500'}>
                      {quote.market_context.change_pct_24w > 0 ? '+' : ''}{quote.market_context.change_pct_24w}%
                    </span>
                  </div>
                )}
              </div>
            </Card>
          )}

          {quote.inventory_context?.available && (
            <Card title="库存紧急度" icon={<Clock size={15} />}>
              <div className="space-y-1 text-sm">
                <div className="flex justify-between"><span>可用天数</span><span className="font-bold text-lg">{quote.inventory_context.days_remaining}天</span></div>
                <div className="flex justify-between"><span>紧急度</span><span className="font-medium">{quote.inventory_context.urgency}</span></div>
                <div className="flex justify-between"><span>可议价</span><span>{quote.inventory_context.can_negotiate ? '是' : '否'}</span></div>
                <div className="text-xs text-gray-500 mt-1.5">{quote.inventory_context.suggestion}</div>
              </div>
            </Card>
          )}

          {quote.diagnosis_investigations && quote.diagnosis_investigations.length > 0 && (
            <Card title={`诊断过程（${quote.diagnosis_investigations.length}步）`} icon={<Activity size={15} />}>
              <div className="space-y-2">
                {quote.diagnosis_investigations.map((inv: DiagnosisInvestigation) => (
                  <div key={inv.step} className="text-sm border-l-2 border-blue-200 pl-3 py-1.5 bg-blue-50/50 rounded-r">
                    <div className="text-xs font-semibold text-blue-600">{inv.tool}</div>
                    <div className="text-gray-700 mt-0.5">{inv.result_summary?.slice(0, 100)}</div>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>

        <div className="space-y-4 xl:sticky xl:top-5 self-start">
          <div ref={decisionPanelRef}>
            <DecisionCenter
              quote={quote}
              selectedSolution={selectedSolutionData}
              committedSolution={committedSolution}
              solutionNote={solutionNote}
              onSolutionNoteChange={setSolutionNote}
              onApplySolution={handleApplySolution}
              loadingSolution={solutionLoading}
              finalDecisionNote={finalDecisionNote}
              onFinalDecisionNoteChange={setFinalDecisionNote}
              onDecision={handleDecision}
              loadingDecision={decisionLoading}
              error={decisionError}
            />
          </div>

          {quote.diagnosis_conclusion && (
            <Card title="AI 诊断结论" icon={<Brain size={15} />}>
              <div className="space-y-3">
                <div>
                  <div className="text-xs text-gray-400 mb-1">根因</div>
                  <div className="text-sm font-semibold text-gray-900 leading-relaxed">{quote.diagnosis_conclusion.root_cause}</div>
                </div>
                <div className="flex gap-3 text-xs text-gray-500 flex-wrap">
                  <span className="px-2 py-0.5 bg-gray-100 rounded">类别：{quote.diagnosis_conclusion.cause_category}</span>
                  <span className="px-2 py-0.5 bg-indigo-50 text-indigo-600 rounded font-medium">{(quote.diagnosis_conclusion.confidence * 100).toFixed(0)}%</span>
                </div>
              </div>
            </Card>
          )}

          {quote.solutions && quote.solutions.length > 0 && (
            <Card title={`应对方案（${quote.solutions.length}个）`} icon={<Lightbulb size={15} />}>
              <div className="space-y-2">
                <p className="text-xs text-gray-500 leading-relaxed">
                  先选一个你准备执行的方案，再提交最终决策。已选方案会直接带入决策记录。
                </p>
                {quote.solutions.map((sol: Solution) => (
                  <button
                    key={sol.id}
                    onClick={() => setSelectedSolution(selectedSolution === sol.id ? null : sol.id)}
                    className={`w-full text-left p-3 rounded-xl border transition-all ${
                      selectedSolution === sol.id
                        ? 'border-indigo-400 bg-indigo-50 ring-1 ring-indigo-200'
                        : 'hover:bg-gray-50 border-gray-200'
                    }`}
                  >
                    <div className="flex justify-between items-center mb-1 gap-3">
                      <span className="font-medium text-sm text-gray-900">{sol.title}</span>
                      <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 font-medium shrink-0">
                        {(sol.confidence * 100).toFixed(0)}%
                      </span>
                    </div>
                    <p className="text-xs text-gray-600 leading-relaxed">{sol.description}</p>
                    <div className="flex justify-between mt-2 text-xs text-gray-400">
                      <span>{sol.action}</span>
                      <span className="text-emerald-600 font-medium">{sol.estimated_savings}</span>
                    </div>
                  </button>
                ))}
              </div>
            </Card>
          )}

          {(quote.decision_log?.length || 0) > 0 && (
            <Card title="人工干预记录" icon={<MessageSquare size={15} />}>
              <div className="space-y-2">
                {[...(quote.decision_log || [])].slice(-4).reverse().map((entry, idx) => (
                  <div key={`${entry.timestamp}-${idx}`} className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-gray-700">{entry.decision_point}</span>
                      <span className="text-[10px] text-gray-400">
                        {entry.timestamp ? new Date(entry.timestamp).toLocaleString() : ''}
                      </span>
                    </div>
                    <div className="text-xs text-gray-500 mt-1">
                      {entry.source === 'human' ? '人工' : 'AI'} · {entry.chosen_action}
                    </div>
                    {entry.reasoning && (
                      <p className="text-xs text-gray-600 mt-1 leading-relaxed">{entry.reasoning.slice(0, 120)}</p>
                    )}
                  </div>
                ))}
              </div>
            </Card>
          )}

          {quote.llm_summary && (
            <Card title="LLM 摘要" icon={<FileText size={15} />}>
              <p className="text-sm text-gray-600 whitespace-pre-wrap leading-relaxed">{quote.llm_summary.slice(0, 300)}</p>
            </Card>
          )}
        </div>
      </div>

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

      {showOverride && quote && (
        <OverrideModal
          quote={quote}
          stepLabel="整体报价"
          feedbackContext={latestFeedbackContext}
          onClose={() => setShowOverride(false)}
          onSuccess={(result) => {
            setShowOverride(false)
            if (result.rerun_quote?.id) {
              setActionNotice({
                tone: 'success',
                message: '已根据人工干预生成新的重跑结果，正在切换到最新报价。',
              })
              navigate(`/quotes/${result.rerun_quote.id}`)
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
    </div>
  )
}

function InlineNotice({
  tone,
  message,
}: {
  tone: 'success' | 'info' | 'error'
  message: string
}) {
  const toneClass = {
    success: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    info: 'border-blue-200 bg-blue-50 text-blue-700',
    error: 'border-red-200 bg-red-50 text-red-700',
  } as const

  return (
    <div className={`rounded-2xl border px-4 py-3 text-sm ${toneClass[tone]}`}>
      {message}
    </div>
  )
}

function MiniMetric({
  label,
  value,
  tone,
}: {
  label: string
  value: string
  tone: 'ok' | 'warn' | 'neutral'
}) {
  const toneClass = {
    ok: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    warn: 'border-amber-200 bg-amber-50 text-amber-700',
    neutral: 'border-gray-200 bg-gray-50 text-gray-700',
  } as const

  return (
    <div className={`rounded-xl border px-3 py-2 ${toneClass[tone]}`}>
      <div className="text-[11px] opacity-70">{label}</div>
      <div className="text-sm font-semibold mt-1">{value}</div>
    </div>
  )
}

function Kpi({ label, value, color, Icon }: { label: string; value: string; color: string; Icon: any }) {
  return (
    <div className="bg-white rounded-2xl p-3 border shadow-sm">
      <div className="flex items-center gap-2 text-gray-400 text-xs mb-1">
        <Icon size={13} style={{ color }} />
        <span>{label}</span>
      </div>
      <div className="text-lg font-bold" style={{ color }}>{value}</div>
    </div>
  )
}

function DecisionCenter({
  quote,
  selectedSolution,
  committedSolution,
  solutionNote,
  onSolutionNoteChange,
  onApplySolution,
  loadingSolution,
  finalDecisionNote,
  onFinalDecisionNoteChange,
  onDecision,
  loadingDecision,
  error,
}: {
  quote: Quote
  selectedSolution: Solution | null
  committedSolution: Solution | null
  solutionNote: string
  onSolutionNoteChange: (value: string) => void
  onApplySolution: () => void
  loadingSolution: boolean
  finalDecisionNote: string
  onFinalDecisionNoteChange: (value: string) => void
  onDecision: (decision: string) => void
  loadingDecision: string | null
  error: string
}) {
  const pending = quote.status === 'pending' && quote.phase !== 'fast_pass'
  const awaitingSolutionSelection = pending && quote.phase !== 'resolution' && !quote.selected_solution_id
  const followUpInProgress = quote.status === 'pending' && quote.phase === 'resolution' && !!quote.selected_solution_id
  const finalDecisionEnabled = quote.phase === 'fast_pass' || Boolean(quote.selected_solution_id)
  const activeSolution = committedSolution || selectedSolution

  return (
    <div className="bg-white rounded-2xl border shadow-sm overflow-hidden">
      <div className="px-4 py-4 border-b border-gray-100">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-xs text-gray-400">处理流程</div>
            <h2 className="text-base font-semibold text-gray-900 mt-1">
              {awaitingSolutionSelection
                ? '先选执行方案'
                : followUpInProgress
                ? '方案跟进中'
                : pending
                ? '等待最终结论'
                : '当前单据已有处理结果'}
            </h2>
          </div>
          <span className={`px-2.5 py-1 rounded-full text-xs font-medium border ${
            pending
              ? 'bg-amber-50 text-amber-700 border-amber-200'
              : 'bg-blue-50 text-blue-700 border-blue-200'
          }`}>
            {statusLabel(quote.status)}
          </span>
        </div>
        <p className="text-sm text-gray-600 mt-3 leading-relaxed">
          {awaitingSolutionSelection
            ? '先从方案列表中选定一个执行方案，提交后系统会进入跟进阶段。'
            : followUpInProgress
            ? (quote.interrupt_reason || '当前方案已进入跟进阶段，请在进展明确后提交最终通过或驳回。')
            : pending
            ? '当前单据已完成方案跟进，请提交最终通过或驳回。'
            : `最近一次处理结果：${decisionLabel(quote.human_decision || quote.status)}${quote.decision_by ? `，处理人 ${quote.decision_by}` : ''}。`}
        </p>
      </div>

      <div className="p-4 space-y-4">
        <div className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-3">
          <div className="text-xs text-gray-400 mb-1">步骤 1 · 选定执行方案</div>
          {activeSolution ? (
            <>
              <div className="text-sm font-semibold text-gray-900">{activeSolution.title}</div>
              <p className="text-xs text-gray-600 mt-1 leading-relaxed">{activeSolution.description}</p>
              <div className="flex items-center justify-between mt-2 text-xs">
                <span className="text-gray-500">{activeSolution.action}</span>
                <span className="text-emerald-600 font-medium">{activeSolution.estimated_savings}</span>
              </div>
              {committedSolution && (
                <div className="mt-2 inline-flex px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 text-[11px] font-medium">
                  已进入跟进
                </div>
              )}
            </>
          ) : (
            <p className="text-sm text-gray-500 leading-relaxed">
              还没有选方案。你可以在下方“应对方案”卡片里点选一条，再在这里提交进入跟进。
            </p>
          )}
        </div>

        <div>
          <label className="text-sm font-medium text-gray-700 mb-1.5 block">方案备注</label>
          <textarea
            className="w-full border border-gray-200 rounded-xl p-3 text-sm resize-none focus:outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-200"
            rows={3}
            placeholder="说明为什么采纳这个方案，以及 Agent 接下来应该重点跟进什么。"
            value={solutionNote}
            onChange={e => onSolutionNoteChange(e.target.value)}
          />
        </div>

        <button
          onClick={onApplySolution}
          disabled={loadingSolution || !selectedSolution}
          className="w-full py-2.5 rounded-xl bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 transition-colors disabled:opacity-60"
        >
          {loadingSolution ? '提交中...' : committedSolution ? '更新方案并继续跟进' : '采纳方案并进入跟进'}
        </button>

        <div className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-3">
          <div className="text-xs text-gray-400 mb-1">步骤 2 · 最终结论</div>
          <p className="text-sm text-gray-600 leading-relaxed">
            最终结果只保留“通过”或“驳回”两个终态。方案跟进阶段完成后，再做最后拍板。
          </p>
        </div>

        <div>
          <label className="text-sm font-medium text-gray-700 mb-1.5 block">最终结论备注</label>
          <textarea
            className="w-full border border-gray-200 rounded-xl p-3 text-sm resize-none focus:outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-200"
            rows={3}
            placeholder="补充最终通过或驳回的依据，比如跟进结果、供应商反馈、最新成本核实结论。"
            value={finalDecisionNote}
            onChange={e => onFinalDecisionNoteChange(e.target.value)}
          />
        </div>

        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <DecisionButton
            label="通过"
            icon={CheckCircle}
            tone="approve"
            loading={loadingDecision === 'accept'}
            disabled={!finalDecisionEnabled}
            onClick={() => onDecision('accept')}
          />
          <DecisionButton
            label="驳回"
            icon={AlertTriangle}
            tone="reject"
            loading={loadingDecision === 'reject'}
            disabled={!finalDecisionEnabled}
            onClick={() => onDecision('reject')}
          />
        </div>
        {!finalDecisionEnabled && (
          <div className="text-xs text-amber-600">
            请先采纳一个执行方案并进入跟进，再提交最终通过或驳回。
          </div>
        )}
      </div>
    </div>
  )
}

function DecisionButton({
  label,
  icon: Icon,
  tone,
  loading,
  disabled,
  onClick,
}: {
  label: string
  icon: any
  tone: 'approve' | 'reject'
  loading: boolean
  disabled?: boolean
  onClick: () => void
}) {
  const toneClass = {
    approve: 'bg-emerald-600 hover:bg-emerald-700',
    reject: 'bg-red-500 hover:bg-red-600',
  } as const

  return (
    <button
      onClick={onClick}
      disabled={loading || disabled}
      className={`py-2.5 rounded-xl text-sm font-medium text-white transition-colors flex items-center justify-center gap-1.5 disabled:opacity-60 ${toneClass[tone]}`}
    >
      {loading ? <Loader2 size={14} className="animate-spin" /> : <Icon size={14} />}
      {loading ? '提交中...' : label}
    </button>
  )
}

function Card({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-2xl border shadow-sm">
      <div className="flex items-center gap-2 text-gray-500 text-sm font-semibold px-4 py-3 border-b border-gray-100">
        <span className="text-gray-400">{icon}</span>
        {title}
      </div>
      <div className="p-4">{children}</div>
    </div>
  )
}

function CostBar({ item }: { item: CostItem }) {
  const reasonable = item.reasonable_amount
  const implied = item.implied_amount
  const maxVal = Math.max(reasonable, implied, 1)
  const isHighDev = item.deviation_from_reasonable != null && Math.abs(item.deviation_from_reasonable) > 30

  return (
    <div className="mb-3 last:mb-0">
      <div className="flex justify-between text-xs mb-1">
        <span className="font-medium text-gray-800">{item.item}</span>
        <span className={
          item.status.includes('偏高') ? 'text-red-500 font-medium' :
          item.status.includes('偏低') ? 'text-yellow-500 font-medium' :
          'text-gray-400'
        }>
          {item.status}
          {item.independently_verified && ' ✓'}
        </span>
      </div>
      <div className="flex items-center gap-2 text-xs text-gray-400 mb-1">
        <span>合理 ¥{reasonable.toFixed(1)}</span>
        <span>|</span>
        <span className={isHighDev ? 'text-red-500 font-semibold' : ''}>
          隐含 ¥{implied.toFixed(1)}
        </span>
        {item.deviation_from_reasonable != null && (
          <span className={item.deviation_from_reasonable > 0 ? 'text-red-400' : 'text-emerald-400'}>
            ({item.deviation_from_reasonable > 0 ? '+' : ''}{item.deviation_from_reasonable.toFixed(0)}%)
          </span>
        )}
      </div>
      <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden flex">
        <div className="h-full bg-blue-400 rounded-l" style={{ width: `${(reasonable / maxVal) * 100}%` }} />
        <div
          className={`h-full rounded-r ${implied > reasonable ? 'bg-red-400' : 'bg-emerald-400'}`}
          style={{ width: `${(Math.abs(implied - reasonable) / maxVal) * 100}%` }}
        />
      </div>
      <div className="text-[10px] text-gray-300 mt-0.5">{item.benchmark_pct}% · {item.data_source}</div>
    </div>
  )
}

function exportExcel(quote: Quote) {
  const wb = XLSX.utils.book_new()
  const data = [
    ['物料', quote.material_name, '供应商', quote.supplier_name],
    ['报价', quote.supplier_quote, '偏离度', quote.deviation_score],
    ['严重级别', quote.severity_level, '阶段', quote.phase],
    [], ['方案'],
    ...(quote.solutions || []).map((s: Solution) => [s.title, s.action, s.confidence, s.estimated_savings]),
  ]
  if (quote.cost_breakdown?.cost_items) {
    data.push([], ['成本项', '合理金额', '隐含金额', '偏离%', '状态'])
    quote.cost_breakdown.cost_items.forEach((c: CostItem) => data.push([c.item, c.reasonable_amount, c.implied_amount, c.deviation_from_reasonable ?? '', c.status]))
  }
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(data), 'QuoteDetail')
  XLSX.writeFile(wb, `quote-${quote.id}.xlsx`)
}

function decisionLabel(decision: string) {
  const map: Record<string, string> = {
    accept: '通过',
    approved: '通过',
    negotiate: '议价',
    reject: '驳回',
    rejected: '驳回',
    pending: '待处理',
  }
  return map[decision] || decision || '未处理'
}

function statusLabel(status: string) {
  const map: Record<string, string> = {
    pending: '待处理',
    approved: '已通过',
    rejected: '已驳回',
    negotiate: '议价中',
  }
  return map[status] || status || '未知'
}

function getLatestFeedbackContext(decisionLog: DecisionLogEntry[] | undefined) {
  if (!decisionLog?.length) {
    return null
  }

  for (const entry of [...decisionLog].reverse()) {
    if (entry.source !== 'human' || !entry.decision_point?.startsWith('human_feedback')) {
      continue
    }

    let stepIndex = -1
    if (entry.decision_point.startsWith('human_feedback_step_')) {
      const parsed = Number(entry.decision_point.replace('human_feedback_step_', ''))
      stepIndex = Number.isFinite(parsed) ? parsed : -1
    }

    return {
      feedback_type: entry.chosen_action,
      additional_info: entry.reasoning,
      override_reasoning: entry.override_reasoning,
      step_index: stepIndex,
      timestamp: entry.timestamp,
    }
  }

  return null
}
