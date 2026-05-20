import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import {
  ArrowLeft,
  Play,
  Pause,
  RotateCcw,
  Clock,
  CheckCircle,
  AlertCircle,
  Search,
  Database,
  Brain,
  Calculator,
  FileText,
  Lightbulb
} from 'lucide-react'
import { fetchQuoteTrace } from '../utils/api'

interface TraceStep {
  step: string
  status: string
  timestamp: string
  duration_ms: number
  output?: string
}

export default function ExecutionTrace() {
  const { id } = useParams<{ id: string }>()
  const [trace, setTrace] = useState<TraceStep[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedStep, setSelectedStep] = useState<number | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentStep, setCurrentStep] = useState(0)

  useEffect(() => {
    if (id) {
      loadTrace()
    }
  }, [id])

  const loadTrace = async () => {
    try {
      const res = await fetchQuoteTrace(id!)
      setTrace(res.execution_trace)
    } catch (error) {
      console.error('Failed to load trace:', error)
    } finally {
      setLoading(false)
    }
  }

  const getStepIcon = (stepName: string) => {
    switch (stepName) {
      case '异常检测':
        return <AlertCircle className="w-5 h-5" />
      case '相似物料检索':
        return <Search className="w-5 h-5" />
      case '价格区间预测':
        return <Calculator className="w-5 h-5" />
      case '成本结构拆解':
        return <Database className="w-5 h-5" />
      case '偏离度综合打分':
        return <Brain className="w-5 h-5" />
      case '方案生成':
        return <Lightbulb className="w-5 h-5" />
      default:
        return <FileText className="w-5 h-5" />
    }
  }

  const getStepColor = (stepName: string) => {
    switch (stepName) {
      case '异常检测':
        return 'bg-blue-500/20 text-blue-600 border-blue-500/30'
      case '相似物料检索':
        return 'bg-purple-500/20 text-purple-600 border-purple-500/30'
      case '价格区间预测':
        return 'bg-cyan-500/20 text-cyan-600 border-cyan-500/30'
      case '成本结构拆解':
        return 'bg-amber-500/20 text-amber-600 border-amber-500/30'
      case '偏离度综合打分':
        return 'bg-rose-500/20 text-rose-600 border-rose-500/30'
      case '方案生成':
        return 'bg-emerald-500/20 text-emerald-600 border-emerald-500/30'
      default:
        return 'bg-gray-500/20 text-gray-600 border-gray-500/30'
    }
  }

  const playAnimation = () => {
    setIsPlaying(true)
    setCurrentStep(0)

    const interval = setInterval(() => {
      if (currentStep >= trace.length - 1) {
        clearInterval(interval)
        setIsPlaying(false)
      } else {
        setCurrentStep(prev => prev + 1)
      }
    }, 1000)

    return () => clearInterval(interval)
  }

  const resetAnimation = () => {
    setIsPlaying(false)
    setCurrentStep(0)
    setSelectedStep(null)
  }

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
      </div>
    )
  }

  const totalDuration = trace.reduce((sum, step) => sum + step.duration_ms, 0)

  return (
    <div className="h-full overflow-auto p-8 bg-[#f8fafc]">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-4">
          <Link
            to={`/quotes/${id}`}
            className="p-2 rounded-lg bg-gray-100 hover:bg-gray-200 transition-colors"
          >
            <ArrowLeft className="w-5 h-5 text-gray-600" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">执行轨迹可视化</h1>
            <p className="text-gray-500">报价单号 {id}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={isPlaying ? () => setIsPlaying(false) : playAnimation}
            className="flex items-center gap-2 px-4 py-2 bg-primary/20 text-primary rounded-lg font-medium hover:bg-primary/30 transition-colors"
          >
            {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
            {isPlaying ? '暂停' : '播放'}
          </button>
          <button
            onClick={resetAnimation}
            className="flex items-center gap-2 px-4 py-2 bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200 transition-colors"
          >
            <RotateCcw className="w-4 h-4" />
            重置
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-6 mb-8">
        <div className="glass rounded-xl p-6 bg-white border border-gray-200 shadow-sm">
          <div className="text-sm text-gray-500 mb-2">总执行步骤</div>
          <div className="text-3xl font-bold text-gray-900">{trace.length}</div>
        </div>
        <div className="glass rounded-xl p-6 bg-white border border-gray-200 shadow-sm">
          <div className="text-sm text-gray-500 mb-2">总耗时</div>
          <div className="text-3xl font-bold text-gray-900">{totalDuration}ms</div>
        </div>
        <div className="glass rounded-xl p-6 bg-white border border-gray-200 shadow-sm">
          <div className="text-sm text-gray-500 mb-2">平均耗时</div>
          <div className="text-3xl font-bold text-gray-900">
            {Math.round(totalDuration / trace.length)}ms
          </div>
        </div>
      </div>

      {/* Timeline */}
      <div className="glass rounded-xl p-6 bg-white border border-gray-200 shadow-sm">
        <h3 className="text-lg font-semibold text-gray-900 mb-6">执行时间线</h3>
        <div className="relative">
          {/* Timeline Line */}
          <div className="absolute left-8 top-0 bottom-0 w-px bg-gray-200"></div>

          {/* Steps */}
          <div className="space-y-6">
            {trace.map((step, index) => {
              const isActive = isPlaying ? index <= currentStep : selectedStep === index
              const isPast = isPlaying ? index < currentStep : selectedStep !== null && index < selectedStep

              return (
                <div
                  key={index}
                  onClick={() => setSelectedStep(index)}
                  className={`relative flex items-start gap-6 cursor-pointer transition-all ${
                    isActive ? 'opacity-100' : 'opacity-50'
                  }`}
                >
                  {/* Node */}
                  <div className={`relative z-10 w-16 h-16 rounded-xl border-2 flex items-center justify-center transition-all ${
                    isActive ? getStepColor(step.step) : 'bg-gray-100 border-gray-200'
                  }`}>
                    {getStepIcon(step.step)}
                  </div>

                  {/* Content */}
                  <div className={`flex-1 p-4 rounded-xl border transition-all ${
                    isActive ? 'bg-gray-50 border-gray-200' : 'border-transparent'
                  }`}>
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="font-medium text-gray-900">{step.step}</h4>
                      <div className="flex items-center gap-2 text-sm text-gray-500">
                        <Clock className="w-4 h-4" />
                        {step.duration_ms}ms
                      </div>
                    </div>
                    <div className="text-sm text-gray-500 mb-2">
                      {step.timestamp}
                    </div>
                    {step.output && (
                      <div className="mt-3 p-3 bg-white rounded-lg font-mono text-sm text-accent border border-gray-200">
                        {step.output}
                      </div>
                    )}
                    {isActive && (
                      <div className="mt-3 flex items-center gap-2">
                        <CheckCircle className="w-4 h-4 text-success" />
                        <span className="text-sm text-success">执行完成</span>
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* Step Detail */}
      {selectedStep !== null && trace[selectedStep] && (
        <div className="glass rounded-xl p-6 mt-6 bg-white border border-gray-200 shadow-sm">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">
            步骤详情: {trace[selectedStep].step}
          </h3>
          <div className="grid grid-cols-2 gap-6">
            <div>
              <div className="text-sm text-gray-500 mb-2">输入参数</div>
              <div className="p-4 bg-gray-50 rounded-lg font-mono text-sm text-gray-600 border border-gray-200">
                {`{
  "material_id": "${id}",
  "step": "${trace[selectedStep].step}",
  "timestamp": "${trace[selectedStep].timestamp}"
}`}
              </div>
            </div>
            <div>
              <div className="text-sm text-gray-500 mb-2">输出结果</div>
              <div className="p-4 bg-gray-50 rounded-lg font-mono text-sm text-accent border border-gray-200">
                {trace[selectedStep].output || '无输出'}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
