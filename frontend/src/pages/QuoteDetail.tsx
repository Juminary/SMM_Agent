import { useEffect, useState } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import {
  ArrowLeft, AlertTriangle, CheckCircle, Clock, TrendingUp,
  Activity, Search, Brain, Lightbulb, Download, FileSpreadsheet,
  FileText, Shield, BarChart3, Target, Zap, ChevronRight,
  User, Building2, LineChart, Package,
} from 'lucide-react'
import { fetchQuote, submitDecision } from '../utils/api'
import type { Quote, Solution, CostItem, DiagnosisInvestigation } from '../types'
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

  if (loading) return <div className="flex items-center justify-center h-64"><div className="animate-spin h-8 w-8 border-2 border-blue-500 border-t-transparent rounded-full" /></div>
  if (!quote) return <div className="text-center py-16 text-gray-400">报价不存在</div>

  const severityIcon = SEVERITY_ICON[quote.severity_level] || AlertTriangle

  return (
    <div className="max-w-7xl mx-auto px-4 py-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link to="/quotes" className="p-2 hover:bg-gray-100 rounded-lg"><ArrowLeft size={20} /></Link>
          <div>
            <h1 className="text-xl font-bold text-gray-900">{quote.material_name}</h1>
            <p className="text-sm text-gray-500">{quote.supplier_name} · ¥{quote.supplier_quote} · {quote.quantity}件</p>
          </div>
          <span className={`px-2 py-0.5 rounded text-xs font-medium`} style={{ background: quote.severity_color + '20', color: quote.severity_color }}>
            {quote.severity_level} · {quote.deviation_score}分
          </span>
          {quote.phase === 'fast_pass' && (
            <span className="px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-700">自动通过</span>
          )}
        </div>
        <div className="flex gap-2">
          <button onClick={() => exportExcel(quote)} className="flex items-center gap-1 px-3 py-2 text-sm border rounded-lg hover:bg-gray-50">
            <FileSpreadsheet size={16} /> Excel
          </button>
          <button onClick={() => setShowDecision(true)} className="flex items-center gap-1 px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700">
            <CheckCircle size={16} /> 提交决策
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

      <div className="grid grid-cols-3 gap-6">
        {/* Column 1: Price + Deviation + Similar */}
        <div className="space-y-4">
          <Card title="价格信息" icon={<Building2 size={16} />}>
            <div className="space-y-2">
              <div className="flex justify-between"><span className="text-gray-500">供应商报价</span><span className="font-bold text-lg">¥{quote.supplier_quote}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">贝叶斯P50</span><span>¥{quote.ai_prediction_mid ?? '?'}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">预测区间</span><span>¥{quote.ai_prediction_low ?? '?'} ~ ¥{quote.ai_prediction_high ?? '?'}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">市场偏离</span><span>{quote.market_deviation}%</span></div>
            </div>
          </Card>

          {quote.supplier_profile?.available && (
            <Card title="供应商画像" icon={<User size={16} />}>
              <div className="space-y-1 text-sm">
                <div className="flex justify-between"><span>采购次数</span><span>{quote.supplier_profile.purchase_count}</span></div>
                <div className="flex justify-between"><span>历史偏离均值</span><span>{quote.supplier_profile.avg_deviation_score}分</span></div>
                <div className="flex justify-between"><span>异常率</span><span>{quote.supplier_profile.anomaly_rate_pct}%</span></div>
                <div className="flex justify-between"><span>风险评估</span><span className="font-medium">{quote.supplier_profile.risk_assessment}</span></div>
              </div>
            </Card>
          )}

          {quote.peer_benchmark?.available && (
            <Card title="同行对比" icon={<BarChart3 size={16} />}>
              <div className="space-y-1 text-sm">
                <div className="flex justify-between"><span>同行家数</span><span>{quote.peer_benchmark.peer_count}</span></div>
                <div className="flex justify-between"><span>Q1 ~ Q3</span><span>¥{quote.peer_benchmark.quartiles?.Q1} ~ ¥{quote.peer_benchmark.quartiles?.Q3}</span></div>
                <div className="flex justify-between"><span>z-score</span><span className={quote.peer_benchmark.is_statistical_outlier ? 'text-red-600 font-medium' : ''}>{quote.peer_benchmark.z_score}</span></div>
                <div className="flex justify-between"><span>判定</span><span>{quote.peer_benchmark.outlier_level}</span></div>
              </div>
            </Card>
          )}

          {quote.similar_materials && quote.similar_materials.length > 0 && (
            <Card title="相似物料" icon={<Search size={16} />}>
              {quote.similar_materials.slice(0, 4).map(m => (
                <div key={m.id} className="flex justify-between text-sm py-1 border-b last:border-0">
                  <span className="truncate flex-1">{m.name}</span>
                  <span className="text-gray-400 mx-2">sim:{(m.similarity * 100).toFixed(0)}%</span>
                  <span>¥{m.price}</span>
                </div>
              ))}
            </Card>
          )}
        </div>

        {/* Column 2: Cost Breakdown */}
        <div className="space-y-4">
          {quote.cost_breakdown && (
            <Card title="成本结构拆解" icon={<Package size={16} />}>
              <div className="text-xs text-gray-400 mb-2">
                锚点：{quote.cost_breakdown.anchor_source} ¥{quote.cost_breakdown.anchor_price} · {quote.cost_breakdown.data_quality === 'with_anchor' ? '有锚点' : '仅参考'}
              </div>
              {quote.cost_breakdown?.cost_items?.map((item: CostItem) => (
                <CostBar key={item.item} item={item} />
              ))}
              <div className="text-xs text-gray-400 mt-2">{quote.cost_breakdown.note?.slice(0, 100)}</div>
            </Card>
          )}

          {quote.market_context?.available && (
            <Card title="市场行情" icon={<LineChart size={16} />}>
              <div className="space-y-1 text-sm">
                <div className="flex justify-between"><span>趋势</span><span>{quote.market_context.trend}</span></div>
                {quote.market_context.trend_detail && <div className="text-xs text-gray-500">{quote.market_context.trend_detail}</div>}
                {quote.market_context.price_range_24w && <div className="flex justify-between"><span>24周区间</span><span>{quote.market_context.price_range_24w}</span></div>}
                {quote.market_context.change_pct_24w != null && <div className="flex justify-between"><span>变化</span><span>{quote.market_context.change_pct_24w}%</span></div>}
              </div>
            </Card>
          )}

          {quote.inventory_context?.available && (
            <Card title="库存紧急度" icon={<Clock size={16} />}>
              <div className="space-y-1 text-sm">
                <div className="flex justify-between"><span>可用天数</span><span className="font-bold">{quote.inventory_context.days_remaining}天</span></div>
                <div className="flex justify-between"><span>紧急度</span><span>{quote.inventory_context.urgency}</span></div>
                <div className="flex justify-between"><span>可议价</span><span>{quote.inventory_context.can_negotiate ? '是' : '否'}</span></div>
                <div className="text-xs text-gray-500 mt-1">{quote.inventory_context.suggestion}</div>
              </div>
            </Card>
          )}
        </div>

        {/* Column 3: Diagnosis + Solutions */}
        <div className="space-y-4">
          {quote.diagnosis_conclusion && (
            <Card title="AI 诊断结论" icon={<Brain size={16} />}>
              <div className="space-y-3">
                <div>
                  <div className="text-xs text-gray-400 mb-1">根因</div>
                  <div className="text-sm font-medium">{quote.diagnosis_conclusion.root_cause}</div>
                </div>
                <div className="flex gap-4 text-xs text-gray-500">
                  <span>类别：{quote.diagnosis_conclusion.cause_category}</span>
                  <span>置信度：{(quote.diagnosis_conclusion.confidence * 100).toFixed(0)}%</span>
                </div>
              </div>
            </Card>
          )}

          {quote.diagnosis_investigations && quote.diagnosis_investigations.length > 0 && (
            <Card title={`诊断过程（${quote.diagnosis_investigations.length}步）`} icon={<Activity size={16} />}>
              <div className="space-y-2">
                {quote.diagnosis_investigations.map((inv: DiagnosisInvestigation) => (
                  <div key={inv.step} className="text-sm border-l-2 border-blue-300 pl-3 py-1">
                    <div className="text-xs text-blue-600">{inv.tool}</div>
                    <div className="text-gray-700">{inv.result_summary?.slice(0, 100)}</div>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {quote.solutions && quote.solutions.length > 0 && (
            <Card title={`应对方案（${quote.solutions.length}个）`} icon={<Lightbulb size={16} />}>
              <div className="space-y-3">
                {quote.solutions.map((sol: Solution) => (
                  <div
                    key={sol.id}
                    onClick={() => setSelectedSolution(sol.id)}
                    className={`p-3 rounded-lg border cursor-pointer transition-colors ${
                      selectedSolution === sol.id ? 'border-blue-500 bg-blue-50' : 'hover:bg-gray-50'
                    }`}
                  >
                    <div className="flex justify-between items-center mb-1">
                      <span className="font-medium text-sm">{sol.title}</span>
                      <span className="text-xs px-1.5 py-0.5 rounded bg-green-100 text-green-700">
                        {(sol.confidence * 100).toFixed(0)}%
                      </span>
                    </div>
                    <p className="text-xs text-gray-600">{sol.description}</p>
                    <div className="flex justify-between mt-2 text-xs text-gray-400">
                      <span>{sol.action}</span>
                      <span>{sol.estimated_savings}</span>
                    </div>
                    {sol.human_decision && <div className="text-xs text-blue-600 mt-1">决策：{sol.human_decision}</div>}
                  </div>
                ))}
              </div>
            </Card>
          )}

          {quote.llm_summary && (
            <Card title="LLM 摘要" icon={<FileText size={16} />}>
              <p className="text-sm text-gray-600 whitespace-pre-wrap">{quote.llm_summary.slice(0, 300)}</p>
            </Card>
          )}
        </div>
      </div>

      {/* Execution Trace */}
      {quote.execution_trace && quote.execution_trace.length > 0 && (
        <Card title="执行轨迹" icon={<Activity size={16} />}>
          <div className="space-y-1">
            {quote.execution_trace.map((step, i) => (
              <div key={i} className="flex items-center gap-3 text-sm py-1.5 border-b last:border-0">
                <span className={`w-2 h-2 rounded-full ${step.status === 'completed' ? 'bg-green-400' : step.status === 'failed' ? 'bg-red-400' : 'bg-gray-300'}`} />
                <span className="w-32 text-gray-500 shrink-0">{step.step}</span>
                <span className="flex-1 text-gray-700 truncate">
                  {step.agent_thought ? `💭 ${step.agent_thought.slice(0, 80)}` : step.output?.slice(0, 80)}
                </span>
                <span className="text-gray-400 text-xs">{(step.duration_ms ?? 0).toFixed(0)}ms</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Decision Modal */}
      {showDecision && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50" onClick={() => setShowDecision(false)}>
          <div className="bg-white rounded-xl p-6 w-96 shadow-xl" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-bold mb-4">提交决策</h3>
            <textarea className="w-full border rounded-lg p-2 text-sm mb-4" rows={3} placeholder="决策备注（可选）" value={decisionNote} onChange={e => setDecisionNote(e.target.value)} />
            <div className="flex gap-2">
              <button onClick={() => handleDecision('accept')} className="flex-1 py-2 bg-green-600 text-white rounded-lg text-sm hover:bg-green-700">通过</button>
              <button onClick={() => handleDecision('negotiate')} className="flex-1 py-2 bg-yellow-600 text-white rounded-lg text-sm hover:bg-yellow-700">议价</button>
              <button onClick={() => handleDecision('reject')} className="flex-1 py-2 bg-red-600 text-white rounded-lg text-sm hover:bg-red-700">驳回</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// === Sub-components ===

function Kpi({ label, value, color, Icon }: { label: string; value: string; color: string; Icon: any }) {
  return (
    <div className="bg-white rounded-xl p-3 border">
      <div className="flex items-center gap-2 text-gray-400 text-xs mb-1"><Icon size={14} style={{ color }} /><span>{label}</span></div>
      <div className="text-lg font-bold" style={{ color }}>{value}</div>
    </div>
  )
}

function Card({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl border p-4">
      <div className="flex items-center gap-2 text-gray-500 text-sm font-medium mb-3">{icon}{title}</div>
      {children}
    </div>
  )
}

function CostBar({ item }: { item: CostItem }) {
  const reasonable = item.reasonable_amount
  const implied = item.implied_amount
  const maxVal = Math.max(reasonable, implied, 1)
  return (
    <div className="mb-3 last:mb-0">
      <div className="flex justify-between text-xs mb-1">
        <span className="font-medium">{item.item}</span>
        <span className={item.status.includes('偏高') ? 'text-red-500' : item.status.includes('偏低') ? 'text-yellow-500' : 'text-gray-400'}>
          {item.status}
          {item.independently_verified && ' ✓'}
        </span>
      </div>
      <div className="flex items-center gap-2 text-xs text-gray-400 mb-1">
        <span>合理 ¥{reasonable.toFixed(1)}</span>
        <span>|</span>
        <span className={item.deviation_from_reasonable && Math.abs(item.deviation_from_reasonable) > 30 ? 'text-red-500 font-medium' : ''}>
          隐含 ¥{implied.toFixed(1)}
        </span>
        {item.deviation_from_reasonable != null && (
          <span className="text-gray-300">({item.deviation_from_reasonable > 0 ? '+' : ''}{item.deviation_from_reasonable.toFixed(0)}%)</span>
        )}
      </div>
      <div className="h-2 bg-gray-100 rounded-full overflow-hidden flex">
        <div className="h-full bg-blue-400 rounded-l" style={{ width: `${(reasonable / maxVal) * 100}%` }} />
        <div className={`h-full rounded-r ${implied > reasonable ? 'bg-red-400' : 'bg-green-400'}`}
          style={{ width: `${(Math.abs(implied - reasonable) / maxVal) * 100}%` }} />
      </div>
      <div className="text-xs text-gray-300 mt-0.5">基准占比 {item.benchmark_pct}% · {item.data_source}</div>
    </div>
  )
}

function exportExcel(quote: Quote) {
  const wb = XLSX.utils.book_new()
  const data = [
    ['物料', quote.material_name, '供应商', quote.supplier_name],
    ['报价', quote.supplier_quote, '偏离度', quote.deviation_score],
    ['严重级别', quote.severity_level, '阶段', quote.phase],
    [], ['方案'], ...quote.solutions.map(s => [s.title, s.action, s.confidence, s.estimated_savings]),
  ]
  if (quote.cost_breakdown?.cost_items) {
    data.push([], ['成本项', '合理金额', '隐含金额', '偏离%', '状态'])
    quote.cost_breakdown.cost_items.forEach(c => data.push([c.item, c.reasonable_amount, c.implied_amount, c.deviation_from_reasonable, c.status]))
  }
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(data), 'QuoteDetail')
  XLSX.writeFile(wb, `quote-${quote.id}.xlsx`)
}
