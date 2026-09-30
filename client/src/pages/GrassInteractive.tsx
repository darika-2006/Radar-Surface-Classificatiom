import { useCallback, useEffect, useRef } from "react";
import { Link } from "wouter";

interface Blade {
  xR: number;
  natAngle: number;
  lenR: number;
  hwR: number;
  layer: 0 | 1 | 2;
  ang: number;
  vel: number;
  wPhase: number;
  wFreq: number;
  hOff: number;
  sOff: number;
}

const CFG = [
  { k: 295, c: 27, cs: 0.008, wa: 0.0055 },
  { k: 218, c: 20, cs: 0.016, wa: 0.0095 },
  { k: 152, c: 14, cs: 0.028, wa: 0.0165 },
] as const;

const CURSOR_R = 240;
const MAX_ANG = 0.73;
const N_SEG = 14;

const RAW: [number, number, number, number, 0 | 1 | 2][] = [
  [0.045, -0.15, 0.52, 0.012, 0], [0.110, 0.12, 0.56, 0.013, 0],
  [0.185, -0.08, 0.54, 0.0125, 0], [0.260, 0.20, 0.50, 0.0115, 0],
  [0.340, -0.18, 0.55, 0.0122, 0], [0.420, 0.06, 0.58, 0.013, 0],
  [0.505, -0.22, 0.52, 0.012, 0], [0.585, 0.14, 0.56, 0.0128, 0],
  [0.665, -0.10, 0.54, 0.0122, 0], [0.745, 0.18, 0.50, 0.0115, 0],
  [0.828, -0.05, 0.57, 0.0128, 0], [0.910, 0.08, 0.53, 0.012, 0],
  [0.022, -0.48, 0.73, 0.0185, 1], [0.088, 0.38, 0.77, 0.0195, 1],
  [0.152, -0.18, 0.75, 0.0188, 1], [0.218, 0.55, 0.71, 0.018, 1],
  [0.288, -0.08, 0.79, 0.0198, 1], [0.358, 0.32, 0.74, 0.0188, 1],
  [0.432, -0.58, 0.76, 0.0192, 1], [0.505, 0.22, 0.78, 0.0188, 1],
  [0.578, -0.35, 0.72, 0.0182, 1], [0.650, 0.48, 0.77, 0.0195, 1],
  [0.722, -0.20, 0.74, 0.0185, 1], [0.796, 0.30, 0.79, 0.0198, 1],
  [0.868, -0.42, 0.71, 0.018, 1], [0.940, 0.15, 0.76, 0.0188, 1],
  [0.032, -0.65, 0.89, 0.0278, 2], [0.102, 0.60, 0.86, 0.029, 2],
  [0.170, -0.22, 0.91, 0.0302, 2], [0.240, -0.78, 0.85, 0.0268, 2],
  [0.312, 0.42, 0.92, 0.0305, 2], [0.388, -0.28, 0.88, 0.0282, 2],
  [0.462, 0.68, 0.90, 0.0295, 2], [0.538, -0.40, 0.86, 0.0272, 2],
  [0.615, 0.25, 0.93, 0.0305, 2], [0.692, -0.55, 0.87, 0.0285, 2],
  [0.768, 0.48, 0.89, 0.0292, 2], [0.845, -0.18, 0.85, 0.0272, 2],
  [0.922, 0.35, 0.91, 0.029, 2],
];

function drawBlade(ctx: CanvasRenderingContext2D, b: Blade, W: number, H: number) {
  const baseX = b.xR * W;
  const baseY = H;
  const length = b.lenR * H;
  const hw0 = b.hwR * W;

  const pts: { x: number; y: number; a: number }[] = [];
  let px = baseX, py = baseY;
  const segLen = length / N_SEG;

  for (let i = 0; i <= N_SEG; i++) {
    const t = i / N_SEG;
    const a = b.natAngle + b.ang * Math.pow(t, 1.8);
    pts.push({ x: px, y: py, a });
    if (i < N_SEG) { px += segLen * Math.sin(a); py -= segLen * Math.cos(a); }
  }

  const hw = (t: number) => hw0 * Math.pow(Math.max(0, 1 - t), 0.52);
  const left: { x: number; y: number }[] = [];
  const right: { x: number; y: number }[] = [];

  for (let i = 0; i <= N_SEG; i++) {
    const { x, y, a } = pts[i];
    const w = hw(i / N_SEG);
    const perpX = Math.cos(a) * w;
    const perpY = Math.sin(a) * w;
    left.push({ x: x - perpX, y: y - perpY });
    right.push({ x: x + perpX, y: y + perpY });
  }

  ctx.beginPath();
  ctx.moveTo(left[0].x, left[0].y);
  for (let i = 1; i <= N_SEG; i++) ctx.lineTo(left[i].x, left[i].y);
  for (let i = N_SEG; i >= 0; i--) ctx.lineTo(right[i].x, right[i].y);
  ctx.closePath();

  const tip = pts[N_SEG];
  const h = 92 + b.hOff;
  const s = 68 + b.sOff;
  const grad = ctx.createLinearGradient(baseX, baseY, tip.x, tip.y);

  if (b.layer === 0) {
    grad.addColorStop(0.00, `hsl(${h + 8}, ${s - 10}%, 13%)`);
    grad.addColorStop(0.28, `hsl(${h + 2}, ${s - 2}%, 23%)`);
    grad.addColorStop(0.62, `hsl(${h - 2}, ${s + 6}%, 30%)`);
    grad.addColorStop(1.00, `hsl(${h - 5}, ${s + 2}%, 35%)`);
  } else if (b.layer === 1) {
    grad.addColorStop(0.00, `hsl(${h + 10}, ${s}%, 15%)`);
    grad.addColorStop(0.18, `hsl(${h + 4}, ${s + 14}%, 27%)`);
    grad.addColorStop(0.52, `hsl(${h}, ${s + 20}%, 38%)`);
    grad.addColorStop(0.82, `hsl(${h - 3}, ${s + 14}%, 44%)`);
    grad.addColorStop(1.00, `hsl(${h - 6}, ${s + 6}%, 47%)`);
  } else {
    grad.addColorStop(0.00, `hsl(${h + 12}, ${s + 5}%, 17%)`);
    grad.addColorStop(0.14, `hsl(${h + 6}, ${s + 20}%, 31%)`);
    grad.addColorStop(0.42, `hsl(${h + 2}, ${s + 28}%, 44%)`);
    grad.addColorStop(0.72, `hsl(${h - 1}, ${s + 22}%, 51%)`);
    grad.addColorStop(1.00, `hsl(${h - 4}, ${s + 12}%, 54%)`);
  }
  ctx.fillStyle = grad;
  ctx.fill();

  const midAlpha = [0.16, 0.24, 0.34][b.layer];
  const midW = Math.max(0.7, hw0 * [0.10, 0.13, 0.15][b.layer]);
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i <= N_SEG; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.strokeStyle = `hsla(82, 95%, 70%, ${midAlpha})`;
  ctx.lineWidth = midW;
  ctx.lineCap = "round";
  ctx.stroke();

  const edgeA = [0.20, 0.27, 0.34][b.layer];
  ctx.beginPath();
  ctx.moveTo(left[0].x, left[0].y);
  for (let i = 1; i <= N_SEG; i++) ctx.lineTo(left[i].x, left[i].y);
  ctx.strokeStyle = `hsla(112, 40%, 8%, ${edgeA})`;
  ctx.lineWidth = hw0 * 0.32;
  ctx.lineJoin = "round";
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(right[0].x, right[0].y);
  for (let i = 1; i <= N_SEG; i++) ctx.lineTo(right[i].x, right[i].y);
  ctx.strokeStyle = `hsla(112, 40%, 8%, ${edgeA * 0.65})`;
  ctx.lineWidth = hw0 * 0.22;
  ctx.stroke();
}

export default function GrassInteractive() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const bladesRef = useRef<Blade[]>([]);
  const cursorRef = useRef({ x: -9999, y: -9999, vx: 0, vy: 0 });
  const animRef = useRef(0);
  const hintRef = useRef<HTMLDivElement>(null);
  const hintDoneRef = useRef(false);

  const initBlades = useCallback(() => {
    const rnd = (a: number, b: number) => a + Math.random() * (b - a);
    bladesRef.current = RAW.map(([xR, natAngle, lenR, hwR, layer]) => ({
      xR, natAngle, lenR, hwR, layer,
      ang: 0, vel: 0,
      wPhase: rnd(0, Math.PI * 2),
      wFreq: rnd(0.27, 0.54),
      hOff: rnd(-6, 6),
      sOff: rnd(-10, 10),
    }));
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    initBlades();

    const dpr = window.devicePixelRatio || 1;
    let W = 0, H = 0;

    const resize = () => {
      W = canvas.offsetWidth;
      H = canvas.offsetHeight;
      canvas.width = W * dpr;
      canvas.height = H * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();

    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const onMove = (e: MouseEvent) => {
      const r = canvas.getBoundingClientRect();
      const nx = e.clientX - r.left;
      const ny = e.clientY - r.top;
      cursorRef.current.vx = nx - cursorRef.current.x;
      cursorRef.current.vy = ny - cursorRef.current.y;
      cursorRef.current.x = nx;
      cursorRef.current.y = ny;
      if (!hintDoneRef.current && hintRef.current) {
        hintDoneRef.current = true;
        hintRef.current.style.opacity = "0";
      }
    };
    const onLeave = () => { cursorRef.current = { x: -9999, y: -9999, vx: 0, vy: 0 }; };
    const onTouch = (e: TouchEvent) => {
      if (!e.touches[0]) return;
      const r = canvas.getBoundingClientRect();
      const nx = e.touches[0].clientX - r.left;
      const ny = e.touches[0].clientY - r.top;
      cursorRef.current.vx = nx - cursorRef.current.x;
      cursorRef.current.vy = ny - cursorRef.current.y;
      cursorRef.current.x = nx;
      cursorRef.current.y = ny;
      if (!hintDoneRef.current && hintRef.current) {
        hintDoneRef.current = true;
        hintRef.current.style.opacity = "0";
      }
    };

    canvas.addEventListener("mousemove", onMove);
    canvas.addEventListener("mouseleave", onLeave);
    canvas.addEventListener("touchmove", onTouch, { passive: true });
    canvas.addEventListener("touchend", onLeave);

    let lastT = 0;
    const tick = (t: number) => {
      const dt = Math.min((t - lastT) / 1000, 0.033);
      lastT = t;
      const cur = cursorRef.current;
      const wT = t * 0.001;

      for (const b of bladesRef.current) {
        const cfg = CFG[b.layer];
        const bx = b.xR * W;
        const midY = H - Math.cos(b.natAngle) * b.lenR * H * 0.5;
        const dx = bx - cur.x;
        const dy = midY - cur.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        const fSpring = -cfg.k * b.ang;
        const fDamp = -cfg.c * b.vel;

        let fCursor = 0;
        if (dist < CURSOR_R && dist > 1) {
          const fall = 1 - dist / CURSOR_R;
          const fall2 = fall * fall;
          const sign = dx >= 0 ? 1 : -1;
          const velKick = cur.vx * fall2 * 0.30 * sign;
          fCursor = cfg.cs * 1000 * (sign * 2.8 * fall2 + velKick);
        }

        const wind = Math.sin(wT * b.wFreq * Math.PI * 2 + b.wPhase);
        const fWind = wind * cfg.wa * cfg.k;

        b.vel += (fSpring + fDamp + fCursor + fWind) * dt;
        b.ang += b.vel * dt;
        b.ang = Math.max(-MAX_ANG, Math.min(MAX_ANG, b.ang));
      }

      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = "#f6f6f1";
      ctx.fillRect(0, 0, W, H);

      for (const b of bladesRef.current) drawBlade(ctx, b, W, H);

      const gg = ctx.createLinearGradient(0, H - 28, 0, H);
      gg.addColorStop(0.0, "rgba(16,44,4,0)");
      gg.addColorStop(0.4, "rgba(10,32,2,0.88)");
      gg.addColorStop(1.0, "rgba(5,16,1,1)");
      ctx.fillStyle = gg;
      ctx.fillRect(0, H - 28, W, 28);

      if (cur.x > 0) {
        const glowR = ctx.createRadialGradient(cur.x, cur.y, 0, cur.x, cur.y, 60);
        glowR.addColorStop(0, "rgba(180,255,80,0.04)");
        glowR.addColorStop(1, "rgba(180,255,80,0)");
        ctx.fillStyle = glowR;
        ctx.fillRect(0, 0, W, H);
      }

      animRef.current = requestAnimationFrame(tick);
    };

    animRef.current = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(animRef.current);
      ro.disconnect();
      canvas.removeEventListener("mousemove", onMove);
      canvas.removeEventListener("mouseleave", onLeave);
      canvas.removeEventListener("touchmove", onTouch);
      canvas.removeEventListener("touchend", onLeave);
    };
  }, [initBlades]);

  return (
    <div style={{
      width: "100vw", height: "100vh", background: "#f6f6f1",
      display: "flex", flexDirection: "column", overflow: "hidden",
      fontFamily: "'IBM Plex Mono', 'Courier New', monospace",
    }}>
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        padding: "9px 18px", borderBottom: "1px solid rgba(60,110,20,0.15)",
        fontSize: 11, letterSpacing: "0.07em", color: "#6a7a52",
        background: "rgba(246,246,241,0.96)", backdropFilter: "blur(8px)",
        zIndex: 10, flexShrink: 0,
      }}>
        <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
          <span style={{ color: "#3a7a10", fontWeight: 700, letterSpacing: "0.1em" }}>
            ◈ GRASS / INTERACTIVE
          </span>
          <span style={{ color: "#8a9a72", fontSize: 10 }}>
            cursor-reactive · spring physics · 3-layer parallax
          </span>
        </div>
        <Link href="/" style={{
          color: "#6a7a52", textDecoration: "none",
          border: "1px solid rgba(60,110,20,0.22)",
          padding: "3px 10px", borderRadius: 2, fontSize: 10, letterSpacing: "0.06em",
        }}>
          → RADAR APP
        </Link>
      </div>
      <div style={{ position: "relative", flex: 1 }}>
        <canvas ref={canvasRef} style={{
          width: "100%", height: "100%", display: "block",
          cursor: "none", touchAction: "none",
        }} />
        <div ref={hintRef} style={{
          position: "absolute", bottom: 52, left: "50%",
          transform: "translateX(-50%)",
          fontSize: 11, letterSpacing: "0.10em",
          color: "rgba(60,90,20,0.55)",
          pointerEvents: "none",
          transition: "opacity 0.6s ease",
          whiteSpace: "nowrap",
        }}>
          MOVE CURSOR THROUGH THE GRASS
        </div>
      </div>
    </div>
  );
}
