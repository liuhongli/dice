const COLORS = [
  "#fa714f",
  "#ffc95c",
  "#8d75e6",
  "#76c8b5",
  "#f4a5c3",
  "#80b8e8",
];

export function createEffects(canvas) {
  const context = canvas?.getContext("2d");
  const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  const voices = new Set();
  let audioContext;
  let muted = false;
  let destroyed = false;
  let rollingTimer;
  let frame;
  let particles = [];
  let width = 0;
  let height = 0;
  let lastFrame = 0;

  function resize() {
    if (!context) return;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
  }

  function unlock() {
    if (destroyed) return;
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      audioContext ||= new AudioContext();
      if (audioContext.state === "suspended")
        audioContext.resume().catch(() => {});
    } catch {
      // Audio is optional when the browser or device cannot play it.
    }
  }

  function note(
    frequency,
    delay = 0,
    duration = 0.13,
    volume = 0.035,
    type = "sine",
  ) {
    if (destroyed || muted || audioContext?.state !== "running") return;
    try {
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();
      const start = audioContext.currentTime + delay;
      oscillator.type = type;
      oscillator.frequency.setValueAtTime(frequency, start);
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(volume, start + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
      oscillator.connect(gain);
      gain.connect(audioContext.destination);
      voices.add(oscillator);
      oscillator.onended = () => {
        voices.delete(oscillator);
        oscillator.disconnect();
        gain.disconnect();
      };
      oscillator.start(start);
      oscillator.stop(start + duration + 0.02);
    } catch {
      // Visual effects remain available if the audio device disconnects.
    }
  }

  function stopVoices() {
    for (const oscillator of voices) {
      try {
        oscillator.stop();
      } catch {}
    }
    voices.clear();
  }

  function clearConfetti() {
    cancelAnimationFrame(frame);
    frame = undefined;
    particles = [];
    context?.clearRect(0, 0, width, height);
  }

  function stopRolling() {
    clearInterval(rollingTimer);
    rollingTimer = undefined;
  }

  function draw(now) {
    if (destroyed || !context) return;
    const step = Math.min((now - lastFrame) / 1000, 0.035);
    lastFrame = now;
    context.clearRect(0, 0, width, height);
    particles = particles.filter(
      (particle) => particle.age < particle.life && particle.y < height + 24,
    );
    for (const particle of particles) {
      particle.age += step;
      particle.x += particle.vx * step;
      particle.y += particle.vy * step;
      particle.vx *= Math.exp(-0.7 * step);
      particle.vy += 540 * step;
      particle.rotation += particle.spin * step;
      const fade = Math.min(1, (particle.life - particle.age) / 0.5);
      context.save();
      context.globalAlpha = Math.max(0, fade);
      context.translate(particle.x, particle.y);
      context.rotate(particle.rotation);
      context.scale(
        1,
        0.35 + Math.abs(Math.cos(particle.age * 8 + particle.rotation)) * 0.65,
      );
      context.fillStyle = particle.color;
      if (particle.round) {
        context.beginPath();
        context.arc(0, 0, particle.size * 0.4, 0, Math.PI * 2);
        context.fill();
      } else {
        context.fillRect(
          -particle.size / 2,
          -particle.size / 4,
          particle.size,
          particle.size / 2,
        );
      }
      context.restore();
    }
    if (particles.length) frame = requestAnimationFrame(draw);
    else clearConfetti();
  }

  function confetti(sixes) {
    clearConfetti();
    if (!context || motionQuery.matches) return;
    const count = Math.min(76 + sixes * 38, 190);
    const spread = Math.min(width * 0.31, 350);
    particles = Array.from({ length: count }, (_, index) => ({
      x: width / 2 + (Math.random() - 0.5) * spread,
      y: Math.min(height * 0.53, 470),
      vx: (Math.random() - 0.5) * Math.min(width * 0.95, 740),
      vy: -200 - Math.random() * 350,
      size: 5 + Math.random() * 6,
      rotation: Math.random() * Math.PI,
      spin: (Math.random() - 0.5) * 11,
      age: 0,
      life: 1.35 + Math.random() * 0.65,
      color: COLORS[index % COLORS.length],
      round: index % 4 === 0,
    }));
    lastFrame = performance.now();
    frame = requestAnimationFrame(draw);
  }

  function rolling() {
    if (destroyed) return;
    stop();
    let tick = 0;
    const playTick = () => {
      note([330, 392, 440, 392][tick++ % 4], 0, 0.045, 0.018, "triangle");
    };
    playTick();
    rollingTimer = window.setInterval(playTick, 145);
  }

  function land(values = []) {
    if (destroyed) return;
    stopRolling();
    stopVoices();
    const sixes = values.filter((value) => value === 6).length;
    [523.25, 659.25, 783.99].forEach((frequency, index) => {
      note(frequency, index * 0.065, 0.24, 0.04);
    });
    if (sixes) note(1046.5, 0.205, 0.32, 0.032);
    confetti(sixes);
  }

  function stop() {
    stopRolling();
    stopVoices();
    clearConfetti();
  }

  function setMuted(value) {
    muted = Boolean(value);
    if (muted) stopVoices();
  }

  function onMotionChange() {
    if (motionQuery.matches) clearConfetti();
  }

  function destroy() {
    if (destroyed) return;
    stop();
    destroyed = true;
    window.removeEventListener("resize", resize);
    motionQuery.removeEventListener?.("change", onMotionChange);
    if (audioContext && audioContext.state !== "closed")
      audioContext.close().catch(() => {});
  }

  resize();
  window.addEventListener("resize", resize, { passive: true });
  motionQuery.addEventListener?.("change", onMotionChange);
  return { unlock, rolling, land, stop, setMuted, destroy };
}
