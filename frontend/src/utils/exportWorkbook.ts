import * as XLSX from 'xlsx'
import type { Quote, Solution } from '../types'

export type ExportVariant = 'detail' | 'trace'

export const ACTION_LABELS: Record<string, string> = {
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

export const CAUSE_CATEGORY_LABELS: Record<string, string> = {
  normal: '报价正常',
  supplier_premium: '供应商溢价',
  market_trend: '市场行情驱动',
  cost_structure_anomaly: '成本结构异常',
  insufficient_data: '数据不足',
  unknown_anomaly: '待人工确认',
}

export const STATUS_LABELS: Record<string, string> = {
  pending: '待处理',
  approved: '已通过',
  accepted: '已通过',
  rejected: '已驳回',
  resolved: '已处理',
  accept: '通过',
  reject: '驳回',
}

export const PHASE_LABELS: Record<string, string> = {
  baseline: '基线分析',
  diagnosis: '诊断阶段',
  resolution: '方案执行',
  fast_pass: '快速通道',
}

export const TOOL_LABELS: Record<string, string> = {
  tool_get_supplier_profile: '供应商历史',
  tool_compare_peer_price: '同行价格对比',
  tool_check_market_trend: '市场行情分析',
  tool_search_market_price: '实时市场价格',
  tool_check_urgency: '库存紧急度',
  tool_search_alternatives: '替代供应商',
  tool_analyze_cost_anomaly: '成本异常分析',
  tool_generate_solutions: '方案生成',
  tool_predict_price_range: '价格预测',
  tool_analyze_cost_structure: '成本拆解',
  tool_match_similar_material: '历史对比',
  tool_score_deviation: '异常评分',
}

export function exportQuoteWorkbook(quote: Quote, variant: ExportVariant = 'detail') {
  const workbook = XLSX.utils.book_new()
  const sheetEntries: Array<[string, XLSX.WorkSheet]> =
    variant === 'trace'
      ? [
          ['概览', buildOverviewSheet(quote, variant)],
          ['诊断过程', buildDiagnosisSheet(quote)],
          ['决策日志', buildDecisionSheet(quote)],
          ['执行轨迹', buildTraceSheet(quote)],
          ['上下文', buildContextSheet(quote)],
          ['成本拆解', buildCostSheet(quote)],
          ['方案建议', buildSolutionsSheet(quote)],
        ]
      : [
          ['概览', buildOverviewSheet(quote, variant)],
          ['上下文', buildContextSheet(quote)],
          ['成本拆解', buildCostSheet(quote)],
          ['方案建议', buildSolutionsSheet(quote)],
          ['诊断过程', buildDiagnosisSheet(quote)],
          ['决策日志', buildDecisionSheet(quote)],
          ['执行轨迹', buildTraceSheet(quote)],
        ]

  sheetEntries.forEach(([name, sheet]) => XLSX.utils.book_append_sheet(workbook, sheet, name))

  const prefix = variant === 'trace' ? '溯源报告' : '报价诊断报告'
  const fileName = `${prefix}-${sanitizeFileName(quote.material_name || '未知物料')}-${quote.id.slice(0, 8)}.xlsx`
  XLSX.writeFile(workbook, fileName)
}

function buildOverviewSheet(quote: Quote, variant: ExportVariant) {
  const selectedSolution = quote.solutions?.find(solution => solution.id === quote.selected_solution_id)
  const rows: any[][] = [
    [variant === 'trace' ? '报价异常溯源报告' : '报价诊断导出报告'],
    ['导出时间', formatDateTime(new Date().toISOString()), '报价ID', quote.id],
    [],
    ['基础信息'],
    ['物料名称', quote.material_name, '供应商', quote.supplier_name],
    ['报价金额', formatCurrency(quote.supplier_quote), '采购数量', formatNumber(quote.quantity)],
    ['报价日期', formatDateTime(quote.quote_date), '创建时间', formatDateTime(quote.created_at)],
    ['物料类别', quote.category || '-', '物料类型', quote.material_type || '-'],
    ['工艺', quote.processing || '-', '精度', quote.precision || '-'],
    ['尺寸', quote.dimensions || '-', '状态', formatStatus(quote.status)],
    ['当前阶段', formatPhase(quote.phase), '严重级别', quote.severity_level || '-'],
    ['人工决策', formatStatus(quote.human_decision), '决策人', quote.decision_by || '-'],
    ['决策时间', formatDateTime(quote.decision_at), '已选方案', selectedSolution?.title || '-'],
    [],
    ['偏离度概览'],
    ['综合偏离分', formatScore(quote.deviation_score), '综合评分', formatScore(quote.composite_score)],
    ['价格偏离', formatPercent(quote.price_deviation), '成本偏离', formatPercent(quote.cost_deviation)],
    ['市场偏离', formatPercent(quote.market_deviation), '外部偏离', formatPercent(quote.external_deviation)],
    ['权重 alpha/beta/gamma', quote.weights ? `${quote.weights.alpha}/${quote.weights.beta}/${quote.weights.gamma}` : '-', '中断级别', quote.interrupt_severity || '-'],
    ['中断原因', quote.interrupt_reason || '-', '', ''],
    [],
    ['预测与参考'],
    ['AI 预测区间', formatRange(quote.ai_prediction_low, quote.ai_prediction_high), 'AI 中位价', formatCurrency(quote.ai_prediction_mid)],
    ['RAG 参考区间', quote.rag_info?.available ? formatRange(quote.rag_info.ref_low, quote.rag_info.ref_high) : '-', 'RAG 来源', quote.rag_info?.source || '-'],
  ]

  if (quote.diagnosis_conclusion) {
    rows.push([])
    rows.push(['诊断结论'])
    rows.push(['根因类别', formatCauseCategory(quote.diagnosis_conclusion.cause_category), '结论置信度', formatConfidence(quote.diagnosis_conclusion.confidence)])
    rows.push(['根因说明', quote.diagnosis_conclusion.root_cause || '-', '', ''])
    if (quote.diagnosis_conclusion.llm_summary) {
      rows.push(['LLM 摘要', stripMarkdown(quote.diagnosis_conclusion.llm_summary), '', ''])
    }
  }

  if (quote.llm_summary) {
    rows.push([])
    rows.push(['整单摘要'])
    rows.push([stripMarkdown(quote.llm_summary)])
  }

  return createSheet(rows, [24, 34, 18, 34])
}

function buildContextSheet(quote: Quote) {
  const rows: any[][] = [
    ['业务上下文'],
    [],
    ['供应商画像'],
  ]

  if (quote.supplier_profile?.available) {
    rows.push(['供应商名称', quote.supplier_profile.supplier_name || '-', '风险等级', quote.supplier_profile.risk_level || '-'])
    rows.push(['采购次数', formatNumber(quote.supplier_profile.purchase_count), '分析报价数', formatNumber(quote.supplier_profile.analyzed_quotes)])
    rows.push(['平均单价', formatCurrency(quote.supplier_profile.avg_unit_price), '价格波动', formatPercent(quote.supplier_profile.price_volatility_pct)])
    rows.push(['平均偏离分', formatScore(quote.supplier_profile.avg_deviation_score), '近期待偏离', formatScore(quote.supplier_profile.recent_avg_deviation)])
    rows.push(['异常次数', formatNumber(quote.supplier_profile.anomaly_count), '异常率', formatPercent(quote.supplier_profile.anomaly_rate_pct)])
    rows.push(['价格趋势', quote.supplier_profile.price_trend || '-', '偏离趋势', quote.supplier_profile.deviation_trend || '-'])
    rows.push(['定价行为', quote.supplier_profile.pricing_behavior || '-', '建议采购方式', quote.supplier_profile.recommended_procurement_mode || '-'])
    rows.push(['风险说明', quote.supplier_profile.risk_assessment || quote.supplier_profile.deviation_summary || '-', '', ''])
    rows.push(['首单时间', formatDateTime(quote.supplier_profile.first_order), '最近采购', formatDateTime(quote.supplier_profile.last_order)])
  } else {
    rows.push(['暂无供应商画像数据'])
  }

  rows.push([])
  rows.push(['库存约束'])
  if (quote.inventory_context?.available) {
    rows.push(['当前库存', formatNumber(quote.inventory_context.current_stock), '安全库存', formatNumber(quote.inventory_context.safety_stock)])
    rows.push(['日耗量', formatNumber(quote.inventory_context.daily_consumption), '可支撑天数', quote.inventory_context.days_remaining != null ? `${quote.inventory_context.days_remaining}天` : '-'])
    rows.push(['紧急度', quote.inventory_context.urgency || '-', '可否议价', formatBoolean(quote.inventory_context.can_negotiate)])
    rows.push(['补货日期', formatDateTime(quote.inventory_context.last_restock_date), '数据来源', quote.inventory_context.data_source || '-'])
    rows.push(['建议', quote.inventory_context.suggestion || '-', '', ''])
  } else {
    rows.push(['暂无库存数据'])
  }

  rows.push([])
  rows.push(['同行对比'])
  if (quote.peer_benchmark?.available) {
    rows.push(['品类', quote.peer_benchmark.category || '-', '同行样本数', formatNumber(quote.peer_benchmark.peer_count)])
    rows.push(['同行均价', formatCurrency(quote.peer_benchmark.peer_avg_price), '同行中位价', formatCurrency(quote.peer_benchmark.peer_median_price)])
    rows.push(['同行最低价', formatCurrency(quote.peer_benchmark.peer_min_price), '同行最高价', formatCurrency(quote.peer_benchmark.peer_max_price)])
    rows.push(['当前溢价率', formatPercent(quote.peer_benchmark.current_premium_pct), '分位排名', quote.peer_benchmark.percentile_rank != null ? `${quote.peer_benchmark.percentile_rank.toFixed(1)}%` : '-'])
    rows.push(['异常级别', quote.peer_benchmark.outlier_level || '-', '统计离群', formatBoolean(quote.peer_benchmark.is_statistical_outlier)])
    rows.push(['同业解读', quote.peer_benchmark.current_vs_peers || '-', '', ''])
    if (quote.peer_benchmark.peer_details?.length) {
      rows.push([])
      rows.push(['同行供应商明细'])
      rows.push(['供应商', '均价', '中位价', '区间', '报价次数'])
      quote.peer_benchmark.peer_details.forEach(detail => {
        rows.push([
          detail.supplier,
          formatCurrency(detail.avg_price),
          formatCurrency(detail.median_price),
          `${formatCurrency(detail.min_price)} ~ ${formatCurrency(detail.max_price)}`,
          formatNumber(detail.quote_count),
        ])
      })
    }
  } else {
    rows.push(['暂无同行对比数据'])
  }

  rows.push([])
  rows.push(['市场行情'])
  if (quote.market_context?.available) {
    rows.push(['品类', quote.market_context.category || '-', '物料类型', quote.market_context.material_type || '-'])
    rows.push(['市场区间', formatRange(quote.market_context.price_low, quote.market_context.price_high, quote.market_context.unit), '当前价', formatCurrency(quote.market_context.current_price, quote.market_context.unit)])
    rows.push(['平均价', formatCurrency(quote.market_context.avg_price, quote.market_context.unit), '24周变化', formatPercent(quote.market_context.change_pct_24w)])
    rows.push(['趋势', quote.market_context.trend || '-', '来源', quote.market_context.source || '-'])
    rows.push(['趋势说明', quote.market_context.trend_detail || quote.market_context.note || '-', '', ''])
  } else {
    rows.push(['暂无市场行情数据'])
  }

  rows.push([])
  rows.push(['备选供应商'])
  if (quote.alternatives?.length) {
    rows.push(['供应商', '历史物料数', '平均报价', '价格区间', '样例物料'])
    quote.alternatives.forEach(item => {
      rows.push([
        item.supplier_name,
        formatNumber(item.material_count),
        formatCurrency(item.avg_price),
        item.price_range || '-',
        item.sample_materials?.join('；') || '-',
      ])
    })
  } else {
    rows.push(['暂无备选供应商'])
  }

  return createSheet(rows, [24, 28, 18, 32, 32])
}

function buildCostSheet(quote: Quote) {
  const rows: any[][] = [
    ['成本与历史锚点'],
    [],
    ['成本拆解概览'],
  ]

  if (quote.cost_breakdown) {
    rows.push(['锚点类别', quote.cost_breakdown.benchmark_key || '-', '数据质量', quote.cost_breakdown.data_quality || '-'])
    rows.push(['锚点价格', formatCurrency(quote.cost_breakdown.anchor_price), '锚点来源', quote.cost_breakdown.anchor_source || '-'])
    rows.push(['异常项数', formatNumber(quote.cost_breakdown.anomaly_count), '成本偏离得分', formatScore(quote.cost_breakdown.cost_deviation_score)])
    rows.push(['备注', quote.cost_breakdown.note || '-', '', ''])
    rows.push([])
    rows.push(['成本项', '基准占比', '合理金额', '隐含金额', '偏差金额', '状态', '数据源', '独立核验'])
    quote.cost_breakdown.cost_items.forEach(item => {
      rows.push([
        item.item,
        formatPercent(item.benchmark_pct),
        formatCurrency(item.reasonable_amount),
        formatCurrency(item.implied_amount),
        formatCurrency(item.deviation_from_reasonable),
        item.status,
        item.data_source,
        formatBoolean(item.independently_verified),
      ])
    })
  } else {
    rows.push(['暂无成本拆解数据'])
  }

  rows.push([])
  rows.push(['历史相似物料'])
  if (quote.similar_materials?.length) {
    rows.push(['物料', '供应商', '历史价格', '相似度', '日期'])
    quote.similar_materials.forEach(item => {
      rows.push([
        item.name,
        item.supplier || '-',
        formatCurrency(item.price),
        item.similarity != null ? `${(item.similarity * 100).toFixed(0)}%` : '-',
        formatDateTime(item.date),
      ])
    })
  } else {
    rows.push(['暂无相似物料'])
  }

  return createSheet(rows, [22, 18, 16, 16, 16, 16, 20, 14])
}

function buildSolutionsSheet(quote: Quote) {
  const rows: any[][] = [
    ['方案建议'],
    [],
    ['标题', '执行动作', '置信度', '预计收益', '策略信号', '描述', '是否已采纳'],
  ]

  if (quote.solutions?.length) {
    quote.solutions.forEach(solution => {
      rows.push([
        solution.title,
        formatSolutionAction(solution.action),
        formatConfidence(solution.confidence),
        solution.estimated_savings || '-',
        buildSolutionSignals(solution, quote).join('；') || '-',
        solution.description || '-',
        quote.selected_solution_id === solution.id ? '是' : '否',
      ])
    })
  } else {
    rows.push(['暂无方案'])
  }

  return createSheet(rows, [22, 18, 12, 16, 30, 56, 12])
}

function buildDiagnosisSheet(quote: Quote) {
  const rows: any[][] = [
    ['诊断过程'],
    [],
    ['调查步骤'],
    ['步骤', '工具', '参数摘要', '结果摘要', '置信度'],
  ]

  if (quote.diagnosis_investigations?.length) {
    quote.diagnosis_investigations.forEach(item => {
      rows.push([
        item.step,
        TOOL_LABELS[item.tool] || item.tool || '-',
        item.args_summary || '-',
        item.result_summary || '-',
        formatConfidence(item.confidence),
      ])
    })
  } else {
    rows.push(['暂无调查步骤'])
  }

  rows.push([])
  rows.push(['诊断假设'])
  rows.push(['假设', '初始置信度', '更新置信度', '是否确认', '验证方式', '结论'])
  if (quote.diagnosis_hypotheses?.length) {
    quote.diagnosis_hypotheses.forEach(item => {
      rows.push([
        item.hypothesis,
        formatConfidence(item.prior_confidence),
        formatConfidence(item.updated_confidence),
        item.confirmed == null ? '-' : item.confirmed ? '是' : '否',
        item.verified_by || '-',
        item.conclusion || '-',
      ])
    })
  } else {
    rows.push(['暂无诊断假设'])
  }

  return createSheet(rows, [30, 18, 24, 56, 12, 18])
}

function buildDecisionSheet(quote: Quote) {
  const rows: any[][] = [
    ['AI 与人工决策日志'],
    [],
    ['时间', '来源', '决策点', '候选项', '选择结果', '置信度', '说明', '人工修正', '跟进摘要'],
  ]

  if (quote.decision_log?.length) {
    quote.decision_log.forEach(item => {
      rows.push([
        formatDateTime(item.timestamp),
        item.source === 'human' ? '人工' : 'Agent',
        item.decision_point || '-',
        item.options_considered?.join('；') || '-',
        formatSolutionAction(item.chosen_action),
        formatConfidence(item.confidence),
        stripMarkdown(item.reasoning || '-'),
        item.override_reasoning || '-',
        item.follow_up_summary || '-',
      ])
    })
  } else {
    rows.push(['暂无决策日志'])
  }

  return createSheet(rows, [20, 10, 24, 28, 18, 12, 48, 32, 28])
}

function buildTraceSheet(quote: Quote) {
  const rows: any[][] = [
    ['执行轨迹'],
    [],
    ['步骤', '状态', '时间', '耗时(ms)', '工具', '工具置信度', '决策', '阶段结论', '输出摘要', 'Agent 思考'],
  ]

  if (quote.execution_trace?.length) {
    quote.execution_trace.forEach(item => {
      rows.push([
        item.step,
        item.status,
        formatDateTime(item.timestamp),
        formatNumber(item.duration_ms),
        TOOL_LABELS[item.tool || ''] || item.tool || '-',
        formatConfidence(item.tool_confidence),
        item.decision || '-',
        item.conclusion_from_step || '-',
        stripMarkdown(item.output || '-'),
        stripMarkdown(item.agent_thought || item.tool_reasoning || '-'),
      ])
    })
  } else {
    rows.push(['暂无执行轨迹'])
  }

  return createSheet(rows, [28, 12, 20, 12, 18, 12, 18, 26, 54, 40])
}

function createSheet(rows: any[][], widths: number[]) {
  const sheet = XLSX.utils.aoa_to_sheet(rows)
  sheet['!cols'] = widths.map(width => ({ wch: width }))
  return sheet
}

export function buildSolutionSignals(solution: Solution, quote: Quote) {
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

  return signals.slice(0, 4)
}

export function formatSolutionAction(action?: string) {
  if (!action) return '待执行'
  return ACTION_LABELS[action] || action
}

export function formatCauseCategory(category?: string) {
  if (!category) return '待确认'
  return CAUSE_CATEGORY_LABELS[category] || category
}

export function formatStatus(status?: string | null) {
  if (!status) return '-'
  return STATUS_LABELS[status] || status
}

export function formatPhase(phase?: string | null) {
  if (!phase) return '-'
  return PHASE_LABELS[phase] || phase
}

export function formatCurrency(value?: number | null, unit = '¥') {
  if (value == null || Number.isNaN(value)) return '-'
  const amount = Number(value).toFixed(2)
  if (!unit || unit === '¥') return `¥${amount}`
  if (unit.includes('¥') || unit.includes('元')) return `${amount}${unit}`
  return `${amount} ${unit}`
}

export function formatPercent(value?: number | null) {
  if (value == null || Number.isNaN(value)) return '-'
  return `${Number(value).toFixed(1)}%`
}

export function formatConfidence(value?: number | null) {
  if (value == null || Number.isNaN(value)) return '-'
  return `${(Number(value) * 100).toFixed(0)}%`
}

export function formatScore(value?: number | null) {
  if (value == null || Number.isNaN(value)) return '-'
  return Number(value).toFixed(1)
}

export function formatNumber(value?: number | null) {
  if (value == null || Number.isNaN(value)) return '-'
  return Number.isInteger(value) ? String(value) : Number(value).toFixed(2)
}

export function formatRange(low?: number | null, high?: number | null, unit = '¥') {
  if (low == null && high == null) return '-'
  if (low != null && high != null) return `${formatCurrency(low, unit)} ~ ${formatCurrency(high, unit)}`
  return formatCurrency(low ?? high, unit)
}

export function formatBoolean(value?: boolean | null) {
  if (value == null) return '-'
  return value ? '是' : '否'
}

export function formatDateTime(value?: string | null) {
  if (!value) return '-'
  try {
    return new Date(value).toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return value
  }
}

export function sanitizeFileName(value: string) {
  return value.replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, '_')
}

export function stripMarkdown(text: string) {
  return text
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^[-*]\s+/gm, '')
    .replace(/^\|\s*/gm, '')
    .replace(/\|\s*$/gm, '')
    .replace(/\|/g, ' · ')
    .replace(/---+/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
