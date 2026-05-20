import axios from 'axios'
import type { Quote, QuoteInput, DecisionInput, Stats } from '../types'

const API_BASE_URL = 'http://localhost:8000/api'

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json'
  }
})

// Quotes
export const fetchQuotes = async (params?: { severity?: string; status?: string; limit?: number }) => {
  const response = await api.get('/quotes', { params })
  return response.data as { total: number; quotes: Quote[] }
}

export const fetchQuote = async (id: string) => {
  const response = await api.get(`/quotes/${id}`)
  return response.data as Quote
}

export const analyzeQuote = async (data: QuoteInput) => {
  const response = await api.post('/quotes/analyze', data)
  return response.data as Quote
}

export const submitDecision = async (id: string, data: DecisionInput) => {
  const response = await api.post(`/quotes/${id}/decision`, data)
  return response.data as Quote
}

export const fetchQuoteTrace = async (id: string) => {
  const response = await api.get(`/quotes/${id}/trace`)
  return response.data as { quote_id: string; execution_trace: any[]; total_duration_ms: number }
}

export const rerunAnalysis = async (id: string, params: Record<string, any>) => {
  const response = await api.post(`/quotes/${id}/rerun`, { params })
  return response.data as Quote
}

// Materials
export const fetchMaterials = async (params?: { category?: string; limit?: number }) => {
  const response = await api.get('/materials', { params })
  return response.data as { total: number; materials: any[] }
}

export const fetchMaterial = async (id: string) => {
  const response = await api.get(`/materials/${id}`)
  return response.data
}

// Stats
export const fetchStats = async () => {
  const response = await api.get('/stats')
  return response.data as Stats
}

// Real-time analysis APIs
export const fetchSimilarMaterials = async (materialName: string, category: string) => {
  const response = await api.get('/materials', { params: { category, limit: 5 } })
  return response.data as { total: number; materials: any[] }
}

export const fetchPricePrediction = async (category: string) => {
  const response = await api.get('/external-references', { params: { category } })
  return response.data as { total: number; references: any[] }
}

export const calculateDeviation = async (data: { supplier_quote: number; category: string }) => {
  // 简化版：直接调用分析API获取预测区间
  const response = await api.get('/external-references', { params: { category: data.category } })
  const refs = response.data.references
  if (refs.length > 0) {
    const ref = refs[0]
    const mid = (ref.price_low + ref.price_high) / 2
    const deviation = Math.abs(data.supplier_quote - mid) / mid * 100
    return {
      predicted_low: ref.price_low,
      predicted_high: ref.price_high,
      predicted_mid: mid,
      deviation: Math.round(deviation * 10) / 10
    }
  }
  return null
}
export const fetchExternalReferences = async (category?: string) => {
  const response = await api.get('/external-references', { params: { category } })
  return response.data as { total: number; references: any[] }
}

export const fetchBenchmarks = async () => {
  const response = await api.get('/benchmarks')
  return response.data as Record<string, any>
}
