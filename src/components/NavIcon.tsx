const P = { stroke: "currentColor", strokeWidth: 1.7, fill: "none", strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

export type IconName =
  | "home" | "building" | "wrench" | "registry" | "coins" | "calendar" | "megaphone" | "folder" | "list" | "gear" | "users"
  | "info" | "door" | "award" | "map" | "hammer" | "key" | "pen" | "bolt" | "stamp" | "shield" | "split" | "droplet";

export function NavIcon({ name, size = 20 }: { name: IconName; size?: number }) {
  const paths: Record<IconName, React.ReactNode> = {
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
    info: (
      <>
        <circle cx={12} cy={12} r={8.5} {...P} />
        <path d="M12 11v5.5M12 7.8v.1" {...P} />
      </>
    ),
    door: (
      <>
        <path d="M6 20.5V4.5a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v16M4 20.5h16" {...P} />
        <path d="M14.5 12.5v.1" {...P} />
      </>
    ),
    award: (
      <>
        <circle cx={12} cy={9} r={5} {...P} />
        <path d="M9 13.2 7.5 20.5l4.5-2.3 4.5 2.3-1.5-7.3" {...P} />
      </>
    ),
    map: <path d="M3.5 6.5 9 4.5l6 2 5.5-2v13l-5.5 2-6-2-5.5 2zM9 4.5v13M15 6.5v13" {...P} />,
    hammer: <path d="M13.5 6.5 17 3l4 4-3.5 3.5M13.5 6.5l4 4M13.5 6.5 11 4H7.5l3 3-7 7 3.5 3.5 7-7" {...P} />,
    key: (
      <>
        <circle cx={8} cy={15} r={4} {...P} />
        <path d="M11 12 20 3M16.5 6.5l2.5 2.5M14 9l2 2" {...P} />
      </>
    ),
    pen: <path d="M4 20l1-4.5L15.5 5a2.1 2.1 0 0 1 3 3L8 18.5zM13.5 7l3 3M13 20h7" {...P} />,
    droplet: <path d="M12 3.5c3.2 4 6 7.4 6 10.5a6 6 0 0 1-12 0c0-3.1 2.8-6.5 6-10.5zM9.5 14.5a2.5 2.5 0 0 0 2.5 2.5" {...P} />,
    bolt: <path d="M13 3 5.5 13.5H12L11 21l7.5-10.5H12z" {...P} />,
    stamp: (
      <>
        <path d="M9.5 11.5V9a2.5 2.5 0 1 1 5 0v2.5M5 14.5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v2H5zM6.5 20h11" {...P} />
      </>
    ),
    shield: (
      <>
        <path d="M12 3.5 5 6.5v5c0 4.3 3 7.6 7 9 4-1.4 7-4.7 7-9v-5z" {...P} />
        <path d="M12 8.5v4.5M9.75 10.75h4.5" {...P} />
      </>
    ),
    split: (
      <>
        <path d="M4 11 12 4.5l8 6.5v9H4z" {...P} />
        <path d="M12 9v11" {...P} />
      </>
    ),
  };
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      {paths[name]}
    </svg>
  );
}
