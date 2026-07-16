/* =========================================================
   POKÉDEX ULTIMATE — GRADIENT-BG.JS
   Fundo animado que retoma o próprio conceito do hero ("SCANNER DE
   POKÉDEX ATIVO"): um radar de sensor varrendo o campo, uma grade
   hexagonal de leitura de dados e Poké Balls flutuando lentamente,
   como blips detectados à distância. Canvas 2D puro, sem dependências.
   ========================================================= */

(function () {
  'use strict';

  function initCanvas(canvas) {
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      canvas.style.display = 'none';
      return;
    }

    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const isLight = () => document.body.classList.contains('theme-light');

    let width = 0;
    let height = 0;
    let dpr = 1;

    function resize() {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      canvas.width = Math.max(1, Math.floor(width * dpr));
      canvas.height = Math.max(1, Math.floor(height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(canvas);
    resize();

    // Poké Balls detectadas ao longe: sobem lentamente pela tela, como
    // blips capturados pelo sensor, com um leve balanço lateral.
    const BALL_COUNT = 10;
    const balls = Array.from({ length: BALL_COUNT }, () => ({
      x: Math.random(),
      y: Math.random() * 1.4,
      r: 50 + Math.random() * 130,
      speed: 0.014 + Math.random() * 0.02,
      driftAmp: 0.02 + Math.random() * 0.03,
      driftSpeed: 0.15 + Math.random() * 0.25,
      phase: Math.random() * Math.PI * 2
    }));

    function drawPokeball(x, y, r, color) {
      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(1.2, r * 0.05);
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x - r, y);
      ctx.lineTo(x + r, y);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x, y, r * 0.2, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    function drawHex(cx, cy, size) {
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const angle = (Math.PI / 180) * (60 * i - 30);
        const px = cx + size * Math.cos(angle);
        const py = cy + size * Math.sin(angle);
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.stroke();
    }

    // Grade hexagonal sutil, como a malha de leitura de um sensor de campo.
    // Desliza bem devagar para dar a sensação de dados em varredura contínua.
    function drawHexGrid(t, color) {
      const size = 48;
      const stepX = size * 1.732;
      const stepY = size * 1.5;
      const offsetY = (t * 3.5) % (stepY * 2);

      ctx.save();
      ctx.globalAlpha = 0.09;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;

      for (let row = -1; row * stepY - offsetY < height + stepY; row++) {
        const y = row * stepY - offsetY;
        const xOffset = row % 2 === 0 ? 0 : stepX / 2;
        for (let col = -1; col * stepX + xOffset < width + stepX; col++) {
          drawHex(col * stepX + xOffset, y, size);
        }
      }
      ctx.restore();
    }

    // Varredura de radar girando a partir de um canto, como o "scanner-line"
    // do hero, só que contínua e em segundo plano por todo o site.
    function drawRadarSweep(t, cx, cy, maxR, color, coreColor) {
      ctx.save();
      if (typeof ctx.createConicGradient === 'function') {
        const angle = (t * 0.85) % (Math.PI * 2);
        const grad = ctx.createConicGradient(angle - 1.3, cx, cy);
        grad.addColorStop(0, 'rgba(0,0,0,0)');
        grad.addColorStop(0.82, 'rgba(0,0,0,0)');
        grad.addColorStop(0.98, color);
        grad.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.globalAlpha = 0.55;
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(cx, cy, maxR, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 0.22;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.4;
      [0.28, 0.56, 0.84, 1.1].forEach((f) => {
        ctx.beginPath();
        ctx.arc(cx, cy, maxR * f, 0, Math.PI * 2);
        ctx.stroke();
      });

      // Núcleo pulsante no ponto de origem do radar, como o LED de um scanner ligado.
      const pulse = 10 + Math.sin(t * 2.4) * 5;
      const coreGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, pulse * 4);
      coreGrad.addColorStop(0, coreColor);
      coreGrad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.globalAlpha = 0.8;
      ctx.fillStyle = coreGrad;
      ctx.beginPath();
      ctx.arc(cx, cy, pulse * 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    let start = null;
    let rafId = null;

    function frame(ts) {
      if (!start) start = ts;
      const t = (ts - start) / 1000;

      ctx.clearRect(0, 0, width, height);

      const light = isLight();
      const gridColor = light ? 'rgba(199,51,37,0.6)' : 'rgba(57,217,164,0.7)';
      const sweepColor = light ? 'rgba(199,51,37,0.6)' : 'rgba(57,217,164,0.65)';
      const coreColor = light ? 'rgba(199,51,37,0.5)' : 'rgba(57,217,164,0.55)';
      const ballColor = light ? 'rgba(199,51,37,0.22)' : 'rgba(242,176,37,0.22)';

      drawHexGrid(t, gridColor);
      drawRadarSweep(t, width * 0.85, height * 0.1, Math.max(width, height) * 0.65, sweepColor, coreColor);

      balls.forEach((b) => {
        const travel = (b.y - t * b.speed) % 1.4;
        const normalizedY = travel < -0.2 ? travel + 1.4 : travel;
        const wobble = Math.sin(t * b.driftSpeed + b.phase) * b.driftAmp;
        drawPokeball((b.x + wobble) * width, (1.2 - normalizedY) * height, b.r, ballColor);
      });

      if (!prefersReducedMotion) {
        rafId = requestAnimationFrame(frame);
      }
    }

    if (prefersReducedMotion) {
      // Um único frame estático, sem varredura contínua nem blips subindo.
      frame(0);
    } else {
      rafId = requestAnimationFrame(frame);
    }

    // Redesenha imediatamente ao trocar de tema, para as cores acompanharem.
    const themeObserver = new MutationObserver(() => {
      if (prefersReducedMotion) frame(0);
    });
    themeObserver.observe(document.body, { attributes: true, attributeFilter: ['class'] });

    // Pausa a animação quando a aba não está visível (economiza CPU/bateria).
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && rafId) {
        cancelAnimationFrame(rafId);
        rafId = null;
      } else if (!document.hidden && !prefersReducedMotion && !rafId) {
        start = null;
        rafId = requestAnimationFrame(frame);
      }
    });
  }

  function init() {
    const canvas = document.getElementById('gradientCanvas');
    if (!canvas) return;
    try {
      initCanvas(canvas);
    } catch (e) {
      console.warn('Não foi possível iniciar a animação de fundo:', e);
      canvas.style.display = 'none';
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();