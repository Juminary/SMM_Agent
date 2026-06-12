import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Layout from './components/Layout'
import Dashboard from './pages/Dashboard'
import ProcurementFlow from './pages/ProcurementFlow'
import QuoteList from './pages/QuoteList'
import QuoteDetail from './pages/QuoteDetail'
import ExecutionTrace from './pages/ExecutionTrace'
import AnalysisProgress from './pages/AnalysisProgress'
import NewQuote from './pages/NewQuote'
import Stats from './pages/Stats'
import Demo from './pages/Demo'

function App() {
  return (
    <BrowserRouter>
      <Layout>
        <Routes>
          <Route path="/" element={<ProcurementFlow />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/procurement" element={<ProcurementFlow />} />
          <Route path="/quotes" element={<QuoteList />} />
          <Route path="/quotes/new" element={<NewQuote />} />
          <Route path="/quotes/:id" element={<QuoteDetail />} />
          <Route path="/quotes/:id/trace" element={<ExecutionTrace />} />
          <Route path="/analysis/:id" element={<AnalysisProgress />} />
          <Route path="/stats" element={<Stats />} />
          <Route path="/demo" element={<Demo />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  )
}

export default App
