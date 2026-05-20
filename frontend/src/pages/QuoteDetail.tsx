import { useEffect, useState, useRef } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import {
  ArrowLeft,
  AlertTriangle,
  CheckCircle,
  Clock,
  AlertCircle,
  TrendingUp,
  TrendingDown,
  Activity,
  Play,
  RotateCcw,
  Check,
  X,
  MessageSquare,
  Pause,
  Search,
  Database,
  Brain,
  Calculator,
  FileText,
  Lightbulb,
  Download,
  FileSpreadsheet,
  FileText as FileTextIcon
} from 'lucide-react'
import { fetchQuote, submitDecision, fetchQuoteTrace } from '../utils/api'
import type { Quote, Solution } from '../types'
import jsPDF from 'jspdf'
import html2canvas from 'html2canvas'
import * as XLSX from 'xlsx'

interface TraceStep {
  step: string
  status: string
  timestamp: string
  duration_ms: number
  output?: string
}

export default function QuoteDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [quote, setQuote] = useState<Quote | null>(null)
  const [loading, setLoading] = useState(true)
  const [selectedSolution, setSelectedSolution] = useState<string | null>(null)
  const [showDecisionModal, setShowDecisionModal] = useState(false)
  const [decisionNote, setDecisionNote] = useState('')

  // 执行轨迹相关状态
  const [trace, setTrace] = useState<TraceStep[]>([])
  const [traceLoading, setTraceLoading] = useState(true)
  const [selectedStep, setSelectedStep] = useState<number | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentStep, setCurrentStep] = useState(-1)
  const [visibleCards, setVisibleCards] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (id) {
      loadQuote()
      loadTrace()
    }
  }, [id])

  const loadQuote = async () => {
    try {
      const res = await fetchQuote(id!)
      setQuote(res)
    } catch (error) {
      console.error('Failed to load quote:', error)
    } finally {
      setLoading(false)
    }
  }

  const loadTrace = async () => {
    try {
      const res = await fetchQuoteTrace(id!)
      setTrace(res.execution_trace)
    } catch (error) {
      console.error('Failed to load trace:', error)
    } finally {
      setTraceLoading(false)
    }
  }

  const handleDecision = async (decision: string) => {
    try {
      await submitDecision(id!, {
        decision,
        decision_by: '当前用户',
        selected_solution_id: selectedSolution,
        override_reason: decisionNote
      })
      navigate('/quotes')
    } catch (error) {
      console.error('Failed to submit decision:', error)
    }
  }

  const getSeverityIcon = (level: string) => {
    switch (level) {
      case '紧急':
        return <AlertTriangle className="w-6 h-6 text-danger" />
      case '警示':
        return <AlertCircle className="w-6 h-6 text-warning" />
      case '关注':
        return <Clock className="w-6 h-6 text-warning/70" />
      default:
        return <CheckCircle className="w-6 h-6 text-success" />
    }
  }

  const getSeverityColor = (level: string) => {
    switch (level) {
      case '紧急':
        return 'bg-danger/10 text-danger border-danger/20'
      case '警示':
        return 'bg-warning/10 text-warning border-warning/20'
      case '关注':
        return 'bg-warning/5 text-warning/80 border-warning/10'
      default:
        return 'bg-success/10 text-success border-success/20'
    }
  }

  // 执行轨迹相关函数
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
    setCurrentStep(-1)
    setSelectedStep(null)
    setVisibleCards(new Set())

    let stepIndex = -1
    const interval = setInterval(() => {
      stepIndex++
      if (stepIndex >= trace.length) {
        clearInterval(interval)
        setIsPlaying(false)
        setCurrentStep(trace.length - 1)
        setSelectedStep(trace.length - 1)
        // 显示所有卡片
        setVisibleCards(new Set(['price', 'deviation', 'similar', 'cost', 'solutions']))
      } else {
        setCurrentStep(stepIndex)
        setSelectedStep(stepIndex)
        // 根据步骤显示对应卡片
        const stepName = trace[stepIndex]?.step
        if (stepName === '相似物料检索') {
          setVisibleCards(prev => new Set([...prev, 'similar']))
        } else if (stepName === '价格区间预测') {
          setVisibleCards(prev => new Set([...prev, 'price', 'deviation']))
        } else if (stepName === '成本结构拆解') {
          setVisibleCards(prev => new Set([...prev, 'cost']))
        } else if (stepName === '方案生成') {
          setVisibleCards(prev => new Set([...prev, 'solutions']))
        }
      }
    }, 1500)

    return () => clearInterval(interval)
  }

  const resetAnimation = () => {
    setIsPlaying(false)
    setCurrentStep(-1)
    setSelectedStep(null)
    setVisibleCards(new Set(['price', 'deviation', 'similar', 'cost', 'solutions']))
  }

  // 导出功能
  const exportToPDF = async () => {
    if (!quote) return

    const element = document.getElementById('quote-detail-content')
    if (!element) return

    try {
      const canvas = await html2canvas(element, {
        scale: 2,
        useCORS: true,
        allowTaint: true
      })

      const imgData = canvas.toDataURL('image/png')
      const pdf = new jsPDF('p', 'mm', 'a4')
      const pdfWidth = pdf.internal.pageSize.getWidth()
      const pdfHeight = (canvas.height * pdfWidth) / canvas.width

      pdf.addImage(imgData, 'PNG', 0, 0, pdfWidth, pdfHeight)
      pdf.save(`报价分析报告-${quote.id}.pdf`)
    } catch (error) {
      console.error('PDF导出失败:', error)
      alert('PDF导出失败，请重试')
    }
  }

  const exportToExcel = () => {
    if (!quote) return

    // 准备数据
    const data = [
      ['报价分析报告', '', '', ''],
      ['', '', '', ''],
      ['基本信息', '', '', ''],
      ['报价单号', quote.id, '物料名称', quote.material_name],
      ['供应商', quote.supplier_name, '报价金额', `¥${quote.supplier_quote}`],
      ['AI预测区间', `¥${quote.ai_prediction_low} ~ ¥${quote.ai_prediction_high}`, '偏离度', `${quote.deviation_score}分`],
      ['严重级别', quote.severity_level, '状态', quote.status],
      ['', '', '', ''],
      ['成本结构', '', '', ''],
      ['项目', '供应商占比', '基准占比', '偏离'],
      ...(quote.cost_breakdown?.cost_items?.map((item: any) => [
        item.item, `${item.supplier_pct}%`, `${item.benchmark_pct}%`, `${item.deviation}%`
      ]) || []),
      ['', '', '', ''],
      ['AI建议方案', '', '', ''],
      ['方案', '置信度', '预计节省', '操作'],
      ...(quote.solutions?.map((sol: Solution) => [
        sol.title, `${sol.confidence * 100}%`, sol.estimated_savings, sol.action
      ]) || [])
    ]

    const ws = XLSX.utils.aoa_to_sheet(data)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, '报价分析')
    XLSX.writeFile(wb, `报价分析-${quote.id}.xlsx`)
  }

  const generateDecisionDoc = () => {
    if (!quote) return

    const content = `
报价分析决策建议书
==================

报价单号：${quote.id}
物料名称：${quote.material_name}
供应商：${quote.supplier_name}

一、价格分析
- 供应商报价：¥${quote.supplier_quote}
- AI预测区间：¥${quote.ai_prediction_low} ~ ¥${quote.ai_prediction_high}
- 偏离度：${quote.deviation_score}分
- 严重级别：${quote.severity_level}

二、成本结构分析
${quote.cost_breakdown?.cost_items?.map((item: any) => `
- ${item.item}：供应商${item.supplier_pct}% vs 基准${item.benchmark_pct}% (${item.status})`).join('\n')}

三、AI建议方案
${quote.solutions?.map((sol: Solution, idx: number) => `
方案${idx + 1}：${sol.title}
- 置信度：${sol.confidence * 100}%
- 预计节省：${sol.estimated_savings}
- 建议操作：${sol.action}
- 说明：${sol.description}`).join('\n\n')}

四、决策建议
根据偏离度${quote.deviation_score}分，建议${quote.severity_level === '正常' ? '直接通过' : quote.severity_level === '紧急' ? '升级处理' : '进一步评估'}。

生成时间：${new Date().toLocaleString()}
    `.trim()

    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `决策建议-${quote.id}.txt`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
      </div>
    )
  }

  if (!quote) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-gray-500">报价不存在</div>
      </div>
    )
  }

  const totalDuration = trace.reduce((sum, step) => sum + step.duration_ms, 0)

  return (
    <div className="h-full overflow-auto p-4 sm:p-6 lg:p-8 bg-[#f8fafc]" id="quote-detail-content">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6 lg:mb-8">
        <div className="flex items-center gap-4">
          <Link
            to="/quotes"
            className="p-2 rounded-lg bg-gray-100 hover:bg-gray-200 transition-colors"
          >
            <ArrowLeft className="w-5 h-5 text-gray-600" />
          </Link>
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-gray-900">{quote.material_name}</h1>
            <p className="text-gray-500 text-sm">{quote.supplier_name} · 报价单号 {quote.id}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <Link
            to={`/quotes/${id}/trace`}
            className="flex items-center gap-2 px-3 sm:px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg text-gray-600 transition-colors text-sm"
          >
            <Activity className="w-4 h-4" />
            <span className="hidden sm:inline">查看执行轨迹</span>
            <span className="sm:hidden">轨迹</span>
          </Link>

          {/* 导出按钮组 */}
          <div className="relative group">
            <button
              className="flex items-center gap-2 px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg text-gray-600 transition-colors"
            >
              <Download className="w-4 h-4" />
              导出
            </button>
            <div className="absolute right-0 top-full mt-2 w-48 bg-white border border-gray-200 rounded-lg shadow-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-50">
              <button
                onClick={exportToPDF}
                className="w-full flex items-center gap-3 px-4 py-3 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-50 transition-colors"
              >
                <FileTextIcon className="w-4 h-4 text-danger" />
                导出PDF报告
              </button>
              <button
                onClick={exportToExcel}
                className="w-full flex items-center gap-3 px-4 py-3 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-50 transition-colors"
              >
                <FileSpreadsheet className="w-4 h-4 text-success" />
                导出Excel数据
              </button>
              <button
                onClick={generateDecisionDoc}
                className="w-full flex items-center gap-3 px-4 py-3 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-50 transition-colors"
              >
                <FileText className="w-4 h-4 text-accent" />
                生成决策文档
              </button>
            </div>
          </div>

          <button
            onClick={() => setShowDecisionModal(true)}
            className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-primary to-accent text-white rounded-lg font-medium hover:opacity-90 transition-opacity"
          >
            <Check className="w-4 h-4" />
            提交决策
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 lg:gap-6">
        {/* Left Column - Price Info */}
        <div className="space-y-4 lg:space-y-6">
          {/* Price Card - 价格区间预测完成后显示 */}
          <div className={`glass rounded-xl p-6 bg-white border border-gray-200 shadow-sm transition-all duration-500 ${
            visibleCards.has('price') || !isPlaying ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
          }`}>
            <h3 className="text-base font-semibold text-gray-700 mb-4 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-cyan-500"></span>
              价格对比
              {visibleCards.has('price') && isPlaying && (
                <span className="text-xs text-cyan-600 animate-pulse">刚生成</span>
              )}
            </h3>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-gray-600 text-base">供应商报价</span>
                <span className="text-3xl font-mono font-bold text-gray-900">
                  ¥{quote.supplier_quote}
                </span>
              </div>
              <div className="h-px bg-gray-200"></div>
              <div className="flex items-center justify-between">
                <span className="text-gray-600 text-base">AI预测区间</span>
                <span className="font-mono text-lg text-accent">
                  ¥{quote.ai_prediction_low} ~ {quote.ai_prediction_high}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-600 text-base">预测中位数</span>
                <span className="font-mono text-lg text-gray-900">
                  ¥{quote.ai_prediction_mid}
                </span>
              </div>
            </div>
          </div>

          {/* Deviation Card - 偏离度打分完成后显示 */}
          <div className={`glass rounded-xl p-6 bg-white border border-gray-200 shadow-sm transition-all duration-500 ${
            visibleCards.has('deviation') || !isPlaying ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
          }`}>
            <h3 className="text-base font-semibold text-gray-700 mb-4 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-rose-500"></span>
              偏离度分析
              {visibleCards.has('deviation') && isPlaying && (
                <span className="text-xs text-rose-600 animate-pulse">刚生成</span>
              )}
            </h3>
            <div className="flex items-center gap-4 mb-4">
              {getSeverityIcon(quote.severity_level)}
              <div>
                <div className="text-4xl font-bold" style={{ color: quote.severity_color }}>
                  {quote.deviation_score}
                </div>
                <div className="text-base text-gray-600">综合偏离度</div>
              </div>
            </div>
            <div className={`inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-base font-medium border ${getSeverityColor(quote.severity_level)}`}>
              {quote.severity_level}
            </div>
          </div>

          {/* Similar Materials - 相似物料检索完成后显示 */}
          <div className={`glass rounded-xl p-6 bg-white border border-gray-200 shadow-sm transition-all duration-500 ${
            visibleCards.has('similar') || !isPlaying ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
          }`}>
            <h3 className="text-base font-semibold text-gray-700 mb-4 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-purple-500"></span>
              相似历史物料
              {visibleCards.has('similar') && isPlaying && (
                <span className="text-xs text-purple-600 animate-pulse">刚检索到</span>
              )}
            </h3>
            <div className="space-y-3">
              {quote.similar_materials?.slice(0, 3).map((mat, idx) => (
                <div key={idx} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                  <div>
                    <div className="text-base font-medium text-gray-900">{mat.name}</div>
                    <div className="text-sm text-gray-500">{mat.date}</div>
                  </div>
                  <div className="text-right">
                    <div className="font-mono text-base text-gray-900">¥{mat.price}</div>
                    <div className="text-sm text-accent">相似度 {mat.similarity}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Middle Column - Cost Breakdown */}
        <div className="space-y-4 lg:space-y-6">
          {/* Cost Structure - 成本结构拆解完成后显示 */}
          <div className={`glass rounded-xl p-6 bg-white border border-gray-200 shadow-sm transition-all duration-500 ${
            visibleCards.has('cost') || !isPlaying ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
          }`}>
            <h3 className="text-base font-semibold text-gray-700 mb-4 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-amber-500"></span>
              成本结构拆解
              {visibleCards.has('cost') && isPlaying && (
                <span className="text-xs text-amber-600 animate-pulse">刚拆解</span>
              )}
            </h3>
            <div className="space-y-4">
              {quote.cost_breakdown?.cost_items?.map((item: any, idx: number) => (
                <div key={idx}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-base text-gray-600">{item.item}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-base font-medium text-gray-900">{item.supplier_pct}%</span>
                      <span className="text-sm text-gray-500">(基准 {item.benchmark_pct}%)</span>
                    </div>
                  </div>
                  <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full ${
                        item.deviation > 25 ? 'bg-danger' :
                        item.deviation > 10 ? 'bg-warning' :
                        'bg-success'
                      }`}
                      style={{ width: `${item.supplier_pct}%` }}
                    ></div>
                  </div>
                  {item.deviation > 10 && (
                    <div className={`text-sm mt-1 ${
                      item.deviation > 25 ? 'text-danger' : 'text-warning'
                    }`}>
                      偏离 {item.deviation}% · {item.status}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Cost Deviation Score */}
          <div className={`glass rounded-xl p-6 bg-white border border-gray-200 shadow-sm transition-all duration-500 ${
            visibleCards.has('cost') || !isPlaying ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
          }`}>
            <h3 className="text-base font-semibold text-gray-700 mb-4">成本结构偏离分</h3>
            <div className="flex items-center gap-3">
              <div className={`text-3xl font-bold ${
                (quote.cost_breakdown?.cost_deviation_score || 0) > 50 ? 'text-danger' :
                (quote.cost_breakdown?.cost_deviation_score || 0) > 25 ? 'text-warning' :
                'text-success'
              }`}>
                {quote.cost_breakdown?.cost_deviation_score || 0}
              </div>
              <span className="text-gray-500 text-lg">/ 100</span>
            </div>
          </div>
        </div>

        {/* Right Column - Solutions */}
        <div className="space-y-4 lg:space-y-6">
          {/* Solutions - 方案生成完成后显示 */}
          <div className={`glass rounded-xl p-6 bg-white border border-gray-200 shadow-sm transition-all duration-500 ${
            visibleCards.has('solutions') || !isPlaying ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
          }`}>
            <h3 className="text-base font-semibold text-gray-700 mb-4 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
              AI建议方案
              {visibleCards.has('solutions') && isPlaying && (
                <span className="text-xs text-emerald-600 animate-pulse">刚生成</span>
              )}
            </h3>
            <div className="space-y-4">
              {quote.solutions?.map((solution: Solution, idx: number) => (
                <div
                  key={solution.id}
                  onClick={() => setSelectedSolution(solution.id)}
                  className={`p-4 rounded-lg border cursor-pointer transition-all ${
                    selectedSolution === solution.id
                      ? 'border-primary bg-primary/10'
                      : 'border-gray-200 bg-gray-50 hover:bg-gray-100'
                  }`}
                >
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-lg font-bold text-gray-900">{solution.title}</span>
                      <span className="text-sm text-gray-500">置信度 {solution.confidence * 100}%</span>
                    </div>
                    {selectedSolution === solution.id && (
                      <CheckCircle className="w-5 h-5 text-primary" />
                    )}
                  </div>
                  <p className="text-base text-gray-600 mb-3">{solution.description}</p>
                  <div className="flex items-center gap-2 text-base">
                    <TrendingDown className="w-4 h-4 text-success" />
                    <span className="text-success font-medium">预计节省: {solution.estimated_savings}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Decision Modal */}
      {showDecisionModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="glass rounded-xl p-6 w-96 bg-white border border-gray-200 shadow-xl">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">提交决策</h3>
            <textarea
              value={decisionNote}
              onChange={(e) => setDecisionNote(e.target.value)}
              placeholder="添加决策备注（可选）..."
              className="w-full h-24 px-3 py-2 bg-gray-50 border border-gray-300 rounded-lg text-gray-900 placeholder-gray-400 focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary mb-4 resize-none"
            />
            <div className="flex gap-3">
              <button
                onClick={() => handleDecision('accept')}
                className="flex-1 py-2 bg-success/20 text-success rounded-lg font-medium hover:bg-success/30 transition-colors"
              >
                接受
              </button>
              <button
                onClick={() => handleDecision('negotiate')}
                className="flex-1 py-2 bg-accent/20 text-accent rounded-lg font-medium hover:bg-accent/30 transition-colors"
              >
                议价
              </button>
              <button
                onClick={() => handleDecision('reject')}
                className="flex-1 py-2 bg-danger/20 text-danger rounded-lg font-medium hover:bg-danger/30 transition-colors"
              >
                驳回
              </button>
            </div>
            <button
              onClick={() => setShowDecisionModal(false)}
              className="w-full mt-3 py-2 bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200 transition-colors"
            >
              取消
            </button>
          </div>
        </div>
      )}

      {/* 执行轨迹区域 */}
      <div className="mt-8">
        <div className="glass rounded-xl p-6 bg-white border border-gray-200 shadow-sm">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-4">
              <h3 className="text-lg font-semibold text-gray-900">执行轨迹</h3>
              <Link
                to={`/quotes/${id}/trace`}
                className="text-sm text-primary hover:text-accent transition-colors"
              >
                查看完整版 →
              </Link>
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

          {traceLoading ? (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            </div>
          ) : (
            <>
              {/* Stats */}
              <div className="grid grid-cols-3 gap-4 mb-6">
                <div className="bg-gray-50 rounded-lg p-4">
                  <div className="text-sm text-gray-500 mb-1">总执行步骤</div>
                  <div className="text-2xl font-bold text-gray-900">{trace.length}</div>
                </div>
                <div className="bg-gray-50 rounded-lg p-4">
                  <div className="text-sm text-gray-500 mb-1">总耗时</div>
                  <div className="text-2xl font-bold text-gray-900">{totalDuration}ms</div>
                </div>
                <div className="bg-gray-50 rounded-lg p-4">
                  <div className="text-sm text-gray-500 mb-1">平均耗时</div>
                  <div className="text-2xl font-bold text-gray-900">
                    {Math.round(totalDuration / trace.length)}ms
                  </div>
                </div>
              </div>

              {/* Timeline */}
              <div className="relative">
                {/* Timeline Line - 动态进度 */}
                <div className="absolute left-6 top-0 bottom-0 w-px bg-gray-200">
                  <div
                    className="w-full bg-gradient-to-b from-primary to-accent transition-all duration-500"
                    style={{
                      height: isPlaying
                        ? `${((currentStep + 1) / trace.length) * 100}%`
                        : selectedStep !== null
                          ? `${((selectedStep + 1) / trace.length) * 100}%`
                          : '0%'
                    }}
                  />
                </div>

                {/* Steps */}
                <div className="space-y-4">
                  {trace.map((step, index) => {
                    const isActive = isPlaying ? index <= currentStep : selectedStep === index
                    const isPast = isPlaying ? index < currentStep : selectedStep !== null && index < selectedStep
                    const isCurrent = isPlaying && index === currentStep

                    return (
                      <div
                        key={index}
                        onClick={() => {
                          setSelectedStep(index)
                          setIsPlaying(false)
                          // 点击步骤时高亮对应的数据卡片
                          const stepName = step.step
                          if (stepName === '相似物料检索') {
                            setVisibleCards(new Set(['similar']))
                          } else if (stepName === '价格区间预测') {
                            setVisibleCards(new Set(['price', 'deviation']))
                          } else if (stepName === '成本结构拆解') {
                            setVisibleCards(new Set(['cost']))
                          } else if (stepName === '方案生成') {
                            setVisibleCards(new Set(['solutions']))
                          } else if (stepName === '偏离度综合打分') {
                            setVisibleCards(new Set(['price', 'deviation', 'cost']))
                          }
                        }}
                        className={`relative flex items-start gap-4 cursor-pointer transition-all duration-300 ${
                          isActive ? 'opacity-100' : 'opacity-40'
                        } ${isCurrent ? 'scale-[1.02]' : ''}`}
                      >
                        {/* Node - 添加脉冲动画 */}
                        <div className={`relative z-10 w-12 h-12 rounded-lg border-2 flex items-center justify-center transition-all duration-300 ${
                          isActive ? getStepColor(step.step) : 'bg-gray-100 border-gray-200'
                        } ${isCurrent ? 'ring-4 ring-primary/30 animate-pulse' : ''}`}>
                          {getStepIcon(step.step)}
                          {isCurrent && (
                            <div className="absolute -top-1 -right-1 w-4 h-4 bg-primary rounded-full flex items-center justify-center">
                              <div className="w-2 h-2 bg-white rounded-full animate-ping" />
                            </div>
                          )}
                        </div>

                        {/* Content */}
                        <div className={`flex-1 p-3 rounded-lg border transition-all duration-300 ${
                          isActive ? 'bg-gray-50 border-gray-200' : 'border-transparent'
                        } ${isCurrent ? 'border-primary/50 shadow-lg shadow-primary/10' : ''}`}>
                          <div className="flex items-center justify-between mb-1">
                            <h4 className={`font-medium text-sm transition-colors ${
                              isCurrent ? 'text-primary' : 'text-gray-900'
                            }`}>
                              {step.step}
                              {isCurrent && <span className="ml-2 text-xs text-primary animate-pulse">执行中...</span>}
                            </h4>
                            <div className="flex items-center gap-1 text-xs text-gray-500">
                              <Clock className="w-3 h-3" />
                              {step.duration_ms}ms
                            </div>
                          </div>
                          {step.output && (
                            <div className={`mt-2 p-2 rounded font-mono text-xs transition-all duration-500 ${
                              isActive ? 'bg-gray-100 text-accent' : 'bg-gray-50 text-gray-400'
                            } ${isCurrent ? 'ring-1 ring-accent/30' : ''}`}>
                              {step.output}
                            </div>
                          )}
                          {isActive && (
                            <div className="mt-2 flex items-center gap-1">
                              <CheckCircle className={`w-3 h-3 ${isCurrent ? 'text-primary animate-bounce' : 'text-success'}`} />
                              <span className={`text-xs ${isCurrent ? 'text-primary' : 'text-success'}`}>
                                {isCurrent ? '正在执行' : '执行完成'}
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* Step Detail */}
              {selectedStep !== null && trace[selectedStep] && (
                <div className="mt-4 p-4 bg-gray-50 rounded-lg border border-gray-200">
                  <h4 className="text-sm font-semibold text-gray-900 mb-3">
                    步骤详情: {trace[selectedStep].step}
                  </h4>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <div className="text-xs text-gray-500 mb-1">输入参数</div>
                      <div className="p-3 bg-white rounded-lg font-mono text-xs text-gray-600 border border-gray-200">
                        {`{\n  "material_id": "${id}",\n  "step": "${trace[selectedStep].step}"\n}`}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-gray-500 mb-1">输出结果</div>
                      <div className="p-3 bg-white rounded-lg font-mono text-xs text-accent border border-gray-200">
                        {trace[selectedStep].output || '无输出'}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
