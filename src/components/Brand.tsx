/**
 * eRapun merkki: talon ääriviiva ja sisällä nouseva porras. Portaat ovat
 * sky-sinisiä, ovi coral: rappu vie kotiin.
 */
export function LogoMark({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
      <path d="M12 44 L50 14 L88 44 L88 86 L12 86 Z" fill="none" stroke="currentColor" strokeWidth={7} strokeLinejoin="round" />
      <rect x={24} y={68} width={16} height={12} rx={2.5} fill="var(--color-sky)" />
      <rect x={40} y={56} width={16} height={24} rx={2.5} fill="var(--color-sky)" />
      <rect x={56} y={44} width={16} height={36} rx={2.5} fill="var(--color-sky)" />
      <rect x={60} y={30} width={8} height={8} rx={2} fill="var(--color-coral)" />
    </svg>
  );
}

export function Brand({ size = 22, inverted = false }: { size?: number; inverted?: boolean }) {
  return (
    <span className={`flex items-center gap-2 ${inverted ? "text-paper" : "text-ink"}`}>
      <LogoMark size={size} />
      <span className="font-extrabold tracking-tight">
        <span className="text-sky">e</span>Rappu
      </span>
    </span>
  );
}
