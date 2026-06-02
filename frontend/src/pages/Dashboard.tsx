import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  FileText, AlertTriangle, TrendingUp, CheckCircle,
  ArrowRight, Plus, GitBranch,
} from 'lucide-react'
import { fetchQuotes, fetchStats } from '../utils/api'
import type { Quote, Stats } from '../types'

export default function Dashboard() {
  const [recentQuotes, setRecentQuotes] = useState<Quote[]>([])
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([fetchQuotes({ limit: 6 }), fetchStats()])
      .then(([quotesRes, statsRes]) => {
        setRecentQuotes(quotesRes.quotes)
        setStats(statsRes)
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  if (loading) return (
    <div className="h-full flex items-center justify-center">
      <div className="animate-spin h-10 w-10 border-2 border-indigo-500 border-t-transparent rounded-full" />
    </div>
  )

  const sev = stats?.severity_distribution || {}
  const pending = (sev['警示'] || 0) + (sev['紧急'] || 0)

  const severityColor = (level: string) => {
    switch (level) {
      case '紧急': return 'bg-red-50 border-red-200 text-red-700'
      case '警示': return 'bg-orange-50 border-orange-200 text-orange-700'
      case '关注': return 'bg-yellow-50 border-yellow-200 text-yellow-700'
      default: return 'bg-emerald-50 border-emerald-200 text-emerald-700'
    }
  }

  return (
    <div className="h-full overflow-auto bg-gray-50 p-4 lg:p-6">
      {/* Header */}
      <div className="mb-5">
        <h1 className="text-xl font-bold text-gray-900 mb-0.5">Agent 工作台</h1>
        <p className="text-sm text-gray-500">实时监控 AI Agent 决策过程，人工确认与干预异常报价</p>
      </div>

      {/* Quick actions */}
      <div className="grid grid-cols-3 gap-3 mb-5">
        <Link to="/quotes/new"
          className="flex items-center gap-2 px-4 py-3 bg-white rounded-2xl border shadow-sm hover:shadow-md hover:border-indigo-200 transition-all group">
          <div className="w-9 h-9 rounded-xl bg-indigo-100 flex items-center justify-center">
            <Plus size={16} className="text-indigo-600" />
          </div>
          <div>
            <div className="text-sm font-semibold text-gray-900 group-hover:text-indigo-600 transition-colors">新建分析</div>
            <div className="text-xs text-gray-400">输入报价信息</div>
          </div>
        </Link>
        <Link to="/quotes?status=pending"
          className="flex items-center gap-2 px-4 py-3 bg-white rounded-2xl border shadow-sm hover:shadow-md hover:border-red-200 transition-all group">
          <div className="w-9 h-9 rounded-xl bg-red-50 flex items-center justify-center">
            <AlertTriangle size={16} className="text-red-500" />
          </div>
          <div>
            <div className="text-sm font-semibold text-gray-900">{pending} 条待处理</div>
            <div className="text-xs text-gray-400">需要人工干预</div>
          </div>
        </Link>
        <Link to="/demo"
          className="flex items-center gap-2 px-4 py-3 bg-white rounded-2xl border shadow-sm hover:shadow-md hover:border-purple-200 transition-all group">
          <div className="w-9 h-9 rounded-xl bg-purple-50 flex items-center justify-center">
            <GitBranch size={16} className="text-purple-500" />
          </div>
          <div>
            <div className="text-sm font-semibold text-gray-900 group-hover:text-purple-600 transition-colors">调试演示</div>
            <div className="text-xs text-gray-400">典型场景演示</div>
          </div>
        </Link>
      </div>

      {/* KPI Cards */}
      {stats && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
          <div className="bg-white rounded-2xl border shadow-sm p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-gray-500 font-medium">总报价数</span>
              <div className="w-8 h-8 rounded-lg bg-indigo-50 flex items-center justify-center">
                <FileText size={14} className="text-indigo-500" />
              </div>
            </div>
            <div className="text-2xl font-bold text-gray-900">{stats.total_quotes}</div>
            <div className="text-xs text-gray-400 mt-0.5">累计分析</div>
          </div>
          <div className="bg-white rounded-2xl border shadow-sm p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-gray-500 font-medium">待处理异常</span>
              <div className="w-8 h-8 rounded-lg bg-red-50 flex items-center justify-center">
                <AlertTriangle size={14} className="text-red-500" />
              </div>
            </div>
            <div className="text-2xl font-bold text-red-600">{pending}</div>
            <div className="text-xs text-gray-400 mt-0.5">需人工干预</div>
          </div>
          <div className="bg-white rounded-2xl border shadow-sm p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-gray-500 font-medium">平均偏离度</span>
              <div className="w-8 h-8 rounded-lg bg-cyan-50 flex items-center justify-center">
                <TrendingUp size={14} className="text-cyan-500" />
              </div>
            </div>
            <div className="text-2xl font-bold text-gray-900">{stats.avg_deviation_score}</div>
            <div className="text-xs text-gray-400 mt-0.5">综合评分</div>
          </div>
          <div className="bg-white rounded-2xl border shadow-sm p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-gray-500 font-medium">潜在节省</span>
              <div className="w-8 h-8 rounded-lg bg-emerald-50 flex items-center justify-center">
                <CheckCircle size={14} className="text-emerald-500" />
              </div>
            </div>
            <div className="text-2xl font-bold text-emerald-600">
              ¥{(stats.total_potential_savings / 10000).toFixed(1)}万
            </div>
            <div className="text-xs text-gray-400 mt-0.5">预估节省金额</div>
          </div>
        </div>
      )}

      {/* Severity distribution */}
      {stats && (
        <div className="bg-white rounded-2xl border shadow-sm p-4 mb-5">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">异常分布</h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {Object.entries(sev).map(([level, count]) => (
              <div key={level} className={`rounded-xl border p-3 text-center transition-all hover:shadow-sm ${severityColor(level)}`}>
                <div className="text-xl font-bold">{count}</div>
                <div className="text-xs font-medium">{level}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recent quotes */}
      <div className="bg-white rounded-2xl border shadow-sm p-4">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-gray-700">最近报价</h3>
          <Link to="/quotes" className="text-xs text-indigo-600 font-medium hover:text-indigo-700 flex items-center gap-1">
            查看全部 <ArrowRight size={12} />
          </Link>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {recentQuotes.map(quote => (
            <Link key={quote.id} to={`/quotes/${quote.id}`}
              className="p-3 rounded-xl border border-gray-100 hover:border-gray-200 hover:bg-gray-50 transition-all group">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full ${
                    quote.severity_level === '紧急' ? 'bg-red-500' :
                    quote.severity_level === '警示' ? 'bg-orange-500' :
                    quote.severity_level === '关注' ? 'bg-yellow-500' : 'bg-emerald-500'
                  }`} />
                  <span className="text-sm font-medium text-gray-900 group-hover:text-indigo-600 transition-colors">
                    {quote.material_name}
                  </span>
                </div>
                <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${severityColor(quote.severity_level)}`}>
                  {quote.severity_level}
                </span>
              </div>
              <div className="flex items-center justify-between text-xs text-gray-400">
                <span>{quote.supplier_name} · ¥{quote.supplier_quote}</span>
                <span className="font-mono font-semibold" style={{
                  color: quote.deviation_score > 60 ? '#ef4444' : quote.deviation_score > 40 ? '#f97316' : '#10b981'
                }}>
                  {quote.deviation_score}分
                </span>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  )
}
