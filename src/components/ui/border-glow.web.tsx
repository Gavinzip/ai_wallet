import { useCallback, useEffect, useRef, type CSSProperties, type PropsWithChildren } from "react";

import "./border-glow.web.css";

type BorderGlowStyle = CSSProperties & Record<string, string | number | undefined>;

type BorderGlowProps = PropsWithChildren<{
  active?: boolean;
  animated?: boolean;
  backgroundColor?: string;
  borderRadius?: number;
  className?: string;
  colors?: string[];
  coneSpread?: number;
  contentStyle?: CSSProperties;
  edgeSensitivity?: number;
  fillOpacity?: number;
  glowColor?: string;
  glowIntensity?: number;
  glowRadius?: number;
  style?: CSSProperties;
}>;

function parseHSL(hslStr: string) {
  const match = hslStr.match(/([\d.]+)\s*([\d.]+)%?\s*([\d.]+)%?/);
  if (!match) return { h: 40, l: 80, s: 80 };
  return { h: Number.parseFloat(match[1]), s: Number.parseFloat(match[2]), l: Number.parseFloat(match[3]) };
}

function buildGlowVars(glowColor: string, intensity: number) {
  const { h, s, l } = parseHSL(glowColor);
  const base = `${h}deg ${s}% ${l}%`;
  const opacities = [100, 60, 50, 40, 30, 20, 10];
  const keys = ["", "-60", "-50", "-40", "-30", "-20", "-10"];
  const vars: BorderGlowStyle = {};

  for (let i = 0; i < opacities.length; i += 1) {
    vars[`--glow-color${keys[i]}`] = `hsl(${base} / ${Math.min(opacities[i] * intensity, 100)}%)`;
  }

  return vars;
}

export function BorderGlow({
  active = false,
  animated = false,
  backgroundColor = "#ffffff",
  borderRadius = 28,
  children,
  className = "",
  colors = ["#c084fc", "#f472b6", "#38bdf8"],
  coneSpread = 25,
  contentStyle,
  edgeSensitivity = 30,
  fillOpacity = 0,
  glowColor = "40 80 80",
  glowIntensity = 1,
  glowRadius = 40,
  style,
}: BorderGlowProps) {
  const cardRef = useRef<HTMLDivElement | null>(null);

  const getCenterOfElement = useCallback((el: HTMLDivElement) => {
    const { height, width } = el.getBoundingClientRect();
    return [width / 2, height / 2];
  }, []);

  const getEdgeProximity = useCallback(
    (el: HTMLDivElement, x: number, y: number) => {
      const [cx, cy] = getCenterOfElement(el);
      const dx = x - cx;
      const dy = y - cy;
      let kx = Infinity;
      let ky = Infinity;

      if (dx !== 0) kx = cx / Math.abs(dx);
      if (dy !== 0) ky = cy / Math.abs(dy);

      return Math.min(Math.max(1 / Math.min(kx, ky), 0), 1);
    },
    [getCenterOfElement],
  );

  const getCursorAngle = useCallback(
    (el: HTMLDivElement, x: number, y: number) => {
      const [cx, cy] = getCenterOfElement(el);
      const dx = x - cx;
      const dy = y - cy;

      if (dx === 0 && dy === 0) return 0;

      const radians = Math.atan2(dy, dx);
      let degrees = radians * (180 / Math.PI) + 90;
      if (degrees < 0) degrees += 360;
      return degrees;
    },
    [getCenterOfElement],
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const card = cardRef.current;
      if (!card) return;

      const rect = card.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      const edge = getEdgeProximity(card, x, y);
      const angle = getCursorAngle(card, x, y);

      card.style.setProperty("--edge-proximity", `${(edge * 100).toFixed(3)}`);
      card.style.setProperty("--cursor-angle", `${angle.toFixed(3)}deg`);
    },
    [getCursorAngle, getEdgeProximity],
  );

  const handlePointerLeave = useCallback(() => {
    const card = cardRef.current;
    if (!card || animated) return;

    card.style.setProperty("--edge-proximity", active ? "100" : "0");
    card.style.setProperty("--cursor-angle", "45deg");
  }, [active, animated]);

  useEffect(() => {
    const card = cardRef.current;
    if (!card) return;

    card.style.setProperty("--edge-proximity", active || animated ? "100" : "0");

    if (!animated) {
      card.classList.remove("sweep-active");
      return;
    }

    card.classList.add("sweep-active");
    let raf = 0;
    const startedAt = performance.now();
    const duration = 5200;

    const tick = (now: number) => {
      const cycle = ((now - startedAt) % duration) / duration;
      const angle = 110 + cycle * 360;
      card.style.setProperty("--edge-proximity", "100");
      card.style.setProperty("--cursor-angle", `${angle.toFixed(3)}deg`);
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      card.classList.remove("sweep-active");
    };
  }, [active, animated]);

  const cssVars: BorderGlowStyle = {
    "--border-radius": `${borderRadius}px`,
    "--card-bg": backgroundColor,
    "--cone-spread": coneSpread,
    "--edge-proximity": active || animated ? 100 : 0,
    "--edge-sensitivity": edgeSensitivity,
    "--fill-opacity": fillOpacity,
    "--flow-one": colors[0] ?? "#c084fc",
    "--flow-two": colors[1] ?? "#f472b6",
    "--flow-three": colors[2] ?? "#38bdf8",
    "--glow-padding": `${glowRadius}px`,
    ...buildGlowVars(glowColor, glowIntensity),
  };

  return (
    <div
      className={`border-glow-card ${active ? "is-active" : ""} ${className}`.trim()}
      onPointerLeave={handlePointerLeave}
      onPointerMove={handlePointerMove}
      ref={cardRef}
      style={{ ...cssVars, ...style }}
    >
      <span className="edge-light" />
      <div className="border-glow-inner" style={contentStyle}>
        {children}
      </div>
    </div>
  );
}
