import { useCallback, useEffect, useRef } from "react";

const COLS = 24;
const ROWS = 24;
const CURSOR_R = 120;

interface Node {
  ox: number;
  oy: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  mobility: number;
  type: "soil" | "leaf" | "crack";
}

export default function DrySurfaceCanvasMini() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const nodesRef = useRef<Node[][]>([]);
  const cursorRef = useRef({ x: -999, y: -999, vx: 0, vy: 0 });
  const animRef = useRef(0);

  const initGrid = useCallback((img: HTMLImageElement, W: number, H: number) => {
    // Create an offscreen canvas to sample colors
    const off = document.createElement("canvas");
    off.width = COLS;
    off.height = ROWS;
    const ctx = off.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;
    ctx.drawImage(img, 0, 0, COLS, ROWS);
    const data = ctx.getImageData(0, 0, COLS, ROWS).data;

    const nodes: Node[][] = [];
    const cellW = W / (COLS - 1);
    const cellH = H / (ROWS - 1);

    for (let j = 0; j < ROWS; j++) {
      const row: Node[] = [];
      for (let i = 0; i < COLS; i++) {
        const idx = (j * COLS + i) * 4;
        const r = data[idx];
        const g = data[idx + 1];
        const b = data[idx + 2];
        const a = data[idx + 3];

        let mobility = 0.2;
        let type: "soil" | "leaf" | "crack" = "soil";

        if (a > 50) {
          // Dark = crack
          if (r < 60 && g < 60 && b < 60) {
            mobility = 0.05; // extremely subtle
            type = "crack";
          }
          // Green/Yellow = vegetation/leaves
          else if (g > r * 0.8 && g > 60) {
            mobility = 0.8; // bends/sways
            type = "leaf";
          }
          // Light brown = loose debris
          else if (r > 100 && g > 80 && b < 100) {
            mobility = 0.4;
            type = "soil";
          }
        } else {
          mobility = 0; // transparent areas
        }

        row.push({
          ox: i * cellW,
          oy: j * cellH,
          x: i * cellW,
          y: j * cellH,
          vx: 0,
          vy: 0,
          mobility,
          type,
        });
      }
      nodes.push(row);
    }
    nodesRef.current = nodes;
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const img = new Image();
    img.src = "/dry-surface.png";
    img.onload = () => {
      imgRef.current = img;
      resize();
    };

    let W = 0, H = 0;
    const dpr = window.devicePixelRatio || 1;

    const resize = () => {
      W = canvas.offsetWidth;
      H = canvas.offsetHeight;
      canvas.width = W * dpr;
      canvas.height = H * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (imgRef.current) initGrid(imgRef.current, W, H);
    };

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
    };
    const onLeave = () => { cursorRef.current = { x: -999, y: -999, vx: 0, vy: 0 }; };

    canvas.addEventListener("mousemove", onMove);
    canvas.addEventListener("mouseleave", onLeave);

    let lastT = 0;
    const tick = (t: number) => {
      const dt = Math.min((t - lastT) / 1000, 0.033);
      lastT = t;
      const cur = cursorRef.current;
      const img = imgRef.current;
      const nodes = nodesRef.current;

      if (!img || nodes.length === 0) {
        animRef.current = requestAnimationFrame(tick);
        return;
      }

      // Physics pass
      for (let j = 0; j < ROWS; j++) {
        for (let i = 0; i < COLS; i++) {
          const n = nodes[j][i];
          if (n.mobility === 0) continue;

          // Spring to original position
          const k = 150; // stiffness
          const damp = 12; // damping
          let fx = -k * (n.x - n.ox) - damp * n.vx;
          let fy = -k * (n.y - n.oy) - damp * n.vy;

          // Cursor interaction
          const dx = n.x - cur.x;
          const dy = n.y - cur.y;
          const dist = Math.sqrt(dx * dx + dy * dy);

          if (dist < CURSOR_R && dist > 1) {
            const falloff = Math.pow(1 - dist / CURSOR_R, 2);
            // Push outwards, proportional to cursor velocity and node mobility
            const pushX = (dx / dist) * 1000 * falloff * n.mobility;
            const pushY = (dy / dist) * 1000 * falloff * n.mobility;
            
            // Cursor velocity drag
            const dragX = cur.vx * 30 * falloff * n.mobility;
            const dragY = cur.vy * 30 * falloff * n.mobility;

            fx += pushX + dragX;
            fy += pushY + dragY;
          }

          n.vx += fx * dt;
          n.vy += fy * dt;
          n.x += n.vx * dt;
          n.y += n.vy * dt;
        }
      }

      // Render pass
      ctx.clearRect(0, 0, W, H);
      
      // Match dark background
      ctx.fillStyle = "#0a0f0a";
      ctx.fillRect(0, 0, W, H);

      const cellSw = img.width / (COLS - 1);
      const cellSh = img.height / (ROWS - 1);

      for (let j = 0; j < ROWS - 1; j++) {
        for (let i = 0; i < COLS - 1; i++) {
          const n00 = nodes[j][i];
          const n10 = nodes[j][i + 1];
          const n01 = nodes[j + 1][i];
          const n11 = nodes[j + 1][i + 1];

          const minX = Math.min(n00.x, n01.x, n10.x, n11.x);
          const maxX = Math.max(n00.x, n01.x, n10.x, n11.x);
          const minY = Math.min(n00.y, n01.y, n10.y, n11.y);
          const maxY = Math.max(n00.y, n01.y, n10.y, n11.y);

          const dw = maxX - minX;
          const dh = maxY - minY;

          // +0.5 to prevent seams between drawn cells
          ctx.drawImage(
            img,
            i * cellSw, j * cellSh, cellSw, cellSh,
            minX, minY, dw + 0.5, dh + 0.5
          );
        }
      }

      animRef.current = requestAnimationFrame(tick);
    };

    animRef.current = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(animRef.current);
      ro.disconnect();
      canvas.removeEventListener("mousemove", onMove);
      canvas.removeEventListener("mouseleave", onLeave);
    };
  }, [initGrid]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        display: "block",
        cursor: "crosshair",
        touchAction: "none",
      }}
    />
  );
}
