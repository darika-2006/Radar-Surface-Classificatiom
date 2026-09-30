import React, { useEffect, useRef } from "react";

type WaterConfidenceCanvasProps = {
  wetConfidence: number; // 0.0 to 1.0
};

type Ripple = {
  x: number;
  intensity: number;
  age: number;
};

export default function WaterConfidenceCanvas({ wetConfidence }: WaterConfidenceCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const smoothedConfidenceRef = useRef(wetConfidence);
  const ripplesRef = useRef<Ripple[]>([]);
  const lastMousePos = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) return;

    let animationId: number;
    let time = 0;

    // Resize handling
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * window.devicePixelRatio;
      canvas.height = rect.height * window.devicePixelRatio;
    };
    window.addEventListener("resize", resize);
    resize();

    const draw = () => {
      const width = canvas.width;
      const height = canvas.height;
      const dpr = window.devicePixelRatio;
      time += 0.02;

      // Smooth confidence transition (eases toward target)
      smoothedConfidenceRef.current += (wetConfidence - smoothedConfidenceRef.current) * 0.04;
      const waterLevelY = height - smoothedConfidenceRef.current * height;

      // Clear with dark tank background matching the radar UI
      ctx.fillStyle = "#0b0f14";
      ctx.fillRect(0, 0, width, height);

      // We will draw the water body as a filled polygon
      ctx.beginPath();
      ctx.moveTo(0, height); // bottom left

      // Draw surface waves
      const step = 4 * dpr; // optimize step size
      for (let x = 0; x <= width + step; x += step) {
        // Base sine waves for subtle liquid movement
        let surfaceY = waterLevelY;
        
        // Only show waves if we actually have some water
        if (smoothedConfidenceRef.current > 0.01) {
          const wave1 = Math.sin((x / dpr) * 0.01 + time * 1.2) * 4 * dpr;
          const wave2 = Math.sin((x / dpr) * 0.025 - time * 0.8) * 2 * dpr;
          const wave3 = Math.sin((x / dpr) * 0.005 + time * 0.5) * 6 * dpr;
          surfaceY += wave1 + wave2 + wave3;
        }

        // Apply interactive cursor ripples
        ripplesRef.current.forEach((ripple) => {
          const distance = Math.abs(x - ripple.x * dpr);
          // Gaussian-like falloff for localized ripple
          const falloff = Math.exp(-(distance * distance) / (20000 * dpr));
          const rippleWave = Math.sin(distance * 0.04 - ripple.age * 0.3) * ripple.intensity * dpr;
          const decay = Math.max(0, 1 - ripple.age / 100);
          surfaceY += rippleWave * falloff * decay;
        });

        if (x === 0) {
          ctx.lineTo(x, surfaceY);
        } else {
          ctx.lineTo(x, surfaceY);
        }
      }

      // Complete the polygon
      ctx.lineTo(width, height); // bottom right
      ctx.closePath();

      // Soft water gradient
      const gradient = ctx.createLinearGradient(0, waterLevelY - 20 * dpr, 0, height);
      gradient.addColorStop(0, "rgba(161, 219, 255, 0.45)");
      gradient.addColorStop(1, "rgba(80, 160, 255, 0.15)");
      ctx.fillStyle = gradient;
      ctx.fill();

      // Top edge highlight (gives surface tension feel)
      ctx.strokeStyle = "rgba(190, 230, 255, 0.7)";
      ctx.lineWidth = 1.5 * dpr;
      ctx.stroke();

      // Update ripples
      ripplesRef.current = ripplesRef.current.filter((r) => {
        r.age += 1;
        return r.age < 100; // max age
      });

      animationId = requestAnimationFrame(draw);
    };

    draw();

    return () => {
      window.removeEventListener("resize", resize);
      cancelAnimationFrame(animationId);
    };
  }, [wetConfidence]);

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    
    const currentX = e.clientX - rect.left;
    const currentY = e.clientY - rect.top;

    if (lastMousePos.current) {
      const dx = currentX - lastMousePos.current.x;
      const dy = currentY - lastMousePos.current.y;
      const velocity = Math.sqrt(dx * dx + dy * dy);

      // Only create ripples if the cursor is somewhat near the water surface
      // (Estimate surface height)
      const estimatedSurfaceY = rect.height - smoothedConfidenceRef.current * rect.height;
      if (Math.abs(currentY - estimatedSurfaceY) < 40) {
        if (velocity > 1) {
          ripplesRef.current.push({
            x: currentX,
            intensity: Math.min(velocity * 0.5, 15),
            age: 0,
          });
        }
      }
    }

    lastMousePos.current = { x: currentX, y: currentY };
  };

  const handleMouseLeave = () => {
    lastMousePos.current = null;
  };

  return (
    <canvas
      ref={canvasRef}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        cursor: "crosshair",
      }}
    />
  );
}
