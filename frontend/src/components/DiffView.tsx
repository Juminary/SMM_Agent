import { useState } from 'react'
import {
  X, ArrowRight, TrendingUp, TrendingDown, Minus,
  Loader2, BarChart3, CheckCircle, AlertCircle,
} from 'lucide-react'
import type { Quote, ReRunParams } from '../types'
import { rerunAnalysis } from '../utils/api'

interface DiffViewProps {
  original: Quote
  rerun?: Quote
  history?: Array<{ id: string; deviation_score: number | null; severity_level: string | null; created_at: string | null }>
  onClose: () => void
  onSelectCompare?: (compareId: string) => void
  onRerun?: (params: ReRunParams) => void
  rerunLoading?: boolean
}

function DiffCell({ oldVal, newVal }: { oldVal: any; newVal: any }) {
  const displayOld = oldVal ?? '—'
  const displayNew = newVal ?? '—'

  let bgClass = 'bg-gray-50'
  let icon = null
  if (oldVal !== null && newVal !== null && oldVal !== newVal) {
    if (typeof oldVal === 'number' && typeof newVal === 'number') {
      if (newVal > oldVal) {
        bgClass = 'bg-red-50'
        icon = <TrendingUp size={12} className="text-red-500" />
      } else if (newVal < oldVal) {
        bgClass = 'bg-emerald-50'
        icon = <TrendingDown size={12} className="text-emerald-500" />
      }
    } else {
      bgClass = 'bg-amber-50'
      icon = <Minus size={12} className="text-amber-500" />
    }
  }

  const change = (typeof oldVal === 'number' && typeof newVal === 'number')
    ? newVal - oldVal
    : null

  return (
    <div className={`px-4 py-2 rounded-lg ${bgClass} transition-colors`}>
      <div className="flex items-center gap-1.5">
        <span className="text-sm text-gray-400 line-through">{displayOld}</span>
        {icon}
        <ArrowRight size={12} className="text-gray-300 shrink-0" />
        <span className="text-sm font-medium text-gray-900">{displayNew}</span>
      </div>
      {change !== null && change !== 0 && (
        <div className={`text-xs mt-0.5 ${change > 0 ? 'text-red-500' : 'text-emerald-500'}`}>
          {change > 0 ? '+' : ''}{typeof change === 'number' ? change.toFixed(2) : change}
        </div>
      )}
    </div>
  )
}

function SeverityBadge({ level }: { level: string | null }) {
  const map: Record<string, { color: string; bg: string }> = {
    '紧急': { color: 'text-red-600', bg: 'bg-red-100' },
    '警示': { color: 'text-orange-600', bg: 'bg-orange-100' },
    '关注': { color: 'text-yellow-600', bg: 'bg-yellow-100' },
    '正常': { color: 'text-emerald-600', bg: 'bg-emerald-100' },
  }
  const style = map[level || ''] || { color: 'text-gray-600', bg: 'bg-gray-100' }
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-medium ${style.color} ${style.bg}`}>
      {level || '—'}
    </span>
  )
}

function LabelRow({ label, oldVal, newVal, badge }: {
  label: string
  oldVal: any
  newVal: any
  badge?: boolean
}) {
  return (
    <div className="flex items-center gap-3">
      <div className="w-28 shrink-0">
        <span className="text-xs text-gray-500">{label}</span>
      </div>
      <div className="flex-1">
        {badge ? (
          <div className="flex items-center gap-2">
            <SeverityBadge level={oldVal} />
            <ArrowRight size={12} className="text-gray-300" />
            <SeverityBadge level={newVal} />
          </div>
        ) : (
          <DiffCell oldVal={oldVal} newVal={newVal} />
        )}
      </div>
    </div>
  )
}

export default function DiffView({
  original,
  rerun,
  history = [],
  onClose,
  onSelectCompare,
  onRerun,
  rerunLoading = false,
}: DiffViewProps) {
  const [selectedCompare, setSelectedCompare] = useState<string | null>(null)
  const [showRerunParams, setShowRerunParams] = useState(false)
  const [rerunParams, setRerunParams] = useState<ReRunParams>({
    supplier_quote: original.supplier_quote,
    quantity: original.quantity,
    category: original.category,
  })

  const handleRerun = async () => {
    if (onRerun) {
      onRerun(rerunParams)
    } else {
      try {
        await rerunAnalysis(original.id, rerunParams)
        window.location.reload()
      } catch (e) {
        console.error('Rerun failed:', e)
      }
    }
  }

  const display = rerun || original
  const scoreDelta = display.deviation_score - original.deviation_score
  const severityChanged = display.severity_level !== original.severity_level
  const diagnosisChanged = display.diagnosis_conclusion?.root_cause !== original.diagnosis_conclusion?.root_cause

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[100]" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-2xl w-[720px] max-h-[88vh] overflow-hidden flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-indigo-100 flex items-center justify-center">
              <BarChart3 size={16} className="text-indigo-600" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-gray-900">对比视图</h2>
              <p className="text-xs text-gray-400">原始分析 vs 重跑结果</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowRerunParams(!showRerunParams)}
              className="px-3 py-1.5 text-xs font-medium border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors flex items-center gap-1.5"
            >
              <Loader2 size={12} className={rerunLoading ? 'animate-spin' : ''} />
              调整后重跑
            </button>
            <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg">
              <X size={18} className="text-gray-400" />
            </button>
          </div>
        </div>

        <div className="px-6 py-3 bg-slate-50 border-b border-slate-200">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <SummaryPill
              label="偏离度变化"
              value={`${scoreDelta > 0 ? '+' : ''}${scoreDelta.toFixed(1)}分`}
              tone={scoreDelta < 0 ? 'good' : scoreDelta > 0 ? 'bad' : 'neutral'}
            />
            <SummaryPill
              label="严重级别"
              value={severityChanged ? `${original.severity_level} -> ${display.severity_level}` : '无变化'}
              tone={severityChanged ? 'warn' : 'neutral'}
            />
            <SummaryPill
              label="根因结论"
              value={diagnosisChanged ? '已变化' : '保持一致'}
              tone={diagnosisChanged ? 'warn' : 'neutral'}
            />
          </div>
        </div>

        {/* Rerun params panel */}
        {showRerunParams && (
          <div className="px-6 py-3 bg-gray-50 border-b border-gray-200">
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="text-xs text-gray-500 mb-1 block">供应商报价</label>
                <input
                  type="number"
                  step="0.01"
                  value={rerunParams.supplier_quote}
                  onChange={e => setRerunParams(p => ({ ...p, supplier_quote: parseFloat(e.target.value) || 0 }))}
                  className="w-full px-2.5 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:border-indigo-500"
                />
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">采购数量</label>
                <input
                  type="number"
                  value={rerunParams.quantity}
                  onChange={e => setRerunParams(p => ({ ...p, quantity: parseInt(e.target.value) || 0 }))}
                  className="w-full px-2.5 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:border-indigo-500"
                />
              </div>
              <div className="flex items-end">
                <button
                  onClick={handleRerun}
                  disabled={rerunLoading}
                  className="w-full py-1.5 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 flex items-center justify-center gap-1.5"
                >
                  {rerunLoading ? <Loader2 size={12} className="animate-spin" /> : null}
                  执行重跑
                </button>
              </div>
            </div>
          </div>
        )}

        {/* History tabs */}
        {history.length > 0 && (
          <div className="px-6 pt-3 flex gap-2 overflow-x-auto">
            <span className="text-xs text-gray-400 shrink-0 pt-1">历史版本：</span>
            <button
              onClick={() => setSelectedCompare(null)}
              className={`px-2.5 py-1 rounded-full text-xs font-medium shrink-0 transition-colors ${
                !selectedCompare ? 'bg-indigo-100 text-indigo-700 border border-indigo-300' : 'bg-gray-100 text-gray-600 border border-gray-200'
              }`}
            >
              原始分析
            </button>
            {rerun && (
              <button
                onClick={() => setSelectedCompare('rerun')}
                className={`px-2.5 py-1 rounded-full text-xs font-medium shrink-0 transition-colors ${
                  selectedCompare === 'rerun' ? 'bg-emerald-100 text-emerald-700 border border-emerald-300' : 'bg-gray-100 text-gray-600 border border-gray-200'
                }`}
              >
                最新重跑
              </button>
            )}
            {history.filter(h => !h.id.includes('rerun') && !h.id.includes('override')).map(h => (
              <button
                key={h.id}
                onClick={() => onSelectCompare && onSelectCompare(h.id)}
                className="px-2.5 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-600 border border-gray-200 shrink-0 hover:bg-gray-200"
              >
                {h.id.slice(-8)}
              </button>
            ))}
          </div>
        )}

        {/* Quote header comparison */}
        <div className="px-6 py-4">
          <div className="grid grid-cols-2 gap-4">
            {/* Original */}
            <div className="bg-gray-50 rounded-xl p-4 border border-gray-200">
              <div className="text-xs font-medium text-gray-500 mb-2 flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-gray-400" />
                原始分析
              </div>
              <div className="text-sm font-bold text-gray-900">{original.material_name}</div>
              <div className="text-xs text-gray-500">{original.supplier_name} · ¥{original.supplier_quote}</div>
              <div className="flex items-center gap-3 mt-2">
                <span className={`text-lg font-bold ${original.severity_level === '紧急' ? 'text-red-600' : original.severity_level === '警示' ? 'text-orange-600' : 'text-gray-700'}`}>
                  {original.deviation_score}分
                </span>
                <SeverityBadge level={original.severity_level} />
              </div>
            </div>

            {/* Compare */}
            <div className={`rounded-xl p-4 border ${rerun ? 'bg-emerald-50 border-emerald-200' : 'bg-gray-50 border-gray-200'}`}>
              <div className="text-xs font-medium text-emerald-600 mb-2 flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-500" />
                重跑结果
              </div>
              <div className="text-sm font-bold text-gray-900">{display.material_name}</div>
              <div className="text-xs text-gray-500">{display.supplier_name} · ¥{display.supplier_quote}</div>
              <div className="flex items-center gap-3 mt-2">
                <span className={`text-lg font-bold ${display.severity_level === '紧急' ? 'text-red-600' : display.severity_level === '警示' ? 'text-orange-600' : 'text-gray-700'}`}>
                  {display.deviation_score}分
                </span>
                <SeverityBadge level={display.severity_level} />
              </div>
            </div>
          </div>
        </div>

        {/* Diff rows */}
        <div className="flex-1 overflow-auto px-6 pb-4 space-y-3">
          <h3 className="text-sm font-semibold text-gray-700 pt-2 pb-1 border-b border-gray-100">
            指标对比
          </h3>

          <div className="space-y-2">
            <LabelRow label="偏离度" oldVal={original.deviation_score} newVal={display.deviation_score} />
            <LabelRow label="严重级别" oldVal={original.severity_level} newVal={display.severity_level} badge />
            <LabelRow label="流程阶段" oldVal={original.phase} newVal={display.phase} />
            <LabelRow label="贝叶斯 P50" oldVal={original.ai_prediction_mid} newVal={display.ai_prediction_mid} />
            <LabelRow label="预测下限" oldVal={original.ai_prediction_low} newVal={display.ai_prediction_low} />
            <LabelRow label="预测上限" oldVal={original.ai_prediction_high} newVal={display.ai_prediction_high} />
            <LabelRow label="价格偏离" oldVal={original.price_deviation} newVal={display.price_deviation} />
            <LabelRow label="成本偏离" oldVal={original.cost_deviation} newVal={display.cost_deviation} />
            <LabelRow label="市场偏离" oldVal={original.market_deviation} newVal={display.market_deviation} />
          </div>

          {/* Diagnosis conclusion */}
          {display.diagnosis_conclusion && original.diagnosis_conclusion && (
            <>
              <h3 className="text-sm font-semibold text-gray-700 pt-3 pb-1 border-b border-gray-100">
                诊断结论
              </h3>
              <div className="space-y-3">
                {display.diagnosis_conclusion.root_cause !== original.diagnosis_conclusion.root_cause && (
                  <div className="flex items-start gap-2">
                    <AlertCircle size={14} className="text-amber-500 mt-0.5 shrink-0" />
                    <div>
                      <div className="text-xs text-gray-400">根因变化</div>
                      <div className="text-sm text-gray-700 line-through">{original.diagnosis_conclusion.root_cause}</div>
                      <div className="text-sm font-medium text-gray-900">→ {display.diagnosis_conclusion.root_cause}</div>
                    </div>
                  </div>
                )}
                <div className="flex items-center gap-3">
                  <div className="w-28 shrink-0"><span className="text-xs text-gray-500">置信度</span></div>
                  <DiffCell
                    oldVal={original.diagnosis_conclusion.confidence}
                    newVal={display.diagnosis_conclusion.confidence}
                  />
                </div>
                <div className="flex items-center gap-3">
                  <div className="w-28 shrink-0"><span className="text-xs text-gray-500">根因类别</span></div>
                  <DiffCell
                    oldVal={original.diagnosis_conclusion.cause_category}
                    newVal={display.diagnosis_conclusion.cause_category}
                  />
                </div>
              </div>
            </>
          )}

          {/* Solutions */}
          {display.solutions && display.solutions.length > 0 && (
            <>
              <h3 className="text-sm font-semibold text-gray-700 pt-3 pb-1 border-b border-gray-100">
                应对方案（{display.solutions.length}个）
              </h3>
              <div className="space-y-2">
                {display.solutions.map((sol, i) => (
                  <div key={sol.id || i} className="flex items-start gap-3 bg-gray-50 rounded-lg p-3">
                    <CheckCircle size={14} className="text-emerald-500 mt-0.5 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-gray-900">{sol.title}</span>
                        <span className="text-xs text-gray-400">{(sol.confidence * 100).toFixed(0)}%</span>
                      </div>
                      <p className="text-xs text-gray-500 mt-0.5 truncate">{sol.description}</p>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function SummaryPill({
  label,
  value,
  tone,
}: {
  label: string
  value: string
  tone: 'good' | 'bad' | 'warn' | 'neutral'
}) {
  const toneClass = {
    good: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    bad: 'border-red-200 bg-red-50 text-red-700',
    warn: 'border-amber-200 bg-amber-50 text-amber-700',
    neutral: 'border-gray-200 bg-white text-gray-700',
  } as const

  return (
    <div className={`rounded-xl border px-3 py-2 ${toneClass[tone]}`}>
      <div className="text-[11px] opacity-75">{label}</div>
      <div className="text-sm font-semibold mt-0.5">{value}</div>
    </div>
  )
}
