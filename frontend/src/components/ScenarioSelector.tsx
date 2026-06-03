import { useState } from 'react'
import {
  Zap, TrendingUp, CheckCircle, Globe,
  Play,
} from 'lucide-react'

interface Scenario {
  id: string
  title: string
  description: string
  category: string
  icon: any
  color: string
  bgColor: string
  difficulty: '简单' | '中等' | '复杂'
  quote: {
    material_name: string
    supplier_quote: number
    supplier_name: string
    quantity: number
    category: string
    deviation_score: number
    severity_level: string
    phase: string
  }
  highlights: string[]
  demo_note: string
}

const SCENARIOS: Scenario[] = [
  {
    id: 'supplier-premium',
    title: '供应商溢价诊断',
    description: '某供应商报价持续偏高，偏离度55分，AI 通过假设-验证循环定位到供应商系统性溢价问题',
    category: '典型异常',
    icon: TrendingUp,
    color: '#f97316',
    bgColor: 'bg-orange-50',
    difficulty: '中等',
    quote: {
      material_name: 'ABS注塑支架',
      supplier_quote: 12.50,
      supplier_name: '深圳塑料厂',
      quantity: 50000,
      category: '塑料外壳',
      deviation_score: 55,
      severity_level: '警示',
      phase: 'diagnosis',
    },
    highlights: [
      'DAG 全链路展示',
      '推理时间线动画',
      '假设验证过程',
      '诊断结论呈现',
    ],
    demo_note: '演示 Agent 如何通过多轮调查定位供应商溢价根因',
  },
  {
    id: 'market-trend',
    title: '市场行情驱动',
    description: '原材料涨价导致报价偏高，偏离度38分，AI 查市场行情和同行对比确认非供应商问题',
    category: '行情分析',
    icon: Globe,
    color: '#06b6d4',
    bgColor: 'bg-cyan-50',
    difficulty: '简单',
    quote: {
      material_name: 'LCD段码屏',
      supplier_quote: 7.80,
      supplier_name: '晶显电子',
      quantity: 30000,
      category: '显示屏',
      deviation_score: 38,
      severity_level: '关注',
      phase: 'diagnosis',
    },
    highlights: [
      '市场行情数据展示',
      '同行价格对比',
      '外部参考数据',
    ],
    demo_note: '演示 Agent 如何利用外部数据排除误判',
  },
  {
    id: 'fast-pass',
    title: '快速通道',
    description: '报价在预测区间内，偏离度12分，AI 自动通过，无需人工干预，全程仅展示 DAG',
    category: '正常报价',
    icon: CheckCircle,
    color: '#10b981',
    bgColor: 'bg-emerald-50',
    difficulty: '简单',
    quote: {
      material_name: '硅胶按键组',
      supplier_quote: 0.75,
      supplier_name: '橡塑制品厂',
      quantity: 60000,
      category: '按键',
      deviation_score: 12,
      severity_level: '正常',
      phase: 'fast_pass',
    },
    highlights: [
      'DAG 简洁展示',
      '自动通过动画',
      '无人工节点',
    ],
    demo_note: '演示偏离度 < 20 时的快速通道自动处理流程',
  },
  {
    id: 'urgent-escalation',
    title: '紧急升级',
    description: '报价严重偏离，偏离度78分，AI 生成紧急诊断结论，人类必须确认后才能执行方案',
    category: '高危异常',
    icon: Zap,
    color: '#ef4444',
    bgColor: 'bg-red-50',
    difficulty: '复杂',
    quote: {
      material_name: '压力传感器模组',
      supplier_quote: 22.80,
      supplier_name: '新供应商A',
      quantity: 20000,
      category: '传感器',
      deviation_score: 78,
      severity_level: '紧急',
      phase: 'diagnosis',
    },
    highlights: [
      'DAG + 推理链联动',
      'Override 操作',
      'Diff View 对比',
      '强制人工确认',
    ],
    demo_note: '演示偏离度 ≥ 60 时的紧急升级和 Override 流程',
  },
]

interface ScenarioSelectorProps {
  onSelectScenario: (scenario: Scenario) => void
}

export default function ScenarioSelector({ onSelectScenario }: ScenarioSelectorProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [filterCategory, setFilterCategory] = useState<string | null>(null)

  const categories = Array.from(new Set(SCENARIOS.map(s => s.category)))
  const filtered = filterCategory ? SCENARIOS.filter(s => s.category === filterCategory) : SCENARIOS

  return (
    <div className="space-y-6">
      {/* Category filter */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-sm text-gray-500">场景分类：</span>
        <button
          onClick={() => setFilterCategory(null)}
          className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
            !filterCategory ? 'bg-indigo-100 text-indigo-700 border border-indigo-300' : 'bg-gray-100 text-gray-600 border border-gray-200 hover:bg-gray-200'
          }`}
        >
          全部
        </button>
        {categories.map(cat => (
          <button
            key={cat}
            onClick={() => setFilterCategory(cat)}
            className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
              filterCategory === cat ? 'bg-indigo-100 text-indigo-700 border border-indigo-300' : 'bg-gray-100 text-gray-600 border border-gray-200 hover:bg-gray-200'
            }`}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* Scenario grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {filtered.map(scenario => {
          const Icon = scenario.icon
          return (
            <div
              key={scenario.id}
              onClick={() => setSelectedId(scenario.id)}
              className={`cursor-pointer rounded-xl border-2 p-6 transition-all hover:shadow-md ${
                selectedId === scenario.id
                  ? `${scenario.bgColor} border-2`
                  : 'bg-white border-gray-100 hover:border-gray-300'
              }`}
              style={selectedId === scenario.id ? { borderColor: scenario.color } : {}}
            >
              {/* Header */}
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-2.5">
                  <div
                    className="w-9 h-9 rounded-xl flex items-center justify-center"
                    style={{ background: scenario.color + '20' }}
                  >
                    <Icon size={18} style={{ color: scenario.color }} />
                  </div>
                  <div>
                    <div className="text-sm font-bold text-gray-900">{scenario.title}</div>
                    <div className="text-xs text-gray-400">{scenario.category}</div>
                  </div>
                </div>
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                  scenario.difficulty === '复杂' ? 'bg-red-100 text-red-600' :
                  scenario.difficulty === '中等' ? 'bg-yellow-100 text-yellow-700' :
                  'bg-green-100 text-green-600'
                }`}>
                  {scenario.difficulty}
                </span>
              </div>

              {/* Description */}
              <p className="text-sm text-gray-600 mb-4 leading-relaxed">
                {scenario.description}
              </p>

              {/* KPI preview */}
              <div className="grid grid-cols-3 gap-2 mb-3">
                <div className="text-center bg-white/60 rounded-lg py-1.5">
                  <div className="text-base font-bold" style={{ color: scenario.color }}>
                    {scenario.quote.deviation_score}分
                  </div>
                  <div className="text-[10px] text-gray-400">偏离度</div>
                </div>
                <div className="text-center bg-white/60 rounded-lg py-1.5">
                  <div className="text-base font-bold text-gray-700">
                    ¥{scenario.quote.supplier_quote}
                  </div>
                  <div className="text-[10px] text-gray-400">报价</div>
                </div>
                <div className="text-center bg-white/60 rounded-lg py-1.5">
                  <div className={`text-xs font-bold px-1.5 py-0.5 rounded ${
                    scenario.quote.severity_level === '紧急' ? 'bg-red-100 text-red-600' :
                    scenario.quote.severity_level === '警示' ? 'bg-orange-100 text-orange-600' :
                    scenario.quote.severity_level === '关注' ? 'bg-yellow-100 text-yellow-700' :
                    'bg-green-100 text-green-600'
                  }`}>
                    {scenario.quote.severity_level}
                  </div>
                  <div className="text-[10px] text-gray-400">级别</div>
                </div>
              </div>

              {/* Highlights */}
              <div className="flex flex-wrap gap-1 mb-3">
                {scenario.highlights.map(h => (
                  <span key={h} className="text-[10px] px-1.5 py-0.5 rounded-full bg-white/60 text-gray-500 border border-gray-200">
                    {h}
                  </span>
                ))}
              </div>

              {/* Demo note */}
              <div className="text-xs text-gray-400 italic mb-3">
                {scenario.demo_note}
              </div>

              {/* Action */}
              <button
                onClick={(e) => { e.stopPropagation(); onSelectScenario(scenario) }}
                className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg text-sm font-medium transition-colors"
                style={{ background: scenario.color, color: '#fff' }}
              >
                <Play size={14} />
                演示此场景
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
