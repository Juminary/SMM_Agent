import { useEffect, useState } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import {
  ArrowLeft, CheckCircle, Brain, FileSpreadsheet,
  Loader2, MessageSquare, Target,
  Package, XCircle, ArrowUp, ArrowDown, Settings,
} from 'lucide-react'
import { fetchQuote, selectQuoteSolution, submitDecision } from '../utils/api'
import type { Quote, Solution, CostItem, DiagnosisInvestigation } from '../types'
import OverrideModal from '../components/OverrideModal'
import * as XLSX from 'xlsx'

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
            <button onClick={() => exportExcel(quote)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-gray-300 text-gray-600 rounded-lg hover:bg-gray-50 bg-white">
              <FileSpreadsheet size={13} /> 导出
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
                            {sol.action === 'accept' ? '直接通过' :
                             sol.action === 'negotiate' ? '议价' :
                             sol.action === 'requote' ? '询价' :
                             sol.action === 'escalate' ? '升级审批' : sol.action}
                          </span>
                        </div>
                        <p className="text-xs text-gray-500 leading-5 line-clamp-2">{sol.description}</p>
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
            </div>
            {quote.diagnosis_investigations && quote.diagnosis_investigations.length > 0 ? (
              <div className="space-y-1.5">
                {quote.diagnosis_investigations.slice(0, 3).map((inv: DiagnosisInvestigation) => (
                  <div key={inv.step} className="text-xs border-l-2 border-blue-200 pl-2 py-1">
                    <span className="text-blue-600 font-medium text-[10px]">{inv.tool}</span>
                    <p className="text-gray-500 mt-0.5">{inv.result_summary?.slice(0, 60)}</p>
                  </div>
                ))}
                {quote.diagnosis_conclusion && (
                  <div className="mt-2 text-xs font-medium text-purple-700">→ {quote.diagnosis_conclusion.root_cause?.slice(0, 50)}</div>
                )}
              </div>
            ) : (
              <div className="text-xs text-gray-400">暂无数据</div>
            )}
          </div>
        </div>

        {quote.decision_log && quote.decision_log.length > 0 && (
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5">
            <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
              <MessageSquare size={14} className="text-gray-400" /> 操作记录（{quote.decision_log.length}）
            </h3>
            <div className="space-y-1.5">
              {[...quote.decision_log].slice(-5).reverse().map((entry: any, i: number) => (
                <div key={i} className="flex items-start gap-2 text-xs text-gray-600 border-l-2 border-gray-200 pl-3 py-1">
                  <span className="font-medium shrink-0">{entry.source === 'human' ? '👤' : '🤖'}</span>
                  <span className="text-gray-500">{entry.chosen_action} · {(entry.reasoning || '').slice(0, 80)}</span>
                </div>
              ))}
            </div>
          </div>
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

function exportExcel(quote: Quote) {
  const wb = XLSX.utils.book_new()
  const data: any[][] = [
    ['物料', quote.material_name, '供应商', quote.supplier_name],
    ['报价', String(quote.supplier_quote), '偏离度', String(quote.deviation_score)],
    ['级别', quote.severity_level, '状态', quote.status],
    [],
    ['方案'],
    ...(quote.solutions || []).map((s: Solution) => [s.title, s.action, s.confidence, s.estimated_savings]),
  ]
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(data), 'Quote')
  XLSX.writeFile(wb, `quote-${quote.id}.xlsx`)
}
