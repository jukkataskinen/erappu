import type { NavItem } from "@/config/nav";

const P = { stroke: "currentColor", strokeWidth: 1.7, fill: "none", strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

export function NavIcon({ name, size = 20 }: { name: NavItem["icon"]; size?: number }) {
  const paths: Record<NavItem["icon"], React.ReactNode> = {
    home: <path d="M4 11 L12 4.5 L20 11 V20 H4 Z" {...P} />,
    building: (
      <>
        <rect x={5} y={3.5} width={14} height={17} rx={1.5} {...P} />
        <path d="M9 8h1.5M13.5 8H15M9 11.5h1.5M13.5 11.5H15M10.5 20.5v-4h3v4" {...P} />
      </>
    ),
    wrench: <path d="M14.5 5.5a4 4 0 0 0-5 5L4 16l4 4 5.5-5.5a4 4 0 0 0 5-5l-2.5 2.5-2.5-.5-.5-2.5z" {...P} />,
    registry: (
      <>
        <path d="M6 4h9l3 3v13H6z" {...P} />
        <path d="M9 11h6M9 14.5h6M9 18h3" {...P} />
      </>
    ),
    coins: (
      <>
        <ellipse cx={12} cy={7} rx={6.5} ry={2.5} {...P} />
        <path d="M5.5 7v5c0 1.4 2.9 2.5 6.5 2.5s6.5-1.1 6.5-2.5V7M5.5 12v5c0 1.4 2.9 2.5 6.5 2.5s6.5-1.1 6.5-2.5v-5" {...P} />
      </>
    ),
    calendar: (
      <>
        <rect x={4} y={5.5} width={16} height={14.5} rx={2} {...P} />
        <path d="M4 10h16M8.5 3.5v4M15.5 3.5v4" {...P} />
      </>
    ),
    megaphone: <path d="M4 10v4h3l7 4V6L7 10zM17.5 9.5a3.5 3.5 0 0 1 0 5" {...P} />,
    folder: <path d="M3.5 7a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v8.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" {...P} />,
    list: (
      <>
        <circle cx={12} cy={12} r={8} {...P} />
        <path d="M12 7.5V12l3 2" {...P} />
      </>
    ),
    gear: (
      <>
        <circle cx={12} cy={12} r={3} {...P} />
        <path d="M12 3.5v2.5M12 18v2.5M3.5 12H6M18 12h2.5M6 6l1.8 1.8M16.2 16.2 18 18M6 18l1.8-1.8M16.2 7.8 18 6" {...P} />
      </>
    ),
    users: (
      <>
        <circle cx={9} cy={9} r={3} {...P} />
        <path d="M3.5 19c0-3 2.5-5 5.5-5s5.5 2 5.5 5M16 6.5a3 3 0 0 1 0 5.5M17.5 14.3c1.8.7 3 2.3 3 4.7" {...P} />
      </>
    ),
  };
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      {paths[name]}
    </svg>
  );
}
