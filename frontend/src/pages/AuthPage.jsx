import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAppStore } from "../store";
import { postJSON } from "../lib/api";
import { Button, Input, Wordmark } from "../components/ui";

export default function AuthPage() {
  const { login, toast } = useAppStore();
  const nav = useNavigate();
  const [mode,     setMode]     = useState("login");
  const [form,     setForm]     = useState({ username: "", password: "", email: "" });
  const [loading,  setLoading]  = useState(false);
  const [errors,   setErrors]   = useState({});

  const validate = () => {
    const e = {};
    if (!form.username || form.username.length < 3) e.username = "อย่างน้อย 3 ตัวอักษร";
    if (!form.password || form.password.length < 6) e.password = "อย่างน้อย 6 ตัวอักษร";
    setErrors(e);
    return !Object.keys(e).length;
  };

  const submit = async () => {
    if (!validate()) return;
    setLoading(true);
    try {
      const data = await postJSON(`/api/auth/${mode}`, form);
      login(data);
      toast(mode === "login" ? `ยินดีต้อนรับ ${data.username}!` : "สร้างบัญชีแล้ว!");
      nav("/");
    } catch (err) { toast(err.message || "เกิดข้อผิดพลาด", "error"); }
    setLoading(false);
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        {/* Cover */}
        <div className="text-center mb-8">
          <Wordmark size={52} className="mx-auto mb-3"/>
          <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">Data Analysis Bot</h1>
          <p className="eyebrow mt-1.5">อัปโหลด · ตรวจสอบ · แชร์รายงาน</p>
        </div>

        <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-sm border border-gray-200 dark:border-gray-800 overflow-hidden">
          {/* Tabs */}
          <div className="flex border-b border-gray-100 dark:border-gray-800">
            {["login","register"].map(m => (
              <button key={m} onClick={() => { setMode(m); setErrors({}); }}
                className={`flex-1 py-3 font-mono text-[11px] uppercase tracking-eyebrow border-b-2 transition-colors ${mode===m ? "text-gray-900 dark:text-gray-100 border-brand-500" : "text-gray-500 dark:text-gray-400 border-transparent hover:text-gray-700 dark:hover:text-gray-200"}`}>
                {m === "login" ? "เข้าสู่ระบบ" : "สมัครสมาชิก"}
              </button>
            ))}
          </div>

          {/* A real <form>: Enter submits from any field (the old per-input
              onKeyDown missed the email field), and password managers get
              the semantics they key on. */}
          <form className="p-6 space-y-4" onSubmit={e => { e.preventDefault(); submit(); }}>
            <Input label="ชื่อผู้ใช้" name="username" autoComplete="username" autoCapitalize="none" spellCheck={false}
              placeholder="your_username" value={form.username} error={errors.username}
              onChange={e => setForm(f => ({...f, username: e.target.value}))}/>
            {mode === "register" && (
              <Input label="อีเมล (ไม่บังคับ)" name="email" type="email" inputMode="email" autoComplete="email"
                autoCapitalize="none" spellCheck={false} placeholder="you@example.com" value={form.email}
                onChange={e => setForm(f => ({...f, email: e.target.value}))}/>
            )}
            <Input label="รหัสผ่าน" name="password" type="password"
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              placeholder="••••••••" value={form.password} error={errors.password}
              onChange={e => setForm(f => ({...f, password: e.target.value}))}/>

            <Button className="w-full" size="md" type="submit" loading={loading}>
              {mode === "login" ? "เข้าสู่ระบบ" : "สมัครสมาชิก"}
            </Button>
          </form>
        </div>

        <p className="text-center text-xs text-gray-400 mt-4">
          ใช้งานได้โดยไม่ต้อง login · ประวัติและ workspace ต้องการบัญชี
        </p>
      </div>
    </div>
  );
}
