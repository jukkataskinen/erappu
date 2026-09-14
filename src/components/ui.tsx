import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

/**
 * Käyttöliittymän perusosat. Tyyli Reilusopparista: pyöreät napit,
 * ohuella viivalla rajatut valkoiset paneelit, 44 px kosketuskohteet.
 */

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

type Variant = "primary" | "secondary" | "danger" | "ghost";
const buttonBase =
  "inline-flex min-h-[var(--size-touch)] items-center justify-center gap-2 rounded-full px-5 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50";
const variants: Record<Variant, string> = {
  primary: "bg-ink text-paper hover:bg-ink-strong",
  secondary: "border border-line bg-paper text-ink hover:border-ink/30",
  danger: "bg-coral text-paper hover:bg-coral/90",
  ghost: "text-ink/70 hover:text-ink",
};

export function Button({ variant = "primary", className, ...props }: ComponentProps<"button"> & { variant?: Variant }) {
  return <button className={cx(buttonBase, variants[variant], className)} {...props} />;
}

export function LinkButton({ variant = "primary", className, ...props }: ComponentProps<typeof Link> & { variant?: Variant }) {
  return <Link className={cx(buttonBase, variants[variant], className)} {...props} />;
}

export function Panel({ className, ...props }: ComponentProps<"section">) {
  return <section className={cx("rounded-[var(--radius-panel)] border border-line bg-paper p-5 sm:p-6", className)} {...props} />;
}

export function PageHeader({ title, subtitle, actions, back }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; back?: { href: string; label: string } }) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {back ? (
          <Link href={back.href} className="mb-2 inline-block text-sm text-ink/60 hover:text-ink">
            ← {back.label}
          </Link>
        ) : null}
        <h1 className="text-2xl sm:text-3xl">{title}</h1>
        {subtitle ? <p className="mt-1 text-ink/65">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </header>
  );
}

export function SectionTitle({ children, actions }: { children: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <h2 className="text-lg">{children}</h2>
      {actions}
    </div>
  );
}

type Tone = "neutral" | "info" | "ok" | "warn" | "alert";
const tones: Record<Tone, string> = {
  neutral: "bg-cloud text-ink/70 border-line",
  info: "bg-sky-soft text-sky border-sky/20",
  ok: "bg-moss-soft text-moss border-moss/20",
  warn: "bg-amber-soft text-amber border-amber/25",
  alert: "bg-coral-soft text-coral border-coral/25",
};

export function Badge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return <span className={cx("inline-flex items-center whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-semibold", tones[tone])}>{children}</span>;
}

export function Notice({ tone = "info", title, children }: { tone?: Tone; title?: ReactNode; children?: ReactNode }) {
  return (
    <div className={cx("rounded-xl border px-4 py-3 text-sm", tones[tone])}>
      {title ? <p className="font-semibold">{title}</p> : null}
      {children ? <div className="mt-0.5 text-ink/80">{children}</div> : null}
    </div>
  );
}

export function EmptyState({ title, children, action }: { title: ReactNode; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="rounded-[var(--radius-panel)] border border-dashed border-line bg-paper px-6 py-10 text-center">
      <p className="font-semibold">{title}</p>
      {children ? <p className="mx-auto mt-1 max-w-md text-sm text-ink/65">{children}</p> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

export function Field({ label, htmlFor, hint, error, children }: { label: string; htmlFor: string; hint?: ReactNode; error?: string | null; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-sm font-semibold">
        {label}
      </label>
      {children}
      {hint ? <p className="text-xs text-ink/55">{hint}</p> : null}
      {error ? <p className="text-xs font-medium text-coral">{error}</p> : null}
    </div>
  );
}

const inputBase = "min-h-[var(--size-touch)] w-full rounded-xl border border-line bg-paper px-3.5 text-base text-ink placeholder:text-ink/40 focus:border-sky focus:outline-none";

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input className={cx(inputBase, className)} {...props} />;
}

export function Select({ className, ...props }: ComponentProps<"select">) {
  return <select className={cx(inputBase, "pr-8", className)} {...props} />;
}

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return <textarea className={cx(inputBase, "min-h-28 py-2.5", className)} {...props} />;
}

export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cx("overflow-x-auto rounded-[var(--radius-panel)] border border-line bg-paper", className)}>
      <table className="w-full border-collapse text-sm">{children}</table>
    </div>
  );
}

export function Th({ children, className, numeric }: { children?: ReactNode; className?: string; numeric?: boolean }) {
  return (
    <th className={cx("border-b border-line bg-cloud/60 px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-ink/55", numeric && "text-right", className)}>
      {children}
    </th>
  );
}

export function Td({ children, className, numeric }: { children?: ReactNode; className?: string; numeric?: boolean }) {
  return <td className={cx("border-b border-line px-4 py-3 align-top last:border-b-0", numeric && "tabular text-right", className)}>{children}</td>;
}

export function Stat({ label, value, href, tone }: { label: string; value: ReactNode; href?: string; tone?: Tone }) {
  const body = (
    <>
      <p className="text-sm text-ink/60">{label}</p>
      <p className={cx("tabular mt-1 text-2xl font-bold", tone === "alert" && "text-coral", tone === "ok" && "text-moss", tone === "warn" && "text-amber")}>{value}</p>
    </>
  );
  const cls = "block rounded-[var(--radius-panel)] border border-line bg-paper p-5";
  return href ? (
    <Link href={href} className={cx(cls, "hover:border-ink/25")}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

export function DefinitionList({ items }: { items: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
      {items.map((i) => (
        <div key={i.label} className="min-w-0">
          <dt className="text-xs font-semibold uppercase tracking-wide text-ink/50">{i.label}</dt>
          <dd className="mt-0.5 break-words">{i.value ?? "–"}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Tabs({ items, active }: { items: { href: string; label: string; key: string }[]; active: string }) {
  return (
    <nav className="mb-6 flex gap-1 overflow-x-auto border-b border-line" aria-label="Välilehdet">
      {items.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          aria-current={t.key === active ? "page" : undefined}
          className={cx(
            "whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-semibold",
            t.key === active ? "border-ink text-ink" : "border-transparent text-ink/55 hover:text-ink",
          )}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
