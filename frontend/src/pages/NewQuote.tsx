import { useState, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { ArrowRight, ArrowLeft, Sparkles, Wand2, AlertCircle, TrendingUp, TrendingDown, Activity, Check, FileSearch } from 'lucide-react'
import { fetchExternalReferences } from '../utils/api'

// ── 预设模板 ──
const templates: Record<string, Record<string, string>> = {
  '塑料外壳': { category: '塑料外壳', material_type: 'ABS', dimensions: '80×60×15mm', processing: '注塑成型', precision: '±0.1mm', quantity: '50000' },
  'PCB板': { category: 'PCB板', material_type: 'FR-4', dimensions: '60×40×1.6mm', processing: '双面板沉金', precision: '±0.05mm', quantity: '25000' },
  '显示屏': { category: '显示屏', material_type: 'LCD', dimensions: '45×30×2mm', processing: 'COB封装', precision: '±0.05mm', quantity: '30000' },
  '传感器': { category: '传感器', material_type: 'MEMS', dimensions: '15×10×5mm', processing: 'SMT贴片', precision: '±0.01mm', quantity: '20000' },
  '按键': { category: '按键', material_type: '硅胶', dimensions: '30×20×5mm', processing: '模压成型', precision: '±0.1mm', quantity: '60000' },
  '袖带': { category: '袖带', material_type: '尼龙+TPU', dimensions: '220×120×3mm', processing: '缝制+热压', precision: '±2mm', quantity: '35000' },
}

const commonSuppliers = ['华塑科技', '晶显电子', '电路通科技', '芯感科技', '橡塑制品厂', '医疗器械配件厂']
const commonMaterialNames: Record<string, string[]> = {
  '塑料外壳': ['ABS注塑外壳', 'ABS注塑支架', '下外壳+电池仓'],
  'PCB板': ['主控PCB板', 'PCB板-体温计', '双面板'],
  '显示屏': ['LCD段码屏', 'LCD屏-体温计', 'OLED屏'],
  '传感器': ['压力传感器模组', '温度传感器', '血氧传感器'],
  '按键': ['硅胶按键组', '薄膜按键', '电容按键'],
  '袖带': ['血压计袖带', '成人袖带', '儿童袖带'],
}
const processingOptions: Record<string, string[]> = {
  '塑料外壳': ['注塑成型', '注塑+喷漆', '注塑+电镀'],
  'PCB板': ['单面板', '双面板', '双面板沉金'],
  '显示屏': ['COB封装', 'COG封装', 'SMT贴片'],
  '传感器': ['SMT贴片', '插件焊接', '封装测试'],
  '按键': ['模压成型', '注塑成型', '激光雕刻'],
  '袖带': ['缝制+热压', '高频焊接', '缝制'],
}
const precisionOptions = ['±0.01mm', '±0.05mm', '±0.1mm', '±0.2mm', '±0.5mm', '±1mm', '±2mm']

type Step = 1 | 2 | 3

const categories = Object.keys(templates)

export default function NewQuote() {
  const navigate = useNavigate()
  const [step, setStep] = useState<Step>(1)
  const [error] = useState('')

  const [formData, setFormData] = useState({
    material_name: '', supplier_quote: '', supplier_name: '',
    quantity: '10000', category: '塑料外壳', material_type: '',
    dimensions: '', processing: '', precision: '', description: '',
  })

  const [deviationPreview, setDeviationPreview] = useState<{ value: string; status: string; color: string } | null>(null)

  // ── 从其他页面跳转过来时预填数据（创建对比版本） ──
  const location = useLocation()
  const prefill = (location.state as any)?.prefill
  useEffect(() => {
    if (prefill) {
      setFormData(prev => ({ ...prev, ...prefill }))
    }
  }, [])  // 只在挂载时执行

  // 实时偏离估算
  useEffect(() => {
    if (!formData.supplier_quote || !formData.category) { setDeviationPreview(null); return }
    const timer = setTimeout(async () => {
      try {
        const res = await fetchExternalReferences(formData.category)
        const ref = res.references?.[0]
        if (!ref) return
        const mid = (ref.price_low + ref.price_high) / 2
        const quote = parseFloat(formData.supplier_quote)
        if (!isNaN(quote) && quote > 0 && mid > 0) {
          const dev = Math.abs(quote - mid) / mid * 100
          const status = dev < 20 ? '正常' : dev < 40 ? '关注' : dev < 60 ? '警示' : '紧急'
          const color = dev < 20 ? '#10b981' : dev < 40 ? '#eab308' : dev < 60 ? '#f97316' : '#ef4444'
          setDeviationPreview({ value: dev.toFixed(1), status, color })
        }
      } catch { /* ignore */ }
    }, 600)
    return () => clearTimeout(timer)
  }, [formData.supplier_quote, formData.category])

  const applyTemplate = (name: string) => {
    const t = templates[name]
    if (t) setFormData(prev => ({ ...prev, ...t }))
  }

  const isValidStep1 = formData.material_name && formData.supplier_quote && formData.supplier_name

  const handleSubmit = () => {
    // 立即跳转到进度页，API 调用在进度页完成
    navigate('/analysis/new', { state: { formData } })
  }

  return (
    <div className="h-full overflow-auto bg-[#f8fafc]">
      <div className="max-w-2xl mx-auto px-6 py-10 lg:py-14">
        {/* ─── 步骤指示器 ─── */}
        <div className="flex items-center justify-center gap-2 mb-8">
          {([1, 2, 3] as Step[]).map(s => (
            <div key={s} className="flex items-center gap-2">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all ${
                step === s ? 'bg-indigo-600 text-white shadow-md' :
                step > s ? 'bg-emerald-100 text-emerald-600' : 'bg-gray-100 text-gray-400'
              }`}>
                {step > s ? <Check size={14} /> : s}
              </div>
              <span className={`text-xs ${step === s ? 'text-indigo-600 font-medium' : 'text-gray-400'}`}>
                {s === 1 ? '基本信息' : s === 2 ? '详细信息' : '确认提交'}
              </span>
              {s < 3 && <div className={`w-8 h-px ${step > s ? 'bg-emerald-300' : 'bg-gray-200'}`} />}
            </div>
          ))}
        </div>

        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6 lg:p-8">
          {error && (
            <div className="mb-5 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700 flex items-center gap-2">
              <AlertCircle size={14} /> {error}
            </div>
          )}

          {/* ══════ Step 1: 基本信息 ══════ */}
          {step === 1 && (
            <div className="space-y-5">
              <div>
                <h2 className="text-lg font-bold text-gray-900">填写基本信息</h2>
                <p className="text-sm text-gray-400 mt-1">这些信息足够让 AI 开始分析</p>
              </div>

              <div className="space-y-4">
                {/* 物料名称 */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">物料名称 *</label>
                  <div className="relative">
                    <input type="text" value={formData.material_name}
                      onChange={e => setFormData(p => ({ ...p, material_name: e.target.value }))}
                      placeholder="例如：ABS注塑外壳"
                      className="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-200" />
                    <select value="" onChange={e => { if (e.target.value) setFormData(p => ({ ...p, material_name: e.target.value })) }}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-400 bg-transparent cursor-pointer">
                      <option value="">常用</option>
                      {(commonMaterialNames[formData.category] || []).map(n => <option key={n} value={n}>{n}</option>)}
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1.5">供应商 *</label>
                    <div className="relative">
                      <input type="text" value={formData.supplier_name}
                        onChange={e => setFormData(p => ({ ...p, supplier_name: e.target.value }))}
                        placeholder="供应商名称"
                        className="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-200" />
                      <select value="" onChange={e => { if (e.target.value) setFormData(p => ({ ...p, supplier_name: e.target.value })) }}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-400 bg-transparent cursor-pointer">
                        <option value="">常用</option>
                        {commonSuppliers.map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1.5">报价（元）*</label>
                    <input type="number" step="0.01" value={formData.supplier_quote}
                      onChange={e => setFormData(p => ({ ...p, supplier_quote: e.target.value }))}
                      placeholder="例如：8.50"
                      className="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-200" />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1.5">物料类别</label>
                    <select value={formData.category}
                      onChange={e => setFormData(p => ({ ...p, category: e.target.value, processing: '' }))}
                      className="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:border-indigo-400">
                      {categories.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1.5">数量（件）</label>
                    <input type="number" value={formData.quantity}
                      onChange={e => setFormData(p => ({ ...p, quantity: e.target.value }))}
                      className="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:border-indigo-400" />
                  </div>
                </div>
              </div>

              {/* 快速模板 */}
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <Wand2 size={13} className="text-indigo-400" />
                  <span className="text-xs text-gray-400">快速模板</span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {categories.map(name => (
                    <button key={name} type="button" onClick={() => applyTemplate(name)}
                      className="px-3 py-1.5 bg-gray-50 hover:bg-indigo-50 border border-gray-200 hover:border-indigo-200 rounded-lg text-xs text-gray-600 hover:text-indigo-600 transition-all">
                      {name}
                    </button>
                  ))}
                </div>
              </div>

              {/* 偏离预览 */}
              {deviationPreview && (
                <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg border border-gray-200">
                  <Activity size={16} style={{ color: deviationPreview.color }} />
                  <span className="text-sm text-gray-600">AI 估算偏离度：</span>
                  <span className="text-lg font-bold font-mono" style={{ color: deviationPreview.color }}>{deviationPreview.value}%</span>
                  <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ background: deviationPreview.color + '18', color: deviationPreview.color }}>
                    {deviationPreview.status}
                  </span>
                </div>
              )}

              <div className="flex justify-end pt-2">
                <button onClick={() => setStep(2)}
                  className="flex items-center gap-2 px-5 py-2.5 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors">
                  下一步 <ArrowRight size={15} />
                </button>
              </div>
            </div>
          )}

          {/* ══════ Step 2: 详细信息（可选）══════ */}
          {step === 2 && (
            <div className="space-y-5">
              <div>
                <h2 className="text-lg font-bold text-gray-900">补充详细信息</h2>
                <p className="text-sm text-gray-400 mt-1">选填，让 AI 分析更精准</p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">材料类型</label>
                  <input type="text" value={formData.material_type}
                    onChange={e => setFormData(p => ({ ...p, material_type: e.target.value }))}
                    placeholder="如 ABS、FR-4"
                    className="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-200" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">尺寸规格</label>
                  <input type="text" value={formData.dimensions}
                    onChange={e => setFormData(p => ({ ...p, dimensions: e.target.value }))}
                    placeholder="如 80×60×15mm"
                    className="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:border-indigo-400" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">精度要求</label>
                  <select value={formData.precision}
                    onChange={e => setFormData(p => ({ ...p, precision: e.target.value }))}
                    className="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:border-indigo-400 bg-white">
                    <option value="">请选择</option>
                    {precisionOptions.map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">加工工艺</label>
                  <div className="flex flex-wrap gap-1.5">
                    {(processingOptions[formData.category] || []).map(proc => (
                      <button key={proc} type="button" onClick={() => setFormData(p => ({ ...p, processing: proc }))}
                        className={`px-2.5 py-1 rounded-lg text-xs transition-all ${formData.processing === proc ? 'bg-indigo-100 text-indigo-600 border border-indigo-200' : 'bg-gray-50 text-gray-500 border border-gray-200 hover:bg-gray-100'}`}>
                        {proc}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">补充说明</label>
                  <textarea value={formData.description}
                    onChange={e => setFormData(p => ({ ...p, description: e.target.value }))}
                    placeholder="特殊工艺要求、医疗认证要求等..." rows={2}
                    className="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:border-indigo-400 resize-none" />
                </div>
              </div>

              <div className="flex items-center justify-between pt-2">
                <button onClick={() => setStep(1)}
                  className="flex items-center gap-2 px-4 py-2.5 text-sm text-gray-500 hover:text-gray-700 transition-colors">
                  <ArrowLeft size={15} /> 上一步
                </button>
                <button onClick={() => setStep(3)}
                  className="flex items-center gap-2 px-5 py-2.5 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors">
                  下一步 <ArrowRight size={15} />
                </button>
              </div>
            </div>
          )}

          {/* ══════ Step 3: 确认提交 ══════ */}
          {step === 3 && (
            <div className="space-y-5">
              <div>
                <h2 className="text-lg font-bold text-gray-900">确认并开始分析</h2>
                <p className="text-sm text-gray-400 mt-1">AI 将执行以下检查</p>
              </div>

              {/* 信息摘要 */}
              <div className="bg-gray-50 rounded-xl p-4 space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-gray-500">物料</span><span className="font-medium text-gray-900">{formData.material_name}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">供应商</span><span className="font-medium text-gray-900">{formData.supplier_name}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">报价</span><span className="font-bold text-gray-900">¥{formData.supplier_quote}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">数量</span><span className="text-gray-900">{parseInt(formData.quantity || '0').toLocaleString()} 件</span></div>
                <div className="flex justify-between"><span className="text-gray-500">类别</span><span className="text-gray-900">{formData.category}</span></div>
                {formData.processing && <div className="flex justify-between"><span className="text-gray-500">工艺</span><span className="text-gray-900">{formData.processing}</span></div>}
                {formData.dimensions && <div className="flex justify-between"><span className="text-gray-500">尺寸</span><span className="text-gray-900">{formData.dimensions}</span></div>}
              </div>

              {/* AI 检查清单 */}
              <div className="space-y-2">
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">AI 将执行</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {[
                    { icon: TrendingDown, label: '价格区间预测', desc: '贝叶斯模型计算合理价' },
                    { icon: FileSearch, label: '相似物料对比', desc: '检索历史采购记录' },
                    { icon: Activity, label: '成本结构拆解', desc: '行业基准对标分析' },
                    { icon: TrendingUp, label: '市场行情对比', desc: '1688 / 联网行情' },
                    { icon: Sparkles, label: 'AI 诊断分析', desc: 'LLM 定位异常根因' },
                    { icon: Check, label: '方案生成', desc: '自动产出应对策略' },
                  ].map((item, i) => (
                    <div key={i} className="flex items-start gap-2.5 p-2.5 bg-white rounded-lg border border-gray-100">
                      <item.icon size={14} className="text-indigo-500 mt-0.5 shrink-0" />
                      <div>
                        <div className="text-xs font-medium text-gray-800">{item.label}</div>
                        <div className="text-[11px] text-gray-400">{item.desc}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {deviationPreview && (
                <div className="flex items-center gap-3 p-3 rounded-lg border" style={{ borderColor: deviationPreview.color + '30', background: deviationPreview.color + '08' }}>
                  <Activity size={16} style={{ color: deviationPreview.color }} />
                  <span className="text-sm text-gray-600">当前报价偏离估算：</span>
                  <span className="text-lg font-bold font-mono" style={{ color: deviationPreview.color }}>{deviationPreview.value}%</span>
                  <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ background: deviationPreview.color + '18', color: deviationPreview.color }}>
                    {deviationPreview.status}
                  </span>
                </div>
              )}

              <div className="flex items-center justify-between pt-2">
                <button onClick={() => setStep(2)}
                  className="flex items-center gap-2 px-4 py-2.5 text-sm text-gray-500 hover:text-gray-700 transition-colors">
                  <ArrowLeft size={15} /> 上一步
                </button>
                <button onClick={handleSubmit} disabled={!isValidStep1}
                  className="flex items-center gap-2 px-8 py-3 bg-gradient-to-r from-indigo-600 to-purple-600 text-white rounded-xl text-base font-semibold hover:shadow-lg hover:shadow-indigo-200 transition-all disabled:opacity-50 shadow-md">
                  开始分析 <ArrowRight size={18} />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
