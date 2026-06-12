import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  CheckCircle2,
  ClipboardCheck,
  FileText,
  GitBranch,
  History,
  Loader2,
  PackageCheck,
  Play,
  RefreshCcw,
  Search,
  ShieldCheck,
  Sparkles,
  Target,
  UserCheck,
  XCircle,
} from 'lucide-react'
import {
  analyzeQuote,
  fetchMaterials,
  fetchQuotes,
  selectQuoteSolution,
  submitDecision,
} from '../utils/api'
import type { Material, Quote, QuoteInput, Solution, TraceStep } from '../types'

type FlowStage = 'intake' | 'analysis' | 'plan' | 'approval'

const categoryTemplates: Record<string, Partial<QuoteInput>> = {
  '塑料外壳': {
    material_name: 'ABS注塑外壳',
    material_type: 'ABS',
    dimensions: '80×60×15mm',
    processing: '注塑成型',
    precision: '±0.1mm',
    quantity: 50000,
  },
  'PCB板': {
    material_name: '主控PCB板',
    material_type: 'FR-4',
    dimensions: '60×40×1.6mm',
    processing: '双面板沉金',
    precision: '±0.05mm',
    quantity: 25000,
  },
  '传感器': {
    material_name: '压力传感器模组',
    material_type: 'MEMS',
    dimensions: '15×10×5mm',
    processing: 'SMT贴片',
    precision: '±0.01mm',
    quantity: 20000,
  },
  '袖带': {
    material_name: '血压计袖带',
    material_type: '尼龙+TPU',
    dimensions: '220×120×3mm',
    processing: '缝制+热压',
    precision: '±2mm',
    quantity: 35000,
  },
}

const defaultInput: QuoteInput = {
  material_id: 'MAT-FLOW-001',
  material_name: 'ABS注塑外壳',
  supplier_quote: 8.5,
  supplier_name: '新供应商A',
  quantity: 50000,
  quote_date: new Date().toISOString().slice(0, 10),
  category: '塑料外壳',
  material_type: 'ABS',
  dimensions: '80×60×15mm',
  processing: '注塑成型',
  precision: '±0.1mm',
  description: '血压计上盖，医疗器械外观件，含喷码与包装要求',
}

const suppliers = ['新供应商A', '华塑科技', '晶显电子', '电路通科技', '芯感科技', '医疗器械配件厂']

export default function ProcurementFlow() {
  const [input, setInput] = useState<QuoteInput>(defaultInput)
  const [quote, setQuote] = useState<Quote | null>(null)
  const [recentQuotes, setRecentQuotes] = useState<Quote[]>([])
  const [materials, setMaterials] = useState<Material[]>([])
  const [selectedSolution, setSelectedSolution] = useState<string>('')
  const [buyerNote, setBuyerNote] = useState('')
  const [decisionNote, setDecisionNote] = useState('')
  const [loading, setLoading] = useState(false)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [message, setMessage] = useState<{ tone: 'success' | 'error' | 'info'; text: string } | null>(null)

  useEffect(() => {
    Promise.all([fetchQuotes({ limit: 8 }), fetchMaterials({ limit: 20 })])
      .then(([quoteRes, materialRes]) => {
        setRecentQuotes(quoteRes.quotes || [])
        setMaterials(materialRes.materials || [])
      })
      .catch(console.error)
  }, [])

  useEffect(() => {
    if (!quote?.solutions?.length) {
      setSelectedSolution('')
      return
    }
    setSelectedSolution(quote.selected_solution_id || quote.solutions[0].id)
  }, [quote?.id, quote?.selected_solution_id])

  const currentStage = useMemo<FlowStage>(() => {
    if (!quote) return 'intake'
    if (quote.human_decision) return 'approval'
    if (quote.selected_solution_id || quote.phase === 'resolution') return 'approval'
    if (quote.solutions?.length) return 'plan'
    return 'analysis'
  }, [quote])

  const selectedSolutionData = quote?.solutions?.find(item => item.id === selectedSolution)
  const finalDecisionEnabled = quote?.phase === 'fast_pass' || !!quote?.selected_solution_id
  const priceGap = quote?.ai_prediction_high != null
    ? quote.supplier_quote - quote.ai_prediction_high
    : null
  const savingsFromP50 = quote?.ai_prediction_mid
    ? Math.max(0, (quote.supplier_quote - quote.ai_prediction_mid) * quote.quantity)
    : 0

  const applyCategory = (category: string) => {
    const template = categoryTemplates[category] || {}
    setInput(prev => ({
      ...prev,
      ...template,
      category,
      quote_date: new Date().toISOString().slice(0, 10),
    }))
  }

  const applyMaterial = (material: Material) => {
    setInput(prev => ({
      ...prev,
      material_id: material.id,
      material_name: material.name,
      category: material.category,
      material_type: material.material_type,
      dimensions: material.dimensions,
      processing: material.processing,
      precision: material.precision,
      supplier_name: material.supplier_name,
      quantity: material.order_quantity,
      supplier_quote: Number((material.unit_price * 1.18).toFixed(2)),
      description: material.description || prev.description,
    }))
  }

  const runAnalysis = async () => {
    setLoading(true)
    setMessage(null)
    try {
      const result = await analyzeQuote({
        ...input,
        supplier_quote: Number(input.supplier_quote),
        quantity: Number(input.quantity),
        material_id: input.material_id || `MAT-FLOW-${Date.now()}`,
        quote_date: input.quote_date || new Date().toISOString().slice(0, 10),
      })
      setQuote(result)
      setRecentQuotes(prev => [result, ...prev.filter(item => item.id !== result.id)].slice(0, 8))
      setMessage({ tone: 'success', text: 'AI 已完成报价体检，采购单进入方案评审。' })
    } catch (error: any) {
      setMessage({ tone: 'error', text: error.response?.data?.detail || error.message || '分析失败，请检查后端服务。' })
    } finally {
      setLoading(false)
    }
  }

  const adoptSolution = async () => {
    if (!quote || !selectedSolution) return
    setActionLoading('solution')
    setMessage(null)
    try {
      const updated = await selectQuoteSolution(quote.id, {
        selected_solution_id: selectedSolution,
        selected_by: '采购工程师',
        note: buyerNote,
      })
      setQuote(updated)
      setMessage({ tone: 'success', text: '已采纳执行方案，单据进入供应商跟进与最终审批。' })
    } catch (error: any) {
      setMessage({ tone: 'error', text: error.response?.data?.detail || error.message || '方案采纳失败。' })
    } finally {
      setActionLoading(null)
    }
  }

  const submitFinalDecision = async (decision: 'accept' | 'reject') => {
    if (!quote) return
    if (!finalDecisionEnabled) {
      setMessage({ tone: 'error', text: '请先采纳一个执行方案，再提交最终采购决策。' })
      return
    }

    setActionLoading(decision)
    setMessage(null)
    try {
      const updated = await submitDecision(quote.id, {
        decision,
        decision_by: '采购经理',
        selected_solution_id: quote.selected_solution_id || selectedSolution || undefined,
        override_reason: decisionNote || buyerNote || undefined,
      })
      setQuote(updated)
      setMessage({ tone: 'success', text: decision === 'accept' ? '已通过采购决策，审计记录已写入。' : '已驳回报价，建议继续议价或替换供应商。' })
    } catch (error: any) {
      setMessage({ tone: 'error', text: error.response?.data?.detail || error.message || '提交最终决策失败。' })
    } finally {
      setActionLoading(null)
    }
  }

  return (
    <div className="h-full overflow-auto bg-slate-50">
      <div className="mx-auto max-w-[1500px] px-4 py-5 lg:px-6 space-y-5">
        <header className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold text-indigo-600 mb-1">
              <PackageCheck size={15} />
              采购闭环工作台
            </div>
            <h1 className="text-2xl font-bold text-slate-950">从供应商报价到人工审批的一站式流程</h1>
            <p className="text-sm text-slate-500 mt-1">
              题目5用于异常协调与方案生成，题目11用于推理可视化、干预和审计留痕。
            </p>
          </div>
          <div className="flex gap-2">
            <Link to="/quotes" className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border bg-white text-sm text-slate-600 hover:bg-slate-100">
              <History size={15} /> 历史单据
            </Link>
            {quote && (
              <Link to={`/quotes/${quote.id}/trace`} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-indigo-200 bg-white text-sm text-indigo-700 hover:bg-indigo-50">
                <GitBranch size={15} /> 推理工作台
              </Link>
            )}
          </div>
        </header>

        <FlowProgress currentStage={currentStage} quote={quote} />

        {message && <Notice tone={message.tone} text={message.text} />}

        <div className="grid gap-5 xl:grid-cols-[360px_minmax(0,1fr)] 2xl:grid-cols-[360px_minmax(0,1fr)_380px]">
          <section className="space-y-4">
            <Panel title="1. 采购需求与报价录入" icon={<FileText size={16} />}>
              <div className="space-y-4">
                <div>
                  <label className="field-label">品类模板</label>
                  <div className="grid grid-cols-2 gap-2">
                    {Object.keys(categoryTemplates).map(category => (
                      <button
                        key={category}
                        type="button"
                        onClick={() => applyCategory(category)}
                        className={`px-3 py-2 rounded-lg border text-sm font-medium ${
                          input.category === category
                            ? 'border-indigo-300 bg-indigo-50 text-indigo-700'
                            : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                        }`}
                      >
                        {category}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <Field label="物料名称" value={input.material_name} onChange={value => setInput(prev => ({ ...prev, material_name: value }))} />
                  <Field label="供应商" value={input.supplier_name} onChange={value => setInput(prev => ({ ...prev, supplier_name: value }))} suggestions={suppliers} />
                  <Field label="供应商报价" type="number" value={input.supplier_quote} onChange={value => setInput(prev => ({ ...prev, supplier_quote: Number(value) }))} suffix="元" />
                  <Field label="采购数量" type="number" value={input.quantity} onChange={value => setInput(prev => ({ ...prev, quantity: Number(value) }))} suffix="件" />
                  <Field label="材料" value={input.material_type || ''} onChange={value => setInput(prev => ({ ...prev, material_type: value }))} />
                  <Field label="尺寸" value={input.dimensions || ''} onChange={value => setInput(prev => ({ ...prev, dimensions: value }))} />
                </div>

                <Field label="工艺" value={input.processing || ''} onChange={value => setInput(prev => ({ ...prev, processing: value }))} />
                <div>
                  <label className="field-label">采购备注</label>
                  <textarea
                    value={input.description}
                    onChange={event => setInput(prev => ({ ...prev, description: event.target.value }))}
                    rows={3}
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-indigo-400"
                  />
                </div>

                <button
                  type="button"
                  onClick={runAnalysis}
                  disabled={loading || !input.material_name || !input.supplier_name || !input.supplier_quote}
                  className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
                >
                  {loading ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} />}
                  发起AI采购体检
                </button>
              </div>
            </Panel>

            <Panel title="历史物料快速带入" icon={<Search size={16} />}>
              <div className="space-y-2 max-h-[250px] overflow-auto pr-1">
                {materials.slice(0, 8).map(material => (
                  <button
                    key={material.id}
                    type="button"
                    onClick={() => applyMaterial(material)}
                    className="w-full text-left rounded-lg border border-slate-200 bg-white px-3 py-2 hover:border-indigo-200 hover:bg-indigo-50"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium text-slate-800 truncate">{material.name}</span>
                      <span className="text-xs font-semibold text-slate-500">¥{material.unit_price}</span>
                    </div>
                    <div className="text-xs text-slate-400 truncate">{material.category} · {material.supplier_name}</div>
                  </button>
                ))}
              </div>
            </Panel>
          </section>

          <main className="space-y-4">
            <section className="grid grid-cols-2 gap-3 2xl:grid-cols-4">
              <Metric label="偏离度" value={quote ? `${scoreText(quote.deviation_score)}分` : '待分析'} tone={severityTone(quote?.severity_level)} icon={AlertTriangle} />
              <Metric label="AI合理区间" value={quote ? `¥${quote.ai_prediction_low ?? '?'} - ${quote.ai_prediction_high ?? '?'}` : '待生成'} tone="indigo" icon={Target} />
              <Metric label="潜在节省" value={quote ? `¥${(savingsFromP50 / 10000).toFixed(1)}万` : '待估算'} tone="emerald" icon={ShieldCheck} />
              <Metric label="当前状态" value={quote ? statusText(quote) : '录入中'} tone={quote?.human_decision ? 'emerald' : 'amber'} icon={ClipboardCheck} />
            </section>

            <Panel title="2. AI异常协调结果" icon={<Sparkles size={16} />}>
              {!quote ? (
                <EmptyState
                  title="等待报价进入AI体检"
                  text="提交后会自动完成相似物料检索、价格区间预测、成本拆解、偏离打分和方案生成。"
                />
              ) : (
                <div className="grid gap-4 2xl:grid-cols-[minmax(0,1fr)_260px]">
                  <div className="space-y-4">
                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-sm font-semibold text-slate-900">{quote.material_name}</div>
                          <p className="text-sm text-slate-500 mt-1">
                            {quote.supplier_name} 报价 ¥{quote.supplier_quote}，采购 {quote.quantity} 件。
                            {priceGap != null && priceGap > 0 ? ` 高于AI上限 ¥${priceGap.toFixed(2)}。` : ' 当前报价未超过AI上限。'}
                          </p>
                        </div>
                        <span className={`shrink-0 rounded-lg px-2.5 py-1 text-xs font-bold ${badgeClass(quote.severity_level)}`}>
                          {quote.severity_level}
                        </span>
                      </div>
                    </div>

                    <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-3">
                      <EvidenceCard title="相似物料" value={`${quote.similar_materials?.length || 0}条`} detail={quote.similar_materials?.[0]?.name || '暂无对标'} />
                      <EvidenceCard title="成本结构" value={`${quote.cost_breakdown?.anomaly_count ?? 0}项异常`} detail={quote.cost_breakdown?.note || '参考行业基准'} />
                      <EvidenceCard title="外部市场" value={quote.rag_info?.available ? '已校准' : '未命中'} detail={quote.rag_info?.source || quote.market_context?.source || '内部数据优先'} />
                      <EvidenceCard
                        title="供应风险/库存"
                        value={`${quote.supplier_profile?.risk_level || '待评估'} · ${quote.inventory_context?.urgency || '未知'}`}
                        detail={quote.inventory_context?.suggestion || quote.supplier_profile?.recommended_procurement_mode || '待补充库存与供应商上下文'}
                      />
                    </div>

                    {quote.diagnosis_conclusion && (
                      <div className="rounded-lg border border-blue-100 bg-blue-50 p-4">
                        <div className="flex items-center gap-2 text-sm font-semibold text-blue-800 mb-2">
                          <BarChart3 size={15} /> 诊断结论
                        </div>
                        <p className="text-sm leading-6 text-blue-950">{quote.diagnosis_conclusion.root_cause}</p>
                        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-blue-700">
                          <span>置信度 {(quote.diagnosis_conclusion.confidence * 100).toFixed(0)}%</span>
                          <span className="rounded-full bg-white/80 px-2 py-0.5 font-semibold text-blue-800">
                            {formatCauseCategory(quote.diagnosis_conclusion.cause_category)}
                          </span>
                        </div>
                      </div>
                    )}
                  </div>

                  <TracePreview trace={quote.execution_trace || []} quoteId={quote.id} />
                </div>
              )}
            </Panel>

            <Panel title="3. 方案选择与供应商跟进" icon={<UserCheck size={16} />}>
              {!quote ? (
                <EmptyState title="暂无候选方案" text="AI分析完成后，这里会出现议价、二次询价、升级审批或直接通过方案。" />
              ) : (
                <div className="grid gap-4 2xl:grid-cols-[minmax(0,1fr)_280px]">
                  <div className="space-y-3">
                    {(quote.solutions || []).map(solution => (
                      <SolutionOption
                        key={solution.id}
                        solution={solution}
                        quote={quote}
                        active={selectedSolution === solution.id}
                        committed={quote.selected_solution_id === solution.id}
                        onSelect={() => setSelectedSolution(solution.id)}
                      />
                    ))}
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 space-y-3">
                    <div>
                      <label className="field-label">采购人员备注</label>
                      <textarea
                        value={buyerNote}
                        onChange={event => setBuyerNote(event.target.value)}
                        rows={5}
                        placeholder="例如：优先按AI建议目标价议价，同时补充二供询价。"
                        className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-indigo-400"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={adoptSolution}
                      disabled={!quote.solutions?.length || !selectedSolution || !!quote.selected_solution_id || actionLoading === 'solution'}
                      className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
                    >
                      {actionLoading === 'solution' ? <Loader2 size={16} className="animate-spin" /> : <ArrowRight size={16} />}
                      {quote.selected_solution_id ? '方案已采纳' : '采纳方案并进入跟进'}
                    </button>
                    {selectedSolutionData && (
                      <div className="text-xs leading-5 text-slate-500">
                        当前选择：{selectedSolutionData.title}。采纳后会写入 Agent 跟进轨迹，供最终审批引用。
                      </div>
                    )}
                  </div>
                </div>
              )}
            </Panel>
          </main>

          <aside className="space-y-4 xl:col-span-2 2xl:col-span-1">
            <Panel title="4. 最终采购决策" icon={<ClipboardCheck size={16} />}>
              {!quote ? (
                <EmptyState title="等待单据" text="先发起AI体检，之后可以在这里完成通过或驳回。" />
              ) : (
                <div className="space-y-4">
                  <div className="rounded-lg border border-slate-200 bg-white p-3">
                    <div className="text-xs text-slate-400 mb-1">审批前置条件</div>
                    <ChecklistItem done={quote.phase === 'fast_pass' || quote.deviation_score < 20} text="低风险可走快速通道" />
                    <ChecklistItem done={!!quote.diagnosis_conclusion || quote.phase === 'fast_pass'} text="已形成AI诊断证据" />
                    <ChecklistItem done={!!quote.selected_solution_id || quote.phase === 'fast_pass'} text="已选择执行方案" />
                    <ChecklistItem done={!!quote.execution_trace?.length} text="推理与人工动作可审计" />
                  </div>

                  <div>
                    <label className="field-label">审批意见</label>
                    <textarea
                      value={decisionNote}
                      onChange={event => setDecisionNote(event.target.value)}
                      rows={4}
                      placeholder="记录最终通过、驳回或价格Override依据。"
                      className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-indigo-400"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => submitFinalDecision('reject')}
                      disabled={!finalDecisionEnabled || !!quote.human_decision || actionLoading === 'reject'}
                      className="inline-flex items-center justify-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm font-semibold text-red-700 hover:bg-red-100 disabled:opacity-50"
                    >
                      {actionLoading === 'reject' ? <Loader2 size={15} className="animate-spin" /> : <XCircle size={15} />}
                      驳回
                    </button>
                    <button
                      type="button"
                      onClick={() => submitFinalDecision('accept')}
                      disabled={!finalDecisionEnabled || !!quote.human_decision || actionLoading === 'accept'}
                      className="inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-600 px-3 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                    >
                      {actionLoading === 'accept' ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle2 size={15} />}
                      通过
                    </button>
                  </div>

                  {quote.human_decision && (
                    <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
                      已提交最终决策：{quote.human_decision === 'accept' ? '通过' : '驳回'}。
                    </div>
                  )}

                  <div className="flex gap-2">
                    <Link to={`/quotes/${quote.id}`} className="flex-1 text-center rounded-lg border bg-white px-3 py-2 text-sm text-slate-600 hover:bg-slate-50">
                      详情
                    </Link>
                    <Link to={`/quotes/${quote.id}/trace`} className="flex-1 text-center rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-sm text-indigo-700 hover:bg-indigo-100">
                      调试
                    </Link>
                  </div>
                </div>
              )}
            </Panel>

            <Panel title="待办采购单" icon={<RefreshCcw size={16} />}>
              <div className="space-y-2 max-h-[360px] overflow-auto pr-1">
                {recentQuotes.map(item => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setQuote(item)
                      setMessage({ tone: 'info', text: `已载入 ${item.material_name}，可继续方案处理或审批。` })
                    }}
                    className={`w-full text-left rounded-lg border px-3 py-2 hover:bg-slate-50 ${
                      quote?.id === item.id ? 'border-indigo-300 bg-indigo-50' : 'border-slate-200 bg-white'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-semibold text-slate-800 truncate">{item.material_name}</span>
                      <span className={`rounded px-1.5 py-0.5 text-[11px] font-bold ${badgeClass(item.severity_level)}`}>{item.severity_level}</span>
                    </div>
                    <div className="text-xs text-slate-400 truncate">{item.supplier_name} · ¥{item.supplier_quote} · {statusText(item)}</div>
                  </button>
                ))}
              </div>
            </Panel>
          </aside>
        </div>
      </div>
    </div>
  )
}

function FlowProgress({ currentStage, quote }: { currentStage: FlowStage; quote: Quote | null }) {
  const steps: { key: FlowStage; label: string; icon: typeof FileText }[] = [
    { key: 'intake', label: '报价录入', icon: FileText },
    { key: 'analysis', label: 'AI体检', icon: Sparkles },
    { key: 'plan', label: '方案协调', icon: UserCheck },
    { key: 'approval', label: '采购审批', icon: ClipboardCheck },
  ]
  const currentIndex = steps.findIndex(step => step.key === currentStage)

  return (
    <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
      {steps.map((step, index) => {
        const Icon = step.icon
        const done = quote ? index < currentIndex || !!quote.human_decision : index === 0
        const active = step.key === currentStage
        return (
          <div
            key={step.key}
            className={`rounded-lg border px-4 py-3 ${
              active ? 'border-indigo-300 bg-indigo-50' : done ? 'border-emerald-200 bg-emerald-50' : 'border-slate-200 bg-white'
            }`}
          >
            <div className="flex items-center gap-2">
              <Icon size={16} className={active ? 'text-indigo-700' : done ? 'text-emerald-700' : 'text-slate-400'} />
              <span className={`text-sm font-semibold ${active ? 'text-indigo-900' : done ? 'text-emerald-900' : 'text-slate-500'}`}>{step.label}</span>
            </div>
            <div className="mt-1 text-xs text-slate-500">{active ? '当前步骤' : done ? '已完成' : '待处理'}</div>
          </div>
        )
      })}
    </div>
  )
}

function Panel({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-3">
        <span className="text-indigo-600">{icon}</span>
        <h2 className="text-sm font-bold text-slate-900">{title}</h2>
      </div>
      <div className="p-4">{children}</div>
    </section>
  )
}

function Field({
  label,
  value,
  onChange,
  type = 'text',
  suffix,
  suggestions,
}: {
  label: string
  value: string | number
  onChange: (value: string) => void
  type?: string
  suffix?: string
  suggestions?: string[]
}) {
  return (
    <div>
      <label className="field-label">{label}</label>
      <div className="relative">
        <input
          type={type}
          value={value}
          onChange={event => onChange(event.target.value)}
          list={suggestions ? `${label}-list` : undefined}
          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-indigo-400"
        />
        {suffix && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400">{suffix}</span>}
      </div>
      {suggestions && (
        <datalist id={`${label}-list`}>
          {suggestions.map(item => <option key={item} value={item} />)}
        </datalist>
      )}
    </div>
  )
}

function Metric({ label, value, tone, icon: Icon }: { label: string; value: string; tone: string; icon: typeof AlertTriangle }) {
  const toneClass: Record<string, string> = {
    red: 'bg-red-50 border-red-200 text-red-700',
    amber: 'bg-amber-50 border-amber-200 text-amber-700',
    emerald: 'bg-emerald-50 border-emerald-200 text-emerald-700',
    indigo: 'bg-indigo-50 border-indigo-200 text-indigo-700',
    slate: 'bg-slate-50 border-slate-200 text-slate-700',
  }
  return (
    <div className={`rounded-lg border p-4 ${toneClass[tone] || toneClass.slate}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium opacity-80">{label}</span>
        <Icon size={15} />
      </div>
      <div className="mt-2 text-lg font-bold truncate">{value}</div>
    </div>
  )
}

function EvidenceCard({ title, value, detail }: { title: string; value: string; detail: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <div className="text-xs text-slate-400">{title}</div>
      <div className="mt-1 text-sm font-bold text-slate-900">{value}</div>
      <div className="mt-1 text-xs text-slate-500 leading-5">{detail}</div>
    </div>
  )
}

function TracePreview({ trace, quoteId }: { trace: TraceStep[]; quoteId: string }) {
  const visibleTrace = trace.slice(0, 6)
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <div className="flex items-center justify-between mb-3">
        <div className="text-sm font-semibold text-slate-800">可解释轨迹</div>
        <Link to={`/quotes/${quoteId}/trace`} className="text-xs font-medium text-indigo-600 hover:text-indigo-800">展开</Link>
      </div>
      <div className="space-y-2">
        {visibleTrace.map((step, index) => (
          <div key={`${step.step}-${index}`} className="flex gap-2">
            <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-indigo-500" />
            <div className="min-w-0">
              <div className="text-xs font-semibold text-slate-700 truncate">{step.step}</div>
              <div className="text-[11px] text-slate-400 truncate">{step.output || step.conclusion_from_step || '已完成'}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function SolutionOption({
  solution,
  active,
  committed,
  quote,
  onSelect,
}: {
  solution: Solution
  active: boolean
  committed: boolean
  quote?: Quote | null
  onSelect: () => void
}) {
  const signals = buildSolutionSignals(solution, quote || null)
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full text-left rounded-lg border p-4 ${
        committed
          ? 'border-emerald-300 bg-emerald-50'
          : active
          ? 'border-indigo-300 bg-indigo-50'
          : 'border-slate-200 bg-white hover:border-indigo-200 hover:bg-slate-50'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-bold text-slate-900">{solution.title}</div>
          <p className="mt-1 text-sm leading-6 text-slate-600">{solution.description}</p>
        </div>
        <span className="shrink-0 rounded bg-white px-2 py-1 text-xs font-semibold text-slate-600">
          {(solution.confidence * 100).toFixed(0)}%
        </span>
      </div>
      <div className="mt-2 flex items-center justify-between text-xs text-slate-500">
        <span>{formatSolutionAction(solution.action)}</span>
        <span>{solution.estimated_savings || '节省待估算'}</span>
      </div>
      {signals.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {signals.map(signal => (
            <span key={signal} className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">
              {signal}
            </span>
          ))}
        </div>
      )}
    </button>
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

function buildSolutionSignals(solution: Solution, quote: Quote | null) {
  if (!quote) return []
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

function ChecklistItem({ done, text }: { done: boolean; text: string }) {
  return (
    <div className="flex items-center gap-2 py-1 text-sm">
      {done ? <CheckCircle2 size={15} className="text-emerald-600" /> : <AlertTriangle size={15} className="text-amber-500" />}
      <span className={done ? 'text-slate-700' : 'text-slate-500'}>{text}</span>
    </div>
  )
}

function Notice({ tone, text }: { tone: 'success' | 'error' | 'info'; text: string }) {
  const className = tone === 'success'
    ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
    : tone === 'error'
    ? 'border-red-200 bg-red-50 text-red-800'
    : 'border-blue-200 bg-blue-50 text-blue-800'
  return <div className={`rounded-lg border px-4 py-3 text-sm ${className}`}>{text}</div>
}

function EmptyState({ title, text }: { title: string; text: string }) {
  return (
    <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center">
      <div className="text-sm font-semibold text-slate-700">{title}</div>
      <p className="mx-auto mt-1 max-w-md text-sm text-slate-500">{text}</p>
    </div>
  )
}

function severityTone(severity?: string) {
  if (severity === '紧急') return 'red'
  if (severity === '警示' || severity === '关注') return 'amber'
  if (severity === '正常') return 'emerald'
  return 'slate'
}

function badgeClass(severity?: string) {
  if (severity === '紧急') return 'bg-red-100 text-red-700'
  if (severity === '警示') return 'bg-orange-100 text-orange-700'
  if (severity === '关注') return 'bg-amber-100 text-amber-700'
  return 'bg-emerald-100 text-emerald-700'
}

function scoreText(score?: number) {
  if (score == null) return '-'
  return Number(score).toFixed(Number.isInteger(score) ? 0 : 1)
}

function statusText(quote: Quote) {
  if (quote.human_decision === 'accept') return '已通过'
  if (quote.human_decision === 'reject') return '已驳回'
  if (quote.phase === 'resolution') return '跟进中'
  if (quote.phase === 'fast_pass') return '快速通过'
  if (quote.status === 'pending') return '待人工处理'
  return quote.status || '待处理'
}
