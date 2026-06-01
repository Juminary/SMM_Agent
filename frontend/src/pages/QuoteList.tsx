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
  const [viewMode, setViewMode] = useState<'list' | 'card'>('card')

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
    <div className="h-full overflow-auto bg-gray-50 p-4 lg:p-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5">
        <div>
          <h1 className="text-xl font-bold text-gray-900">报价异常列表</h1>
          <p className="text-sm text-gray-500">共 {filteredQuotes.length} 条记录</p>
        </div>
        <Link to="/quotes/new"
          className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-xl text-sm font-medium hover:bg-indigo-700 transition-colors shadow-sm">
          <Plus size={14} /> 新建分析
        </Link>
      </div>

      <div className="bg-white rounded-2xl border shadow-sm p-4 mb-4 flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-[200px] relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="搜索物料或供应商..."
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-4 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-200"
          />
        </div>
        <div className="flex items-center gap-2">
          <select value={filterSeverity} onChange={e => setFilterSeverity(e.target.value)}
            className="px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-indigo-400">
            <option value="">全部级别</option>
            <option value="紧急">紧急</option>
            <option value="警示">警示</option>
            <option value="关注">关注</option>
            <option value="正常">正常</option>
          </select>
          <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
            className="px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-indigo-400">
            <option value="">全部状态</option>
            <option value="pending">待处理</option>
            <option value="approved">已通过</option>
            <option value="rejected">已驳回</option>
            <option value="negotiate">议价中</option>
          </select>
        </div>
        <div className="flex bg-gray-100 rounded-xl p-0.5">
          <button onClick={() => setViewMode('card')}
            className={viewMode === 'card' ? 'p-1.5 rounded-lg bg-white shadow-sm text-indigo-600' : 'p-1.5 rounded-lg text-gray-400 hover:text-gray-600'}>
            <LayoutGrid size={15} />
          </button>
          <button onClick={() => setViewMode('list')}
            className={viewMode === 'list' ? 'p-1.5 rounded-lg bg-white shadow-sm text-indigo-600' : 'p-1.5 rounded-lg text-gray-400 hover:text-gray-600'}>
            <List size={15} />
          </button>
        </div>
      </div>

      {viewMode === 'card' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {filteredQuotes.map(quote => (
            <Link key={quote.id} to={'/quotes/' + quote.id}
              className="bg-white rounded-2xl border shadow-sm p-4 hover:shadow-md hover:border-gray-300 transition-all block">
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-2">
                  {severityIcon(quote.severity_level)}
                  <div>
                    <div className="text-sm font-semibold text-gray-900 hover:text-indigo-600">{quote.material_name}</div>
                    <div className="text-xs text-gray-400">{quote.supplier_name}</div>
                  </div>
                </div>
                <span className={'text-xs px-2 py-0.5 rounded-full font-medium border ' + severityColor(quote.severity_level)}>
                  {quote.severity_level}
                </span>
              </div>

              <div className="mb-3">
                <div className="flex justify-between text-xs text-gray-500 mb-1">
                  <span>偏离度</span>
                  <span className="font-mono font-semibold" style={{
                    color: quote.deviation_score > 60 ? '#ef4444' : quote.deviation_score > 40 ? '#f97316' : '#10b981'
                  }}>{quote.deviation_score}分</span>
                </div>
                <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                  <div className="h-full rounded-full transition-all" style={{
                    width: Math.min(quote.deviation_score, 100) + '%',
                    background: quote.deviation_score > 60 ? '#ef4444' : quote.deviation_score > 40 ? '#f97316' : '#10b981',
                  }} />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2 mb-3 text-center">
                <div className="bg-gray-50 rounded-lg py-1.5">
                  <div className="text-sm font-bold text-gray-900">{'¥' + quote.supplier_quote}</div>
                  <div className="text-[10px] text-gray-400">报价</div>
                </div>
                <div className="bg-gray-50 rounded-lg py-1.5">
                  <div className="text-sm font-bold text-indigo-600">{'¥' + (quote.ai_prediction_mid ?? '—')}</div>
                  <div className="text-[10px] text-gray-400">P50</div>
                </div>
                <div className="bg-gray-50 rounded-lg py-1.5">
                  <div className="text-sm font-bold text-gray-700">
                    {quote.quantity >= 1000 ? (quote.quantity / 1000).toFixed(0) + 'k' : quote.quantity}
                  </div>
                  <div className="text-[10px] text-gray-400">数量</div>
                </div>
              </div>

              <div className="flex items-center justify-between pt-2 border-t border-gray-100">
                {statusBadge(quote.status)}
                <div className="flex items-center gap-1 text-xs text-indigo-600 font-medium opacity-0 group-hover:opacity-100 transition-opacity">
                  查看详情 <ChevronRight size={12} />
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}

      {viewMode === 'list' && (
        <div className="bg-white rounded-2xl border shadow-sm overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                {['物料信息', '供应商报价', 'AI预测', '偏离度', '级别', '状态', '操作'].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filteredQuotes.map(quote => (
                <tr key={quote.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      {severityIcon(quote.severity_level)}
                      <div>
                        <div className="text-sm font-medium text-gray-900">{quote.material_name}</div>
                        <div className="text-xs text-gray-400">{quote.supplier_name}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sm font-mono font-semibold text-gray-900">{'¥' + quote.supplier_quote}</td>
                  <td className="px-4 py-3 text-sm font-mono text-indigo-600">
                    {'¥' + (quote.ai_prediction_low ?? '?') + ' ~ ¥' + (quote.ai_prediction_high ?? '?')}
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-sm font-mono font-semibold" style={{
                      color: quote.deviation_score > 60 ? '#ef4444' : quote.deviation_score > 40 ? '#f97316' : '#10b981'
                    }}>{quote.deviation_score}分</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={'text-xs px-2 py-0.5 rounded-full font-medium border ' + severityColor(quote.severity_level)}>
                      {quote.severity_level}
                    </span>
                  </td>
                  <td className="px-4 py-3">{statusBadge(quote.status)}</td>
                  <td className="px-4 py-3">
                    <Link to={'/quotes/' + quote.id}
                      className="flex items-center gap-1 text-xs text-indigo-600 font-medium hover:text-indigo-700">
                      详情 <ChevronRight size={12} />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {filteredQuotes.length === 0 && (
        <div className="text-center py-16 text-gray-400">
          <Search size={32} className="mx-auto mb-3 opacity-40" />
          <p className="text-sm">未找到匹配的报价记录</p>
        </div>
      )}
    </div>
  )
}
