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

export interface Quote {
  id: string
  material_id: string
  material_name: string
  supplier_quote: number
  supplier_name: string
  quantity: number
  ai_prediction_low: number
  ai_prediction_high: number
  ai_prediction_mid: number
  deviation_score: number
  severity_level: string
  severity_color: string
  solutions: Solution[]
  cost_breakdown: any
  similar_materials: SimilarMaterial[]
  status: string
  human_decision?: string
  decision_by?: string
  created_at: string
}

export interface Solution {
  id: string
  title: string
  description: string
  confidence: number
  estimated_savings: string
  action: string
}

export interface SimilarMaterial {
  id: string
  name: string
  price: number
  similarity: number
  date: string
}

export interface Stats {
  total_quotes: number
  severity_distribution: Record<string, number>
  status_distribution: Record<string, number>
  total_potential_savings: number
  avg_deviation_score: number
}

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
}
