import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Zap, Brain, Database, Search, Calculator, TrendingDown, Lightbulb,
  Play, RotateCcw, CheckCircle, AlertTriangle, Sparkles, ArrowRight,
  BarChart3, GitBranch, Shield, User, Globe, Wrench, Clock, Activity,
} from 'lucide-react'
import { analyzeQuote } from '../utils/api'
import type { Quote } from '../types'

const PHASE1_NODES = [
  { id: 'material', label: '物料构造', icon: Database, color: '#6366f1', desc: '结构化物料基础信息' },
  { id: 'baseline', label: '并行体检', icon: Activity, color: '#8b5cf6', desc: '价格预测+成本拆解+相似检索' },
  { id: 'scoring', label: '偏离度评分', icon: TrendingDown, color: '#f59e0b', desc: '两层串联加权综合打分' },
  { id: 'triage', label: '智能分流', icon: GitBranch, color: '#10b981', desc: '偏离<20自动通过 / ≥20进入诊断' },
]

const PHASE2_NODES = [
  { id: 'hypothesis', label: '生成假设', icon: Brain, color: '#ec4899', desc: 'LLM分析偏离模式生成根因假设' },
  { id: 'investigate', label: '调查验证', icon: Search, color: '#06b6d4', desc: '调用诊断工具收集证据' },
  { id: 'conclude', label: '诊断结论', icon: Lightbulb, color: '#f97316', desc: '确认根因+生成应对方案' },
  { id: 'human', label: '人工确认', icon: Shield, color: '#3b82f6', desc: 'Human-in-the-loop 审核决策' },
]

const DIAG_TOOLS = [
  { icon: User, label: '供应商画像', color: '#6366f1' },
  { icon: BarChart3, label: '同行对比', color: '#8b5cf6' },
  { icon: Globe, label: '市场行情', color: '#06b6d4' },
  { icon: Clock, label: '库存紧急度', color: '#f59e0b' },
  { icon: Search, label: '替代供应商', color: '#10b981' },
  { icon: Wrench, label: '成本异常分析', color: '#f97316' },
]

const DEMO_QUOTE = {
  material_id: 'DEMO-001',
  material_name: 'ABS注塑支架',
  supplier_quote: 8.5,
  supplier_name: '深圳塑料厂',
  quantity: 50000,
  quote_date: new Date().toISOString().split('T')[0],
  category: '塑料外壳',
  material_type: 'ABS',
  dimensions: '120×80×20mm',
  processing: '注塑成型',
  precision: '±0.2mm',
  description: '医疗设备用精密塑料支架',
}

export default function Demo() {
  const navigate = useNavigate()
  const [phase, setPhase] = useState<'intro' | 'running' | 'done'>('intro')
  const [p1Node, setP1Node] = useState(-1)
  const [p2Node, setP2Node] = useState(-1)
  const [investigating, setInvestigating] = useState(false)
  const [result, setResult] = useState<Quote | null>(null)
  const intervalRef = useRef<NodeJS.Timeout | null>(null)

  useEffect(() => { return () => { if (intervalRef.current) clearInterval(intervalRef.current) } }, [])

  const startDemo = async () => {
    setPhase('running')
    setP1Node(-1); setP2Node(-1); setInvestigating(false)

    // Phase 1 animation: 4 nodes × 800ms
    for (let i = 0; i < PHASE1_NODES.length; i++) {
      await sleep(800); setP1Node(i)
    }

    // Fire API call (don't wait for it to start Phase 2 animation)
    const apiPromise = analyzeQuote(DEMO_QUOTE).catch(() => null)

    // Phase 2 animation runs in parallel with API call
    for (let i = 0; i < PHASE2_NODES.length; i++) {
      await sleep(i === 1 ? 1500 : 800)
      setP2Node(i)
      if (i === 1) {
        setInvestigating(true)
        await sleep(1500)
        setInvestigating(false)
      }
    }

    // Wait for API result
    const quoteResult = await apiPromise
    setResult(quoteResult)
    setPhase('done')
  }

  const reset = () => { setPhase('intro'); setP1Node(-1); setP2Node(-1); setResult(null) }

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 space-y-8">
      {/* Hero */}
      <div className="text-center space-y-3">
        <h1 className="text-3xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
          供销计划异常协调 Agent
        </h1>
        <p className="text-gray-500">两阶段+三条路径架构 · 层次贝叶斯价格预测 · AI自主诊断</p>
      </div>

      {/* Demo Card */}
      <div className="bg-white rounded-xl border p-6 max-w-lg mx-auto">
        <h3 className="font-semibold mb-3">演示报价</h3>
        <div className="grid grid-cols-2 gap-2 text-sm">
          <span className="text-gray-400">物料</span><span>{DEMO_QUOTE.material_name}</span>
          <span className="text-gray-400">供应商</span><span>{DEMO_QUOTE.supplier_name}</span>
          <span className="text-gray-400">报价</span><span className="font-bold">¥{DEMO_QUOTE.supplier_quote}</span>
          <span className="text-gray-400">数量</span><span>{DEMO_QUOTE.quantity.toLocaleString()}件</span>
        </div>
        <div className="flex gap-2 mt-4">
          {phase === 'intro' && (
            <button onClick={startDemo} className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
              <Play size={16} /> 开始演示
            </button>
          )}
          {phase === 'running' && (
            <button disabled className="flex items-center gap-2 px-4 py-2 bg-gray-300 text-gray-500 rounded-lg">
              <Activity size={16} className="animate-spin" /> 运行中...
            </button>
          )}
          {phase === 'done' && (
            <button onClick={reset} className="flex items-center gap-2 px-4 py-2 border rounded-lg hover:bg-gray-50">
              <RotateCcw size={16} /> 重新演示
            </button>
          )}
          <button onClick={() => navigate('/quotes/new')} className="flex items-center gap-2 px-4 py-2 border rounded-lg hover:bg-gray-50">
            体验完整系统 <ArrowRight size={16} />
          </button>
        </div>
      </div>

      {(phase === 'running' || phase === 'done') && (
        <>
          {/* Phase 1 */}
          <PhaseSection
            title="第一阶段：自动化体检（确定性，无LLM）"
            subtitle="并行执行三项体检 → 两层打分 → 智能分流"
            color="#6366f1"
            nodes={PHASE1_NODES}
            activeNode={p1Node}
            done={phase === 'done'}
          />

          {/* Triage result */}
          {p1Node >= 3 && (
            <div className="flex justify-center">
              <div className={`px-4 py-2 rounded-full text-sm font-medium ${
                (result?.phase ?? 'diagnosis') === 'fast_pass'
                  ? 'bg-green-100 text-green-700'
                  : 'bg-yellow-100 text-yellow-700'
              }`}>
                {result?.phase === 'fast_pass'
                  ? `↳ 偏离度 ${result.deviation_score}分 → 快速通道（自动通过）`
                  : `↳ 偏离度 ${result?.deviation_score ?? '?'}分 → 进入Agent诊断`
                }
              </div>
            </div>
          )}

          {/* Phase 2 — Phase 1 完成后始终展示 */}
          {p1Node >= 3 && (
            <PhaseSection
              title="第二阶段：Agent诊断（LLM自主决策）"
              subtitle="假设-验证循环 → 7个诊断工具 → 根因定位"
              color="#f59e0b"
              nodes={PHASE2_NODES}
              activeNode={p2Node}
              done={phase === 'done'}
            />
          )}

          {/* Diagnostic tools */}
          {investigating && (
            <div className="bg-white rounded-xl border p-4">
              <h3 className="text-sm font-medium mb-3 flex items-center gap-2"><Search size={16} /> Agent 选择调用的诊断工具</h3>
              <div className="grid grid-cols-6 gap-2">
                {DIAG_TOOLS.map((t, i) => (
                  <div key={i} className="text-center p-2 rounded-lg animate-pulse" style={{ background: t.color + '15' }}>
                    <t.icon size={20} style={{ color: t.color }} className="mx-auto mb-1" />
                    <div className="text-xs text-gray-600">{t.label}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Results */}
          {phase === 'done' && result && (
            <div className="bg-white rounded-xl border p-6">
              <h3 className="font-bold text-lg mb-4 flex items-center gap-2">
                <Sparkles size={20} className="text-yellow-500" /> 分析结果
              </h3>
              <div className="grid grid-cols-4 gap-4 mb-4">
                <Stat label="偏离度" value={`${result.deviation_score}分`} color={result.severity_color} />
                <Stat label="严重级别" value={result.severity_level} color={result.severity_color} />
                <Stat label="贝叶斯P50" value={`¥${result.ai_prediction_mid ?? '?'}`} color="#6366f1" />
                <Stat label="阶段" value={result.phase === 'fast_pass' ? '快速通道' : result.phase} color="#10b981" />
              </div>

              {result.diagnosis_conclusion && (
                <div className="bg-purple-50 rounded-lg p-4 mb-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Brain size={16} className="text-purple-600" />
                    <span className="font-medium text-sm">AI 诊断结论</span>
                    <span className="text-xs text-purple-400">置信度 {(result.diagnosis_conclusion.confidence * 100).toFixed(0)}%</span>
                  </div>
                  <p className="text-sm text-gray-700">{result.diagnosis_conclusion.root_cause}</p>
                </div>
              )}

              {result.solutions && result.solutions.length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-sm font-medium">应对方案</h4>
                  {result.solutions.slice(0, 3).map((s, i) => (
                    <div key={i} className="flex items-center gap-3 p-2 rounded-lg bg-gray-50 text-sm">
                      <CheckCircle size={16} className="text-green-500 shrink-0" />
                      <span className="flex-1">{s.title}</span>
                      <span className="text-xs text-gray-400">{(s.confidence * 100).toFixed(0)}%</span>
                      <span className="text-xs text-gray-400">{s.estimated_savings}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* Architecture footer */}
      <div className="text-center text-xs text-gray-400 space-y-1">
        <p>层次贝叶斯价格预测 · TF-IDF 向量相似检索 · DuckDuckGo 联网行情 · Kimi K2.5 诊断推理</p>
        <p>偏离&lt;20 自动通过 · 20-60 标准诊断 · ≥60 紧急升级 · Human-in-the-Loop</p>
      </div>
    </div>
  )
}

function PhaseSection({ title, subtitle, color, nodes, activeNode, done }: {
  title: string; subtitle: string; color: string; nodes: any[]; activeNode: number; done: boolean
}) {
  return (
    <div className="bg-white rounded-xl border p-4">
      <h3 className="font-semibold text-sm mb-1" style={{ color }}>{title}</h3>
      <p className="text-xs text-gray-400 mb-4">{subtitle}</p>
      <div className="flex items-center gap-2">
        {nodes.map((node, i) => (
          <div key={node.id} className="flex items-center gap-2 flex-1">
            <div className={`flex-1 text-center p-3 rounded-lg border transition-all duration-300 ${
              done || i <= activeNode ? 'border-' : 'border-gray-100 opacity-30'
            }`} style={{ borderColor: done || i <= activeNode ? node.color : undefined }}>
              <node.icon size={20} style={{ color: node.color }} className="mx-auto mb-1" />
              <div className="text-xs font-medium">{node.label}</div>
              <div className="text-xs text-gray-400 mt-0.5">{node.desc}</div>
              {(done || i <= activeNode) && <CheckCircle size={14} className="mx-auto mt-1" style={{ color: node.color }} />}
            </div>
            {i < nodes.length - 1 && <ArrowRight size={14} className="text-gray-300 shrink-0" />}
          </div>
        ))}
      </div>
    </div>
  )
}

function Stat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="text-center">
      <div className="text-2xl font-bold" style={{ color }}>{value}</div>
      <div className="text-xs text-gray-400">{label}</div>
    </div>
  )
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)) }
