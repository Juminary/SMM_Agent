import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowRight,
  Loader2,
  AlertCircle,
  ChevronDown,
  ChevronUp,
  Sparkles,
  Wand2,
  Search,
  TrendingUp,
  TrendingDown,
  Activity
} from 'lucide-react'
import { analyzeQuote, fetchSimilarMaterials, fetchExternalReferences } from '../utils/api'

// 预设模板
const templates = {
  '塑料外壳': {
    category: '塑料外壳',
    material_type: 'ABS',
    dimensions: '80×60×15mm',
    processing: '注塑成型',
    precision: '±0.1mm',
    quantity: '50000'
  },
  'PCB板': {
    category: 'PCB板',
    material_type: 'FR-4',
    dimensions: '60×40×1.6mm',
    processing: '双面板沉金',
    precision: '±0.05mm',
    quantity: '25000'
  },
  '显示屏': {
    category: '显示屏',
    material_type: 'LCD',
    dimensions: '45×30×2mm',
    processing: 'COB封装',
    precision: '±0.05mm',
    quantity: '30000'
  },
  '传感器': {
    category: '传感器',
    material_type: 'MEMS',
    dimensions: '15×10×5mm',
    processing: 'SMT贴片',
    precision: '±0.01mm',
    quantity: '20000'
  },
  '按键': {
    category: '按键',
    material_type: '硅胶',
    dimensions: '30×20×5mm',
    processing: '模压成型',
    precision: '±0.1mm',
    quantity: '60000'
  },
  '袖带': {
    category: '袖带',
    material_type: '尼龙+TPU',
    dimensions: '220×120×3mm',
    processing: '缝制+热压',
    precision: '±2mm',
    quantity: '35000'
  }
}

// 常用供应商
const commonSuppliers = [
  '华塑科技',
  '晶显电子',
  '电路通科技',
  '芯感科技',
  '橡塑制品厂',
  '医疗器械配件厂',
  '微电机厂',
  '精密五金厂',
  '包装印刷厂'
]

// 常用物料名称（按类别）
const commonMaterialNames: Record<string, string[]> = {
  '塑料外壳': ['ABS注塑外壳', 'ABS注塑支架', '下外壳+电池仓', 'PC外壳', 'PP外壳'],
  'PCB板': ['主控PCB板', 'PCB板-体温计', '双面板', '四层板', '沉金PCB'],
  '显示屏': ['LCD段码屏', 'LCD屏-体温计', 'OLED屏', 'TFT彩屏', '数码管'],
  '传感器': ['压力传感器模组', '温度传感器', '血氧传感器', '红外传感器'],
  '按键': ['硅胶按键组', '薄膜按键', '电容按键', '机械按键'],
  '袖带': ['血压计袖带', '成人袖带', '儿童袖带', '腕式袖带'],
  '电机': ['微型充气泵', '微型电机', '步进电机', '直流电机'],
  '连接器': ['血糖试纸连接器', 'USB连接器', '排针连接器', 'FPC连接器'],
  '包装': ['包装盒', '吸塑盒', '说明书', '标签贴纸'],
  '五金件': ['电池弹簧片', '螺丝套件', '金属支架', '屏蔽罩']
}

// 工艺选项（按类别）
const processingOptions: Record<string, string[]> = {
  '塑料外壳': ['注塑成型', '注塑+喷漆', '注塑+电镀', '吹塑成型'],
  'PCB板': ['单面板', '双面板', '双面板沉金', '多层板'],
  '显示屏': ['COB封装', 'COG封装', 'SMT贴片', '邦定'],
  '传感器': ['SMT贴片', '插件焊接', '封装测试'],
  '按键': ['模压成型', '注塑成型', '激光雕刻'],
  '袖带': ['缝制+热压', '高频焊接', '缝制'],
  '电机': ['组装', '绕线+组装', '贴片+组装'],
  '连接器': ['冲压+镀金', '注塑+插针', '组装'],
  '包装': ['印刷+覆膜', '烫金', 'UV印刷']
}

// 精度选项
const precisionOptions = [
  '±0.01mm',
  '±0.05mm',
  '±0.1mm',
  '±0.2mm',
  '±0.5mm',
  '±1mm',
  '±2mm'
]

export default function NewQuote() {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [showAdvanced, setShowAdvanced] = useState(false)

  const [formData, setFormData] = useState({
    material_id: '',
    material_name: '',
    supplier_quote: '',
    supplier_name: '',
    quantity: '10000',
    category: '塑料外壳',
    material_type: '',
    dimensions: '',
    processing: '',
    precision: '',
    description: ''
  })

  // 实时分析结果状态
  const [realtimeAnalysis, setRealtimeAnalysis] = useState({
    similarMaterials: [] as any[],
    pricePrediction: null as { low: number; high: number; mid: number } | null,
    deviation: null as { value: number; status: string } | null,
    loading: false
  })

  // 防抖定时器
  const [debounceTimer, setDebounceTimer] = useState<ReturnType<typeof setTimeout> | null>(null)

  // 实时分析函数
  const performRealtimeAnalysis = useCallback(async () => {
    const { material_name, category, supplier_quote } = formData

    if (!material_name && !supplier_quote) return

    setRealtimeAnalysis(prev => ({ ...prev, loading: true }))

    try {
      // 1. 获取相似物料（当物料名称或类别变化时）
      if (material_name || category) {
        const similarRes = await fetchSimilarMaterials(material_name, category)
        setRealtimeAnalysis(prev => ({
          ...prev,
          similarMaterials: similarRes.materials.slice(0, 3)
        }))
      }

      // 2+3. 获取外部参考数据（价格预测 + 偏离度估算，一次请求）
      if (category) {
        try {
          const extRes = await fetchExternalReferences(category)
          if (extRes.references?.length > 0) {
            const ref = extRes.references[0]
            const mid = (ref.price_low + ref.price_high) / 2
            setRealtimeAnalysis(prev => ({
              ...prev,
              pricePrediction: { low: ref.price_low, high: ref.price_high, mid },
            }))
            // 偏离度估算
            if (supplier_quote) {
              const quote = parseFloat(supplier_quote)
              if (!isNaN(quote) && quote > 0 && mid > 0) {
                const dev = Math.abs(quote - mid) / mid * 100
                const status = dev < 20 ? '正常' : dev < 40 ? '关注' : dev < 60 ? '警示' : '紧急'
                setRealtimeAnalysis(prev => ({
                  ...prev,
                  deviation: { value: Math.round(dev * 10) / 10, status },
                }))
              }
            }
          }
        } catch (_) { /* ignore */ }
      }
    } catch (err) {
      console.error('Realtime analysis error:', err)
    } finally {
      setRealtimeAnalysis(prev => ({ ...prev, loading: false }))
    }
  }, [formData])

  // 监听表单变化，触发实时分析
  useEffect(() => {
    if (debounceTimer) clearTimeout(debounceTimer)

    const timer = setTimeout(() => {
      performRealtimeAnalysis()
    }, 500) // 500ms 防抖

    setDebounceTimer(timer)

    return () => {
      if (timer) clearTimeout(timer)
    }
  }, [formData.material_name, formData.category, formData.supplier_quote, performRealtimeAnalysis])

  // 应用模板
  const applyTemplate = (templateName: string) => {
    const template = templates[templateName as keyof typeof templates]
    if (template) {
      setFormData(prev => ({
        ...prev,
        ...template
      }))
    }
  }

  // 快速填充供应商
  const fillSupplier = (name: string) => {
    setFormData(prev => ({ ...prev, supplier_name: name }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')

    try {
      // 构建提交数据，空值使用默认值
      const submitData = {
        ...formData,
        supplier_quote: parseFloat(formData.supplier_quote),
        quantity: parseInt(formData.quantity) || 10000,
        quote_date: new Date().toISOString().split('T')[0]
      }

      const result = await analyzeQuote(submitData)
      navigate(`/quotes/${result.id}`)
    } catch (err: any) {
      setError(err.message || '分析失败，请重试')
    } finally {
      setLoading(false)
    }
  }

  const categories = Object.keys(templates)

  // 检查是否填写了必填项
  const isValid = formData.material_name && formData.supplier_quote && formData.supplier_name

  return (
    <div className="h-full overflow-auto p-4 sm:p-6 lg:p-8 bg-[#f8fafc]">
      {/* Header */}
      <div className="mb-6 lg:mb-8">
        <h1 className="text-2xl lg:text-3xl font-bold text-gray-900 mb-2">新建报价分析</h1>
        <p className="text-gray-600 text-sm lg:text-base">
          输入供应商报价信息，AI将自动分析异常并生成应对方案
        </p>
      </div>

      {error && (
        <div className="mb-6 p-4 bg-danger/10 border border-danger/20 rounded-lg flex items-center gap-3 text-danger">
          <AlertCircle className="w-5 h-5" />
          {error}
        </div>
      )}

      {/* Quick Templates */}
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-3">
          <Wand2 className="w-4 h-4 text-accent" />
          <span className="text-sm text-gray-500">快速模板</span>
        </div>
        <div className="flex flex-wrap gap-2">
          {categories.map(template => (
            <button
              key={template}
              onClick={() => applyTemplate(template)}
              className="px-3 py-1.5 bg-gray-100 hover:bg-primary/20 border border-gray-200 hover:border-primary/30 rounded-lg text-sm text-gray-600 hover:text-primary transition-all"
            >
              {template}
            </button>
          ))}
        </div>
      </div>

      <form onSubmit={handleSubmit} className="max-w-3xl">
        <div className="glass rounded-xl p-4 sm:p-6 space-y-6 bg-white border border-gray-200 shadow-sm">

          {/* Section 1: 必填信息 */}
          <div>
            <h3 className="text-sm font-medium text-gray-900 mb-4 flex items-center gap-2">
              <span className="w-6 h-6 rounded-full bg-primary/20 text-primary flex items-center justify-center text-xs">1</span>
              基本信息
              <span className="text-xs text-danger">*必填</span>
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* 物料名称 */}
              <div className="col-span-2">
                <label className="block text-sm text-gray-600 mb-2">
                  物料名称 <span className="text-danger">*</span>
                </label>
                <div className="relative">
                  <input
                    type="text"
                    value={formData.material_name}
                    onChange={(e) => setFormData({ ...formData, material_name: e.target.value })}
                    placeholder="选择或输入物料名称"
                    className="w-full px-4 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 placeholder-gray-400 focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                    required
                  />
                  {/* 常用物料名称下拉 */}
                  <div className="absolute right-2 top-1/2 -translate-y-1/2">
                    <select
                      value=""
                      onChange={(e) => {
                        if (e.target.value) {
                          setFormData(prev => ({ ...prev, material_name: e.target.value }))
                        }
                      }}
                      className="bg-transparent text-xs text-gray-500 cursor-pointer"
                    >
                      <option value="">常用物料</option>
                      {(commonMaterialNames[formData.category] || []).map(name => (
                        <option key={name} value={name}>{name}</option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              {/* 物料类别 */}
              <div>
                <label className="block text-sm text-gray-600 mb-2">物料类别</label>
                <select
                  value={formData.category}
                  onChange={(e) => {
                    const newCategory = e.target.value
                    setFormData(prev => ({
                      ...prev,
                      category: newCategory,
                      processing: '' // 重置工艺
                    }))
                  }}
                  className="w-full px-4 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                >
                  {categories.map(cat => (
                    <option key={cat} value={cat}>{cat}</option>
                  ))}
                </select>
              </div>

              {/* 供应商名称 */}
              <div>
                <label className="block text-sm text-gray-600 mb-2">
                  供应商名称 <span className="text-danger">*</span>
                </label>
                <div className="relative">
                  <input
                    type="text"
                    value={formData.supplier_name}
                    onChange={(e) => setFormData({ ...formData, supplier_name: e.target.value })}
                    placeholder="选择或输入"
                    className="w-full px-4 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 placeholder-gray-400 focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                    required
                  />
                  {/* 常用供应商下拉 */}
                  <div className="absolute right-2 top-1/2 -translate-y-1/2">
                    <select
                      value=""
                      onChange={(e) => e.target.value && fillSupplier(e.target.value)}
                      className="bg-transparent text-xs text-gray-500 cursor-pointer"
                    >
                      <option value="">常用</option>
                      {commonSuppliers.map(s => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              {/* 供应商报价 */}
              <div>
                <label className="block text-sm text-gray-600 mb-2">
                  供应商报价（元） <span className="text-danger">*</span>
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={formData.supplier_quote}
                  onChange={(e) => setFormData({ ...formData, supplier_quote: e.target.value })}
                  placeholder="例如：8.50"
                  className="w-full px-4 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 placeholder-gray-400 focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                  required
                />
              </div>

              {/* 采购数量 */}
              <div>
                <label className="block text-sm text-gray-600 mb-2">采购数量</label>
                <div className="relative">
                  <input
                    type="number"
                    value={formData.quantity}
                    onChange={(e) => setFormData({ ...formData, quantity: e.target.value })}
                    placeholder="例如：10000"
                    className="w-full px-4 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 placeholder-gray-400 focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-500">件</span>
                </div>
              </div>
            </div>
          </div>

          {/* Section 2: 可选详细信息（可折叠） */}
          <div className="border-t border-gray-200 pt-6">
            <button
              type="button"
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900 transition-colors mb-4"
            >
              {showAdvanced ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              详细信息（可选）
              <span className="text-xs text-gray-400">用于提高分析精度</span>
            </button>

            {showAdvanced && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 animate-fade-in">
                {/* 物料ID */}
                <div>
                  <label className="block text-sm text-gray-600 mb-2">物料ID</label>
                  <input
                    type="text"
                    value={formData.material_id}
                    onChange={(e) => setFormData({ ...formData, material_id: e.target.value })}
                    placeholder="例如：MAT-NEW-001（留空自动生成）"
                    className="w-full px-4 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 placeholder-gray-400 focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                  />
                </div>

                {/* 材料类型 */}
                <div>
                  <label className="block text-sm text-gray-600 mb-2">材料类型</label>
                  <input
                    type="text"
                    value={formData.material_type}
                    onChange={(e) => setFormData({ ...formData, material_type: e.target.value })}
                    placeholder="例如：ABS、FR-4、LCD"
                    className="w-full px-4 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 placeholder-gray-400 focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                  />
                </div>

                {/* 尺寸规格 */}
                <div>
                  <label className="block text-sm text-gray-600 mb-2">尺寸规格</label>
                  <input
                    type="text"
                    value={formData.dimensions}
                    onChange={(e) => setFormData({ ...formData, dimensions: e.target.value })}
                    placeholder="例如：80×60×15mm"
                    className="w-full px-4 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 placeholder-gray-400 focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                  />
                </div>

                {/* 精度要求 */}
                <div>
                  <label className="block text-sm text-gray-600 mb-2">精度要求</label>
                  <select
                    value={formData.precision}
                    onChange={(e) => setFormData({ ...formData, precision: e.target.value })}
                    className="w-full px-4 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                  >
                    <option value="">请选择</option>
                    {precisionOptions.map(p => (
                      <option key={p} value={p}>{p}</option>
                    ))}
                  </select>
                </div>

                {/* 加工工艺 */}
                <div className="col-span-2">
                  <label className="block text-sm text-gray-600 mb-2">加工工艺</label>
                  <div className="flex flex-wrap gap-2">
                    {(processingOptions[formData.category] || []).map(proc => (
                      <button
                        key={proc}
                        type="button"
                        onClick={() => setFormData(prev => ({ ...prev, processing: proc }))}
                        className={`px-3 py-1.5 rounded-lg text-sm transition-all ${
                          formData.processing === proc
                            ? 'bg-primary/20 text-primary border border-primary/30'
                            : 'bg-gray-100 text-gray-600 border border-gray-200 hover:bg-gray-200'
                        }`}
                      >
                        {proc}
                      </button>
                    ))}
                    <input
                      type="text"
                      value={formData.processing}
                      onChange={(e) => setFormData({ ...formData, processing: e.target.value })}
                      placeholder="或输入其他工艺"
                      className="flex-1 min-w-[150px] px-3 py-1.5 bg-white border border-gray-300 rounded-lg text-gray-900 placeholder-gray-400 focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary text-sm"
                    />
                  </div>
                </div>

                {/* 补充说明 */}
                <div className="col-span-2">
                  <label className="block text-sm text-gray-600 mb-2">补充说明</label>
                  <textarea
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    placeholder="添加物料的详细描述、特殊要求等..."
                    rows={3}
                    className="w-full px-4 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 placeholder-gray-400 focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary resize-none"
                  />
                </div>
              </div>
            )}
          </div>

          {/* AI提示 */}
          <div className="bg-accent/5 border border-accent/20 rounded-lg p-4 flex items-start gap-3">
            <Sparkles className="w-5 h-5 text-accent flex-shrink-0 mt-0.5" />
            <div className="text-sm text-gray-600">
              <p className="text-gray-900 font-medium mb-1">AI分析提示</p>
              <p>填写更多信息可以帮助AI更准确地分析报价异常。至少需要填写物料名称、供应商和报价即可开始分析。</p>
            </div>
          </div>

          {/* 实时分析结果面板 */}
          {(realtimeAnalysis.similarMaterials.length > 0 || realtimeAnalysis.pricePrediction || realtimeAnalysis.deviation) && (
            <div className="border-t border-gray-200 pt-6">
              <div className="flex items-center gap-2 mb-4">
                <Activity className="w-4 h-4 text-primary" />
                <span className="text-sm font-medium text-gray-900">实时分析结果</span>
                {realtimeAnalysis.loading && (
                  <Loader2 className="w-4 h-4 text-primary animate-spin" />
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {/* 相似物料 */}
                {realtimeAnalysis.similarMaterials.length > 0 && (
                  <div className="bg-gray-50 rounded-lg p-4">
                    <div className="flex items-center gap-2 mb-3">
                      <Search className="w-4 h-4 text-purple-500" />
                      <span className="text-sm text-gray-600">相似历史物料</span>
                    </div>
                    <div className="space-y-2">
                      {realtimeAnalysis.similarMaterials.map((mat, idx) => (
                        <div key={idx} className="flex items-center justify-between text-sm">
                          <span className="text-gray-900 truncate">{mat.name}</span>
                          <span className="text-accent">¥{mat.unit_price}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* 价格预测 */}
                {realtimeAnalysis.pricePrediction && (
                  <div className="bg-gray-50 rounded-lg p-4">
                    <div className="flex items-center gap-2 mb-3">
                      <TrendingUp className="w-4 h-4 text-cyan-500" />
                      <span className="text-sm text-gray-600">AI价格预测</span>
                    </div>
                    <div className="space-y-2">
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-600">区间</span>
                        <span className="text-gray-900">¥{realtimeAnalysis.pricePrediction.low.toFixed(2)} ~ {realtimeAnalysis.pricePrediction.high.toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-600">中位数</span>
                        <span className="text-accent">¥{realtimeAnalysis.pricePrediction.mid.toFixed(2)}</span>
                      </div>
                    </div>
                  </div>
                )}

                {/* 偏离度 */}
                {realtimeAnalysis.deviation && (
                  <div className="bg-gray-50 rounded-lg p-4">
                    <div className="flex items-center gap-2 mb-3">
                      <TrendingDown className="w-4 h-4 text-rose-500" />
                      <span className="text-sm text-gray-600">偏离度分析</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className={`text-2xl font-bold ${
                        realtimeAnalysis.deviation.value < 20 ? 'text-success' :
                        realtimeAnalysis.deviation.value < 40 ? 'text-warning' :
                        realtimeAnalysis.deviation.value < 60 ? 'text-orange-500' :
                        'text-danger'
                      }`}>
                        {realtimeAnalysis.deviation.value}%
                      </div>
                      <span className={`text-xs px-2 py-1 rounded ${
                        realtimeAnalysis.deviation.status === '正常' ? 'bg-success/20 text-success' :
                        realtimeAnalysis.deviation.status === '关注' ? 'bg-warning/20 text-warning' :
                        realtimeAnalysis.deviation.status === '警示' ? 'bg-orange-500/20 text-orange-500' :
                        'bg-danger/20 text-danger'
                      }`}>
                        {realtimeAnalysis.deviation.status}
                      </span>
                    </div>
                    {formData.supplier_quote && realtimeAnalysis.pricePrediction && (
                      <div className="mt-2 text-xs text-gray-500">
                        报价¥{formData.supplier_quote} vs 预测¥{realtimeAnalysis.pricePrediction.mid.toFixed(2)}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Submit */}
          <div className="flex items-center justify-end gap-4 pt-4 border-t border-gray-200">
            <button
              type="button"
              onClick={() => navigate('/quotes')}
              className="px-6 py-2 text-gray-600 hover:text-gray-900 transition-colors"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={loading || !isValid}
              className="flex items-center gap-2 px-6 py-2 bg-gradient-to-r from-primary to-accent text-white rounded-lg font-medium hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  分析中...
                </>
              ) : (
                <>
                  开始分析
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </div>
        </div>
      </form>
    </div>
  )
}
