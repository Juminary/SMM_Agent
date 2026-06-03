import { useEffect, useState } from 'react'
import { BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line, Legend } from 'recharts'
import { TrendingUp, AlertTriangle, FileText, DollarSign } from 'lucide-react'
import { fetchStats, fetchQuotes } from '../utils/api'
import type { Stats, Quote } from '../types'

const SEV_COLORS = { '正常': '#10b981', '关注': '#f59e0b', '警示': '#f97316', '紧急': '#f43f5e' }

export default function Stats() {
  const [stats, setStats] = useState<Stats | null>(null)
  const [quotes, setQuotes] = useState<Quote[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => { loadData() }, [])

  const loadData = async () => {
    try {
      const [statsRes, quotesRes] = await Promise.all([fetchStats(), fetchQuotes({ limit: 100 })])
      setStats(statsRes)
      setQuotes(quotesRes.quotes)
    } catch (e) { console.error(e); setQuotes([]) }
    finally { setLoading(false) }
  }

  const severityData = stats ? Object.entries(stats.severity_distribution).map(([name, value]) => ({ name, value, fill: SEV_COLORS[name as keyof typeof SEV_COLORS] || '#94a3b8' })) : []

  const deviationTrend = [...quotes]
    .sort((a, b) => (new Date(a.created_at).getTime() || 0) - (new Date(b.created_at).getTime() || 0))
    .map((q, i) => ({ index: i + 1, deviation: q.deviation_score, supplier: q.supplier_name.slice(0, 4), level: q.severity_level }))

  const monthlyData = [...quotes]
    .sort((a, b) => (new Date(a.created_at).getTime() || 0) - (new Date(b.created_at).getTime() || 0))
    .reduce((acc, q) => {
      const month = q.created_at ? q.created_at.slice(0, 7) : '未知'
      if (!acc[month]) acc[month] = { month, 正常: 0, 关注: 0, 警示: 0, 紧急: 0 }
      if (acc[month][q.severity_level as keyof typeof acc[typeof month]] !== undefined) (acc[month] as any)[q.severity_level]++
      return acc
    }, {} as Record<string, any>)

  const monthlyChartData = Object.values(monthlyData).slice(-6)

  const supplierData = quotes.reduce((acc, q) => {
    if (!acc[q.supplier_name]) acc[q.supplier_name] = { name: q.supplier_name, total: 0, abnormal: 0 }
    acc[q.supplier_name].total++
    if (['警示', '紧急'].includes(q.severity_level)) acc[q.supplier_name].abnormal++
    return acc
  }, {} as Record<string, { name: string; total: number; abnormal: number }>)

  const supplierChartData = Object.values(supplierData).filter(s => s.total >= 1)
    .map(s => ({ ...s, rate: s.total > 0 ? (s.abnormal / s.total * 100) : 0 }))
    .sort((a, b) => b.rate - a.rate).slice(0, 8)

  if (loading) return (
    <div className="h-full flex items-center justify-center">
      <div className="animate-spin h-10 w-10 border-2 border-indigo-500 border-t-transparent rounded-full" />
    </div>
  )

  const pending = ((stats?.severity_distribution?.['警示'] || 0) + (stats?.severity_distribution?.['紧急'] || 0))

  return (
    <div className="h-full overflow-auto bg-gray-50 p-6 lg:p-8">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-xl font-bold text-gray-900 tracking-tight">统计分析</h1>
        <p className="text-sm text-gray-400 mt-1">AI Agent 运行数据统计与异常趋势分析</p>
      </div>

      {/* KPI Cards */}
      {stats && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <div className="bg-white rounded-xl border p-5 shadow-sm">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-9 h-9 rounded-lg bg-indigo-50 flex items-center justify-center"><FileText size={16} className="text-indigo-500" /></div>
              <span className="text-xs text-gray-400 uppercase tracking-wider">总报价数</span>
            </div>
            <div className="text-3xl font-bold text-gray-900">{stats.total_quotes}</div>
          </div>
          <div className="bg-white rounded-xl border p-5 shadow-sm">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-9 h-9 rounded-lg bg-cyan-50 flex items-center justify-center"><TrendingUp size={16} className="text-cyan-500" /></div>
              <span className="text-xs text-gray-400 uppercase tracking-wider">平均偏离度</span>
            </div>
            <div className="text-3xl font-bold text-gray-900">{stats.avg_deviation_score}</div>
          </div>
          <div className="bg-white rounded-xl border p-5 shadow-sm">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-9 h-9 rounded-lg bg-red-50 flex items-center justify-center"><AlertTriangle size={16} className="text-red-500" /></div>
              <span className="text-xs text-gray-400 uppercase tracking-wider">待处理异常</span>
            </div>
            <div className="text-3xl font-bold text-red-500">{pending}</div>
          </div>
          <div className="bg-white rounded-xl border p-5 shadow-sm">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-9 h-9 rounded-lg bg-emerald-50 flex items-center justify-center"><DollarSign size={16} className="text-emerald-500" /></div>
              <span className="text-xs text-gray-400 uppercase tracking-wider">潜在节省</span>
            </div>
            <div className="text-3xl font-bold text-emerald-500">¥{(stats.total_potential_savings / 10000).toFixed(1)}万</div>
          </div>
        </div>
      )}

      {/* Charts grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Severity distribution */}
        <div className="bg-white rounded-xl border p-5 shadow-sm">
          <h3 className="text-sm font-semibold text-gray-700 mb-4">异常级别分布</h3>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={severityData} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis type="number" stroke="#94a3b8" fontSize={12} />
                <YAxis dataKey="name" type="category" width={50} stroke="#94a3b8" fontSize={12} />
                <Tooltip contentStyle={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: '8px', fontSize: '12px' }} />
                <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                  {severityData.map((entry, i) => <Cell key={i} fill={entry.fill} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Monthly severity stacked */}
        <div className="bg-white rounded-xl border p-5 shadow-sm">
          <h3 className="text-sm font-semibold text-gray-700 mb-4">月度异常趋势</h3>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={monthlyChartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="month" stroke="#94a3b8" fontSize={11} />
                <YAxis stroke="#94a3b8" fontSize={11} />
                <Tooltip contentStyle={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: '8px', fontSize: '12px' }} />
                <Legend wrapperStyle={{ fontSize: '11px' }} />
                <Bar dataKey="正常" stackId="a" fill="#10b981" />
                <Bar dataKey="关注" stackId="a" fill="#f59e0b" />
                <Bar dataKey="警示" stackId="a" fill="#f97316" />
                <Bar dataKey="紧急" stackId="a" fill="#f43f5e" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Deviation trend */}
        <div className="bg-white rounded-xl border p-5 shadow-sm">
          <h3 className="text-sm font-semibold text-gray-700 mb-4">偏离度趋势</h3>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={deviationTrend}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="index" stroke="#94a3b8" fontSize={11} />
                <YAxis stroke="#94a3b8" fontSize={11} />
                <Tooltip contentStyle={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: '8px', fontSize: '12px' }} formatter={(v: number) => [`${v}分`, '偏离度']} />
                <Line type="monotone" dataKey="deviation" stroke="#ef4444" strokeWidth={2} dot={{ r: 3, fill: '#ef4444' }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Supplier anomaly rate */}
        <div className="bg-white rounded-xl border p-5 shadow-sm">
          <h3 className="text-sm font-semibold text-gray-700 mb-4">供应商异常率排行</h3>
          {supplierChartData.length === 0 ? (
            <div className="h-56 flex items-center justify-center text-sm text-gray-400">暂无供应商异常数据</div>
          ) : (
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={supplierChartData} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis type="number" stroke="#94a3b8" fontSize={11} unit="%" />
                  <YAxis dataKey="name" type="category" width={60} stroke="#94a3b8" fontSize={11} />
                  <Tooltip contentStyle={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: '8px', fontSize: '12px' }} formatter={(v: number) => [`${v?.toFixed(1) ?? v}%`, '异常率']} />
                  <Bar dataKey="rate" fill="#f97316" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
