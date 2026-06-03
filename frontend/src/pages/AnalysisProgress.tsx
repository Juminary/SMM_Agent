import { useEffect, useState, useRef } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { CheckCircle, Circle, Loader2, Zap, Brain, Search, TrendingDown, GitBranch, Lightbulb, Shield, Sparkles, AlertCircle } from 'lucide-react'
import { analyzeQuote } from '../utils/api'

interface StepDef {
  id: string
  phase: 1 | 2
  label: string
  detail: string
  icon: any
  color: string
  duration: number
}

const PHASE1_STEPS: StepDef[] = [
  { id: 'build', phase: 1, label: '构造物料', detail: '结构化物料基础信息', icon: Zap, color: '#6366f1', duration: 300 },
  { id: 'predict', phase: 1, label: '价格预测', detail: '贝叶斯模型计算合理价区间', icon: TrendingDown, color: '#6366f1', duration: 600 },
  { id: 'cost', phase: 1, label: '成本拆解', detail: '行业基准对标 + 市场交叉验证', icon: Search, color: '#6366f1', duration: 500 },
  { id: 'similar', phase: 1, label: '相似检索', detail: 'TF-IDF 向量检索历史物料', icon: GitBranch, color: '#6366f1', duration: 400 },
  { id: 'score', phase: 1, label: '偏离评分', detail: '两层串联加权综合打分', icon: TrendingDown, color: '#6366f1', duration: 300 },
  { id: 'triage', phase: 1, label: '智能分流', detail: '判断是否需要进入诊断', icon: GitBranch, color: '#6366f1', duration: 200 },
]

const PHASE2_STEPS: StepDef[] = [
  { id: 'hypothesis', phase: 2, label: '生成假设', detail: 'LLM 分析偏离模式产出根因假设', icon: Brain, color: '#f59e0b', duration: 500 },
  { id: 'diagnose', phase: 2, label: '诊断调查', detail: '调用工具收集证据验证假设', icon: Search, color: '#f59e0b', duration: 1000 },
  { id: 'conclude', phase: 2, label: '诊断结论', detail: '确认根因 + 生成应对方案', icon: Lightbulb, color: '#f59e0b', duration: 500 },
  { id: 'human', phase: 2, label: '等待确认', detail: '人工审核诊断结果与方案', icon: Shield, color: '#f59e0b', duration: 200 },
]

const ALL_STEPS = [...PHASE1_STEPS, ...PHASE2_STEPS]

export default function AnalysisProgress() {
  const navigate = useNavigate()
  const location = useLocation()
  const formData = (location.state as any)?.formData

  const [stepIdx, setStepIdx] = useState(-1)
  const [completedSteps, setCompletedSteps] = useState<Set<string>>(new Set())
  const [fadeOut, setFadeOut] = useState(false)
  const [error, setError] = useState('')
  const [apiDone, setApiDone] = useState(false)
  const [apiResult, setApiResult] = useState<any>(null)
  const mountedRef = useRef(true)

  // ── 如果没有 formData → 直接跳 QuoteDetail ──
  useEffect(() => {
    if (!formData) {
      navigate('/quotes', { replace: true })
    }
  }, [])

  // ── 启动：步进动画 + API 同时跑 ──
  useEffect(() => {
    mountedRef.current = true  // ← 修复 Strict Mode 下 cleanup 误杀
    if (!formData) return

    // 并行1: 步进动画（每步完成后等 200ms 再下一步）
    let idx = 0
    const advanceStep = () => {
      if (!mountedRef.current || idx >= ALL_STEPS.length) return
      setStepIdx(idx)
      const step = ALL_STEPS[idx]
      setTimeout(() => {
        if (!mountedRef.current) return
        setCompletedSteps(prev => new Set(prev).add(step.id))
        idx++
        setTimeout(advanceStep, 200)
      }, step.duration)
    }
    const startTimer = setTimeout(advanceStep, 400)

    // 并行2: 真正的 API 调用
    const apiPromise = analyzeQuote({
      material_id: '',
      material_name: formData.material_name,
      supplier_quote: parseFloat(formData.supplier_quote),
      supplier_name: formData.supplier_name,
      quantity: parseInt(formData.quantity) || 10000,
      quote_date: new Date().toISOString().split('T')[0],
      category: formData.category || '塑料外壳',
      material_type: formData.material_type || formData.category || 'ABS',
      dimensions: formData.dimensions || '80×60×15mm',
      processing: formData.processing || '注塑成型',
      precision: formData.precision || '±0.1mm',
      description: formData.description || '',
    })

    apiPromise
      .then(result => {
        if (!mountedRef.current) return
        setApiResult(result)
        setApiDone(true)
      })
      .catch(err => {
        if (!mountedRef.current) return
        setError(err.message || '分析失败')
      })

    return () => { mountedRef.current = false; clearTimeout(startTimer) }
  }, [])

  // ── API 完成 + 步进动画完成 → 跳转 ──
  useEffect(() => {
    if (apiDone && completedSteps.size >= ALL_STEPS.length) {
      const timer = setTimeout(() => {
        if (!mountedRef.current) return
        setFadeOut(true)
        setTimeout(() => {
          if (!mountedRef.current) return
          navigate(`/quotes/${apiResult.id}`, { replace: true })
        }, 600)
      }, 400)
      return () => clearTimeout(timer)
    }
  }, [apiDone, completedSteps.size])

  const phase1Done = PHASE1_STEPS.every(s => completedSteps.has(s.id))
  const totalProgress = Math.round((completedSteps.size / ALL_STEPS.length) * 100)
  const progressColor = apiDone ? '#10b981' : '#6366f1'

  if (!formData) return null

  return (
    <div className={`h-full overflow-auto bg-gradient-to-b from-gray-50 to-white transition-opacity duration-500 ${fadeOut ? 'opacity-0' : 'opacity-100'}`}>
      <div className="max-w-2xl mx-auto px-6 py-16 lg:py-24">
        {/* Header */}
        <div className="text-center mb-12 animate-[fadeIn_0.6s_ease-out]">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 shadow-lg shadow-indigo-200 mb-4">
            <Sparkles size={24} className="text-white" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">AI 正在分析报价</h1>
          <p className="text-sm text-gray-400 mt-1">{formData.material_name} · {formData.supplier_name}</p>
        </div>

        {/* 进度条 */}
        <div className="mb-10 animate-[fadeIn_0.6s_ease-out_0.2s_both]">
          <div className="flex items-center justify-between text-xs text-gray-400 mb-2">
            <span>{apiDone ? '分析完成，等待动画结束...' : '正在分析中'}</span>
            <span className="font-mono font-medium" style={{ color: progressColor }}>{totalProgress}%</span>
          </div>
          <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
            <div className="h-full rounded-full transition-all duration-700 ease-out"
              style={{ width: `${totalProgress}%`, background: apiDone ? 'linear-gradient(90deg, #10b981, #34d399)' : 'linear-gradient(90deg, #6366f1, #8b5cf6)' }} />
          </div>
        </div>

        {/* 错误状态 */}
        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-2xl flex items-center gap-3 text-sm text-red-700 animate-[fadeIn_0.3s_ease-out]">
            <AlertCircle size={18} className="shrink-0" />
            <span>{error}</span>
            <button onClick={() => navigate('/quotes/new')} className="ml-auto text-sm px-3 py-1 border border-red-200 rounded-lg hover:bg-red-100 transition-colors">
              重试
            </button>
          </div>
        )}

        {/* 第一阶段 */}
        <div className="mb-8 animate-[fadeIn_0.6s_ease-out_0.3s_both]">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-2 h-2 rounded-full bg-indigo-500" />
            <span className="text-sm font-semibold text-gray-700">第一阶段：自动化体检</span>
            {phase1Done && <span className="text-xs text-emerald-600 font-medium">✓ 完成</span>}
          </div>
          <div className="space-y-2">
            {PHASE1_STEPS.map(step => (
              <StepCard key={step.id} step={step}
                isActive={stepIdx >= 0 && ALL_STEPS[stepIdx]?.id === step.id}
                isCompleted={completedSteps.has(step.id)}
                apiDone={apiDone} />
            ))}
          </div>
        </div>

        {/* 第二阶段 */}
        <div className={`transition-all duration-500 ${phase1Done ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'}`}>
          <div className="flex items-center gap-2 mb-4">
            <div className="w-2 h-2 rounded-full bg-amber-500" />
            <span className="text-sm font-semibold text-gray-700">第二阶段：Agent 诊断</span>
          </div>
          <div className="space-y-2">
            {PHASE2_STEPS.map(step => (
              <StepCard key={step.id} step={step}
                isActive={stepIdx >= 0 && ALL_STEPS[stepIdx]?.id === step.id}
                isCompleted={completedSteps.has(step.id)}
                apiDone={apiDone} />
            ))}
          </div>
        </div>

        {/* 动画完成，等API */}
        {!apiDone && completedSteps.size >= ALL_STEPS.length && (
          <div className="text-center mt-10 animate-[fadeInUp_0.5s_ease-out]">
            <div className="inline-flex items-center gap-3 px-5 py-3 bg-indigo-50 border border-indigo-100 rounded-2xl">
              <Loader2 size={18} className="animate-spin text-indigo-500" />
              <div className="text-left">
                <div className="text-sm font-semibold text-indigo-700">正在等待 AI 分析结果</div>
                <div className="text-xs text-indigo-500 mt-0.5">AI 正在执行诊断推理，通常需要 1-2 分钟</div>
              </div>
            </div>
          </div>
        )}

        {/* 完成提示 */}
        {apiDone && completedSteps.size >= ALL_STEPS.length && (
          <div className="text-center mt-10 animate-[fadeInUp_0.5s_ease-out]">
            <div className="inline-flex items-center gap-2 px-5 py-3 bg-emerald-50 border border-emerald-200 rounded-2xl shadow-sm">
              <CheckCircle size={20} className="text-emerald-500" />
              <span className="text-sm font-semibold text-emerald-700">分析完成，正在跳转到结果页...</span>
            </div>
          </div>
        )}

        {/* API 已完但动画未完 */}
        {apiDone && completedSteps.size < ALL_STEPS.length && (
          <div className="text-center mt-6 animate-[fadeIn_0.3s_ease-out]">
            <div className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-50 border border-indigo-100 rounded-xl">
              <Loader2 size={14} className="animate-spin text-indigo-500" />
              <span className="text-xs text-indigo-600">后端分析已完成，等待动画播放完毕...</span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── 步骤卡片 ──
function StepCard({ step, isActive, isCompleted, apiDone }: {
  step: StepDef; isActive: boolean; isCompleted: boolean; apiDone: boolean
}) {
  const Icon = step.icon
  const bgColor = isCompleted ? '#f0fdf4' : isActive ? `${step.color}08` : '#f9fafb'
  const borderColor = isCompleted ? '#bbf7d0' : isActive ? step.color + '30' : '#e5e7eb'

  return (
    <div className={`flex items-center gap-3 p-3.5 rounded-xl border transition-all duration-500 ${isActive ? 'shadow-sm' : ''}`}
      style={{ background: bgColor, borderColor, transform: isActive ? 'translateX(4px)' : 'none' }}>
      {/* 状态图标 */}
      <div className="relative shrink-0">
        {isCompleted ? (
          <CheckCircle size={18} className="text-emerald-500 animate-[scaleIn_0.3s_ease-out]" />
        ) : isActive ? (
          <div className="relative">
            <Circle size={18} className="text-indigo-300" />
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse" />
            </div>
          </div>
        ) : !apiDone ? (
          <Circle size={18} className="text-gray-200" />
        ) : (
          <Circle size={18} className="text-gray-300" />
        )}
      </div>

      {/* 图标 */}
      <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 transition-all duration-500"
        style={{ background: isCompleted ? '#d1fae5' : isActive ? `${step.color}18` : '#f3f4f6' }}>
        <Icon size={15} style={{ color: isCompleted ? '#059669' : isActive ? step.color : '#9ca3af' }} />
      </div>

      {/* 文字 */}
      <div className="flex-1 min-w-0">
        <div className={`text-sm font-medium transition-colors duration-300 ${isCompleted ? 'text-emerald-700' : isActive ? 'text-gray-900' : 'text-gray-400'}`}>
          {step.label}
          {isActive && (
            <span className="ml-2 inline-flex items-center gap-1 text-xs text-indigo-500 font-normal">
              <Loader2 size={10} className="animate-spin" /> 执行中
            </span>
          )}
        </div>
        <div className={`text-xs mt-0.5 transition-colors duration-300 ${isCompleted ? 'text-emerald-500' : isActive ? 'text-gray-500' : 'text-gray-300'}`}>
          {step.detail}
        </div>
      </div>
    </div>
  )
}
