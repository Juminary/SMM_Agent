import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  AlertTriangle, CheckCircle, Clock, AlertCircle,
  Search, ChevronRight, Plus, LayoutGrid, List,
} from 'lucide-react'
import { fetchQuotes } from '../utils/api'
import type { Quote } from '../types'

export default function QuoteList() {
  const [quotes, setQuotes] = useState<Quote[]>([])
  const [loading, setLoading] = useState(true)
  const [filterSeverity, setFilterSeverity] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [searchTerm, setSearchTerm] = useState('')
  const [viewMode, setViewMode] = useState<'list' | 'card'>('list')

  useEffect(() => { loadQuotes() }, [filterSeverity, filterStatus])

  const loadQuotes = async () => {
    try {
      const params: Record<string, string> = {}
      if (filterSeverity) params.severity = filterSeverity
      if (filterStatus) params.status = filterStatus
      const res = await fetchQuotes(params)
      setQuotes(res.quotes)
    } catch (error) { console.error('Failed to load quotes:', error) }
    finally { setLoading(false) }
  }

  const filteredQuotes = quotes.filter(q =>
    q.material_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    q.supplier_name.toLowerCase().includes(searchTerm.toLowerCase())
  )

  const severityIcon = (level: string) => {
    switch (level) {
      case '紧急': return <AlertTriangle className="w-4 h-4 text-red-500" />
      case '警示': return <AlertCircle className="w-4 h-4 text-orange-500" />
      case '关注': return <Clock className="w-4 h-4 text-yellow-500" />
      default: return <CheckCircle className="w-4 h-4 text-emerald-500" />
    }
  }

  const severityColor = (level: string) => {
    switch (level) {
      case '紧急': return 'bg-red-50 border-red-200 text-red-700'
      case '警示': return 'bg-orange-50 border-orange-200 text-orange-700'
      case '关注': return 'bg-yellow-50 border-yellow-200 text-yellow-700'
      default: return 'bg-emerald-50 border-emerald-200 text-emerald-700'
    }
  }

  const statusBadge = (status: string) => {
    switch (status) {
      case 'approved': case 'accept': return <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">已通过</span>
      case 'rejected': case 'reject': return <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-700">已驳回</span>
      case 'negotiate': return <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">议价中</span>
      default: return <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">待处理</span>
    }
  }

  if (loading) return (
    <div className="h-full flex items-center justify-center">
      <div className="animate-spin h-10 w-10 border-2 border-indigo-500 border-t-transparent rounded-full" />
    </div>
  )

  return (
    <div className="h-full overflow-auto bg-gray-50 p-6 lg:p-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-xl font-bold text-gray-900 tracking-tight">报价异常列表</h1>
          <p className="text-sm text-gray-400 mt-1">共 {filteredQuotes.length} 条记录</p>
        </div>
        <Link to="/quotes/new"
          className="flex items-center gap-2 px-4 py-2.5 bg-indigo-600 text-white rounded-xl text-sm font-medium hover:bg-indigo-700 transition-colors shadow-sm">
          <Plus size={15} /> 新建分析
        </Link>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border shadow-sm p-5 mb-5 flex flex-col sm:flex-row items-start sm:items-center gap-4">
        <div className="flex-1 min-w-[200px] relative w-full">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="搜索物料或供应商..."
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-200"
          />
        </div>
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <select value={filterSeverity} onChange={e => setFilterSeverity(e.target.value)}
            className="flex-1 sm:flex-none px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-indigo-400 bg-white">
            <option value="">全部级别</option>
            <option value="紧急">紧急</option>
            <option value="警示">警示</option>
            <option value="关注">关注</option>
            <option value="正常">正常</option>
          </select>
          <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
            className="flex-1 sm:flex-none px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-indigo-400 bg-white">
            <option value="">全部状态</option>
            <option value="pending">待处理</option>
            <option value="approved">已通过</option>
            <option value="rejected">已驳回</option>
            <option value="negotiate">议价中</option>
          </select>
          <div className="flex bg-gray-100 rounded-lg p-0.5 shrink-0">
            <button onClick={() => setViewMode('card')}
              className={viewMode === 'card' ? 'p-1.5 rounded-md bg-white shadow-sm text-indigo-600' : 'p-1.5 rounded-md text-gray-400 hover:text-gray-600'}>
              <LayoutGrid size={16} />
            </button>
            <button onClick={() => setViewMode('list')}
              className={viewMode === 'list' ? 'p-1.5 rounded-md bg-white shadow-sm text-indigo-600' : 'p-1.5 rounded-md text-gray-400 hover:text-gray-600'}>
              <List size={16} />
            </button>
          </div>
        </div>
      </div>

      {/* Card Mode — 2 columns, larger cards */}
      {viewMode === 'card' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filteredQuotes.map(quote => (
            <Link key={quote.id} to={'/quotes/' + quote.id}
              className="bg-white rounded-xl border shadow-sm p-5 hover:shadow-md hover:border-gray-300 transition-all block">
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-3">
                  {severityIcon(quote.severity_level)}
                  <div>
                    <div className="text-sm font-semibold text-gray-900">{quote.material_name}</div>
                    <div className="text-xs text-gray-400 mt-0.5">{quote.supplier_name}</div>
                  </div>
                </div>
                <span className={'text-xs px-2 py-0.5 rounded-full font-medium border ' + severityColor(quote.severity_level)}>
                  {quote.severity_level}
                </span>
              </div>

              <div className="grid grid-cols-3 gap-3 mb-4">
                <div className="bg-gray-50 rounded-lg py-2 text-center">
                  <div className="text-base font-bold text-gray-900">¥{quote.supplier_quote}</div>
                  <div className="text-[11px] text-gray-400 mt-0.5">报价</div>
                </div>
                <div className="bg-gray-50 rounded-lg py-2 text-center">
                  <div className="text-base font-bold text-indigo-600">¥{quote.ai_prediction_mid ?? '—'}</div>
                  <div className="text-[11px] text-gray-400 mt-0.5">P50</div>
                </div>
                <div className="bg-gray-50 rounded-lg py-2 text-center">
                  <div className="text-base font-bold text-gray-700">
                    {quote.quantity >= 1000 ? (quote.quantity / 1000).toFixed(0) + 'k' : quote.quantity}
                  </div>
                  <div className="text-[11px] text-gray-400 mt-0.5">数量</div>
                </div>
              </div>

              <div className="flex items-center justify-between pt-3 border-t border-gray-100">
                <div className="flex items-center gap-3">
                  {statusBadge(quote.status)}
                  <span className="text-xs font-mono font-semibold" style={{
                    color: quote.deviation_score > 60 ? '#ef4444' : quote.deviation_score > 40 ? '#f97316' : '#10b981'
                  }}>
                    偏离{quote.deviation_score}分
                  </span>
                </div>
                <div className="flex items-center gap-1 text-xs text-indigo-600 font-medium opacity-0 group-hover:opacity-100 transition-opacity">
                  详情 <ChevronRight size={12} />
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}

      {/* List Mode — cleaner table */}
      {viewMode === 'list' && (
        <div className="bg-white rounded-xl border shadow-sm overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                {['物料信息', '供应商报价', 'AI预测', '偏离度', '状态'].map(h => (
                  <th key={h} className="px-5 py-3.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filteredQuotes.map(quote => (
                <tr key={quote.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-5 py-4">
                    <Link to={'/quotes/' + quote.id} className="flex items-center gap-3">
                      {severityIcon(quote.severity_level)}
                      <div>
                        <div className="text-sm font-medium text-gray-900">{quote.material_name}</div>
                        <div className="text-xs text-gray-400 mt-0.5">{quote.supplier_name}</div>
                      </div>
                    </Link>
                  </td>
                  <td className="px-5 py-4 text-sm font-mono font-semibold text-gray-900">¥{quote.supplier_quote}</td>
                  <td className="px-5 py-4 text-sm font-mono text-indigo-600">
                    ¥{quote.ai_prediction_low ?? '?'} ~ ¥{quote.ai_prediction_high ?? '?'}
                  </td>
                  <td className="px-5 py-4">
                    <div className="flex items-center gap-2">
                      <span className={`inline-block w-2 h-2 rounded-full ${
                        quote.deviation_score > 60 ? 'bg-red-500' :
                        quote.deviation_score > 40 ? 'bg-orange-500' :
                        quote.deviation_score > 20 ? 'bg-yellow-500' : 'bg-emerald-500'
                      }`} />
                      <span className="text-sm font-mono font-semibold" style={{
                        color: quote.deviation_score > 60 ? '#ef4444' : quote.deviation_score > 40 ? '#f97316' : '#10b981'
                      }}>{quote.deviation_score}分</span>
                    </div>
                  </td>
                  <td className="px-5 py-4">{statusBadge(quote.status)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Empty state */}
      {filteredQuotes.length === 0 && (
        <div className="text-center py-16 text-gray-400">
          <Search size={36} className="mx-auto mb-3 opacity-30" />
          <p className="text-sm">未找到匹配的报价记录</p>
        </div>
      )}
    </div>
  )
}
