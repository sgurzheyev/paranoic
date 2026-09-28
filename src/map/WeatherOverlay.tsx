/**
 * Lightweight rain / sand canvas over the Family map. Idle when the sky is clear.
 */
import { useEffect, useRef } from 'react';
import type { MapWeatherMode } from './weather';

type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  len: number;
  alpha: number;
  w: number;
};

function spawnRain(w: number, h: number): Particle {
  return {
    x: Math.random() * (w + 40) - 20,
    y: Math.random() * h - h,
    vx: -1.2 - Math.random() * 1.4,
    vy: 14 + Math.random() * 10,
    len: 10 + Math.random() * 14,
    alpha: 0.18 + Math.random() * 0.35,
    w: 1,
  };
}

function spawnSand(w: number, h: number): Particle {
  return {
    x: Math.random() * (w + 80) - 40,
    y: Math.random() * h,
    vx: 6 + Math.random() * 10,
    vy: (Math.random() - 0.5) * 1.6,
    len: 4 + Math.random() * 10,
    alpha: 0.08 + Math.random() * 0.22,
    w: 1 + Math.random() * 2.2,
  };
}

export default function WeatherOverlay({ weather }: { weather: MapWeatherMode }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || weather === 'clear') return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let running = true;
    let raf = 0;
    const particles: Particle[] = [];
    const dpr = Math.min(2, window.devicePixelRatio || 1);

    const resize = () => {
      const parent = canvas.parentElement;
      const w = parent?.clientWidth || window.innerWidth;
      const h = parent?.clientHeight || window.innerHeight;
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const count =
        weather === 'rain'
          ? Math.min(140, Math.floor((w * h) / 12000))
          : Math.min(110, Math.floor((w * h) / 14000));
      particles.length = 0;
      const spawn = weather === 'rain' ? spawnRain : spawnSand;
      for (let i = 0; i < count; i += 1) particles.push(spawn(w, h));
    };

    resize();
    window.addEventListener('resize', resize);

    const tick = () => {
      if (!running) return;
      if (document.visibilityState === 'hidden') return;
      raf = requestAnimationFrame(tick);
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      ctx.clearRect(0, 0, w, h);
      if (weather === 'sandstorm') {
        ctx.fillStyle = 'rgba(216, 208, 193, 0.12)';
        ctx.fillRect(0, 0, w, h);
      }
      for (let i = 0; i < particles.length; i += 1) {
        const p = particles[i];
        p.x += p.vx;
        p.y += p.vy;
        if (weather === 'rain') {
          if (p.y > h + 20 || p.x < -30) {
            particles[i] = spawnRain(w, h);
            particles[i].y = -10;
            continue;
          }
          ctx.strokeStyle = `rgba(180, 210, 255, ${p.alpha})`;
          ctx.lineWidth = p.w;
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(p.x + p.vx * 1.2, p.y + p.len);
          ctx.stroke();
        } else {
          if (p.x > w + 40) {
            particles[i] = spawnSand(w, h);
            particles[i].x = -20;
            continue;
          }
          if (p.y < -10 || p.y > h + 10) p.y = Math.random() * h;
          ctx.strokeStyle = `rgba(209, 196, 170, ${p.alpha})`;
          ctx.lineWidth = p.w;
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(p.x + p.len, p.y + p.vy * 0.4);
          ctx.stroke();
        }
      }
    };

    const onVis = () => {
      if (!running || document.visibilityState !== 'visible') return;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(tick);
    };
    document.addEventListener('visibilitychange', onVis);
    raf = requestAnimationFrame(tick);
    return () => {
      running = false;
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [weather]);

  if (weather === 'clear') return null;

  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none absolute inset-0 z-[2]"
      aria-hidden
    />
  );
}
