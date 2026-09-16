"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ComponentProps, type ReactNode } from "react";
import { Input } from "@/components/ui";
import { issueText, readingIssues, type ReadingIssue } from "@/lib/water/checks";

/**
 * Lukemakenttien tarkistus lomakkeella: jokainen kenttä vertaa arvoa
 * edelliseen lukemaan, ja poikkeavista lukemista tulee varoitus sekä
 * pakollinen kuittaus ennen lähetystä. Palvelin tarkistaa saman uudelleen.
 */

const Ctx = createContext<{
  set: (id: string, issues: ReadingIssue[]) => void;
  count: number;
} | null>(null);

export function ReadingChecks({ children }: { children: ReactNode }) {
  const [issues, setIssues] = useState<Record<string, number>>({});
  const set = useCallback((id: string, list: ReadingIssue[]) => {
    setIssues((prev) => (prev[id] === list.length ? prev : { ...prev, [id]: list.length }));
  }, []);
  const count = Object.values(issues).reduce((s, n) => s + n, 0);
  const value = useMemo(() => ({ set, count }), [set, count]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function ReadingInput({
  meterId,
  previous,
  defaultValue,
  ...props
}: ComponentProps<typeof Input> & {
  meterId: string;
  previous: string | null;
  defaultValue?: string;
}) {
  const ctx = useContext(Ctx);
  const [value, setValue] = useState(defaultValue ?? "");
  const [touched, setTouched] = useState(false);
  const list = touched ? readingIssues(previous, value) : [];
  return (
    <>
      <Input
        {...props}
        defaultValue={defaultValue}
        onChange={(e) => {
          setValue(e.target.value);
          setTouched(true);
          ctx?.set(meterId, readingIssues(previous, e.target.value));
        }}
        aria-describedby={list.length ? `warn_${meterId}` : undefined}
      />
      {list.length && previous !== null ? (
        <p id={`warn_${meterId}`} className="mt-1 max-w-xs text-left text-xs text-coral" role="status">
          {issueText(list[0], previous, value)}
        </p>
      ) : null}
    </>
  );
}

export function ReadingConfirm() {
  const ctx = useContext(Ctx);
  if (!ctx || ctx.count === 0) return null;
  return (
    <label className="flex items-start gap-2 rounded-xl border border-coral/30 bg-coral/5 px-3 py-2 text-sm">
      <input type="checkbox" name="confirm_readings" required className="mt-1" />
      <span>Olen tarkistanut poikkeavat lukemat, ja ne ovat oikein.</span>
    </label>
  );
}
