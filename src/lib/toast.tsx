/**
 * Minimal toast system — no external deps.
 *
 * Usage:
 *   1. Mount <ToastProvider> near your app root.
 *   2. Mount <ToastContainer /> once (typically just inside ToastProvider).
 *   3. In any component: const toast = useToast(); toast.success("…");
 *
 * Behavior:
 *   - Bottom-center position.
 *   - Auto-dismiss after 4 seconds (or longer if `duration` is provided).
 *   - Stack of max 3; older toasts get evicted.
 *   - Click the × button to dismiss early.
 *   - Each toast can carry an optional "Undo" action that closes the toast
 *     when clicked.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

export type ToastKind = "success" | "info" | "warning" | "error";

export interface ToastOptions {
  kind?: ToastKind;
  duration?: number; // ms; default 4000
  undo?: {
    label?: string; // default "Undo"
    onClick: () => void;
  };
}

export interface ToastRecord {
  id: number;
  kind: ToastKind;
  message: string;
  duration: number;
  createdAt: number;
  undo?: { label: string; onClick: () => void };
}

interface ToastContextValue {
  toasts: ToastRecord[];
  push: (message: string, options?: ToastOptions) => number;
  dismiss: (id: number) => void;
  success: (message: string, options?: Omit<ToastOptions, "kind">) => number;
  info: (message: string, options?: Omit<ToastOptions, "kind">) => number;
  warning: (message: string, options?: Omit<ToastOptions, "kind">) => number;
  error: (message: string, options?: Omit<ToastOptions, "kind">) => number;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const MAX_STACK = 3;
const DEFAULT_DURATION = 4000;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastRecord[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (message: string, options: ToastOptions = {}): number => {
      const id = nextId.current++;
      const record: ToastRecord = {
        id,
        kind: options.kind ?? "info",
        message,
        duration: options.duration ?? DEFAULT_DURATION,
        createdAt: Date.now(),
        undo: options.undo
          ? {
              label: options.undo.label ?? "Undo",
              onClick: options.undo.onClick,
            }
          : undefined,
      };
      setToasts((prev) => {
        const next = [...prev, record];
        // Evict the oldest if we exceed the stack.
        return next.length > MAX_STACK
          ? next.slice(next.length - MAX_STACK)
          : next;
      });
      return id;
    },
    [],
  );

  // Auto-dismiss timer per toast — recreated when the toast list changes.
  useEffect(() => {
    if (toasts.length === 0) return;
    const timers = toasts.map((t) => {
      const remaining = t.duration - (Date.now() - t.createdAt);
      return window.setTimeout(() => dismiss(t.id), Math.max(remaining, 0));
    });
    return () => {
      timers.forEach((id) => window.clearTimeout(id));
    };
  }, [toasts, dismiss]);

  const success = useCallback(
    (message: string, options: Omit<ToastOptions, "kind"> = {}) =>
      push(message, { ...options, kind: "success" }),
    [push],
  );
  const info = useCallback(
    (message: string, options: Omit<ToastOptions, "kind"> = {}) =>
      push(message, { ...options, kind: "info" }),
    [push],
  );
  const warning = useCallback(
    (message: string, options: Omit<ToastOptions, "kind"> = {}) =>
      push(message, { ...options, kind: "warning" }),
    [push],
  );
  const error = useCallback(
    (message: string, options: Omit<ToastOptions, "kind"> = {}) =>
      push(message, { ...options, kind: "error" }),
    [push],
  );

  const value = useMemo<ToastContextValue>(
    () => ({ toasts, push, dismiss, success, info, warning, error }),
    [toasts, push, dismiss, success, info, warning, error],
  );

  return (
    <ToastContext.Provider value={value}>{children}</ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast() must be called inside <ToastProvider>");
  }
  return ctx;
}

const ICONS: Record<ToastKind, string> = {
  success: "✓",
  info: "ℹ",
  warning: "⚠",
  error: "✕",
};

export function ToastContainer() {
  const { toasts, dismiss } = useToast();
  if (toasts.length === 0) return null;
  return (
    <div
      className="toast-container"
      role="region"
      aria-label="Notifications"
      aria-live="polite"
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`toast toast-${t.kind}`}
          role={t.kind === "error" ? "alert" : "status"}
        >
          <span className="toast-icon" aria-hidden="true">
            {ICONS[t.kind]}
          </span>
          <span className="toast-message">{t.message}</span>
          {t.undo && (
            <button
              type="button"
              className="toast-undo"
              onClick={() => {
                t.undo?.onClick();
                dismiss(t.id);
              }}
            >
              {t.undo.label}
            </button>
          )}
          <button
            type="button"
            className="toast-dismiss"
            aria-label="Dismiss notification"
            onClick={() => dismiss(t.id)}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
