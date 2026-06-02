import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Brain, Database, Search, TrendingDown, Lightbulb,
  RotateCcw, CheckCircle, Sparkles,
  ArrowRight, BarChart3, GitBranch, Shield, User, Globe,
  Wrench, Clock, Activity,
} from 'lucide-react'
import { analyzeQuote } from '../utils/api'
import ScenarioSelector from '../components/ScenarioSelector'
import ExecutionDAG from '../components/ExecutionDAG'
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

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)) }

export default function Demo() {
  const navigate = useNavigate()
  const [phase, setPhase] = useState<'intro' | 'running' | 'done'>('intro')
  const [selectedScenario, setSelectedScenario] = useState<any>(null)
  const [p1Node, setP1Node] = useState(-1)
  const [p2Node, setP2Node] = useState(-1)
  const [investigating, setInvestigating] = useState(false)
  const [result, setResult] = useState<Quote | null>(null)

  const startScenario = async (scenario: any) => {
    setSelectedScenario(scenario)
    setPhase('running')
    setP1Node(-1); setP2Node(-1); setInvestigating(false)

    // Phase 1
    for (let i = 0; i < PHASE1_NODES.length; i++) {
      await sleep(600); setP1Node(i)
    }

    // Fire API
    const apiPromise = analyzeQuote({
      material_id: scenario.quote.material_name,
      material_name: scenario.quote.material_name,
      supplier_quote: scenario.quote.supplier_quote,
      supplier_name: scenario.quote.supplier_name,
      quantity: scenario.quote.quantity,
      quote_date: new Date().toISOString().split('T')[0],
      category: scenario.quote.category,
      material_type: scenario.quote.category,
      dimensions: '80×60×15mm',
      processing: '注塑成型',
      precision: '±0.1mm',
      description: '',
    }).catch(() => null)

    // Phase 2 animation
    for (let i = 0; i < PHASE2_NODES.length; i++) {
      await sleep(i === 1 ? 1000 : 600)
      setP2Node(i)
      if (i === 1) { setInvestigating(true); await sleep(1000); setInvestigating(false) }
    }

    const quoteResult = await apiPromise
    setResult(quoteResult)
    setPhase('done')
  }

  const reset = () => { setPhase('intro'); setP1Node(-1); setP2Node(-1); setResult(null); setSelectedScenario(null) }

  return (
    <div className="h-full overflow-auto bg-gray-50">
      <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">
        {/* Hero */}
        <div className="text-center py-4">
          <h1 className="text-2xl font-bold bg-gradient-to-r from-indigo-600 to-purple-600 bg-clip-text text-transparent mb-2">
            供销计划异常协调 Agent
          </h1>
          <p className="text-sm text-gray-500">
            两阶段+三条路径架构 · 层次贝叶斯价格预测 · AI自主诊断 · 调试工作台
          </p>
        </div>

        {/* Scenario Selector or Results */}
        {phase === 'intro' ? (
          <div className="bg-white rounded-2xl border shadow-sm p-6">
            <div className="mb-5">
              <h2 className="text-lg font-bold text-gray-900 mb-1">选择调试场景</h2>
              <p className="text-sm text-gray-500">点击任意场景，演示 Agent 的完整推理链路和调试功能</p>
            </div>
            <ScenarioSelector onSelectScenario={startScenario} />
          </div>
        ) : (
          <>
            {/* Scenario banner */}
            {selectedScenario && (
              <div className="bg-white rounded-2xl border shadow-sm px-5 py-3 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div
                    className="w-8 h-8 rounded-lg flex items-center justify-center"
                    style={{ background: selectedScenario.color + '20' }}
                  >
                    <selectedScenario.icon size={16} style={{ color: selectedScenario.color }} />
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-gray-900">{selectedScenario.title}</div>
                    <div className="text-xs text-gray-400">{selectedScenario.demo_note}</div>
                  </div>
                </div>
                <button onClick={reset}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors">
                  <RotateCcw size={12} /> 重新选择
                </button>
              </div>
            )}

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
                    ? 'bg-emerald-100 text-emerald-700 border border-emerald-200'
                    : 'bg-amber-100 text-amber-700 border border-amber-200'
                }`}>
                  {result?.phase === 'fast_pass'
                    ? `↳ 偏离度 ${result?.deviation_score}分 → 快速通道（自动通过）`
                    : `↳ 偏离度 ${result?.deviation_score ?? selectedScenario?.quote?.deviation_score}分 → 进入Agent诊断`
                  }
                </div>
              </div>
            )}

            {/* Phase 2 */}
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
              <div className="bg-white rounded-2xl border shadow-sm p-4">
                <h3 className="text-sm font-medium mb-3 flex items-center gap-2">
                  <Search size={14} className="text-cyan-500" />
                  Agent 正在调用诊断工具
                </h3>
                <div className="grid grid-cols-6 gap-2">
                  {DIAG_TOOLS.map((t, i) => (
                    <div key={i} className="text-center p-2 rounded-xl animate-pulse" style={{ background: t.color + '15' }}>
                      <t.icon size={20} style={{ color: t.color }} className="mx-auto mb-1" />
                      <div className="text-xs text-gray-600">{t.label}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* DAG preview */}
            {phase === 'done' && result && (
              <div className="bg-white rounded-2xl border shadow-sm overflow-hidden">
                <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <GitBranch size={14} className="text-indigo-500" />
                    <h3 className="text-sm font-semibold text-gray-700">执行链路 DAG</h3>
                  </div>
                  <button
                    onClick={() => navigate(`/quotes/${result.id}/trace`)}
                    className="text-xs text-indigo-600 hover:text-indigo-700 font-medium flex items-center gap-1">
                    全屏调试工作台 <ArrowRight size={12} />
                  </button>
                </div>
                <ExecutionDAG
                  trace={result.execution_trace || []}
                  height={320}
                  showControls
                />
              </div>
            )}

            {/* Results */}
            {phase === 'done' && result && (
              <div className="bg-white rounded-2xl border shadow-sm p-6">
                <h3 className="font-bold text-base mb-4 flex items-center gap-2">
                  <Sparkles size={16} className="text-yellow-500" />
                  分析结果
                </h3>
                <div className="grid grid-cols-4 gap-4 mb-4">
                  <div className="text-center">
                    <div className="text-2xl font-bold" style={{ color: result.severity_color }}>
                      {result.deviation_score}分
                    </div>
                    <div className="text-xs text-gray-400">偏离度</div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold text-gray-700">{result.severity_level}</div>
                    <div className="text-xs text-gray-400">严重级别</div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold text-indigo-600">
                      ¥{result.ai_prediction_mid ?? '?'}
                    </div>
                    <div className="text-xs text-gray-400">贝叶斯P50</div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold text-emerald-600">
                      {result.phase === 'fast_pass' ? '快速通道' : result.phase}
                    </div>
                    <div className="text-xs text-gray-400">处理阶段</div>
                  </div>
                </div>

                {result.diagnosis_conclusion && (
                  <div className="bg-purple-50 rounded-xl p-4 mb-4 border border-purple-100">
                    <div className="flex items-center gap-2 mb-2">
                      <Brain size={14} className="text-purple-600" />
                      <span className="font-semibold text-sm text-purple-700">AI 诊断结论</span>
                      <span className="text-xs text-purple-400">置信度 {(result.diagnosis_conclusion.confidence * 100).toFixed(0)}%</span>
                    </div>
                    <p className="text-sm text-gray-700">{result.diagnosis_conclusion.root_cause}</p>
                  </div>
                )}

                {result.solutions?.length > 0 && (
                  <div className="space-y-2">
                    <h4 className="text-sm font-semibold text-gray-700">应对方案</h4>
                    {result.solutions.slice(0, 3).map((s, i) => (
                      <div key={i} className="flex items-center gap-3 p-2.5 rounded-xl bg-gray-50 text-sm">
                        <CheckCircle size={14} className="text-emerald-500 shrink-0" />
                        <span className="flex-1">{s.title}</span>
                        <span className="text-xs text-gray-400">{(s.confidence * 100).toFixed(0)}%</span>
                        <span className="text-xs text-gray-400">{s.estimated_savings}</span>
                      </div>
                    ))}
                  </div>
                )}

                <div className="flex gap-2 mt-4 pt-4 border-t border-gray-100">
                  <button onClick={reset}
                    className="flex items-center gap-1.5 px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium hover:bg-gray-50 transition-colors">
                    <RotateCcw size={14} /> 重新演示
                  </button>
                  {result.id && (
                    <button onClick={() => navigate(`/quotes/${result.id}/trace`)}
                      className="flex items-center gap-1.5 px-4 py-2 border border-indigo-200 text-indigo-600 rounded-lg text-sm font-medium hover:bg-indigo-50 transition-colors">
                      <GitBranch size={14} /> 查看完整调试工作台
                    </button>
                  )}
                  <button onClick={() => navigate('/quotes/new')}
                    className="flex items-center gap-1.5 px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium hover:bg-gray-50 transition-colors">
                    体验完整系统 <ArrowRight size={14} />
                  </button>
                </div>
              </div>
            )}
          </>
        )}

        {/* Footer */}
        <div className="text-center text-xs text-gray-400 space-y-1 pb-4">
          <p>层次贝叶斯价格预测 · TF-IDF 向量相似检索 · DuckDuckGo 联网行情 · Kimi K2.5 诊断推理</p>
          <p>偏离&lt;20 自动通过 · 20-60 标准诊断 · ≥60 紧急升级 · Human-in-the-Loop</p>
        </div>
      </div>
    </div>
  )
}

function PhaseSection({ title, subtitle, color, nodes, activeNode, done }: {
  title: string; subtitle: string; color: string; nodes: any[]; activeNode: number; done: boolean
}) {
  return (
    <div className="bg-white rounded-2xl border shadow-sm p-4">
      <div className="mb-3">
        <h3 className="text-sm font-semibold" style={{ color }}>{title}</h3>
        <p className="text-xs text-gray-400">{subtitle}</p>
      </div>
      <div className="flex items-center gap-2">
        {nodes.map((node, i) => (
          <div key={node.id} className="flex items-center gap-2 flex-1">
            <div
              className="flex-1 text-center p-3 rounded-xl border-2 transition-all duration-300"
              style={{
                borderColor: done || i <= activeNode ? node.color : undefined,
                background: done || i <= activeNode ? node.color + '12' : '#f9fafb',
                opacity: done || i <= activeNode ? 1 : 0.35,
              }}
            >
              <node.icon size={20} style={{ color: node.color }} className="mx-auto mb-1" />
              <div className="text-xs font-medium">{node.label}</div>
              <div className="text-[10px] text-gray-400 mt-0.5 hidden sm:block">{node.desc}</div>
              {(done || i <= activeNode) && (
                <CheckCircle size={14} className="mx-auto mt-1" style={{ color: node.color }} />
              )}
            </div>
            {i < nodes.length - 1 && (
              <ArrowRight size={12} className="text-gray-300 shrink-0" />
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
