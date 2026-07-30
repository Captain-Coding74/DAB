import React, { useEffect, useState, Suspense, lazy } from "react";
import { Routes, Route, NavLink, useNavigate } from "react-router-dom";
import { BarChart2, Users, History, LogOut, LogIn, Moon, Sun, Command } from "lucide-react";
import { useAppStore } from "./store";
import { postJSON } from "./lib/api";
import { Toasts, Skeleton, Modal, Kbd, Wordmark } from "./components/ui";
import ErrorBoundary from "./components/errors";
import CommandPalette, { firePaletteAction } from "./components/palette";
import PerfOverlay from "./components/perf";
import Dashboard from "./components/dashboard";

// v11: pages load lazily — the first paint ships only the dashboard
const WorkspacePanel = lazy(() => import("./components/workspace"));
const AuthPage       = lazy(() => import("./pages/AuthPage"));
const SharePage      = lazy(() => import("./pages/SharePage"));
const HistoryPage    = lazy(() => import("./pages/HistoryPage"));
const prefetch = { history: () => import("./pages/HistoryPage"), workspace: () => import("./components/workspace") };

function PageSkeleton() {
  return (
    <div className="max-w-screen-xl mx-auto px-4 py-6 space-y-4" aria-busy="true">
      <Skeleton className="h-6 w-48"/>
      <Skeleton className="h-32 w-full"/>
      <Skeleton className="h-32 w-full"/>
    </div>
  );
}


/* v11: global shortcuts. Skips fields so typing is never hijacked. */
const FIELD_TAG_RE = /^(INPUT|TEXTAREA|SELECT)$/;
function useGlobalShortcuts() {
  const setPaletteOpen = useAppStore(s => s.setPaletteOpen);
  const paletteOpen    = useAppStore(s => s.paletteOpen);
  useEffect(() => {
    const onKey = (e) => {
      const typing = FIELD_TAG_RE.test(document.activeElement?.tagName) || document.activeElement?.isContentEditable;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setPaletteOpen(!paletteOpen); return; }
      if (typing) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "u") { e.preventDefault(); firePaletteAction("upload"); return; }
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter")           { e.preventDefault(); firePaletteAction("analyze"); return; }
      if (e.key === "?" && !e.ctrlKey && !e.metaKey && !e.altKey)  { e.preventDefault(); firePaletteAction("shortcuts"); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [paletteOpen, setPaletteOpen]);
}

function ShortcutsHelp() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onAction = (e) => { if (e.detail === "shortcuts") setOpen(true); };
    window.addEventListener("dab:action", onAction);
    return () => window.removeEventListener("dab:action", onAction);
  }, []);
  const rows = [
    ["Ctrl", "K", "เปิด command palette"],
    ["Ctrl", "U", "เลือกไฟล์เพื่อวิเคราะห์"],
    ["Ctrl", "↵", "วิเคราะห์ไฟล์ที่เลือกไว้"],
    ["?", null, "เปิดหน้าปุ่มลัดนี้"],
    ["Esc", null, "ปิดหน้าต่าง / palette / ทัวร์"],
  ];
  return (
    <Modal open={open} onClose={() => setOpen(false)} title="ปุ่มลัด · Shortcuts" width="max-w-sm">
      <div className="space-y-2.5">
        {rows.map(([a, b, desc]) => (
          <div key={desc} className="flex items-center justify-between gap-4">
            <span className="text-sm text-gray-700 dark:text-gray-300">{desc}</span>
            <span className="flex items-center gap-1 shrink-0"><Kbd>{a}</Kbd>{b && <Kbd>{b}</Kbd>}</span>
          </div>
        ))}
      </div>
    </Modal>
  );
}

function Nav() {
  const user           = useAppStore(s => s.user);
  const logout         = useAppStore(s => s.logout);
  const dark           = useAppStore(s => s.dark);
  const toggleDark     = useAppStore(s => s.toggleDark);
  const toast          = useAppStore(s => s.toast);
  const setPaletteOpen = useAppStore(s => s.setPaletteOpen);
  const navigate = useNavigate();

  const handleLogout = async () => {
    const rt = useAppStore.getState().refreshToken;
    if (rt) { try { await postJSON("/api/auth/logout", { refreshToken: rt }); } catch {} }
    logout();
    toast("ออกจากระบบแล้ว");
    navigate("/");
  };

  const navLink = "relative flex items-center gap-2 px-3 py-2 rounded-lg font-mono text-[11px] uppercase tracking-eyebrow text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-800 transition";
  const activeLink = "!text-gray-900 dark:!text-gray-100 before:content-[''] before:absolute before:left-0 before:top-2 before:bottom-2 before:w-0.5 before:rounded-full before:bg-rule dark:before:bg-rule-dark";

  return (
    <nav className="sticky top-0 z-40 bg-gray-50/95 dark:bg-gray-950/95 backdrop-blur border-b border-gray-200 dark:border-gray-800">
      <div className="max-w-screen-xl mx-auto px-4 flex items-center justify-between h-14">
        <NavLink viewTransition to="/" className="flex items-center gap-2.5">
          <Wordmark className="vt-mark"/>
          <span className="hidden sm:flex flex-col leading-none">
            <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">Data Analysis Bot</span>
            <span className="eyebrow !text-[9px] mt-0.5">After-hours console</span>
          </span>
          <span className="num text-[10px] px-1.5 py-0.5 rounded border border-gray-200 dark:border-gray-800 text-gray-500 dark:text-gray-400 ml-1">v20.4</span>
        </NavLink>

        <div className="flex items-center gap-1">
          <NavLink viewTransition to="/" end className={({isActive}) => `${navLink} ${isActive ? activeLink : ""}`}>
            <BarChart2 size={14}/><span className="hidden sm:block">Analyze</span>
          </NavLink>
          {user && (
            <>
              <NavLink viewTransition to="/history" onMouseEnter={prefetch.history} className={({isActive}) => `${navLink} ${isActive ? activeLink : ""}`}>
                <History size={14}/><span className="hidden sm:block">History</span>
              </NavLink>
              <NavLink viewTransition to="/workspace" onMouseEnter={prefetch.workspace} className={({isActive}) => `${navLink} ${isActive ? activeLink : ""}`}>
                <Users size={14}/><span className="hidden sm:block">Workspace</span>
              </NavLink>
            </>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button data-tour="palette" onClick={() => setPaletteOpen(true)} aria-label="เปิด command palette (Ctrl+K)"
            className="hidden md:flex items-center gap-2 px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 transition-colors">
            <Command size={12}/><span className="num text-[10px]">Ctrl K</span>
          </button>
          <button onClick={toggleDark} aria-label="สลับโหมดสว่าง/มืด" className="p-2 rounded-lg text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition">
            {dark ? <Sun size={15}/> : <Moon size={15}/>}
          </button>
          {user ? (
            <div className="flex items-center gap-2">
              <div className="hidden sm:flex items-center gap-2 px-2.5 py-1.5 border border-gray-200 dark:border-gray-800 rounded-lg bg-white dark:bg-gray-900">
                <div className="w-5 h-5 rounded bg-brand-500 flex items-center justify-center text-[10px] text-white font-mono font-semibold">
                  {user.username[0].toUpperCase()}
                </div>
                <span className="num text-[11px] text-gray-700 dark:text-gray-300">{user.username}</span>
              </div>
              <button onClick={handleLogout} aria-label="ออกจากระบบ" className="p-2 rounded-lg text-gray-400 hover:text-rule dark:hover:text-rule-dark hover:bg-rule-soft/50 dark:hover:bg-rule/10 transition">
                <LogOut size={15}/>
              </button>
            </div>
          ) : (
            <NavLink viewTransition to="/auth" className="flex items-center gap-1.5 px-3 py-1.5 bg-brand-500 hover:bg-brand-600 text-white text-sm font-medium rounded-lg transition">
              <LogIn size={13}/> เข้าสู่ระบบ
            </NavLink>
          )}
        </div>
      </div>
    </nav>
  );
}

function Shell() {
  useGlobalShortcuts();
  return (
    <>
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:top-2 focus:left-2 focus:bg-white dark:focus:bg-gray-900 focus:px-3 focus:py-2 focus:rounded-lg focus:border focus:border-brand-400 text-sm">
        ข้ามไปเนื้อหาหลัก
      </a>
      <Nav/>
      <main id="main">
        <ErrorBoundary>
          <Suspense fallback={<PageSkeleton/>}>
            <Routes>
              <Route path="/"          element={<Dashboard/>}/>
              <Route path="/auth"      element={<AuthPage/>}/>
              <Route path="/history"   element={<HistoryPage/>}/>
              <Route path="/workspace" element={<WorkspacePanel/>}/>
            </Routes>
          </Suspense>
        </ErrorBoundary>
      </main>

      {/* v21: a way back to the landing page. It was a nav "Tour" link until
          LandingPage.jsx was deleted (that React route was unreachable — the
          backend serves the static landing at /welcome before the SPA
          fallback), and removing the component removed the only link with it,
          leaving /welcome reachable only by typing the URL.

          A plain <a>, not a NavLink: /welcome is a different DOCUMENT, so
          client-side routing would 404 inside the router. The full navigation
          is also what lets the cross-document view transition fire and carry
          the brand mark across (see index.css). */}
      <footer className="border-t border-gray-200 dark:border-gray-800 mt-10">
        <div className="max-w-screen-xl mx-auto px-4 py-5 flex items-center gap-4 flex-wrap">
          <span className="eyebrow">Data Analysis Bot · After-hours console</span>
          <a href="/welcome"
             className="ml-auto text-sm text-gray-500 dark:text-gray-400 hover:text-brand-500 transition-colors">
            Why DAB ↗
          </a>
        </div>
      </footer>
      <CommandPalette/>
      <ShortcutsHelp/>
      <Toasts/>
      <PerfOverlay/>
    </>
  );
}

export default function App() {
  const dark = useAppStore(s => s.dark);
  useEffect(() => { document.documentElement.classList.toggle("dark", dark); }, [dark]);

  return (
    <div className="min-h-screen">
      <Routes>
        <Route path="/share/:token" element={
          <ErrorBoundary><Suspense fallback={<PageSkeleton/>}><SharePage/></Suspense></ErrorBoundary>
        }/>
        <Route path="*" element={<Shell/>}/>
      </Routes>
    </div>
  );
}
