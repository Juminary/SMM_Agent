// ===== 物料 =====
export interface Material {
  id: string
  name: string
  category: string
  material_type: string
  dimensions: string
  processing: string
  precision: string
  supplier_id: string
  supplier_name: string
  unit_price: number
  order_quantity: number
  order_date: string
  description: string
}

// ===== 报价分析（核心） =====
export interface Quote {
  id: string
  material_id: string
  material_name: string
  supplier_quote: number
  supplier_name: string
  quantity: number
  quote_date?: string

  // 价格预测
  ai_prediction_low: number | null
  ai_prediction_mid: number | null
  ai_prediction_high: number | null

  // 第一层偏离度
  deviation_score: number
  severity_level: string
  severity_color: string
  price_deviation: number
  cost_deviation: number
  market_deviation: number
  weights?: { alpha: number; beta: number; gamma: number }

  // 第二层综合打分
  composite_score?: number
  external_deviation?: number

  // RAG 外部数据
  rag_info?: RagInfo

  // 流程阶段
  phase: string               // "baseline" | "diagnosis" | "resolution" | "fast_pass"
  interrupt_severity?: string | null  // "optional" | "mandatory" | null
  interrupt_reason?: string

  // 诊断结果
  diagnosis_conclusion?: DiagnosisConclusion
  diagnosis_investigations: DiagnosisInvestigation[]
  decision_log: DecisionLogEntry[]

  // 诊断上下文
  supplier_profile?: SupplierProfile
  peer_benchmark?: PeerBenchmark
  market_context?: MarketContext
  inventory_context?: InventoryContext
  alternatives?: AlternativeSupplier[]

  // 方案
  solutions: Solution[]
  llm_summary?: string

  // 成本 & 相似物料
  cost_breakdown?: CostBreakdown
  similar_materials: SimilarMaterial[]

  // 执行轨迹
  execution_trace: TraceStep[]
  total_duration_ms: number

  // 状态
  status: string
  human_decision?: string
  decision_by?: string
  decision_at?: string
  created_at: string
}

// ===== 成本拆解 =====
export interface CostBreakdown {
  cost_items: CostItem[]
  benchmark_key: string
  data_quality: string          // "with_anchor" | "reference_only"
  anchor_price: number
  anchor_source: string
  cost_deviation_score?: number | null
  anomaly_count: number
  note: string
}

export interface CostItem {
  item: string                  // 原材料 / 加工费 / 表面处理 / 包装物流 / 管理+利润
  benchmark_pct: number
  reasonable_amount: number     // 合理价下的金额
  implied_amount: number        // 供应商报价隐含金额
  deviation_from_reasonable: number | null
  benchmark_amount?: number     // deprecated
  status: string
  data_source: string
  independently_verified: boolean
}

// ===== 诊断 =====
export interface DiagnosisConclusion {
  root_cause: string
  cause_category: string        // supplier_premium / market_trend / insufficient_data / unknown_anomaly / normal
  confidence: number
  reasoning_chain?: DiagnosisInvestigation[]
  llm_summary?: string
}

export interface DiagnosisInvestigation {
  step: number
  tool: string
  args_summary?: string
  result_summary: string
  confidence: number
}

export interface DecisionLogEntry {
  timestamp: string
  decision_point: string
  options_considered: string[]
  chosen_action: string
  reasoning: string
  confidence: number
}

// ===== 供应商画像 =====
export interface SupplierProfile {
  available: boolean
  supplier_name: string
  purchase_count?: number
  analyzed_quotes?: number
  categories_covered?: string[]
  avg_unit_price?: number
  price_volatility_pct?: number
  price_trend?: string
  avg_deviation_score?: number
  recent_avg_deviation?: number
  deviation_trend?: string
  anomaly_count?: number
  anomaly_rate_pct?: number
  deviation_summary?: string
  risk_assessment?: string
  first_order?: string
  last_order?: string
  sample_materials?: { name: string; price: number; date: string }[]
}

// ===== 同行对比 =====
export interface PeerBenchmark {
  available: boolean
  category: string
  peer_count: number
  data_points?: number
  peer_avg_price: number
  peer_median_price?: number
  peer_min_price: number
  peer_max_price: number
  quartiles?: { Q1: number; Q2: number; Q3: number }
  iqr?: number
  upper_fence?: number
  z_score?: number
  percentile_rank?: number
  outlier_level?: string
  is_statistical_outlier?: boolean
  current_price: number
  current_premium_pct: number
  current_vs_peers?: string
  peer_details?: PeerDetail[]
  excluded_supplier?: string
}

export interface PeerDetail {
  supplier: string
  avg_price: number
  median_price?: number
  min_price: number
  max_price: number
  std?: number
  quote_count: number
}

// ===== 市场行情 =====
export interface MarketContext {
  available: boolean
  category: string
  material_type?: string
  price_low?: number
  price_high?: number
  unit?: string
  trend?: string
  trend_detail?: string
  source?: string
  confidence?: number
  note?: string
  searched?: boolean
  // Time series fields
  current_price?: number
  avg_price?: number
  price_range_24w?: string
  change_pct_24w?: number
  data_points?: number
}

// ===== 库存 =====
export interface InventoryContext {
  available: boolean
  material_id: string
  material_name?: string
  current_stock?: number
  safety_stock?: number
  daily_consumption?: number
  days_remaining?: number
  urgency?: string
  can_negotiate?: boolean
  suggestion?: string
  last_restock_date?: string
  data_source?: string
}

// ===== RAG =====
export interface RagInfo {
  ref_low: number
  ref_high: number
  source: string
  available: boolean
}

// ===== 替代供应商 =====
export interface AlternativeSupplier {
  supplier_name: string
  material_count: number
  avg_price: number
  price_range: string
  sample_materials: string[]
}

// ===== 方案 =====
export interface Solution {
  id: string
  title: string
  description: string
  confidence: number
  estimated_savings: string
  action: string
  generated_by?: string
  human_decision?: string
  human_comment?: string
}

// ===== 相似物料 =====
export interface SimilarMaterial {
  id: string
  name: string
  price: number
  similarity: number
  date: string
  supplier?: string
}

// ===== 执行轨迹 =====
export interface TraceStep {
  step: string
  status: string
  timestamp: string
  duration_ms: number
  output: string
  tool?: string
  tool_confidence?: number
  tool_reasoning?: string
  agent_thought?: string
  decision?: string
  conclusion_from_step?: string
}

// ===== 统计 =====
export interface Stats {
  total_quotes: number
  severity_distribution: Record<string, number>
  status_distribution: Record<string, number>
  total_potential_savings: number
  avg_deviation_score: number
}

// ===== 输入 =====
export interface QuoteInput {
  material_id: string
  material_name: string
  supplier_quote: number
  supplier_name: string
  quantity: number
  quote_date: string
  category?: string
  material_type?: string
  dimensions?: string
  processing?: string
  precision?: string
  description?: string
}

export interface DecisionInput {
  decision: string
  decision_by: string
  selected_solution_id?: string
  override_reason?: string
  override_price?: number
}
