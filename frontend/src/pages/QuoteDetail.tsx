import { useEffect, useState } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import {
  ArrowLeft, AlertTriangle, CheckCircle, Clock, TrendingUp,
  Activity, Search, Brain, Lightbulb, FileSpreadsheet,
  FileText, Shield, BarChart3, Target, Zap, ChevronRight,
  User, Building2, LineChart, Package, GitBranch, RotateCcw,
  BarChart2,
} from 'lucide-react'
import { fetchQuote, submitDecision } from '../utils/api'
import type { Quote, Solution, CostItem, DiagnosisInvestigation } from '../types'
import ExecutionDAG from '../components/ExecutionDAG'
import DiffView from '../components/DiffView'
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
  const [showDecision, setShowDecision] = useState(false)
  const [showDiff, setShowDiff] = useState(false)
  const [showDAGPreview, setShowDAGPreview] = useState(false)
  const [decisionNote, setDecisionNote] = useState('')

  useEffect(() => { if (id) { loadQuote() } }, [id])

  const loadQuote = async () => {
    try {
      const res = await fetchQuote(id!)
      setQuote(res)
    } catch (e) { console.error(e) }
    finally { setLoading(false) }
  }

  const handleDecision = async (decision: string) => {
    try {
      await submitDecision(id!, {
        decision, decision_by: '当前用户',
        selected_solution_id: selectedSolution ?? undefined,
        override_reason: decisionNote || undefined,
      })
      navigate('/quotes')
    } catch (e) { console.error(e) }
  }

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="animate-spin h-8 w-8 border-2 border-indigo-500 border-t-transparent rounded-full" />
    </div>
  )
  if (!quote) return <div className="text-center py-16 text-gray-400">报价不存在</div>

  const severityIcon = SEVERITY_ICON[quote.severity_level] || AlertTriangle

  return (
    <div className="max-w-7xl mx-auto px-4 py-6 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
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
        </div>
        {/* Action buttons */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowDiff(true)}
            className="flex items-center gap-1.5 px-3 py-2 text-sm border border-gray-300 text-gray-600 rounded-xl hover:bg-gray-50 transition-colors bg-white shadow-sm"
          >
            <BarChart2 size={14} /> 重跑对比
          </button>
          <Link to={`/quotes/${id}/trace`}
            className="flex items-center gap-1.5 px-3 py-2 text-sm border border-indigo-200 text-indigo-600 rounded-xl hover:bg-indigo-50 transition-colors bg-white shadow-sm">
            <Activity size={14} /> 推理工作台
          </Link>
          <button onClick={() => exportExcel(quote)}
            className="flex items-center gap-1.5 px-3 py-2 text-sm border border-gray-300 text-gray-600 rounded-xl hover:bg-gray-50 transition-colors bg-white shadow-sm">
            <FileSpreadsheet size={14} /> 导出
          </button>
          <button onClick={() => setShowDecision(true)}
            className="flex items-center gap-1.5 px-4 py-2 text-sm bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 transition-colors shadow-sm font-medium">
            <CheckCircle size={14} /> 提交决策
          </button>
        </div>
      </div>

      {/* KPI Row */}
      <div className="grid grid-cols-5 gap-3">
        <Kpi label="偏离度" value={`${quote.deviation_score}分`} color={quote.severity_color} Icon={severityIcon} />
        <Kpi label="贝叶斯P50" value={`¥${quote.ai_prediction_mid ?? '?'}`} color="#6366f1" Icon={Target} />
        <Kpi label="价格偏离" value={`${quote.price_deviation}%`} color="#f59e0b" Icon={TrendingUp} />
        <Kpi label="同行z-score" value={quote.peer_benchmark?.z_score?.toFixed(1) ?? '?'} color="#8b5cf6" Icon={BarChart3} />
        <Kpi label="供应商风险" value={quote.supplier_profile?.risk_assessment ?? '?'} color="#ec4899" Icon={Shield} />
      </div>

      {/* DAG Preview */}
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

      <div className="grid grid-cols-3 gap-5">
        {/* Column 1: Price + Deviation + Similar */}
        <div className="space-y-4">
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
        </div>

        {/* Column 2: Cost Breakdown */}
        <div className="space-y-4">
          {quote.cost_breakdown && (
            <Card title="成本结构拆解" icon={<Package size={15} />}>
              <div className="text-xs text-gray-400 mb-3 px-3 py-2 bg-gray-50 rounded-lg">
                锚点：{quote.cost_breakdown.anchor_source} ¥{quote.cost_breakdown.anchor_price} · {quote.cost_breakdown.data_quality === 'with_anchor' ? '有锚点' : '仅参考'}
              </div>
              {quote.cost_breakdown?.cost_items?.map((item: CostItem) => (
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
        </div>

        {/* Column 3: Diagnosis + Solutions */}
        <div className="space-y-4">
          {quote.diagnosis_conclusion && (
            <Card title="AI 诊断结论" icon={<Brain size={15} />}>
              <div className="space-y-3">
                <div>
                  <div className="text-xs text-gray-400 mb-1">根因</div>
                  <div className="text-sm font-semibold text-gray-900 leading-relaxed">{quote.diagnosis_conclusion.root_cause}</div>
                </div>
                <div className="flex gap-3 text-xs text-gray-500">
                  <span className="px-2 py-0.5 bg-gray-100 rounded">类别：{quote.diagnosis_conclusion.cause_category}</span>
                  <span className="px-2 py-0.5 bg-indigo-50 text-indigo-600 rounded font-medium">{(quote.diagnosis_conclusion.confidence * 100).toFixed(0)}%</span>
                </div>
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

          {quote.solutions && quote.solutions.length > 0 && (
            <Card title={`应对方案（${quote.solutions.length}个）`} icon={<Lightbulb size={15} />}>
              <div className="space-y-2">
                {quote.solutions.map((sol: Solution) => (
                  <div
                    key={sol.id}
                    onClick={() => setSelectedSolution(selectedSolution === sol.id ? null : sol.id)}
                    className={`p-3 rounded-xl border cursor-pointer transition-all ${
                      selectedSolution === sol.id
                        ? 'border-indigo-400 bg-indigo-50 ring-1 ring-indigo-200'
                        : 'hover:bg-gray-50 border-gray-200'
                    }`}
                  >
                    <div className="flex justify-between items-center mb-1">
                      <span className="font-medium text-sm text-gray-900">{sol.title}</span>
                      <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 font-medium">
                        {(sol.confidence * 100).toFixed(0)}%
                      </span>
                    </div>
                    <p className="text-xs text-gray-600 leading-relaxed">{sol.description}</p>
                    <div className="flex justify-between mt-2 text-xs text-gray-400">
                      <span>{sol.action}</span>
                      <span className="text-emerald-600 font-medium">{sol.estimated_savings}</span>
                    </div>
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

      {/* Decision Modal */}
      {showDecision && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50" onClick={() => setShowDecision(false)}>
          <div className="bg-white rounded-2xl p-6 w-[420px] shadow-2xl" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-gray-900 mb-4">提交决策</h3>
            <textarea
              className="w-full border border-gray-200 rounded-xl p-3 text-sm mb-4 resize-none focus:outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-200"
              rows={3} placeholder="决策备注（可选）"
              value={decisionNote} onChange={e => setDecisionNote(e.target.value)}
            />
            <div className="flex gap-2">
              <button onClick={() => handleDecision('accept')}
                className="flex-1 py-2.5 bg-emerald-600 text-white rounded-xl text-sm font-medium hover:bg-emerald-700 transition-colors flex items-center justify-center gap-1.5">
                <CheckCircle size={14} /> 通过
              </button>
              <button onClick={() => handleDecision('negotiate')}
                className="flex-1 py-2.5 bg-amber-500 text-white rounded-xl text-sm font-medium hover:bg-amber-600 transition-colors flex items-center justify-center gap-1.5">
                <TrendingUp size={14} /> 议价
              </button>
              <button onClick={() => handleDecision('reject')}
                className="flex-1 py-2.5 bg-red-500 text-white rounded-xl text-sm font-medium hover:bg-red-600 transition-colors flex items-center justify-center gap-1.5">
                <AlertTriangle size={14} /> 驳回
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Diff View Modal */}
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
  )
}

// === Sub-components ===

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
    quote.cost_breakdown.cost_items.forEach((c: CostItem) => data.push([c.item, c.reasonable_amount, c.implied_amount, c.deviation_from_reasonable, c.status]))
  }
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(data), 'QuoteDetail')
  XLSX.writeFile(wb, `quote-${quote.id}.xlsx`)
}
