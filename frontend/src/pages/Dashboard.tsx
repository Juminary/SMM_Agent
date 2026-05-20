import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  AlertTriangle,
  CheckCircle,
  Clock,
  TrendingUp,
  AlertCircle,
  ArrowRight,
  FileText
} from 'lucide-react'
import { fetchQuotes, fetchStats } from '../utils/api'
import type { Quote, Stats } from '../types'

export default function Dashboard() {
  const [recentQuotes, setRecentQuotes] = useState<Quote[]>([])
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadData()
  }, [])

  const loadData = async () => {
    try {
      const [quotesRes, statsRes] = await Promise.all([
        fetchQuotes({ limit: 5 }),
        fetchStats()
      ])
      setRecentQuotes(quotesRes.quotes)
      setStats(statsRes)
    } catch (error) {
      console.error('Failed to load data:', error)
    } finally {
      setLoading(false)
    }
  }

  const getSeverityIcon = (level: string) => {
    switch (level) {
      case '紧急':
        return <AlertTriangle className="w-5 h-5 text-danger" />
      case '警示':
        return <AlertCircle className="w-5 h-5 text-warning" />
      case '关注':
        return <Clock className="w-5 h-5 text-warning/70" />
      default:
        return <CheckCircle className="w-5 h-5 text-success" />
    }
  }

  const getSeverityColor = (level: string) => {
    switch (level) {
      case '紧急':
        return 'bg-danger/10 text-danger border-danger/20'
      case '警示':
        return 'bg-warning/10 text-warning border-warning/20'
      case '关注':
        return 'bg-warning/5 text-warning/80 border-warning/10'
      default:
        return 'bg-success/10 text-success border-success/20'
    }
  }

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
        <h1 className="text-3xl font-bold text-gray-900 mb-2">
          供销计划异常Agent
        </h1>
        <p className="text-gray-600">
          实时监控AI Agent决策过程，人工确认与干预异常报价
        </p>
      </div>

      {/* Stats Cards */}
      {stats && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 lg:gap-6 mb-8">
          <div className="card p-6 hover:shadow-md transition-all duration-200">
            <div className="flex items-center justify-between mb-4">
              <span className="text-gray-500 text-sm font-medium">总报价数</span>
              <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                <FileText className="w-5 h-5 text-primary" />
              </div>
            </div>
            <div className="text-3xl font-bold text-gray-900">{stats.total_quotes}</div>
            <div className="mt-2 text-sm text-gray-500">累计分析报价</div>
          </div>

          <div className="card p-6 hover:shadow-md transition-all duration-200">
            <div className="flex items-center justify-between mb-4">
              <span className="text-gray-500 text-sm font-medium">待处理异常</span>
              <div className="w-10 h-10 rounded-lg bg-danger/10 flex items-center justify-center">
                <AlertTriangle className="w-5 h-5 text-danger" />
              </div>
            </div>
            <div className="text-3xl font-bold text-gray-900">
              {(stats.severity_distribution['紧急'] || 0) + (stats.severity_distribution['警示'] || 0)}
            </div>
            <div className="mt-2 text-sm text-gray-500">需人工干预</div>
          </div>

          <div className="card p-6 hover:shadow-md transition-all duration-200">
            <div className="flex items-center justify-between mb-4">
              <span className="text-gray-500 text-sm font-medium">平均偏离度</span>
              <div className="w-10 h-10 rounded-lg bg-accent/10 flex items-center justify-center">
                <TrendingUp className="w-5 h-5 text-accent" />
              </div>
            </div>
            <div className="text-3xl font-bold text-gray-900">{stats.avg_deviation_score}</div>
            <div className="mt-2 text-sm text-gray-500">综合评分</div>
          </div>

          <div className="card p-6 hover:shadow-md transition-all duration-200">
            <div className="flex items-center justify-between mb-4">
              <span className="text-gray-500 text-sm font-medium">潜在节省</span>
              <div className="w-10 h-10 rounded-lg bg-success/10 flex items-center justify-center">
                <TrendingUp className="w-5 h-5 text-success" />
              </div>
            </div>
            <div className="text-3xl font-bold text-gray-900">
              ¥{(stats.total_potential_savings / 10000).toFixed(1)}万
            </div>
            <div className="mt-2 text-sm text-gray-500">预估节省金额</div>
          </div>
        </div>
      )}

      {/* Severity Distribution */}
      {stats && (
        <div className="card p-6 mb-8">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">异常分布</h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {Object.entries(stats.severity_distribution).map(([level, count]) => (
              <div
                key={level}
                className={`rounded-lg p-4 border transition-all duration-200 hover:shadow-md cursor-pointer ${getSeverityColor(level)}`}
              >
                <div className="text-sm mb-1 opacity-80">{level}</div>
                <div className="text-2xl font-bold">{count}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recent Quotes */}
      <div className="card p-6">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-lg font-semibold text-gray-900">最近报价</h3>
          <Link
            to="/quotes"
            className="btn text-primary hover:text-primary-light"
          >
            查看全部 <ArrowRight className="w-4 h-4" />
          </Link>
        </div>

        <div className="space-y-3">
          {recentQuotes.map((quote) => (
            <Link
              key={quote.id}
              to={`/quotes/${quote.id}`}
              className="flex items-center justify-between p-4 rounded-lg bg-gray-50 hover:bg-gray-100 border border-gray-200 transition-all duration-200 group"
            >
              <div className="flex items-center gap-4">
                <div className="flex-shrink-0">
                  {getSeverityIcon(quote.severity_level)}
                </div>
                <div>
                  <div className="font-medium text-gray-900 group-hover:text-primary transition-colors">
                    {quote.material_name}
                  </div>
                  <div className="text-sm text-gray-500">
                    {quote.supplier_name} · ¥{quote.supplier_quote}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-4">
                <span className={`badge border ${getSeverityColor(quote.severity_level)}`}>
                  {quote.severity_level}
                </span>
                <div className="text-right hidden sm:block">
                  <div className="text-sm text-gray-500">偏离度</div>
                  <div className={`font-mono font-medium ${
                    quote.deviation_score > 60 ? 'text-danger' :
                    quote.deviation_score > 40 ? 'text-warning' :
                    'text-success'
                  }`}>
                    {quote.deviation_score}
                  </div>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  )
}
