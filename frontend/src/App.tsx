import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AppShell } from './components/AppShell'
import { EvalListPage } from './pages/EvalListPage'
import { EvalSetupPage } from './pages/EvalSetupPage'
import { EvalProgressPage } from './pages/EvalProgressPage'
import { ResultsDashboard } from './pages/ResultsDashboard'
import { PromptHistoryPage } from './pages/PromptHistoryPage'
import { VoiceReportPage } from './pages/VoiceReportPage'
import { SttPage } from './pages/SttPage'
import { RagTestPage } from './pages/RagTestPage'
import { AnalyzeCallsPage } from './pages/AnalyzeCallsPage'
import { CallBatchPage } from './pages/CallBatchPage'
import { CallReportPage } from './pages/CallReportPage'
import { ScoreboardPage } from './pages/ScoreboardPage'
import { ScoreboardDetailPage } from './pages/ScoreboardDetailPage'
import { FlowBuilderPage } from './pages/FlowBuilderPage'
import { SettingsPage } from './pages/SettingsPage'
import { LlmPage } from './pages/LlmPage'

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppShell />}>
          {/* Prompt Eval */}
          <Route path="/" element={<EvalListPage />} />
          <Route path="/new" element={<EvalSetupPage />} />
          <Route path="/eval/:id/progress" element={<EvalProgressPage />} />
          <Route path="/eval/:id/results" element={<ResultsDashboard />} />
          <Route path="/eval/:id/prompts" element={<PromptHistoryPage />} />
          <Route path="/eval/:id/voice" element={<VoiceReportPage />} />

          {/* Call Analysis */}
          <Route path="/analyze" element={<AnalyzeCallsPage />} />
          <Route path="/analyze/:batchId" element={<CallBatchPage />} />
          <Route path="/analyze/:batchId/call/:callId" element={<CallReportPage />} />
          <Route path="/scoreboard" element={<ScoreboardPage />} />
          <Route path="/scoreboard/:id" element={<ScoreboardDetailPage />} />

          {/* Test STT (P2) */}
          <Route path="/stt" element={<SttPage />} />

          {/* RAG Testing */}
          <Route path="/rag" element={<RagTestPage />} />

          {/* Flow Builder */}
          <Route path="/flow" element={<FlowBuilderPage />} />

          {/* Settings */}
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/llm" element={<LlmPage />} />

          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}

export default App
