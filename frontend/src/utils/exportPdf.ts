import html2canvas from 'html2canvas'
import { jsPDF } from 'jspdf'
import type { Quote } from '../types'
import {
  buildSolutionSignals,
  formatBoolean,
  formatCauseCategory,
  formatConfidence,
  formatCurrency,
  formatDateTime,
  formatNumber,
  formatPercent,
  formatPhase,
  formatRange,
  formatScore,
  formatSolutionAction,
  formatStatus,
  sanitizeFileName,
  stripMarkdown,
  TOOL_LABELS,
  type ExportVariant,
} from './exportWorkbook'

export async function exportQuotePdf(quote: Quote, variant: ExportVariant = 'detail') {
  const container = document.createElement('div')
  container.style.position = 'fixed'
  container.style.left = '-20000px'
  container.style.top = '0'
  container.style.width = '1120px'
  container.style.background = '#ffffff'
  container.style.zIndex = '-1'
  container.innerHTML = buildReportHtml(quote, variant)
  document.body.appendChild(container)

  try {
    if (document.fonts?.ready) {
      await document.fonts.ready
    }
    await new Promise(resolve => window.setTimeout(resolve, 80))

    const canvas = await html2canvas(container, {
      scale: 2,
      useCORS: true,
      backgroundColor: '#ffffff',
      logging: false,
    })

    const imgData = canvas.toDataURL('image/png')
    const pdf = new jsPDF('p', 'mm', 'a4')
    const pageWidth = pdf.internal.pageSize.getWidth()
    const pageHeight = pdf.internal.pageSize.getHeight()
    const margin = 8
    const usableWidth = pageWidth - margin * 2
    const imgHeight = (canvas.height * usableWidth) / canvas.width

    let remainingHeight = imgHeight
    let positionY = margin

    pdf.addImage(imgData, 'PNG', margin, positionY, usableWidth, imgHeight, undefined, 'FAST')
    remainingHeight -= pageHeight - margin * 2

    while (remainingHeight > 0) {
      positionY = remainingHeight - imgHeight + margin
      pdf.addPage()
      pdf.addImage(imgData, 'PNG', margin, positionY, usableWidth, imgHeight, undefined, 'FAST')
      remainingHeight -= pageHeight - margin * 2
    }

    const prefix = variant === 'trace' ? '溯源报告' : '报价诊断报告'
    pdf.save(`${prefix}-${sanitizeFileName(quote.material_name || '未知物料')}-${quote.id.slice(0, 8)}.pdf`)
  } finally {
    container.remove()
  }
}

function buildReportHtml(quote: Quote, variant: ExportVariant) {
  const selectedSolution = quote.solutions?.find(item => item.id === quote.selected_solution_id)
  const title = variant === 'trace' ? '报价异常溯源 PDF 报告' : '报价诊断 PDF 报告'
  const summaryCards = [
    { label: '供应商报价', value: formatCurrency(quote.supplier_quote) },
    { label: '综合偏离分', value: formatScore(quote.deviation_score) },
    { label: '阶段', value: formatPhase(quote.phase) },
    { label: '状态', value: formatStatus(quote.status) },
    { label: '结论置信度', value: formatConfidence(quote.diagnosis_conclusion?.confidence) },
    { label: '已选方案', value: selectedSolution?.title || '-' },
  ]

  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #0f172a; background: #ffffff; width: 1120px;">
      <style>
        .pdf-report { padding: 40px 44px 56px; }
        .hero { display: flex; justify-content: space-between; gap: 24px; align-items: flex-start; padding-bottom: 24px; border-bottom: 1px solid #e2e8f0; }
        .hero h1 { margin: 0; font-size: 30px; line-height: 1.2; font-weight: 700; color: #0f172a; }
        .hero p { margin: 6px 0 0; font-size: 13px; color: #64748b; }
        .hero-meta { text-align: right; min-width: 260px; }
        .hero-badge { display: inline-block; padding: 5px 10px; border-radius: 999px; font-size: 12px; font-weight: 600; background: #eef2ff; color: #4338ca; margin-left: 8px; }
        .summary-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; margin: 24px 0 8px; }
        .summary-card { border: 1px solid #e2e8f0; border-radius: 10px; padding: 14px 16px; background: #f8fafc; }
        .summary-card .label { font-size: 12px; color: #64748b; margin-bottom: 6px; }
        .summary-card .value { font-size: 19px; font-weight: 700; color: #0f172a; }
        .section { margin-top: 24px; }
        .section h2 { margin: 0 0 12px; font-size: 18px; line-height: 1.3; color: #0f172a; }
        .section-note { margin: -4px 0 14px; font-size: 12px; color: #64748b; }
        .panel { border: 1px solid #e2e8f0; border-radius: 12px; background: #ffffff; padding: 16px; }
        .kv-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px 16px; }
        .kv { padding: 10px 12px; border-radius: 10px; background: #f8fafc; border: 1px solid #edf2f7; }
        .kv .k { font-size: 12px; color: #64748b; margin-bottom: 4px; }
        .kv .v { font-size: 14px; color: #0f172a; line-height: 1.5; font-weight: 600; white-space: pre-wrap; word-break: break-word; }
        .full { grid-column: 1 / -1; }
        .multi-panel { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
        .chips { display: flex; gap: 8px; flex-wrap: wrap; }
        .chip { display: inline-block; padding: 4px 9px; border-radius: 999px; font-size: 11px; font-weight: 600; background: #eff6ff; color: #1d4ed8; }
        table { width: 100%; border-collapse: collapse; table-layout: fixed; }
        th, td { border: 1px solid #e2e8f0; padding: 9px 10px; vertical-align: top; text-align: left; font-size: 12px; line-height: 1.5; word-break: break-word; }
        th { background: #f8fafc; color: #334155; font-weight: 700; }
        .text-block { white-space: pre-wrap; word-break: break-word; font-size: 13px; line-height: 1.7; color: #1e293b; }
        .muted { color: #64748b; }
        .footer { margin-top: 28px; padding-top: 16px; border-top: 1px solid #e2e8f0; font-size: 11px; color: #94a3b8; }
      </style>
      <div class="pdf-report">
        <div class="hero">
          <div>
            <h1>${escapeHtml(title)}</h1>
            <p>${escapeHtml(quote.material_name)} · ${escapeHtml(quote.supplier_name)} · ${escapeHtml(formatCurrency(quote.supplier_quote))}</p>
            <p>${escapeHtml(quote.category || '未分类')} · ${escapeHtml(quote.material_type || '未标注类型')} · ${escapeHtml(formatNumber(quote.quantity))}件</p>
          </div>
          <div class="hero-meta">
            <div>
              <span class="hero-badge">${escapeHtml(quote.severity_level || '-')}</span>
              <span class="hero-badge">${escapeHtml(formatStatus(quote.status))}</span>
            </div>
            <p>报价ID：${escapeHtml(quote.id)}</p>
            <p>导出时间：${escapeHtml(formatDateTime(new Date().toISOString()))}</p>
            <p>报价日期：${escapeHtml(formatDateTime(quote.quote_date))}</p>
          </div>
        </div>

        <div class="summary-grid">
          ${summaryCards.map(card => `
            <div class="summary-card">
              <div class="label">${escapeHtml(card.label)}</div>
              <div class="value">${escapeHtml(card.value)}</div>
            </div>
          `).join('')}
        </div>

        <div class="section">
          <h2>基础概览</h2>
          <div class="panel">
            ${renderKvGrid([
              ['物料名称', quote.material_name],
              ['供应商', quote.supplier_name],
              ['报价金额', formatCurrency(quote.supplier_quote)],
              ['采购数量', formatNumber(quote.quantity)],
              ['物料类别', quote.category || '-'],
              ['物料类型', quote.material_type || '-'],
              ['工艺', quote.processing || '-'],
              ['精度', quote.precision || '-'],
              ['尺寸', quote.dimensions || '-'],
              ['流程阶段', formatPhase(quote.phase)],
              ['价格偏离', formatPercent(quote.price_deviation)],
              ['成本偏离', formatPercent(quote.cost_deviation)],
              ['市场偏离', formatPercent(quote.market_deviation)],
              ['AI 预测区间', formatRange(quote.ai_prediction_low, quote.ai_prediction_high)],
              ['RAG 参考区间', quote.rag_info?.available ? formatRange(quote.rag_info.ref_low, quote.rag_info.ref_high) : '-'],
              ['RAG 来源', quote.rag_info?.source || '-'],
              ['中断原因', quote.interrupt_reason || '-', true],
            ])}
          </div>
        </div>

        <div class="section">
          <h2>诊断结论</h2>
          <div class="panel">
            ${renderKvGrid([
              ['根因类别', formatCauseCategory(quote.diagnosis_conclusion?.cause_category)],
              ['结论置信度', formatConfidence(quote.diagnosis_conclusion?.confidence)],
              ['根因说明', quote.diagnosis_conclusion?.root_cause || '待生成', true],
              ['LLM 摘要', stripMarkdown(quote.diagnosis_conclusion?.llm_summary || quote.llm_summary || '暂无摘要'), true],
            ])}
          </div>
        </div>

        <div class="section">
          <h2>业务上下文</h2>
          <div class="multi-panel">
            <div class="panel">
              <h2 style="font-size:16px; margin-bottom:12px;">供应商画像</h2>
              ${renderKvGrid([
                ['风险等级', quote.supplier_profile?.risk_level || '待评估'],
                ['定价行为', quote.supplier_profile?.pricing_behavior || '-'],
                ['采购次数', formatNumber(quote.supplier_profile?.purchase_count)],
                ['异常率', formatPercent(quote.supplier_profile?.anomaly_rate_pct)],
                ['建议采购方式', quote.supplier_profile?.recommended_procurement_mode || '-'],
                ['风险说明', quote.supplier_profile?.risk_assessment || quote.supplier_profile?.deviation_summary || '暂无', true],
              ])}
            </div>
            <div class="panel">
              <h2 style="font-size:16px; margin-bottom:12px;">库存与市场</h2>
              ${renderKvGrid([
                ['库存紧急度', quote.inventory_context?.urgency || '-'],
                ['库存窗口', quote.inventory_context?.days_remaining != null ? `${quote.inventory_context.days_remaining}天` : '-'],
                ['可否议价', formatBoolean(quote.inventory_context?.can_negotiate)],
                ['库存建议', quote.inventory_context?.suggestion || '暂无', true],
                ['同行溢价率', formatPercent(quote.peer_benchmark?.current_premium_pct)],
                ['市场区间', formatRange(quote.market_context?.price_low, quote.market_context?.price_high, quote.market_context?.unit || '¥')],
                ['市场趋势', quote.market_context?.trend || '-'],
                ['趋势说明', quote.market_context?.trend_detail || quote.market_context?.note || '暂无', true],
              ])}
            </div>
          </div>
        </div>

        <div class="section">
          <h2>方案建议</h2>
          <div class="section-note">这里保留了策略信号，方便回看每个方案是基于什么证据被提出的。</div>
          <div class="panel">
            ${renderTable(
              ['方案', '动作', '置信度', '预计收益', '策略信号', '描述'],
              (quote.solutions || []).map(solution => [
                solution.title,
                formatSolutionAction(solution.action),
                formatConfidence(solution.confidence),
                solution.estimated_savings || '-',
                buildSolutionSignals(solution, quote).join('；') || '-',
                solution.description || '-',
              ]),
              '暂无方案建议'
            )}
          </div>
        </div>

        <div class="section">
          <h2>成本拆解</h2>
          <div class="panel">
            ${renderKvGrid([
              ['锚点类别', quote.cost_breakdown?.benchmark_key || '-'],
              ['锚点价格', formatCurrency(quote.cost_breakdown?.anchor_price)],
              ['数据质量', quote.cost_breakdown?.data_quality || '-'],
              ['锚点来源', quote.cost_breakdown?.anchor_source || '-'],
              ['异常项数', formatNumber(quote.cost_breakdown?.anomaly_count)],
              ['备注', quote.cost_breakdown?.note || '暂无', true],
            ])}
            <div style="height: 14px;"></div>
            ${renderTable(
              ['成本项', '基准占比', '合理金额', '隐含金额', '偏差金额', '状态'],
              (quote.cost_breakdown?.cost_items || []).map(item => [
                item.item,
                formatPercent(item.benchmark_pct),
                formatCurrency(item.reasonable_amount),
                formatCurrency(item.implied_amount),
                formatCurrency(item.deviation_from_reasonable),
                item.status,
              ]),
              '暂无成本拆解数据'
            )}
          </div>
        </div>

        <div class="section">
          <h2>诊断过程</h2>
          <div class="panel">
            ${renderTable(
              ['步骤', '工具', '参数摘要', '结果摘要', '置信度'],
              (quote.diagnosis_investigations || []).map(item => [
                String(item.step),
                TOOL_LABELS[item.tool] || item.tool || '-',
                item.args_summary || '-',
                item.result_summary || '-',
                formatConfidence(item.confidence),
              ]),
              '暂无诊断步骤'
            )}
          </div>
        </div>

        <div class="section">
          <h2>决策日志</h2>
          <div class="panel">
            ${renderTable(
              ['时间', '来源', '决策点', '选择结果', '说明'],
              (quote.decision_log || []).map(item => [
                formatDateTime(item.timestamp),
                item.source === 'human' ? '人工' : 'Agent',
                item.decision_point || '-',
                formatSolutionAction(item.chosen_action),
                item.override_reasoning || stripMarkdown(item.reasoning || '-') || '-',
              ]),
              '暂无决策日志'
            )}
          </div>
        </div>

        ${variant === 'trace' ? `
          <div class="section">
            <h2>执行轨迹</h2>
            <div class="section-note">这是推理链视图里的完整追踪，适合复盘每一步工具调用和结论流转。</div>
            <div class="panel">
              ${renderTable(
                ['步骤', '状态', '时间', '耗时(ms)', '工具', '输出摘要'],
                (quote.execution_trace || []).map(item => [
                  item.step,
                  item.status,
                  formatDateTime(item.timestamp),
                  formatNumber(item.duration_ms),
                  TOOL_LABELS[item.tool || ''] || item.tool || '-',
                  stripMarkdown(item.output || item.conclusion_from_step || '-') || '-',
                ]),
                '暂无执行轨迹'
              )}
            </div>
          </div>
        ` : ''}

        <div class="footer">
          本报告由前端导出能力生成，包含页面可见诊断结果与流程上下文，适合评审留档、课程汇报与异常复盘。
        </div>
      </div>
    </div>
  `
}

function renderKvGrid(entries: Array<[string, string, boolean?]>) {
  return `
    <div class="kv-grid">
      ${entries.map(([label, value, full]) => `
        <div class="kv${full ? ' full' : ''}">
          <div class="k">${escapeHtml(label)}</div>
          <div class="v">${escapeHtml(value || '-')}</div>
        </div>
      `).join('')}
    </div>
  `
}

function renderTable(headers: string[], rows: string[][], emptyText: string) {
  if (!rows.length) {
    return `<div class="text-block muted">${escapeHtml(emptyText)}</div>`
  }

  return `
    <table>
      <thead>
        <tr>${headers.map(header => `<th>${escapeHtml(header)}</th>`).join('')}</tr>
      </thead>
      <tbody>
        ${rows.map(row => `
          <tr>${row.map(cell => `<td>${escapeHtml(cell || '-')}</td>`).join('')}</tr>
        `).join('')}
      </tbody>
    </table>
  `
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
