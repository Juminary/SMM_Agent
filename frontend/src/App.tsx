import { useState } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Layout from './components/Layout'
import Dashboard from './pages/Dashboard'
import QuoteList from './pages/QuoteList'
import QuoteDetail from './pages/QuoteDetail'
import ExecutionTrace from './pages/ExecutionTrace'
import NewQuote from './pages/NewQuote'
import Stats from './pages/Stats'
import Demo from './pages/Demo'

function App() {
  return (
    <BrowserRouter>
      <Layout>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/quotes" element={<QuoteList />} />
          <Route path="/quotes/new" element={<NewQuote />} />
          <Route path="/quotes/:id" element={<QuoteDetail />} />
          <Route path="/quotes/:id/trace" element={<ExecutionTrace />} />
          <Route path="/stats" element={<Stats />} />
          <Route path="/demo" element={<Demo />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  )
}

export default App
