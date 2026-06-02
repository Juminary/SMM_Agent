import { useEffect, useMemo, useState } from 'react'
import {
  X, DollarSign, SlidersHorizontal, Flag,
  Loader2, CheckCircle, AlertTriangle,
} from 'lucide-react'
import { applyOverride } from '../utils/api'
import type { Quote, OverrideType, ReRunParams } from '../types'

interface FeedbackContext {
  feedback_type?: string
  additional_info?: string
  override_reasoning?: string
  step_index?: number
  timestamp?: string
}

interface OverrideModalProps {
  quote: Quote
  stepIndex?: number
  stepLabel?: string
  feedbackContext?: FeedbackContext | null
  onClose: () => void
  onSuccess: (result: any) => void
}

const OVERRIDE_TYPES = [
  {
    type: 'price' as OverrideType,
    label: '价格 Override',
    icon: DollarSign,
    color: '#4f46e5',
    bg: 'bg-indigo-50',
    border: 'border-indigo-200',
    desc: '手动指定你认为合理的价格，AI 将重新评估偏离度',
    inputLabel: '合理价格（元）',
    inputPlaceholder: '例如：5.50',
  },
  {
    type: 'solution' as OverrideType,
    label: '方案 Override',
    icon: CheckCircle,
    color: '#10b981',
    bg: 'bg-emerald-50',
    border: 'border-emerald-200',
    desc: '从 AI 未生成的方案列表中手动补充你认为合适的应对方案',
    inputLabel: '自定义方案',
    inputPlaceholder: '例如：联系供应商重新报价，目标降价 15%',
  },
  {
    type: 'model_param' as OverrideType,
    label: '模型参数 Override',
    icon: SlidersHorizontal,
    color: '#f59e0b',
    bg: 'bg-amber-50',
    border: 'border-amber-200',
    desc: '调整打分权重，重新计算偏离度',
    inputLabel: '参数调整（JSON）',
    inputPlaceholder: '{"alpha": 0.5, "beta": 0.3, "gamma": 0.2}',
  },
  {
    type: 'flag' as OverrideType,
    label: '标记 Override',
    icon: Flag,
    color: '#ef4444',
    bg: 'bg-red-50',
    border: 'border-red-200',
    desc: '标记为 AI 误判并提供原因，用于反馈迭代',
    inputLabel: '误判原因',
    inputPlaceholder: '例如：供应商报价包含特殊工艺，AI 未能识别',
  },
]

export default function OverrideModal({
  quote,
  stepIndex = -1,
  stepLabel,
  feedbackContext,
  onClose,
  onSuccess,
}: OverrideModalProps) {
  const [selectedType, setSelectedType] = useState<OverrideType>('price')
  const [overrideValue, setOverrideValue] = useState('')
  const [overrideReason, setOverrideReason] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const currentType = OVERRIDE_TYPES.find(t => t.type === selectedType)!
  const rerunsAnalysis = selectedType === 'price'
  const priceDelta = selectedType === 'price' && overrideValue
    ? parseFloat(overrideValue) - quote.supplier_quote
    : null
  const feedbackSummary = useMemo(() => {
    if (!feedbackContext) {
      return ''
    }
    return [feedbackContext.additional_info, feedbackContext.override_reasoning]
      .filter(Boolean)
      .join('；')
      .trim()
  }, [feedbackContext])

  useEffect(() => {
    if (!feedbackContext) {
      return
    }

    if (selectedType === 'flag') {
      if (!overrideValue.trim()) {
        setOverrideValue(feedbackContext.override_reasoning || feedbackContext.additional_info || '')
      }
      if (!overrideReason.trim()) {
        setOverrideReason(
          feedbackSummary
            ? `基于此前人工反馈，确认当前判断需要标记误判：${feedbackSummary}`
            : '基于此前人工反馈，确认当前判断需要标记误判。'
        )
      }
      return
    }

    if (selectedType === 'solution') {
      if (!overrideValue.trim() && feedbackContext.additional_info) {
        setOverrideValue(feedbackContext.additional_info)
      }
      if (!overrideReason.trim()) {
        setOverrideReason(
          feedbackSummary
            ? `结合此前人工反馈，补充执行方案：${feedbackSummary}`
            : '结合此前人工反馈，补充一个更贴合业务的执行方案。'
        )
      }
      return
    }

    if (!overrideReason.trim()) {
      setOverrideReason(
        feedbackSummary
          ? `沿用此前人工反馈作为本次 Override 依据：${feedbackSummary}`
          : '沿用此前人工反馈作为本次 Override 的人工依据。'
      )
    }
  }, [feedbackContext, feedbackSummary, overrideReason, overrideValue, selectedType])

  const handleSubmit = async () => {
    setLoading(true)
    setError('')
    try {
      let modifiedParams: ReRunParams | undefined

      // 解析 override_value
      let parsedValue: any = overrideValue
      if (selectedType === 'price') {
        parsedValue = parseFloat(overrideValue)
        if (isNaN(parsedValue) || parsedValue <= 0) {
          setError('请输入有效的价格')
          setLoading(false)
          return
        }
        // 价格 Override 需要触发重跑
        modifiedParams = {
          supplier_quote: parsedValue,
          quantity: quote.quantity,
          category: quote.category,
          material_type: quote.material_type,
        }
      } else if (selectedType === 'model_param') {
        try {
          parsedValue = JSON.parse(overrideValue)
        } catch {
          setError('请输入有效的 JSON 格式')
          setLoading(false)
          return
        }
      }

      const result = await applyOverride(quote.id, {
        override_type: selectedType,
        override_value: parsedValue,
        override_reason: overrideReason,
        step_index: stepIndex,
        modified_params: modifiedParams,
        feedback_context: feedbackContext || undefined,
      })
      onSuccess(result)
    } catch (e: any) {
      setError(e.response?.data?.detail || e.message || '提交失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[100]" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-2xl w-[560px] max-h-[85vh] overflow-hidden flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div>
            <h2 className="text-lg font-bold text-gray-900">人工 Override</h2>
            {stepLabel && (
              <p className="text-xs text-gray-400 mt-0.5">步骤：{stepLabel}</p>
            )}
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors">
            <X size={18} className="text-gray-400" />
          </button>
        </div>

        {/* Override Type Selection */}
        <div className="px-6 pt-5 pb-3">
          <label className="text-sm font-medium text-gray-700 mb-2 block">Override 类型</label>
          <div className="grid grid-cols-2 gap-2">
            {OVERRIDE_TYPES.map(t => (
              <button
                key={t.type}
                onClick={() => { setSelectedType(t.type); setOverrideValue('') }}
                className={`flex items-start gap-2.5 p-3 rounded-xl border transition-all text-left ${
                  selectedType === t.type
                    ? `${t.border} ${t.bg}`
                    : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                }`}
              >
                <t.icon size={16} style={{ color: t.color }} className="mt-0.5 shrink-0" />
                <div>
                  <div className={`text-sm font-medium ${
                    selectedType === t.type ? '' : 'text-gray-700'
                  }`}>{t.label}</div>
                  <div className="text-[11px] text-gray-500 mt-1 leading-relaxed">{t.desc}</div>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Override Value Input */}
        <div className="px-6 pb-3">
          {feedbackContext && feedbackSummary && (
            <div className="rounded-xl border border-blue-200 bg-blue-50 px-3 py-2.5 mb-3">
              <div className="text-xs font-medium text-blue-700 mb-1">将复用最近的人工反馈</div>
              <p className="text-xs text-blue-700 leading-relaxed">{feedbackSummary}</p>
            </div>
          )}

          <div className={`rounded-xl border ${currentType.border} ${currentType.bg} p-4 mb-3`}>
            <div className="flex items-center gap-2 mb-1.5">
              <currentType.icon size={14} style={{ color: currentType.color }} />
              <span className="text-sm font-medium" style={{ color: currentType.color }}>{currentType.label}</span>
            </div>
            <p className="text-xs text-gray-500">{currentType.desc}</p>
            <div className="mt-2 text-[11px] text-gray-600">
              {rerunsAnalysis ? '提交后会立即触发重跑，并返回新旧结果差异。' : '提交后会记录人工判断，不会自动重跑当前分析。'}
            </div>
          </div>

          <label className="text-sm font-medium text-gray-700 mb-1.5 block">
            {currentType.inputLabel}
          </label>
          {selectedType === 'price' ? (
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">¥</span>
              <input
                type="number"
                step="0.01"
                value={overrideValue}
                onChange={e => setOverrideValue(e.target.value)}
                placeholder={currentType.inputPlaceholder}
                className="w-full pl-7 pr-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-200"
              />
            </div>
          ) : selectedType === 'model_param' ? (
            <textarea
              value={overrideValue}
              onChange={e => setOverrideValue(e.target.value)}
              placeholder={currentType.inputPlaceholder}
              rows={3}
              className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm font-mono focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-200 resize-none"
            />
          ) : (
            <textarea
              value={overrideValue}
              onChange={e => setOverrideValue(e.target.value)}
              placeholder={currentType.inputPlaceholder}
              rows={3}
              className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-200 resize-none"
            />
          )}
        </div>

        {/* Reason */}
        <div className="px-6 pb-3">
          <label className="text-sm font-medium text-gray-700 mb-1.5 block">
            Override 原因 <span className="text-gray-400 font-normal">(必填)</span>
          </label>
          <textarea
            value={overrideReason}
            onChange={e => setOverrideReason(e.target.value)}
            placeholder="说明你做出这个 Override 的依据或判断..."
            rows={2}
            className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-200 resize-none"
          />
        </div>

        {/* Current Quote Summary */}
        <div className="px-6 pb-3">
          <div className="bg-gray-50 rounded-xl p-3 text-xs text-gray-500 space-y-2">
            <div>
              当前报价：<span className="font-medium text-gray-700">{quote.material_name}</span>
              {' '}({quote.supplier_name}) · <span className="font-medium text-gray-700">¥{quote.supplier_quote}</span>
              {' '}· 偏离度 <span className="font-medium text-gray-700">{quote.deviation_score}</span>分
            </div>
            {rerunsAnalysis && priceDelta !== null && !Number.isNaN(priceDelta) && (
              <div className={`inline-flex px-2 py-1 rounded-full border ${
                priceDelta < 0
                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                  : priceDelta > 0
                  ? 'bg-red-50 text-red-700 border-red-200'
                  : 'bg-gray-100 text-gray-600 border-gray-200'
              }`}>
                {priceDelta > 0 ? '较当前报价上调' : priceDelta < 0 ? '较当前报价下调' : '与当前报价持平'}
                {' '}
                ¥{Math.abs(priceDelta).toFixed(2)}
              </div>
            )}
          </div>
        </div>

        {error && (
          <div className="px-6 pb-3">
            <div className="flex items-center gap-2 text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              <AlertTriangle size={14} />
              {error}
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center gap-3 px-6 py-4 border-t border-gray-100 mt-auto">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 border border-gray-300 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors"
          >
            取消
          </button>
          <button
            onClick={handleSubmit}
            disabled={loading || !overrideReason.trim()}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? (
              <><Loader2 size={14} className="animate-spin" /> 提交中...</>
            ) : (
              <>
                <CheckCircle size={14} />
                确认 Override
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
