import { Outlet, useLocation } from 'react-router-dom'
import { T } from '../theme'
import { Sidebar } from './Sidebar'

// Routes that want the full content width (canvas-style pages), not the centered column.
const WIDE_ROUTES = ['/flow', '/forge']

// App layout: persistent left sidebar + scrollable main content.
export function AppShell() {
  const { pathname } = useLocation()
  const wide = WIDE_ROUTES.some((r) => pathname === r || pathname.startsWith(r + '/'))

  return (
    <div style={{ display: 'flex', minHeight: '100vh', color: T.text, background: T.bg }}>
      <Sidebar />
      <main style={{ flex: 1, minWidth: 0, height: '100vh', overflowY: 'auto' }}>
        <div style={{
          maxWidth: wide ? 'none' : 1180,
          margin: '0 auto',
          padding: wide ? '28px 28px 40px' : '34px 32px 90px',
        }}>
          <Outlet />
        </div>
      </main>
    </div>
  )
}
