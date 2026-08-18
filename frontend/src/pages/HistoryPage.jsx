import React, { useState, useEffect , useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Trash2, ChevronLeft, ChevronRight, FileText, Clock } from "lucide-react";
import { apiFetch, useAppStore } from "../store";
import { Card, Badge, Button, Spinner , Skeleton } from "../components/ui";

export default function HistoryPage() {
  const { user, toast, dismissToast } = useAppStore();
  const nav = useNavigate();
  const [items,   setItems]   = useState([]);
  const [total,   setTotal]   = useState(0);
  const [page,    setPage]    = useState(0);
  const [loading, setLoading] = useState(true);
  const LIMIT = 10;

  useEffect(() => { if (!user) nav("/auth"); }, [user]);
  useEffect(() => { if (user) fetchHistory(); }, [page, user]);

  // Cached pages return instantly while uncached ones lag — without a
  // sequence check a slow older request could overwrite the newer page.
  const reqSeqRef = useRef(0);
  async function fetchHistory() {
    const seq = ++reqSeqRef.current;
    setLoading(true);
    try {
      const res  = await apiFetch(`/api/history?limit=${LIMIT}&offset=${page * LIMIT}`);
      const data = await res.json();
      if (seq !== reqSeqRef.current) return; // stale — a newer request superseded this one
      if (res.ok) {
        setItems(Array.isArray(data) ? data : []);
        setTotal(parseInt(res.headers?.get?.("X-Total-Count") || 0));
      }
    } catch {}
    if (seq === reqSeqRef.current) setLoading(false);
  }

  // v11: undoable delete — remove locally, commit to the server after a
  // 5-second grace window; "เลิกทำ" cancels the commit and restores the row.
  const pendingRef = useRef(new Map());
  useEffect(() => () => {  // navigating away flushes pending deletes now
    // Dismiss the undo toasts too — the delete just committed, so leaving a
    // live "เลิกทำ" button on screen would fake a successful undo.
    for (const [, p] of pendingRef.current) { clearTimeout(p.timer); p.commit(); dismissToast(p.toastId); }
    pendingRef.current.clear();
  }, []);

  function deleteItem(id, e) {
    e.stopPropagation();
    const idx  = items.findIndex(it => it.id === id);
    const snap = items[idx];
    if (!snap) return;
    setItems(list => list.filter(it => it.id !== id));

    const commit = () => {
      pendingRef.current.delete(id);
      setTotal(t => Math.max(0, t - 1)); // keep the heading and pager honest
      apiFetch(`/api/history/${id}`, { method: "DELETE" }).catch(() => {});
    };
    const timer = setTimeout(commit, 5000);

    const toastId = toast("ลบรายงานแล้ว", "info", {
      duration: 5000,
      action: {
        label: "เลิกทำ",
        onClick: () => {
          const p = pendingRef.current.get(id);
          if (p) { clearTimeout(p.timer); pendingRef.current.delete(id); }
          setItems(list => {
            const next = [...list]; next.splice(Math.min(idx, next.length), 0, snap); return next;
          });
          dismissToast(toastId);
        },
      },
    });
    pendingRef.current.set(id, { timer, commit, toastId });
  }

  const totalPages    = Math.ceil(total / LIMIT);
  const qualityColor  = s => s >= 80 ? "green" : s >= 60 ? "yellow" : "red";

  if (!user) return null;

  return (
    <div className="max-w-screen-lg mx-auto px-4 py-6">
      <div className="flex items-center justify-between mb-5">
        <div>
          <p className="eyebrow mb-1">สารบัญรายงาน · History</p>
          <h1 className="text-lg font-semibold text-gray-900 dark:text-gray-100"><span className="num">{total.toLocaleString()}</span> analyses saved</h1>
        </div>
      </div>

      {loading ? (
        <div className="space-y-3" aria-busy="true">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4 space-y-2.5">
              <Skeleton className="h-3.5 w-52"/>
              <Skeleton className="h-2.5 w-72"/>
            </div>
          ))}
        </div>
      ) : items.length === 0 ? (
        <Card>
          <div className="text-center py-12 text-gray-400">
            <Clock size={36} className="mx-auto mb-2 opacity-30"/>
            <p className="text-sm">ยังไม่มีประวัติการวิเคราะห์</p>
            <Button variant="secondary" size="sm" className="mt-3" onClick={() => nav("/")}>
              เริ่มวิเคราะห์แรก →
            </Button>
          </div>
        </Card>
      ) : (
        <>
          <div className="space-y-3">
            {items.map(item => (
              <div key={item.id} className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4 hover:border-brand-300 dark:hover:border-brand-500 hover:shadow-sm transition cursor-pointer">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3 flex-1 min-w-0">
                    <div className="w-9 h-9 rounded-lg bg-brand-50 dark:bg-brand-900/30 flex items-center justify-center flex-shrink-0">
                      <FileText size={15} className="text-brand-500"/>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate">{item.file_name}</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 line-clamp-1">{item.prompt}</p>
                      {item.preview && (
                        <p className="text-xs text-gray-400 mt-1 line-clamp-2">{item.preview}...</p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <div className="text-right hidden sm:block">
                      <div className="flex items-center gap-1.5 justify-end">
                        <Badge variant="gray">{item.file_type?.toUpperCase()}</Badge>
                        {item.quality_score != null && (
                          <Badge variant={qualityColor(item.quality_score)}>Q:{item.quality_score}</Badge>
                        )}
                      </div>
                      <p className="text-xs text-gray-400 mt-1">
                        {item.total_rows?.toLocaleString()} rows · {item.duration_ms}ms
                      </p>
                      <p className="text-xs text-gray-400">
                        {new Date(item.created_at).toLocaleDateString("th-TH", { day:"numeric", month:"short", hour:"2-digit", minute:"2-digit" })}
                      </p>
                    </div>
                    <button onClick={(e) => deleteItem(item.id, e)}
                      className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30 rounded-lg transition">
                      <Trash2 size={13}/>
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-5">
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Showing {page * LIMIT + 1}–{Math.min((page + 1) * LIMIT, total)} of {total}
              </p>
              <div className="flex gap-2">
                <Button variant="secondary" size="sm" disabled={page === 0} onClick={() => setPage(p => p - 1)}>
                  <ChevronLeft size={13}/> Prev
                </Button>
                <Button variant="secondary" size="sm" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}>
                  Next <ChevronRight size={13}/>
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
