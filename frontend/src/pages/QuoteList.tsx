import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  AlertTriangle,
  CheckCircle,
  Clock,
  AlertCircle,
  Filter,
  Search,
  ChevronRight,
  Plus
} from 'lucide-react'
import { fetchQuotes } from '../utils/api'
import type { Quote } from '../types'

export default function QuoteList() {
  const [quotes, setQuotes] = useState<Quote[]>([])
  const [loading, setLoading] = useState(true)
  const [searchParams, setSearchParams] = useSearchParams()
  const [filterSeverity, setFilterSeverity] = useState(searchParams.get('severity') || '')
  const [searchTerm, setSearchTerm] = useState('')

  useEffect(() => {
    loadQuotes()
  }, [filterSeverity])

  const loadQuotes = async () => {
    try {
      const params: any = {}
      if (filterSeverity) params.severity = filterSeverity

      const res = await fetchQuotes(params)
      setQuotes(res.quotes)
    } catch (error) {
      console.error('Failed to load quotes:', error)
    } finally {
      setLoading(false)
    }
  }

  const filteredQuotes = quotes.filter(q =>
    q.material_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    q.supplier_name.toLowerCase().includes(searchTerm.toLowerCase())
  )

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

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'approved':
      case 'accept':
        return <span className="badge bg-success/10 text-success border-success/20">已通过</span>
      case 'rejected':
      case 'reject':
        return <span className="badge bg-danger/10 text-danger border-danger/20">已驳回</span>
      case 'negotiate':
        return <span className="badge bg-accent/10 text-accent border-accent/20">议价中</span>
      default:
        return <span className="badge bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400">待处理</span>
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
    <div className="h-full overflow-auto p-4 sm:p-8 bg-[#f8fafc]">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 mb-2">
            报价异常列表
          </h1>
          <p className="text-gray-600">
            共 {filteredQuotes.length} 条报价记录
          </p>
        </div>
        <Link
          to="/quotes/new"
          className="btn bg-gradient-to-r from-primary to-accent text-white hover:opacity-90 shadow-md hover:shadow-lg"
        >
          <Plus className="w-4 h-4" />
          新建分析
        </Link>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-4 mb-6">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
          <input
            type="text"
            placeholder="搜索物料或供应商..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="input pl-10"
          />
        </div>
        <div className="flex items-center gap-2">
          <Filter className="w-5 h-5 text-gray-400" />
          <select
            value={filterSeverity}
            onChange={(e) => {
              setFilterSeverity(e.target.value)
              if (e.target.value) {
                setSearchParams({ severity: e.target.value })
              } else {
                setSearchParams({})
              }
            }}
            className="input w-40"
          >
            <option value="">全部级别</option>
            <option value="紧急">紧急</option>
            <option value="警示">警示</option>
            <option value="关注">关注</option>
            <option value="正常">正常</option>
          </select>
        </div>
      </div>

      {/* Quote List - Responsive Table */}
      <div className="card overflow-hidden">
        {/* Desktop Table */}
        <div className="hidden lg:block overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">物料信息</th>
                <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">供应商报价</th>
                <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">AI预测区间</th>
                <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">偏离度</th>
                <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">级别</th>
                <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">状态</th>
                <th className="px-6 py-4 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filteredQuotes.map((quote) => (
                <tr
                  key={quote.id}
                  className="hover:bg-gray-50 transition-colors"
                >
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      {getSeverityIcon(quote.severity_level)}
                      <div>
                        <div className="font-medium text-gray-900">{quote.material_name}</div>
                        <div className="text-sm text-gray-500">{quote.supplier_name}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="font-mono font-medium text-gray-900">¥{quote.supplier_quote}</div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="font-mono text-accent">
                      ¥{quote.ai_prediction_low} ~ {quote.ai_prediction_high}
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className={`font-mono font-medium ${
                      quote.deviation_score > 60 ? 'text-danger' :
                      quote.deviation_score > 40 ? 'text-warning' :
                      'text-success'
                    }`}>
                      {quote.deviation_score}
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <span className={`badge border ${getSeverityColor(quote.severity_level)}`}>
                      {quote.severity_level}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    {getStatusBadge(quote.status)}
                  </td>
                  <td className="px-6 py-4 text-right">
                    <Link
                      to={`/quotes/${quote.id}`}
                      className="btn text-primary hover:text-primary-light"
                    >
                      详情 <ChevronRight className="w-4 h-4" />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Mobile Cards */}
        <div className="lg:hidden divide-y divide-gray-100">
          {filteredQuotes.map((quote) => (
            <Link
              key={quote.id}
              to={`/quotes/${quote.id}`}
              className="block p-4 hover:bg-gray-50 transition-colors"
            >
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-3">
                  {getSeverityIcon(quote.severity_level)}
                  <div>
                    <div className="font-medium text-gray-900">{quote.material_name}</div>
                    <div className="text-sm text-gray-500">{quote.supplier_name}</div>
                  </div>
                </div>
                <span className={`badge border ${getSeverityColor(quote.severity_level)}`}>
                  {quote.severity_level}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-4 text-sm">
                <div>
                  <div className="text-gray-500 text-xs mb-1">报价</div>
                  <div className="font-mono font-medium text-gray-900">¥{quote.supplier_quote}</div>
                </div>
                <div>
                  <div className="text-gray-500 text-xs mb-1">偏离度</div>
                  <div className={`font-mono font-medium ${
                    quote.deviation_score > 60 ? 'text-danger' :
                    quote.deviation_score > 40 ? 'text-warning' :
                    'text-success'
                  }`}>
                    {quote.deviation_score}
                  </div>
                </div>
                <div>
                  <div className="text-gray-500 text-xs mb-1">状态</div>
                  {getStatusBadge(quote.status)}
                </div>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  )
}
