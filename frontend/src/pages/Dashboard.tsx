import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Plus, AlertTriangle, Clock, ArrowRight, FileText } from 'lucide-react'
import { fetchQuotes, fetchStats } from '../utils/api'
import type { Quote, Stats } from '../types'

const SEVERITY_CONFIG: Record<string, { color: string; bg: string; label: string }> = {
  '紧急': { color: '#ef4444', bg: 'bg-red-50', label: '需立即处理' },
  '警示': { color: '#f97316', bg: 'bg-orange-50', label: '需关注' },
  '关注': { color: '#eab308', bg: 'bg-yellow-50', label: '可观察' },
  '正常': { color: '#10b981', bg: 'bg-emerald-50', label: '已通过' },
}

export default function Dashboard() {
  const navigate = useNavigate()
  const [quotes, setQuotes] = useState<Quote[]>([])
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([fetchQuotes({ limit: 20 }), fetchStats()])
      .then(([quotesRes, statsRes]) => {
        setQuotes(quotesRes.quotes)
        setStats(statsRes)
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  const pendingQuotes = quotes.filter(q => q.status === 'pending' && q.severity_level !== '正常').slice(0, 4)
  const recentQuotes = quotes.slice(0, 8)

  if (loading) return (
    <div className="h-full flex items-center justify-center bg-[#f8fafc]">
      <div className="animate-spin h-8 w-8 border-2 border-indigo-500 border-t-transparent rounded-full" />
    </div>
  )

  return (
    <div className="h-full overflow-auto bg-[#f8fafc]">
      <div className="max-w-4xl mx-auto px-6 py-10 lg:py-16">
        {/* ─── Hero CTA ─── */}
        <div className="text-center mb-12">
          <h1 className="text-3xl font-bold text-gray-900 tracking-tight mb-3">
            供销异常分析工作台
          </h1>
          <p className="text-gray-400 text-sm mb-8 max-w-md mx-auto leading-6">
            输入供应商报价，AI 自动检测异常、定位根因、生成应对方案
          </p>
          <button
            onClick={() => navigate('/quotes/new')}
            className="inline-flex items-center gap-3 px-8 py-4 bg-gradient-to-r from-indigo-600 to-purple-600 text-white rounded-2xl text-base font-semibold hover:shadow-lg hover:shadow-indigo-200 transition-all shadow-md"
          >
            <Plus size={22} />
            新建报价分析
          </button>
        </div>

        {/* ─── 快速统计（极简） ─── */}
        {stats && (
          <div className="flex items-center justify-center gap-8 mb-12 text-sm">
            <div className="text-center">
              <div className="text-2xl font-bold text-gray-800">{stats.total_quotes}</div>
              <div className="text-gray-400 mt-0.5">总分析</div>
            </div>
            <div className="w-px h-8 bg-gray-200" />
            <div className="text-center">
              <div className="text-2xl font-bold text-indigo-600">{stats.avg_deviation_score}</div>
              <div className="text-gray-400 mt-0.5">平均偏离</div>
            </div>
            <div className="w-px h-8 bg-gray-200" />
            <div className="text-center">
              <div className="text-2xl font-bold text-emerald-600">¥{((stats.total_potential_savings || 0) / 10000).toFixed(1)}万</div>
              <div className="text-gray-400 mt-0.5">预估节省</div>
            </div>
          </div>
        )}

        {/* ─── 需要关注 ─── */}
        {pendingQuotes.length > 0 && (
          <section className="mb-8">
            <h2 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
              <AlertTriangle size={14} className="text-amber-500" />
              需要关注
              <span className="text-xs text-gray-400 font-normal">({pendingQuotes.length})</span>
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {pendingQuotes.map(q => {
                const cfg = SEVERITY_CONFIG[q.severity_level] || SEVERITY_CONFIG['正常']
                return (
                  <Link key={q.id} to={`/quotes/${q.id}`}
                    className={`flex items-center gap-4 p-4 rounded-xl border ${cfg.bg} hover:shadow-sm transition-all`}
                    style={{ borderColor: cfg.color + '30' }}>
                    <div className="w-10 h-10 rounded-full flex items-center justify-center shrink-0" style={{ background: cfg.color + '18' }}>
                      <AlertTriangle size={18} style={{ color: cfg.color }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-semibold text-gray-900 truncate">{q.material_name}</span>
                        <span className="text-xs font-bold font-mono shrink-0 ml-2" style={{ color: cfg.color }}>{q.deviation_score}分</span>
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-xs text-gray-400 truncate">{q.supplier_name} · ¥{q.supplier_quote}</span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium" style={{ background: cfg.color + '18', color: cfg.color }}>
                          {q.severity_level}
                        </span>
                      </div>
                    </div>
                    <ArrowRight size={14} className="text-gray-300 shrink-0" />
                  </Link>
                )
              })}
            </div>
          </section>
        )}

        {/* ─── 最近分析 ─── */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
              <Clock size={14} className="text-gray-400" />
              最近分析
            </h2>
            {recentQuotes.length > 0 && (
              <Link to="/quotes" className="text-xs text-indigo-600 font-medium hover:text-indigo-700">查看全部 →</Link>
            )}
          </div>

          {recentQuotes.length === 0 ? (
            <div className="text-center py-12 bg-white rounded-xl border border-gray-200">
              <FileText size={32} className="mx-auto mb-3 text-gray-300" />
              <p className="text-sm text-gray-400 mb-4">还没有分析记录</p>
              <button
                onClick={() => navigate('/quotes/new')}
                className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors"
              >
                <Plus size={14} /> 开始第一次分析
              </button>
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              {recentQuotes.map((q, i) => (
                <Link key={q.id} to={`/quotes/${q.id}`}
                  className={`flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors ${i < recentQuotes.length - 1 ? 'border-b border-gray-100' : ''}`}>
                  <div className="w-2 h-2 rounded-full shrink-0" style={{
                    backgroundColor: q.severity_level === '紧急' ? '#ef4444' : q.severity_level === '警示' ? '#f97316' : q.severity_level === '关注' ? '#eab308' : '#10b981'
                  }} />
                  <span className="text-sm text-gray-900 flex-1 min-w-0 truncate">{q.material_name}</span>
                  <span className="text-xs text-gray-400 hidden sm:inline">{q.supplier_name}</span>
                  <span className="text-xs font-mono font-semibold" style={{
                    color: q.deviation_score > 60 ? '#ef4444' : q.deviation_score > 40 ? '#f97316' : q.deviation_score > 20 ? '#eab308' : '#10b981'
                  }}>{q.deviation_score}分</span>
                  <ArrowRight size={12} className="text-gray-300 shrink-0" />
                </Link>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
