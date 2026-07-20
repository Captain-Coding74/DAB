/**
 * ErrorBoundary — v11: a ledger-style recovery page instead of a white screen.
 */
import React from "react";
import { Button, Card } from "../ui";

export default class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) { console.error("[dab] render error:", error, info?.componentStack); }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="min-h-[60vh] flex items-center justify-center p-6">
        <Card title="เกิดข้อผิดพลาดในหน้านี้" meta="render error" className="max-w-md w-full">
          <div className="margin-rule">
            <p className="text-sm text-gray-800 dark:text-gray-200">หน้าจอแสดงผลไม่สำเร็จ — ข้อมูลของคุณไม่ได้หายไป</p>
            <p className="num text-[11px] text-gray-500 dark:text-gray-400 mt-2 break-all">{String(this.state.error?.message || this.state.error)}</p>
          </div>
          <div className="flex gap-2 mt-4">
            <Button size="sm" onClick={() => location.reload()}>โหลดหน้าใหม่</Button>
            <Button size="sm" variant="secondary" onClick={() => this.setState({ error: null })}>ลองแสดงผลอีกครั้ง</Button>
          </div>
        </Card>
      </div>
    );
  }
}
