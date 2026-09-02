import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AppShell } from './components/AppShell'
import { SttPage } from './pages/SttPage'
import { RagTestPage } from './pages/RagTestPage'
import { AnalyzeCallsPage } from './pages/AnalyzeCallsPage'
import { CallBatchPage } from './pages/CallBatchPage'
import { CallReportPage } from './pages/CallReportPage'
import { ScoreboardPage } from './pages/ScoreboardPage'
import { ScoreboardDetailPage } from './pages/ScoreboardDetailPage'
import { FlowBuilderPage } from './pages/FlowBuilderPage'
import { LlmPage } from './pages/LlmPage'
import { ForgeListPage } from './pages/forge/ForgeListPage'
import { ForgeSetupPage } from './pages/forge/ForgeSetupPage'
import { ForgeProgressPage } from './pages/forge/ForgeProgressPage'
import { ForgeResultsPage } from './pages/forge/ForgeResultsPage'
import { ForgeMatrixPage } from './pages/forge/ForgeMatrixPage'
import { ForgeVersionsPage } from './pages/forge/ForgeVersionsPage'
import { ForgeHumanReviewPage } from './pages/forge/ForgeHumanReviewPage'
import { ForgeArenaPage } from './pages/forge/ForgeArenaPage'
import { ForgeSimsPage } from './pages/forge/ForgeSimsPage'

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppShell />}>
          <Route path="/" element={<Navigate to="/forge" replace />} />
          {/* Forge (promptforge optimizer — supersedes Prompt Eval) */}
          <Route path="/forge" element={<ForgeListPage />} />
          <Route path="/forge/new" element={<ForgeSetupPage />} />
          <Route path="/forge/matrix" element={<ForgeMatrixPage />} />
          <Route path="/forge/arena" element={<ForgeArenaPage />} />
          <Route path="/forge/arena/:id" element={<ForgeArenaPage />} />
          <Route path="/forge/:id/progress" element={<ForgeProgressPage />} />
          <Route path="/forge/:id/results" element={<ForgeResultsPage />} />
          <Route path="/forge/:id/matrix" element={<ForgeMatrixPage />} />
          <Route path="/forge/:id/sims" element={<ForgeSimsPage />} />
          <Route path="/forge/:id/versions" element={<ForgeVersionsPage />} />
          <Route path="/forge/:id/review" element={<ForgeHumanReviewPage />} />

          {/* Old Eval (legacy Prompt Eval — read-only path) */}

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
          <Route path="/llm" element={<LlmPage />} />

          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}

export default App
