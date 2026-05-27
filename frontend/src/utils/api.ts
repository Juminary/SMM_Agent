import axios from 'axios'
import type { Quote, QuoteInput, DecisionInput, Stats } from '../types'

const API_BASE_URL = 'http://localhost:8000/api'

const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 120000,
  headers: { 'Content-Type': 'application/json' },
})

// ===== Quotes =====

export const fetchQuotes = async (params?: {
  severity?: string; status?: string; limit?: number
}) => {
  const { data } = await api.get('/quotes', { params })
  return data as { total: number; quotes: Quote[] }
}

export const fetchQuote = async (id: string) => {
  const { data } = await api.get(`/quotes/${id}`)
  return data as Quote
}

export const analyzeQuote = async (input: QuoteInput) => {
  const { data } = await api.post('/quotes/analyze', input)
  return data as Quote
}

export const submitDecision = async (id: string, input: DecisionInput) => {
  const { data } = await api.post(`/quotes/${id}/decision`, input)
  return data as Quote
}

export const fetchQuoteTrace = async (id: string) => {
  const { data } = await api.get(`/quotes/${id}/trace`)
  return data as { quote_id: string; execution_trace: any[]; total_duration_ms: number }
}

export const rerunAnalysis = async (id: string, params: Record<string, any>) => {
  const { data } = await api.post(`/quotes/${id}/rerun`, { params })
  return data as Quote
}

// ===== Materials =====

export const fetchSimilarMaterials = async (materialName: string, category: string) => {
  const { data } = await api.get('/materials', { params: { category, limit: 5 } })
  return data as { total: number; materials: any[] }
}

export const fetchMaterials = async (params?: {
  category?: string; limit?: number
}) => {
  const { data } = await api.get('/materials', { params })
  return data as { total: number; materials: any[] }
}

export const fetchMaterial = async (id: string) => {
  const { data } = await api.get(`/materials/${id}`)
  return data
}

// ===== Stats =====

export const fetchStats = async () => {
  const { data } = await api.get('/stats')
  return data as Stats
}

// ===== Market & Benchmarks =====

export const fetchExternalReferences = async (category?: string) => {
  const { data } = await api.get('/external-references', { params: { category } })
  return data as { total: number; references: any[] }
}

export const fetchBenchmarks = async () => {
  const { data } = await api.get('/benchmarks')
  return data as Record<string, any>
}

// ===== Health =====

export const healthCheck = async () => {
  const { data } = await api.get('/health')
  return data
}
