import { useEffect, useState } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import {
  ArrowLeft, CheckCircle, Brain, FileSpreadsheet, FileText,
  Loader2, Target,
  Package, XCircle, ArrowUp, ArrowDown, Settings,
  ChevronDown, ChevronUp, ChevronRight, Clock, GitBranch,
  Search, BarChart3, Globe, User, Wrench, Lightbulb, TrendingUp, AlertCircle,
} from 'lucide-react'
import { fetchQuote, selectQuoteSolution, submitDecision } from '../utils/api'
import { exportQuotePdf } from '../utils/exportPdf'
import { exportQuoteWorkbook } from '../utils/exportWorkbook'
import type { Quote, Solution, CostItem, DiagnosisInvestigation, DecisionLogEntry } from '../types'
import OverrideModal from '../components/OverrideModal'

// ── 判断是"偏高"还是"偏低" ──
function getDeviationDirection(quote: Quote): 'high' | 'low' | 'normal' {
  if (quote.severity_level === '正常') return 'normal'
  if (quote.ai_prediction_mid && quote.supplier_quote < quote.ai_prediction_mid * 0.85) return 'low'
  if (quote.ai_prediction_mid && quote.supplier_quote > quote.ai_prediction_mid * 1.15) return 'high'
  if (quote.rag_info?.available) {
    if (quote.supplier_quote < quote.rag_info.ref_low * 0.9) return 'low'
    if (quote.supplier_quote > quote.rag_info.ref_high * 1.1) return 'high'
  }
  return 'normal'
}

const DIRECTION_CONFIG = {
  high: { label: '报价偏高', color: '#dc2626', bg: 'bg-red-50', border: 'border-red-300', icon: ArrowUp, text: 'text-red-700' },
  low: { label: '报价偏低', color: '#ea580c', bg: 'bg-orange-50', border: 'border-orange-300', icon: ArrowDown, text: 'text-orange-700' },
  normal: { label: '报价正常', color: '#059669', bg: 'bg-emerald-50', border: 'border-emerald-300', icon: CheckCircle, text: 'text-emerald-700' },
}

const SEVERITY_LABEL: Record<string, string> = {
  '紧急': '需立即处理', '警示': '建议尽快处理', '关注': '可观察', '正常': '无需处理',
}

// ═══ 诊断工具名称 → 中文标签 ═══
const TOOL_LABELS: Record<string, string> = {
  'tool_get_supplier_profile': '供应商历史',
  'tool_compare_peer_price': '同行价格对比',
  'tool_check_market_trend': '市场行情分析',
  'tool_search_market_price': '实时市场价格',
  'tool_check_urgency': '库存紧急度',
  'tool_search_alternatives': '替代供应商',
  'tool_analyze_cost_anomaly': '成本异常分析',
  'tool_generate_solutions': '方案生成',
  'tool_predict_price_range': '价格预测',
  'tool_analyze_cost_structure': '成本拆解',
  'tool_match_similar_material': '历史对比',
  'tool_score_deviation': '异常评分',
}

const TOOL_ICONS: Record<string, any> = {
  'tool_get_supplier_profile': User,
  'tool_compare_peer_price': BarChart3,
  'tool_check_market_trend': Globe,
  'tool_search_market_price': Globe,
  'tool_check_urgency': Clock,
  'tool_search_alternatives': Search,
  'tool_analyze_cost_anomaly': Wrench,
  'tool_generate_solutions': Lightbulb,
  'tool_predict_price_range': Target,
  'tool_analyze_cost_structure': Wrench,
  'tool_match_similar_material': Search,
  'tool_score_deviation': TrendingUp,
}

/** 时间戳格式化 */
function fmtTime(ts: string | undefined | null): string {
  if (!ts) return ''
  try { return new Date(ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) }
  catch { return ts }
}

/** 置信度 → 颜色 */
function confColor(c: number | undefined | null): string {
  if (c == null) return 'text-gray-400'
  if (c >= 0.8) return 'text-emerald-600'
  if (c >= 0.6) return 'text-amber-600'
  return 'text-red-500'
}

function confBg(c: number | undefined | null): string {
  if (c == null) return 'bg-gray-100'
  if (c >= 0.8) return 'bg-emerald-100'
  if (c >= 0.6) return 'bg-amber-100'
  return 'bg-red-100'
}

/** 简单的 Markdown 渲染（支持 ## / ** / - 列表） */
function SimpleMarkdown({ text }: { text: string }) {
  if (!text) return null
  const lines = text.split('\n')
  const elements: JSX.Element[] = []
  let listItems: string[] = []

  const flushList = (key: string) => {
    if (listItems.length > 0) {
      elements.push(
        <ul key={key} className="list-disc list-inside space-y-0.5">
          {listItems.map((item, i) => (
            <li key={`${key}-li-${i}`} className="text-xs text-gray-600">{item}</li>
          ))}
        </ul>
      )
      listItems = []
    }
  }

  lines.forEach((line, i) => {
    const trimmed = line.trim()
    const key = `md-${i}`

    if (!trimmed) { flushList(key); return }

    // ## 标题
    if (trimmed.startsWith('## ')) {
      flushList(key)
      elements.push(
        <div key={key} className="text-xs font-bold text-gray-800 mt-2 mb-1">{trimmed.replace(/^##\s*/, '')}</div>
      )
      return
    }
    // ### 标题
    if (trimmed.startsWith('### ')) {
      flushList(key)
      elements.push(
        <div key={key} className="text-[11px] font-semibold text-gray-700 mt-1.5 mb-0.5">{trimmed.replace(/^###\s*/, '')}</div>
      )
      return
    }
    // - 列表
    if (trimmed.startsWith('- ')) {
      listItems.push(trimmed.replace(/^-\s*/, '').replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>'))
      return
    }
    // 普通段落（处理 **bold**）
    flushList(key)
    const html = trimmed.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    elements.push(
      <p key={key} className="text-xs text-gray-600 leading-relaxed" dangerouslySetInnerHTML={{ __html: html }} />
    )
  })
  flushList('end')

  return <div className="space-y-0.5">{elements}</div>
}

export default function QuoteDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [quote, setQuote] = useState<Quote | null>(null)
  const [loading, setLoading] = useState(true)
  const [selectedSolution, setSelectedSolution] = useState<string | null>(null)
  const [showOverride, setShowOverride] = useState(false)
  const [showDebug, setShowDebug] = useState(false)
  const [solutionNote, setSolutionNote] = useState('')
  const [solutionLoading, setSolutionLoading] = useState(false)
  const [decisionLoading, setDecisionLoading] = useState<string | null>(null)
  const [decisionError, setDecisionError] = useState('')
  const [actionNotice, setActionNotice] = useState<{ tone: 'success' | 'error'; message: string } | null>(null)

  useEffect(() => { if (id) loadQuote() }, [id])

  const loadQuote = async () => {
    try { setQuote(await fetchQuote(id!)) } catch (e) { console.error(e) } finally { setLoading(false) }
  }

  useEffect(() => {
    if (!quote?.solutions?.length) { if (selectedSolution !== null) setSelectedSolution(null); return }
    const preferred = quote.selected_solution_id || selectedSolution
    const exists = quote.solutions.some(sol => sol.id === preferred)
    if (!exists) { setSelectedSolution(quote.solutions[0]?.id || null); return }
    if (preferred !== selectedSolution) setSelectedSolution(preferred)
  }, [quote?.solutions])

  const handleDecision = async (decision: string) => {
    if (quote?.phase !== 'fast_pass' && !quote?.selected_solution_id) {
      setDecisionError('请先选择一个执行方案。'); return
    }
    setDecisionLoading(decision); setDecisionError(''); setActionNotice(null)
    try {
      const updated = await submitDecision(id!, { decision, decision_by: '当前用户',
        selected_solution_id: quote?.selected_solution_id || selectedSolution || undefined, override_reason: '' })
      setQuote(updated)
      setActionNotice({ tone: 'success', message: `已${decision === 'accept' ? '通过' : '驳回'}，状态已更新。` })
    } catch (e: any) { setDecisionError(e.response?.data?.detail || e.message || '提交失败') }
    finally { setDecisionLoading(null) }
  }

  const handleApplySolution = async () => {
    if (!selectedSolution) { setDecisionError('请先选择一个方案。'); return }
    setSolutionLoading(true); setDecisionError(''); setActionNotice(null)
    try {
      const updated = await selectQuoteSolution(id!, { selected_solution_id: selectedSolution, selected_by: '当前用户', note: solutionNote || '' })
      setQuote(updated)
      setActionNotice({ tone: 'success', message: '已采纳方案。' })
    } catch (e: any) { setDecisionError(e.response?.data?.detail || e.message || '提交失败') }
    finally { setSolutionLoading(false) }
  }

  if (loading) return (
    <div className="h-full flex items-center justify-center bg-[#f8fafc]">
      <div className="animate-spin h-8 w-8 border-2 border-indigo-500 border-t-transparent rounded-full" />
    </div>
  )
  if (!quote) return <div className="text-center py-20 text-gray-400">报价不存在</div>

  const direction = getDeviationDirection(quote)
  const dirCfg = DIRECTION_CONFIG[direction]
  const DirIcon = dirCfg.icon
  const committedSolution = quote.solutions?.find(sol => sol.id === quote.selected_solution_id) || null

  return (
    <div className="h-full overflow-auto bg-gray-50">
      <div className="max-w-6xl mx-auto px-6 py-6 pb-20 space-y-5">
        {/* ── 顶栏 ── */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link to="/quotes" className="p-2 bg-white rounded-xl border border-gray-200 shadow-sm hover:bg-gray-50">
              <ArrowLeft size={18} className="text-gray-400" />
            </Link>
            <div>
              <h1 className="text-lg font-bold text-gray-900">{quote.material_name}</h1>
              <p className="text-xs text-gray-400">{quote.supplier_name} · 报价 ¥{quote.supplier_quote} · {quote.quantity}件</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Link to={`/quotes/${id}/trace`}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-gray-300 text-gray-600 rounded-lg hover:bg-gray-50 bg-white">
              <Brain size={13} /> 查看推理链
            </Link>
            <button onClick={() => setShowDebug(!showDebug)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-gray-300 text-gray-500 rounded-lg hover:bg-gray-50 bg-white">
              <Settings size={13} /> 高级
            </button>
            <button onClick={() => exportQuoteWorkbook(quote, 'detail')}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-gray-300 text-gray-600 rounded-lg hover:bg-gray-50 bg-white">
              <FileSpreadsheet size={13} /> 导出Excel
            </button>
            <button onClick={() => exportQuotePdf(quote, 'detail')}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-red-200 text-red-600 rounded-lg hover:bg-red-50 bg-white">
              <FileText size={13} /> 导出PDF
            </button>
          </div>
        </div>

        {/* ── 高级功能面板 ── */}
        {showDebug && (
          <div className="bg-gray-50 rounded-xl border border-gray-200 p-4 space-y-2 animate-[fadeIn_0.2s_ease-out]">
            <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider">高级功能</div>
            <div className="flex flex-wrap gap-2">
              <button onClick={() => setShowOverride(true)}
                className="px-3 py-1.5 text-xs border border-indigo-200 text-indigo-600 rounded-lg hover:bg-indigo-50 bg-white">Override</button>
              <button onClick={() => navigate('/quotes/new', { state: { prefill: { material_name: quote.material_name, supplier_name: quote.supplier_name, quantity: String(quote.quantity), category: quote.category || '塑料外壳' } } })}
                className="px-3 py-1.5 text-xs border border-emerald-200 text-emerald-600 rounded-lg hover:bg-emerald-50 bg-white">创建对比版本</button>
              <button onClick={() => window.open(`/quotes/${id}/trace`, '_self')}
                className="px-3 py-1.5 text-xs border border-purple-200 text-purple-600 rounded-lg hover:bg-purple-50 bg-white">调试推理链</button>
            </div>
          </div>
        )}

        {actionNotice && (
          <div className={`rounded-xl border px-4 py-3 text-sm ${actionNotice.tone === 'error' ? 'border-red-200 bg-red-50 text-red-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700'}`}>
            {actionNotice.message}
          </div>
        )}

        {/* ═══ 结论横幅 ═══ */}
        <div className={`rounded-2xl border ${dirCfg.bg} ${dirCfg.border} p-5`}>
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-2xl flex items-center justify-center shrink-0" style={{ background: dirCfg.color + '20' }}>
              <DirIcon size={24} style={{ color: dirCfg.color }} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-3 flex-wrap">
                <span className="text-lg font-bold" style={{ color: dirCfg.color }}>{dirCfg.label}</span>
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${dirCfg.bg} ${dirCfg.text} border ${dirCfg.border}`}>
                  偏离度 {quote.deviation_score} 分 · {SEVERITY_LABEL[quote.severity_level] || quote.severity_level}
                </span>
              </div>
              <div className="mt-3 flex items-baseline gap-3 flex-wrap">
                <span className="text-2xl font-bold text-gray-900">¥{quote.supplier_quote}</span>
                <span className="text-sm text-gray-400">供应商报价</span>
                {direction === 'high' && (
                  <span className="text-sm text-red-600 font-medium">
                    ↑ 高于 AI 参考价 ¥{quote.ai_prediction_mid ?? '?'}
                  </span>
                )}
                {direction === 'low' && (
                  <span className="text-sm text-orange-600 font-medium">
                    ↓ 低于市场参考下限 ¥{quote.rag_info?.ref_low ?? '?'}
                  </span>
                )}
              </div>
              {quote.diagnosis_conclusion && (
                <p className="text-sm text-gray-600 mt-2 leading-5">
                  AI 分析：{quote.diagnosis_conclusion.root_cause}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* ═══ 价格位置可视化 ═══ */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
          <PriceScale
            quote={quote.supplier_quote}
            predictionLow={quote.ai_prediction_low ?? 0}
            predictionMid={quote.ai_prediction_mid ?? 0}
            predictionHigh={quote.ai_prediction_high ?? 0}
            marketLow={quote.rag_info?.ref_low}
            marketHigh={quote.rag_info?.ref_high}
            direction={direction}
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
            <div className="flex items-center gap-2 mb-3 text-sm font-semibold text-gray-700">
              <User size={14} /> 供应商画像
            </div>
              <div className="space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-gray-400">风险等级</span><span className={`font-semibold ${riskLevelClass(quote.supplier_profile?.risk_level)}`}>{quote.supplier_profile?.risk_level || '待评估'}</span></div>
              <div className="flex justify-between"><span className="text-gray-400">报价行为</span><span className="text-gray-600">{quote.supplier_profile?.pricing_behavior || '暂无'}</span></div>
              <div className="flex justify-between"><span className="text-gray-400">异常率</span><span className="text-gray-600">{quote.supplier_profile?.anomaly_rate_pct != null ? `${quote.supplier_profile.anomaly_rate_pct}%` : '暂无'}</span></div>
              <div className="pt-2 text-xs leading-5 text-gray-500 border-t border-gray-100">{quote.supplier_profile?.recommended_procurement_mode || quote.supplier_profile?.risk_assessment || '等待供应商画像补充建议'}</div>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
            <div className="flex items-center gap-2 mb-3 text-sm font-semibold text-gray-700">
              <Clock size={14} /> 库存约束
            </div>
              <div className="space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-gray-400">紧急度</span><span className={`font-semibold ${urgencyClass(quote.inventory_context?.urgency)}`}>{quote.inventory_context?.urgency || '未知'}</span></div>
              <div className="flex justify-between"><span className="text-gray-400">库存窗口</span><span className="text-gray-600">{quote.inventory_context?.days_remaining != null ? `${quote.inventory_context.days_remaining}天` : '暂无'}</span></div>
              <div className="flex justify-between"><span className="text-gray-400">可否议价</span><span className="text-gray-600">{formatNegotiateState(quote.inventory_context?.can_negotiate, quote.inventory_context?.available)}</span></div>
              <div className="pt-2 text-xs leading-5 text-gray-500 border-t border-gray-100">{quote.inventory_context?.suggestion || '暂无库存建议'}</div>
            </div>
          </div>
        </div>

        {/* ═══ 处理方案 ═══ */}
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100">
            <h2 className="text-base font-bold text-gray-900">处理方案</h2>
            <p className="text-xs text-gray-400 mt-0.5">
              {direction === 'high' ? '报价偏高，建议优先选择升级处理或议价。' :
               direction === 'low' ? '报价偏低，建议核实供应商资质和物料质量。' : '报价在合理范围内。'}
            </p>
          </div>
          <div className="p-5 space-y-4">
            {quote.solutions && quote.solutions.length > 0 && (
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-sm font-semibold text-gray-700">选择方案</span>
                  {committedSolution && <span className="text-xs text-emerald-600 font-medium">✓ 已采纳</span>}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  {quote.solutions.map((sol: Solution) => {
                    const shouldHighlight = direction === 'high' && sol.title.includes('升级')
                    return (
                      <button key={sol.id} onClick={() => setSelectedSolution(sol.id)}
                        className={`text-left p-3.5 rounded-xl border transition-all ${
                          selectedSolution === sol.id ? 'border-indigo-400 bg-indigo-50 ring-1 ring-indigo-200' :
                          shouldHighlight ? 'border-amber-200 bg-amber-50' : 'border-gray-200 hover:border-gray-300'
                        }`}>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-sm font-semibold text-gray-900">{sol.title}</span>
                          <span className={`text-[11px] px-1.5 py-0.5 rounded-full font-medium ${
                            sol.action === 'accept' ? 'bg-emerald-100 text-emerald-700' :
                            sol.action === 'escalate' ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-600'
                          }`}>
                            {formatSolutionAction(sol.action)}
                          </span>
                        </div>
                        <p className="text-xs text-gray-500 leading-5 line-clamp-2">{sol.description}</p>
                        {buildSolutionSignals(sol, quote).length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {buildSolutionSignals(sol, quote).map(signal => (
                              <span key={signal} className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-600">
                                {signal}
                              </span>
                            ))}
                          </div>
                        )}
                      </button>
                    )
                  })}
                </div>
                {!committedSolution && !quote.human_decision && (
                  <div className="mt-3 flex items-center gap-3">
                    <input type="text" value={solutionNote} onChange={e => setSolutionNote(e.target.value)}
                      placeholder="备注说明（选填）..." className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-indigo-400" />
                    <button onClick={handleApplySolution} disabled={solutionLoading || !selectedSolution}
                      className="shrink-0 px-5 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50">
                      {solutionLoading ? '提交中...' : '采纳方案'}
                    </button>
                  </div>
                )}
              </div>
            )}
            {decisionError && <div className="p-2.5 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">{decisionError}</div>}
          </div>
        </div>

        {/* ═══ 证据三列并排 ═══ */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          {/* 价格预测 */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
            <div className="flex items-center gap-2 mb-3 text-sm font-semibold text-gray-700">
              <Target size={14} /> 价格预测
            </div>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-gray-400">报价</span><span className="font-bold text-gray-900">¥{quote.supplier_quote}</span></div>
              <div className="flex justify-between"><span className="text-gray-400">AI基准</span><span className="font-semibold text-indigo-600">¥{quote.ai_prediction_mid ?? '?'}</span></div>
              <div className="flex justify-between"><span className="text-gray-400">区间</span><span className="text-gray-600">¥{quote.ai_prediction_low ?? '?'}~{quote.ai_prediction_high ?? '?'}</span></div>
              <div className="flex justify-between"><span className="text-gray-400">偏离</span><span className={quote.price_deviation > 20 ? 'text-red-500 font-medium' : 'text-emerald-600'}>{quote.price_deviation}%</span></div>
              {quote.weights && <div className="text-[10px] text-gray-300 mt-2">权重 价格{(quote.weights.alpha * 100).toFixed(0)}%</div>}
            </div>
          </div>

          {/* 成本分析 */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
            <div className="flex items-center gap-2 mb-3 text-sm font-semibold text-gray-700">
              <Package size={14} /> 成本分析
            </div>
            {quote.cost_breakdown ? (
              <div className="space-y-2.5">
                <div className="flex justify-between text-[11px]">
                  <span className="text-gray-400">锚点价</span>
                  <span className="font-medium text-gray-700">¥{quote.cost_breakdown.anchor_price}</span>
                </div>
                <div className="text-[10px] text-gray-300 mb-1">数据质量: {quote.cost_breakdown.data_quality === 'with_anchor' ? '有锚点 ✓' : '仅参考'}</div>
                {quote.cost_breakdown.cost_items?.map((item: CostItem) => {
                  const maxVal = Math.max(item.reasonable_amount, item.implied_amount, 1)
                  const isOver = item.implied_amount > item.reasonable_amount
                  const dev = item.deviation_from_reasonable
                  return (
                    <div key={item.item}>
                      <div className="flex justify-between items-center text-xs mb-0.5">
                        <span className="text-gray-600">{item.item}</span>
                        <span className={`font-medium ${isOver ? 'text-red-500' : 'text-emerald-500'}`}>
                          {dev != null ? `${dev > 0 ? '+' : ''}${dev.toFixed(0)}%` : '参考'}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 text-[10px] text-gray-400 mb-1">
                        <span>基准 ¥{item.reasonable_amount.toFixed(1)}</span>
                        <span className={isOver ? 'text-red-400' : 'text-emerald-400'}>实际 ¥{item.implied_amount.toFixed(1)}</span>
                      </div>
                      <div className="h-1 bg-gray-100 rounded-full overflow-hidden flex">
                        <div className="h-full bg-blue-300 rounded-l" style={{ width: `${(item.reasonable_amount / maxVal) * 100}%` }} />
                        <div className={`h-full rounded-r ${isOver ? 'bg-red-300' : 'bg-emerald-300'}`} style={{ width: `${(Math.abs(item.implied_amount - item.reasonable_amount) / maxVal) * 100}%` }} />
                      </div>
                    </div>
                  )
                })}
              </div>
            ) : (
              <div className="text-xs text-gray-400">暂无数据</div>
            )}
          </div>

          {/* 诊断推理 */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
            <div className="flex items-center gap-2 mb-3 text-sm font-semibold text-gray-700">
              <Brain size={14} /> 诊断推理
              {quote.diagnosis_conclusion?.confidence != null && (
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${confBg(quote.diagnosis_conclusion.confidence)} ${confColor(quote.diagnosis_conclusion.confidence)}`}>
                  综合置信度 {(quote.diagnosis_conclusion.confidence * 100).toFixed(0)}%
                </span>
              )}
            </div>
            {quote.diagnosis_investigations && quote.diagnosis_investigations.length > 0 ? (
              <div className="space-y-2">
                {/* 调查步骤表格 */}
                <div className="overflow-hidden rounded-lg border border-gray-200">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-gray-50 border-b border-gray-200">
                        <th className="text-left px-3 py-2 font-medium text-gray-500 w-8">#</th>
                        <th className="text-left px-3 py-2 font-medium text-gray-500">分析工具</th>
                        <th className="text-center px-2 py-2 font-medium text-gray-500 w-20">置信度</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {quote.diagnosis_investigations.map((inv: DiagnosisInvestigation) => {
                        const Icon = TOOL_ICONS[inv.tool] || AlertCircle
                        const label = TOOL_LABELS[inv.tool] || inv.tool
                        return (
                          <tr key={inv.step} className="hover:bg-gray-50 transition-colors">
                            <td className="px-3 py-2.5 text-gray-400 font-mono">{inv.step}</td>
                            <td className="px-3 py-2.5">
                              <div className="flex items-center gap-1.5">
                                <Icon size={12} className="text-indigo-400 shrink-0" />
                                <span className="font-medium text-gray-700">{label}</span>
                              </div>
                              {inv.result_summary && (
                                <p className="text-[11px] text-gray-400 mt-0.5 line-clamp-2 leading-relaxed">
                                  {inv.result_summary.slice(0, 120)}
                                </p>
                              )}
                            </td>
                            <td className="px-2 py-2.5 text-center">
                              <span className={`inline-block text-[10px] px-1.5 py-0.5 rounded-full font-medium ${confBg(inv.confidence)} ${confColor(inv.confidence)}`}>
                                {(inv.confidence * 100).toFixed(0)}%
                              </span>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>

                {/* 诊断结论 */}
                {quote.diagnosis_conclusion && (
                  <div className="bg-purple-50 border border-purple-200 rounded-lg p-3">
                    <div className="flex items-start gap-2">
                      <Lightbulb size={14} className="text-purple-500 mt-0.5 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-semibold text-purple-800 mb-0.5">
                          根因分析：{quote.diagnosis_conclusion.root_cause}
                        </div>
                        {quote.diagnosis_conclusion.cause_category && (
                          <span className="inline-block text-[10px] px-1.5 py-0.5 rounded-full bg-purple-100 text-purple-600 font-medium">
                            {formatCauseCategory(quote.diagnosis_conclusion.cause_category)}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="text-xs text-gray-400">暂无数据</div>
            )}
          </div>
        </div>

        {/* ═══ AI 决策时间线 ═══ */}
        {quote.decision_log && quote.decision_log.length > 0 && (
          <DecisionTimeline entries={quote.decision_log} />
        )}
      </div>

      {showOverride && quote && <OverrideModal quote={quote} stepLabel="整体" feedbackContext={null}
        onClose={() => setShowOverride(false)}
        onSuccess={(r) => { setShowOverride(false); if (r.rerun_quote?.id) navigate(`/quotes/${r.rerun_quote.id}`); else loadQuote() }} />}

      {/* ── 吸底决策栏 ── */}
      {quote && (
        <div className="fixed bottom-0 left-64 right-0 bg-white border-t border-gray-200 shadow-lg z-40 px-6 py-3">
          <div className="max-w-6xl mx-auto flex items-center justify-between">
            <div className="flex items-center gap-4 text-sm">
              <span className="text-gray-500">{quote.material_name}</span>
              <span className="text-gray-300">|</span>
              <span className="font-semibold text-gray-900">¥{quote.supplier_quote}</span>
              <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${
                direction === 'high' ? 'bg-red-50 text-red-600' :
                direction === 'low' ? 'bg-orange-50 text-orange-600' : 'bg-emerald-50 text-emerald-600'
              }`}>
                {dirCfg.label}
              </span>
            </div>
            <div className="flex items-center gap-3">
              {!quote.selected_solution_id && quote.phase !== 'fast_pass' && (
                <span className="text-xs text-amber-600">请先选择方案</span>
              )}
              <button onClick={() => handleDecision('accept')} disabled={decisionLoading === 'accept'}
                className="flex items-center gap-2 px-5 py-2 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 disabled:opacity-50 shadow-sm">
                {decisionLoading === 'accept' ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle size={16} />} 通过
              </button>
              <button onClick={() => handleDecision('reject')} disabled={decisionLoading === 'reject'}
                className="flex items-center gap-2 px-5 py-2 bg-red-500 text-white rounded-lg text-sm font-medium hover:bg-red-600 disabled:opacity-50 shadow-sm">
                {decisionLoading === 'reject' ? <Loader2 size={14} className="animate-spin" /> : <XCircle size={16} />} 驳回
              </button>
              <button onClick={() => setShowOverride(true)}
                className="px-3 py-2 text-xs border border-gray-200 text-gray-500 rounded-lg hover:bg-gray-50">高级</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function formatSolutionAction(action?: string) {
  if (!action) return '待执行'
  const map: Record<string, string> = {
    accept: '直接通过',
    negotiate: '议价',
    requote: '二次询价',
    escalate: '升级审批',
    verify: '核验',
    compare: '历史对比',
    review_supplier: '供应商复核',
    secure_supply: '保供采购',
    secure_then_negotiate: '先保供后追价',
  }
  return map[action] || action
}

function formatCauseCategory(category?: string) {
  const map: Record<string, string> = {
    normal: '报价正常',
    supplier_premium: '供应商溢价',
    market_trend: '市场行情驱动',
    cost_structure_anomaly: '成本结构异常',
    insufficient_data: '数据不足',
    unknown_anomaly: '待人工确认',
  }
  return map[category || ''] || category || '待确认'
}

function formatNegotiateState(canNegotiate?: boolean, available?: boolean) {
  if (available === false || canNegotiate == null) return '待确认'
  return canNegotiate ? '可以' : '不建议'
}

function urgencyClass(urgency?: string) {
  if (urgency === '紧急') return 'text-red-600'
  if (urgency === '关注') return 'text-amber-600'
  if (urgency === '正常') return 'text-emerald-600'
  return 'text-gray-900'
}

function riskLevelClass(level?: string) {
  if (level === '极高') return 'text-red-700'
  if (level === '高') return 'text-red-600'
  if (level === '中') return 'text-amber-600'
  return 'text-gray-900'
}

function buildSolutionSignals(solution: Solution, quote: Quote) {
  const signals: string[] = []
  if (quote.inventory_context?.urgency && quote.inventory_context.urgency !== '未知') {
    signals.push(`库存${quote.inventory_context.urgency}`)
  }
  if (quote.supplier_profile?.risk_level) {
    signals.push(`供应商${quote.supplier_profile.risk_level}风险`)
  }
  if ((quote.cost_breakdown?.anomaly_count || 0) >= 2) {
    signals.push(`成本异常${quote.cost_breakdown?.anomaly_count}项`)
  }
  if (quote.peer_benchmark?.current_premium_pct != null && quote.peer_benchmark.current_premium_pct > 15) {
    signals.push(`同行溢价${quote.peer_benchmark.current_premium_pct.toFixed(0)}%`)
  }
  if (solution.action === 'secure_supply' || solution.action === 'secure_then_negotiate') {
    signals.push('优先保供')
  }
  return signals.slice(0, 3)
}

// ── 价格位置可视化横条 ──
function PriceScale({ quote: q, predictionLow, predictionMid, predictionHigh, marketLow, marketHigh, direction }: {
  quote: number; predictionLow: number; predictionMid: number; predictionHigh: number;
  marketLow?: number; marketHigh?: number; direction: string
}) {
  const maxVal = Math.max(q, predictionHigh, marketHigh || 0, 1) * 1.2
  const minVal = Math.min(q, predictionLow, marketLow || 0, 0) * 0.8
  const range = maxVal - minVal || 1
  const toPct = (v: number) => ((v - minVal) / range) * 100

  return (
    <div className="space-y-3">
      {/* 报价标记 */}
      <div className="relative h-8">
        <div className="absolute inset-0 bg-gray-100 rounded-full" />
        <div className="absolute inset-0 flex items-center px-3">
          <div className="text-xs text-gray-500">报价</div>
          <div className="flex-1 relative h-full">
            <div className="absolute top-1/2 -translate-y-1/2" style={{ left: `${toPct(q)}%`, transform: `translateX(-50%)` }}>
              <div className={`px-2.5 py-1 rounded-full text-xs font-bold border-2 whitespace-nowrap shadow-sm ${
                direction === 'high' ? 'bg-red-100 text-red-700 border-red-300' :
                direction === 'low' ? 'bg-orange-100 text-orange-700 border-orange-300' :
                'bg-emerald-100 text-emerald-700 border-emerald-300'
              }`}>
                ¥{q.toFixed(2)}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* AI预测区间条 */}
      <div>
        <div className="flex justify-between text-xs text-gray-400 mb-1">
          <span>AI预测区间</span>
          <span>P50=¥{predictionMid.toFixed(2)}</span>
        </div>
        <div className="relative h-3">
          <div className="absolute inset-0 bg-gray-100 rounded-full" />
          <div className="absolute h-full rounded-full bg-indigo-200" style={{
            left: `${toPct(predictionLow)}%`,
            width: `${toPct(predictionHigh) - toPct(predictionLow)}%`,
          }} />
          <div className="absolute top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full bg-indigo-500 ring-2 ring-white" style={{
            left: `${toPct(predictionMid)}%`,
          }} />
        </div>
        <div className="flex justify-between text-[10px] text-gray-300 mt-0.5">
          <span>¥{predictionLow.toFixed(2)}</span>
          <span>¥{predictionHigh.toFixed(2)}</span>
        </div>
      </div>

      {/* 市场参考区间条 */}
      {marketLow != null && marketHigh != null && (
        <div>
          <div className="text-xs text-gray-400 mb-1">市场参考区间</div>
          <div className="relative h-3">
            <div className="absolute inset-0 bg-gray-100 rounded-full" />
            <div className="absolute h-full rounded-full bg-emerald-200" style={{
              left: `${toPct(marketLow)}%`,
              width: `${toPct(Math.max(marketLow, marketHigh)) - toPct(marketLow)}%`,
            }} />
          </div>
          <div className="flex justify-between text-[10px] text-gray-300 mt-0.5">
            <span>¥{marketLow.toFixed(1)}</span>
            <span>¥{marketHigh.toFixed(1)}</span>
          </div>
        </div>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════
// AI 决策时间线组件
// ═══════════════════════════════════════════════════════

function DecisionTimeline({ entries }: { entries: DecisionLogEntry[] }) {
  const [expanded, setExpanded] = useState(false)
  const [expandedReason, setExpandedReason] = useState<Set<number>>(new Set())
  const displayEntries = expanded ? entries : entries.slice(-3)

  const toggleReason = (i: number) => {
    setExpandedReason(prev => {
      const next = new Set(prev)
      if (next.has(i)) next.delete(i); else next.add(i)
      return next
    })
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
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
            className="text-xs text-indigo-500 hover:text-indigo-600 font-medium flex items-center gap-1"
          >
            {expanded ? '收起' : `查看全部 ${entries.length} 步`}
            {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          </button>
        )}
      </div>
      <div className="p-4 space-y-4">
        {displayEntries.map((entry: DecisionLogEntry, i: number) => {
          const isHuman = entry.source === 'human'
          const isExpanded = expandedReason.has(i)

          return (
            <div key={i} className="flex gap-3">
              {/* 时间线连接器 */}
              <div className="flex flex-col items-center">
                <div className={`w-7 h-7 rounded-full flex items-center justify-center text-white text-[10px] font-bold shadow-sm ${
                  isHuman ? 'bg-blue-500' : entry.chosen_action?.includes('approve') || entry.chosen_action === 'accept'
                    ? 'bg-emerald-500' : 'bg-violet-500'
                }`}>
                  {isHuman ? 'H' : 'AI'}
                </div>
                {i < displayEntries.length - 1 && <div className="w-0.5 flex-1 bg-gray-100 my-1.5" />}
              </div>

              {/* 内容 */}
              <div className="flex-1 min-w-0 pb-2">
                {/* 标题行：决策点 + 时间 */}
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    {entry.decision_point && (
                      <span className="text-xs font-bold text-gray-800">
                        {isHuman ? '👤 人工反馈' : entry.decision_point}
                      </span>
                    )}
                    {!isHuman && entry.confidence != null && (
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${confBg(entry.confidence)} ${confColor(entry.confidence)}`}>
                        {(entry.confidence * 100).toFixed(0)}%
                      </span>
                    )}
                  </div>
                  <span className="text-[10px] text-gray-400 font-mono">
                    {fmtTime(entry.timestamp)}
                  </span>
                </div>

                {/* 工具名/动作 */}
                <div className="flex flex-wrap items-center gap-1.5 mb-1.5">
                  {entry.chosen_action && entry.chosen_action.split(', ').map((action: string, j: number) => {
                    const label = TOOL_LABELS[action] || action
                    const Icon = TOOL_ICONS[action]
                    return (
                      <span key={j} className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-md bg-gray-100 text-gray-600 font-medium">
                        {Icon && <Icon size={10} className="text-gray-400" />}
                        {label}
                      </span>
                    )
                  })}
                  {entry.is_override && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-orange-100 text-orange-600 font-medium">
                      Override
                    </span>
                  )}
                </div>

                {/* 推理内容 */}
                {entry.reasoning && (
                  <div className="mt-1">
                    <button
                      onClick={() => toggleReason(i)}
                      className="flex items-center gap-1 text-[10px] text-indigo-500 hover:text-indigo-600 font-medium"
                    >
                      {isExpanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
                      {isExpanded ? '收起推理' : '展开推理'}
                    </button>
                    {isExpanded && (
                      <div className="mt-1.5 p-2.5 bg-gray-50 rounded-lg border border-gray-100">
                        <SimpleMarkdown text={entry.reasoning} />
                      </div>
                    )}
                  </div>
                )}

                {/* 人工修正 */}
                {entry.override_reasoning && (
                  <p className="text-[11px] text-orange-600 mt-1 italic leading-relaxed">
                    人工修正：{entry.override_reasoning.slice(0, 200)}
                  </p>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
