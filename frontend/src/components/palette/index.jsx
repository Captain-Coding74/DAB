/**
 * CommandPalette (Ctrl+K) — v11
 * "The index of the ledger": every page and action, searchable in Thai or
 * English. Dashboard-scoped actions travel over a tiny CustomEvent bus so
 * the palette stays decoupled from page internals.
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Search } from "lucide-react";
import { useAppStore } from "../../store";
import { Kbd } from "../ui";

export function firePaletteAction(name) {
  window.dispatchEvent(new CustomEvent("dab:action", { detail: name }));
}

export default function CommandPalette() {
  const { paletteOpen, setPaletteOpen, dark, toggleDark, user } = useAppStore();
  const nav = useNavigate();
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const inputRef = useRef(null);
  const listRef  = useRef(null);

  const close = () => { setPaletteOpen(false); setQ(""); setSel(0); };
  const go = (fn) => { close(); fn(); };

  const items = useMemo(() => [
    { id: "analyze",   label: "ไปหน้า Analyze",              kw: "analyze dashboard วิเคราะห์ หน้าแรก", run: () => go(() => nav("/")) },
    { id: "history",   label: "ไปหน้า History",              kw: "history ประวัติ รายงาน",             run: () => go(() => nav("/history")),   auth: true },
    { id: "workspace", label: "ไปหน้า Workspace",            kw: "workspace ทีม teams",                run: () => go(() => nav("/workspace")), auth: true },
    { id: "upload",    label: "เลือกไฟล์เพื่อวิเคราะห์",       kw: "upload file เลือกไฟล์ อัปโหลด csv excel", kbd: "Ctrl U", run: () => go(() => { nav("/"); setTimeout(() => firePaletteAction("upload"), 60); }) },
    { id: "run",       label: "วิเคราะห์ไฟล์ที่เลือกไว้",       kw: "run analyze วิเคราะห์ ตรวจสอบ",       kbd: "Ctrl ↵", run: () => go(() => { nav("/"); setTimeout(() => firePaletteAction("analyze"), 60); }) },
    { id: "sample",    label: "ลองด้วยข้อมูลตัวอย่าง",         kw: "sample demo ตัวอย่าง ทดลอง",          run: () => go(() => { nav("/"); setTimeout(() => firePaletteAction("sample"), 60); }) },
    { id: "pdf",       label: "Export รายงานเป็น PDF",        kw: "export pdf รายงาน",                   run: () => go(() => firePaletteAction("export-pdf")) },
    { id: "excel",     label: "Export รายงานเป็น Excel",      kw: "export excel xlsx",                   run: () => go(() => firePaletteAction("export-excel")) },
    { id: "theme",     label: dark ? "สลับเป็นโหมดสว่าง" : "สลับเป็นโหมดมืด", kw: "theme dark light โหมดมืด สว่าง ธีม", run: () => go(toggleDark) },
    { id: "tour",      label: "เริ่มทัวร์แนะนำการใช้งาน",      kw: "tour tutorial สอน แนะนำ onboarding",  run: () => go(() => { nav("/"); setTimeout(() => firePaletteAction("tour"), 60); }) },
    { id: "keys",      label: "ดูปุ่มลัดทั้งหมด",              kw: "shortcuts keyboard ปุ่มลัด คีย์",      kbd: "?", run: () => go(() => firePaletteAction("shortcuts")) },
  ].filter(it => !it.auth || user), [dark, user]);

  const results = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return items;
    return items.filter(it => (it.label + " " + it.kw).toLowerCase().includes(t));
  }, [q, items]);

  useEffect(() => { if (paletteOpen) setTimeout(() => inputRef.current?.focus(), 20); }, [paletteOpen]);
  useEffect(() => { setSel(0); }, [q]);
  useEffect(() => {
    listRef.current?.children[sel]?.scrollIntoView({ block: "nearest" });
  }, [sel]);

  if (!paletteOpen) return null;

  const onKey = (e) => {
    if (e.key === "Escape")     { e.preventDefault(); close(); }
    if (e.key === "ArrowDown")  { e.preventDefault(); setSel(s => Math.min(s + 1, results.length - 1)); }
    if (e.key === "ArrowUp")    { e.preventDefault(); setSel(s => Math.max(s - 1, 0)); }
    if (e.key === "Enter" && results[sel]) { e.preventDefault(); results[sel].run(); }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center pt-[14vh] px-4" onClick={close}>
      <div className="absolute inset-0 bg-gray-950/50 backdrop-blur-sm"/>
      <div role="dialog" aria-modal="true" aria-label="Command palette"
        className="relative w-full max-w-lg bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl shadow-xl overflow-hidden"
        onClick={e => e.stopPropagation()} onKeyDown={onKey}>
        <div className="flex items-center gap-2.5 px-4 border-b border-gray-100 dark:border-gray-800">
          <Search size={15} className="text-gray-400 shrink-0"/>
          <input ref={inputRef} value={q} onChange={e => setQ(e.target.value)}
            placeholder="ค้นหาคำสั่ง… (พิมพ์ไทยหรืออังกฤษได้)"
            aria-label="ค้นหาคำสั่ง"
            className="flex-1 py-3.5 text-sm bg-transparent outline-none dark:text-gray-100 placeholder:text-gray-300 dark:placeholder:text-gray-600"/>
          <Kbd>Esc</Kbd>
        </div>
        <div ref={listRef} className="max-h-72 overflow-y-auto py-1.5" role="listbox">
          {results.length === 0 && (
            <p className="px-4 py-6 text-center text-sm text-gray-400">ไม่พบคำสั่งที่ตรงกับ "{q}"</p>
          )}
          {results.map((it, i) => (
            <button key={it.id} role="option" aria-selected={i === sel}
              onMouseEnter={() => setSel(i)} onClick={it.run}
              className={`w-full flex items-center justify-between gap-3 px-4 py-2.5 text-left text-sm transition-colors ${i === sel ? "bg-brand-50 dark:bg-brand-900/30 text-gray-900 dark:text-gray-100" : "text-gray-600 dark:text-gray-400"}`}>
              <span className="flex items-center gap-2.5 min-w-0">
                <span className={`font-mono ${i === sel ? "text-rule dark:text-rule-dark" : "text-gray-300 dark:text-gray-600"}`}>▸</span>
                <span className="truncate">{it.label}</span>
              </span>
              {it.kbd && <Kbd>{it.kbd}</Kbd>}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3 px-4 py-2 border-t border-gray-100 dark:border-gray-800">
          <span className="num text-[11px] text-gray-400 dark:text-gray-500">↑↓ เลือก · ↵ ใช้งาน</span>
        </div>
      </div>
    </div>
  );
}
