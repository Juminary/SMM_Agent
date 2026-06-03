import { ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'
import {
  LayoutDashboard,
  FileText,
  Plus,
  BarChart3,
  Cpu,
  PlayCircle
} from 'lucide-react'

interface LayoutProps {
  children: ReactNode
}

const navItems = [
  { path: '/demo', icon: PlayCircle, label: '演示中心' },
  { path: '/', icon: LayoutDashboard, label: '工作台' },
  { path: '/quotes', icon: FileText, label: '异常列表' },
  { path: '/stats', icon: BarChart3, label: '统计分析' },
]

export default function Layout({ children }: LayoutProps) {
  const location = useLocation()

  return (
    <div className="flex h-screen bg-[#f8fafc]">
      {/* Sidebar */}
      <aside className="w-64 bg-white border-r border-gray-200 flex flex-col shadow-sm">
        {/* Logo */}
        <div className="p-7 border-b border-gray-100">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary to-accent flex items-center justify-center shadow-sm">
              <Cpu className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="font-bold text-lg text-gray-900 tracking-tight">供销异常Agent</h1>
              <p className="text-[11px] text-gray-400">九安医疗 BOM 成本核算</p>
            </div>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 p-5 space-y-1.5">
          {navItems.map((item) => {
            const isActive = location.pathname === item.path
            return (
              <Link
                key={item.path}
                to={item.path}
                className={`flex items-center gap-3 px-4 py-2.5 rounded-xl transition-all ${
                  isActive
                    ? 'bg-primary/10 text-primary border border-primary/20 shadow-sm'
                    : 'text-gray-500 hover:bg-gray-100 hover:text-gray-800'
                }`}
              >
                <item.icon className="w-5 h-5" />
                <span className="font-medium text-sm">{item.label}</span>
              </Link>
            )
          })}

          {/* New Quote Button */}
          <div className="pt-5 mt-5 border-t border-gray-100">
            <Link
              to="/quotes/new"
              className="flex items-center gap-3 px-4 py-3 rounded-xl bg-gradient-to-r from-primary to-accent text-white font-medium hover:opacity-90 transition-opacity shadow-sm"
            >
              <Plus className="w-5 h-5" />
              <span>新建报价分析</span>
            </Link>
          </div>
        </nav>

        {/* Footer */}
        <div className="p-5 border-t border-gray-100">
          <div className="flex items-center gap-3 text-gray-400 text-sm">
            <div className="w-2 h-2 rounded-full bg-emerald-400" />
            <span>系统运行正常</span>
          </div>
          <p className="text-[11px] text-gray-300 mt-2">
            九安医疗 × AI实训营
          </p>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-auto bg-[#f8fafc]">
        {children}
      </main>
    </div>
  )
}
