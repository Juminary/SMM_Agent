import { useState, useEffect } from 'react'
import { ChevronRight, CheckCircle, Circle, Lightbulb, Target, X } from 'lucide-react'

export interface GuideStep {
  id: string
  label: string
  description: string
  icon: any
  action?: string
  onAction?: () => void
}

interface InvestigationGuideProps {
  steps: GuideStep[]
  currentStepIndex: number
  completedSteps: Set<string>
  onClose?: () => void
  onSkip?: () => void
}

const STEP_COLORS = ['#6366f1', '#8b5cf6', '#f59e0b', '#f97316', '#10b981']

export default function InvestigationGuide({
  steps,
  currentStepIndex,
  completedSteps,
  onClose,
  onSkip,
}: InvestigationGuideProps) {
  const [minimized, setMinimized] = useState(false)
  const [dismissed] = useState(false)

  // Auto-minimize when all steps done
  useEffect(() => {
    if (completedSteps.size >= steps.length && !minimized) {
      const timer = setTimeout(() => setMinimized(true), 3000)
      return () => clearTimeout(timer)
    }
  }, [completedSteps.size, steps.length, minimized])

  if (dismissed) return null

  const progress = Math.round((completedSteps.size / steps.length) * 100)

  if (minimized) {
    return (
      <div className="fixed bottom-6 right-6 z-50">
        <button
          onClick={() => setMinimized(false)}
          className="flex items-center gap-2 px-4 py-3 bg-white rounded-2xl border border-gray-200 shadow-lg hover:shadow-xl transition-all"
        >
          <div className="relative">
            <Target size={16} className="text-indigo-500" />
            <div className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-emerald-400 border-2 border-white" />
          </div>
          <span className="text-sm font-medium text-gray-700">
            调查指南 {completedSteps.size}/{steps.length}
          </span>
          <ChevronRight size={14} className="text-gray-300" />
        </button>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-200 shadow-lg overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Lightbulb size={14} className="text-amber-500" />
          <span className="text-sm font-semibold text-gray-800">调查指南</span>
          <span className="text-xs text-gray-400">{completedSteps.size}/{steps.length}</span>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={() => setMinimized(true)} className="p-1 hover:bg-gray-100 rounded-lg">
            <ChevronRight size={14} className="text-gray-400" />
          </button>
          {onClose && (
            <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded-lg">
              <X size={14} className="text-gray-400" />
            </button>
          )}
        </div>
      </div>

      {/* Progress bar */}
      <div className="h-1 bg-gray-100">
        <div className="h-full bg-gradient-to-r from-indigo-500 to-emerald-500 transition-all duration-500" style={{ width: `${progress}%` }} />
      </div>

      <div className="p-4 space-y-2">
        {steps.map((step, i) => {
          const isCompleted = completedSteps.has(step.id)
          const isCurrent = i === currentStepIndex && !isCompleted
          const isFuture = i > currentStepIndex || (i >= currentStepIndex && !isCompleted && !isCurrent)
          const color = STEP_COLORS[i % STEP_COLORS.length]

          return (
            <div key={step.id} className={`flex items-start gap-3 py-1.5 transition-opacity ${
              isFuture ? 'opacity-40' : ''
            }`}>
              {/* Status icon */}
              <div className="mt-0.5 shrink-0">
                {isCompleted ? (
                  <CheckCircle size={16} className="text-emerald-500" />
                ) : isCurrent ? (
                  <div className="w-4 h-4 rounded-full border-2 flex items-center justify-center" style={{ borderColor: color }}>
                    <div className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: color }} />
                  </div>
                ) : (
                  <Circle size={16} className="text-gray-300" />
                )}
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0">
                <div className={`text-xs font-medium ${isCompleted ? 'text-emerald-600' : isCurrent ? 'text-gray-900' : 'text-gray-400'}`}>
                  {step.label}
                </div>
                {isCurrent && (
                  <div className="mt-1">
                    <p className="text-[11px] text-gray-500 leading-relaxed">{step.description}</p>
                    {step.action && step.onAction && (
                      <button
                        onClick={step.onAction}
                        className="mt-1.5 inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium transition-all"
                        style={{ background: color + '15', color }}
                      >
                        {step.action} <ChevronRight size={10} />
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* Footer */}
      {onSkip && (
        <div className="px-4 py-2 border-t border-gray-100">
          <button onClick={onSkip} className="text-[11px] text-gray-400 hover:text-gray-600 transition-colors">
            跳过引导，我自己探索 →
          </button>
        </div>
      )}
    </div>
  )
}
