import { useEffect, useState } from 'react'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  LineChart,
  Line
} from 'recharts'
import { fetchStats, fetchQuotes } from '../utils/api'
import type { Stats, Quote } from '../types'

const COLORS = ['#10b981', '#f59e0b', '#f97316', '#f43f5e']

export default function Stats() {
  const [stats, setStats] = useState<Stats | null>(null)
  const [quotes, setQuotes] = useState<Quote[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadData()
  }, [])

  const loadData = async () => {
    try {
      const [statsRes, quotesRes] = await Promise.all([
        fetchStats(),
        fetchQuotes({ limit: 100 })
      ])
      setStats(statsRes)
      setQuotes(quotesRes.quotes)
    } catch (error) {
      console.error('Failed to load stats:', error)
    } finally {
      setLoading(false)
    }
  }

  const severityData = stats ? Object.entries(stats.severity_distribution).map(([name, value]) => ({
    name,
    value
  })) : []

  const categoryData = quotes.reduce((acc, quote) => {
    const cat = quote.material_name.split('').slice(0, 2).join('') || '其他'
    acc[cat] = (acc[cat] || 0) + 1
    return acc
  }, {} as Record<string, number>)

  const categoryChartData = Object.entries(categoryData)
    .map(([name, value]) => ({ name, value }))
    .slice(0, 8)

  const deviationTrend = quotes
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
    .map((q, i) => ({
      index: i + 1,
      deviation: q.deviation_score
    }))

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
      </div>
    )
  }

  return (
    <div className="h-full overflow-auto p-8 bg-[#f8fafc]">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">统计分析</h1>
        <p className="text-gray-600">
          AI Agent运行数据统计与异常趋势分析
        </p>
      </div>

      {/* Stats Cards */}
      {stats && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 lg:gap-6 mb-8">
          <div className="glass rounded-xl p-4 lg:p-6 bg-white border border-gray-200 shadow-sm">
            <div className="text-sm text-gray-500 mb-2">总报价数</div>
            <div className="text-2xl lg:text-3xl font-bold text-gray-900">{stats.total_quotes}</div>
          </div>
          <div className="glass rounded-xl p-4 lg:p-6 bg-white border border-gray-200 shadow-sm">
            <div className="text-sm text-gray-500 mb-2">平均偏离度</div>
            <div className="text-2xl lg:text-3xl font-bold text-gray-900">{stats.avg_deviation_score}</div>
          </div>
          <div className="glass rounded-xl p-4 lg:p-6 bg-white border border-gray-200 shadow-sm">
            <div className="text-sm text-gray-500 mb-2">紧急异常</div>
            <div className="text-2xl lg:text-3xl font-bold text-danger">
              {stats.severity_distribution['紧急'] || 0}
            </div>
          </div>
          <div className="glass rounded-xl p-4 lg:p-6 bg-white border border-gray-200 shadow-sm">
            <div className="text-sm text-gray-500 mb-2">潜在节省</div>
            <div className="text-2xl lg:text-3xl font-bold text-success">
              ¥{(stats.total_potential_savings / 10000).toFixed(1)}万
            </div>
          </div>
        </div>
      )}

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 lg:gap-6">
        {/* Severity Distribution */}
        <div className="glass rounded-xl p-4 lg:p-6 bg-white border border-gray-200 shadow-sm">
          <h3 className="text-base lg:text-lg font-semibold text-gray-900 mb-4 lg:mb-6">异常级别分布</h3>
          <div className="h-56 lg:h-64">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={severityData}
                  cx="50%"
                  cy="50%"
                  innerRadius={50}
                  outerRadius={70}
                  paddingAngle={5}
                  dataKey="value"
                >
                  {severityData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#ffffff',
                    border: '1px solid rgba(0,0,0,0.1)',
                    borderRadius: '8px'
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="flex flex-wrap justify-center gap-2 lg:gap-4 mt-4">
            {severityData.map((item, idx) => (
              <div key={item.name} className="flex items-center gap-2">
                <div
                  className="w-3 h-3 rounded-full"
                  style={{ backgroundColor: COLORS[idx % COLORS.length] }}
                />
                <span className="text-sm text-gray-600">{item.name}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Category Distribution */}
        <div className="glass rounded-xl p-4 lg:p-6 bg-white border border-gray-200 shadow-sm">
          <h3 className="text-base lg:text-lg font-semibold text-gray-900 mb-4 lg:mb-6">物料类别分布</h3>
          <div className="h-56 lg:h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={categoryChartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.1)" />
                <XAxis dataKey="name" stroke="#64748b" fontSize={12} />
                <YAxis stroke="#64748b" fontSize={12} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#ffffff',
                    border: '1px solid rgba(0,0,0,0.1)',
                    borderRadius: '8px'
                  }}
                />
                <Bar dataKey="value" fill="#4f46e5" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Deviation Trend */}
        <div className="glass rounded-xl p-4 lg:p-6 col-span-1 lg:col-span-2 bg-white border border-gray-200 shadow-sm">
          <h3 className="text-base lg:text-lg font-semibold text-gray-900 mb-4 lg:mb-6">偏离度趋势</h3>
          <div className="h-56 lg:h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={deviationTrend}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.1)" />
                <XAxis dataKey="index" stroke="#64748b" fontSize={12} />
                <YAxis stroke="#64748b" fontSize={12} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#ffffff',
                    border: '1px solid rgba(0,0,0,0.1)',
                    borderRadius: '8px'
                  }}
                />
                <Line
                  type="monotone"
                  dataKey="deviation"
                  stroke="#ef4444"
                  strokeWidth={2}
                  dot={{ fill: '#ef4444' }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  )
}
