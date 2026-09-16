'use strict';

const { PIPS, projectDie } = require('./geometry');
const COLORS = { page: '#f7f6ef', ink: '#243f34', green: '#2e8168', muted: '#839176', pale: '#ecf1e5', line: '#dce5d3', white: '#fffef8', gold: '#e3b84f' };

function createRenderer(canvas, initialMetrics) {
  const ctx = canvas.getContext('2d');
  let metrics = {}, regions = [], contentHeight = 0, scrollY = 0;
  const images = new Map();
  const createImage = initialMetrics.createImage;

  function resize(next) {
    metrics = Object.assign({}, metrics, next);
    metrics.width = Math.max(240, Number(metrics.width) || 375);
    metrics.height = Math.max(320, Number(metrics.height) || 720);
    metrics.pixelRatio = Math.max(1, Math.min(3, Number(metrics.pixelRatio) || 1));
    canvas.width = Math.round(metrics.width * metrics.pixelRatio);
    canvas.height = Math.round(metrics.height * metrics.pixelRatio);
  }
  resize(initialMetrics);

  function roundRect(x, y, w, h, radius = 14) {
    const r = Math.min(radius, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath();
  }
  function box(x, y, w, h, fill, radius = 14, stroke) {
    roundRect(x, y, w, h, radius); ctx.fillStyle = fill; ctx.fill();
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.stroke(); }
  }
  function text(value, x, y, size = 14, color = COLORS.ink, align = 'left', weight = 'normal') {
    ctx.font = `${weight} ${size}px sans-serif`; ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = 'middle'; ctx.fillText(String(value), x, y);
  }
  function wrappedText(value, x, y, maxWidth, size = 12, color = COLORS.muted, lineHeight = 19) {
    ctx.font = `${size}px sans-serif`;
    let line = '', offset = 0;
    for (const char of String(value || '')) {
      if (char === '\n' || (line && ctx.measureText(line + char).width > maxWidth)) {
        text(line, x, y + offset, size, color); offset += lineHeight; line = char === '\n' ? '' : char;
      } else line += char;
    }
    if (line) { text(line, x, y + offset, size, color); offset += lineHeight; }
    return offset;
  }
  function circle(x, y, radius, fill, stroke) {
    ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.fillStyle = fill; ctx.fill();
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.stroke(); }
  }
  function star(x, y, radius, color, rotation = 0) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(rotation); ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const angle = i * Math.PI / 4, r = i % 2 ? radius * 0.32 : radius;
      const xx = Math.cos(angle) * r, yy = Math.sin(angle) * r;
      if (i === 0) ctx.moveTo(xx, yy); else ctx.lineTo(xx, yy);
    }
    ctx.closePath(); ctx.fillStyle = color; ctx.fill(); ctx.restore();
  }
  function tinyDie(x, y, size, foreground = COLORS.white, background = COLORS.green) {
    box(x, y, size, size, background, size * 0.27);
    for (const [u, v] of PIPS[5]) circle(x + u * size, y + v * size, size * 0.065, foreground);
  }
  function region(x, y, w, h, action, value, disabled = false) {
    if (!disabled) regions.push({ x, y, w, h, action, value });
  }
  function button(x, y, w, h, label, action, value, selected = false, disabled = false, size = 14) {
    ctx.save(); if (disabled) ctx.globalAlpha = 0.55;
    box(x, y, w, h, selected ? COLORS.green : COLORS.page, 11, selected ? COLORS.green : COLORS.line);
    text(label, x + w / 2, y + h / 2, size, selected ? COLORS.white : COLORS.muted, 'center', 'bold');
    ctx.restore(); region(x, y, w, h, action, value, disabled);
  }
  function getImage(path) {
    if (!path || !createImage) return null;
    if (!images.has(path)) {
      const entry = { image: null, loaded: false };
      images.set(path, entry);
      try { entry.image = createImage(path, () => { entry.loaded = true; }, () => { entry.loaded = false; }); }
      catch (_) { entry.loaded = false; }
    }
    const cached = images.get(path);
    return cached.loaded ? cached.image : null;
  }
  function photoPreview(path, x, y, w, h, label) {
    box(x, y, w, h, COLORS.pale, 12, COLORS.line);
    const image = getImage(path);
    if (image && image.width && image.height) {
      const side = Math.min(image.width, image.height);
      ctx.save(); roundRect(x, y, w, h, 12); ctx.clip();
      ctx.drawImage(image, (image.width - side) / 2, (image.height - side) / 2, side, side, x, y, w, h); ctx.restore();
      box(x + 5, y + h - 24, w - 10, 19, 'rgba(255,254,248,0.91)', 7);
      text(label, x + w / 2, y + h - 14, 11, COLORS.green, 'center', 'bold');
    } else {
      text('+', x + w / 2, y + h / 2 - 9, 27, COLORS.green, 'center');
      text(label, x + w / 2, y + h - 15, 11, COLORS.muted, 'center');
    }
  }
  function facePath() {
    // Small radii keep the cube silhouette soft while preserving shared edges.
    roundRect(0, 0, 1, 1, 0.065);
  }
  function drawDie(value, x, y, size, progress, index, photos, rolling) {
    const radius = size / 2;
    const bounce = rolling ? Math.sin(progress * Math.PI) * (6 + 5 * Math.abs(Math.sin(progress * Math.PI * 4 + index))) : 0;
    ctx.save(); ctx.translate(x, y + size * 0.72); ctx.scale(1, 0.24);
    circle(0, 0, size * (rolling ? 0.47 : 0.5), 'rgba(45,83,61,0.10)'); ctx.restore();
    const faces = projectDie(value, progress, index);
    for (const face of faces) {
      const points = face.corners.map(point => [x + point[0] * radius, y + point[1] * radius - bounce]);
      const p = points[0], u = points[1], v = points[3];
      ctx.save();
      ctx.transform(u[0] - p[0], u[1] - p[1], v[0] - p[0], v[1] - p[1], p[0], p[1]);
      facePath(); ctx.fillStyle = face.value === value && !rolling ? '#fffef5' : '#edf4e7'; ctx.fill();
      ctx.save(); facePath(); ctx.clip();
      const path = photos.mode === 'single' ? photos.single : photos.mode === 'six' ? (photos.faces || [])[face.value - 1] : null;
      const image = getImage(path);
      if (image && image.width && image.height) {
        const side = Math.min(image.width, image.height);
        ctx.drawImage(image, (image.width - side) / 2, (image.height - side) / 2, side, side, 0, 0, 1, 1);
        ctx.fillStyle = 'rgba(255,254,246,0.16)'; ctx.fillRect(0, 0, 1, 1);
      }
      ctx.fillStyle = `rgba(29,68,47,${(1 - face.normal[2]) * 0.15})`; ctx.fillRect(0, 0, 1, 1);
      for (const [px, py] of PIPS[face.value]) {
        if (image) circle(px, py, face.value === 1 ? 0.135 : 0.115, 'rgba(255,254,248,0.96)');
        circle(px, py, face.value === 1 ? 0.101 : 0.079, face.value === 1 ? '#d48b43' : '#28735b');
      }
      ctx.restore(); facePath(); ctx.strokeStyle = face.value === value && !rolling ? '#82b28d' : '#a5c2a0'; ctx.lineWidth = 1.05 / size; ctx.stroke(); ctx.restore();
    }
  }

  function draw(state, now) {
    regions = [];
    const { width, height, pixelRatio, safeTop = 0, safeBottom = 0, menuRect } = metrics;
    const w = Math.min(width - 28, 520), x = (width - w) / 2, pad = 16, inner = w - pad * 2;
    const count = Math.max(1, Math.min(6, Number(state.count) || 1));
    const values = Array.from({ length: count }, (_, i) => (state.values || [])[i] || 1);
    const photos = state.photos || { mode: 'default', faces: [] };
    const activePhotos = new Set([photos.single, ...(photos.faces || [])].filter(Boolean));
    for (const path of images.keys()) if (!activePhotos.has(path)) images.delete(path);
    const busy = !!(state.rolling || state.photoBusy);
    const progress = state.rolling ? Math.max(0, Math.min(1, (now - state.rollStartedAt) / (state.rollDuration || 2000))) : 1;
    scrollY = Math.max(0, Number(state.scrollY) || 0);
    ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    ctx.globalAlpha = 1; ctx.clearRect(0, 0, width, height); ctx.fillStyle = COLORS.page; ctx.fillRect(0, 0, width, height);
    ctx.save(); ctx.beginPath(); ctx.rect(0, safeTop, width, height - safeTop); ctx.clip(); ctx.translate(0, -scrollY);
    let y = Math.max(safeTop + 10, menuRect && menuRect.bottom ? menuRect.bottom + 9 : 0);
    tinyDie(x + 1, y, 26);
    text('骰子派对', x + 36, y + 14, 19, COLORS.ink, 'left', 'bold');
    text('.', x + 114, y + 12, 24, COLORS.green, 'left', 'bold');
    button(x + w - 79, y - 1, 79, 30, state.soundEnabled ? '♫ 音效开' : '♪ 音效关', 'sound', undefined, false, false, 11);
    y += 49;
    text('准备好，掷出快乐！', width / 2, y, 25, COLORS.ink, 'center', 'bold');
    star(x + w - 13, y - 8, 9, COLORS.gold, 0.2);
    text('一点点运气，满满的快乐。', width / 2, y + 28, 12, COLORS.muted, 'center');
    y += 52;
    const stageY = y, stageH = count > 3 ? 248 : count === 1 ? 190 : 174;
    box(x, y, w, stageH, '#eaf0e3', 21, COLORS.line);
    ctx.save(); roundRect(x + 3, y + 3, w - 6, stageH - 6, 19); ctx.clip();
    for (let dotX = x + 12; dotX < x + w; dotX += 16) for (let dotY = y + 12; dotY < y + stageH; dotY += 16) circle(dotX, dotY, 0.9, '#d7e2cd');
    ctx.strokeStyle = '#dce6d1'; ctx.lineWidth = 1;
    for (const angle of [-0.21, 0.23]) {
      ctx.save(); ctx.translate(width / 2, y + stageH / 2 + 10); ctx.rotate(angle); ctx.scale(1, 0.47); ctx.beginPath(); ctx.arc(0, 0, w * 0.4, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
    }
    ctx.restore();
    circle(x + 18, y + 21, 3, '#81a67c'); text('以顶面点数为准', x + 28, y + 22, 11, '#638563', 'left', 'bold');
    text(state.rolling ? '好运正在路上…' : '每一面，都有惊喜', x + w - 15, y + 22, 10, COLORS.muted, 'right');
    star(x + 29, y + 71, 10, '#afc595', progress * 3); star(x + w - 31, y + stageH - 44, 6, '#aec694', 0.2);
    const cols = count === 1 ? 1 : count === 2 ? 2 : 3;
    const rows = count > 3 ? 2 : 1;
    const rowH = rows === 2 ? 91 : 112;
    const size = count === 1 ? 86 : count === 2 ? 65 : Math.min(55, (w - 32) / 4.9);
    for (let i = 0; i < count; i++) {
      const row = Math.floor(i / cols), itemsInRow = Math.min(cols, count - row * cols);
      const spacing = (w - 20) / cols;
      const centerX = width / 2 + (i % cols - (itemsInRow - 1) / 2) * spacing;
      const centerY = y + (rows === 2 ? 80 : count === 1 ? 97 : 90) + row * rowH;
      drawDie(values[i], centerX, centerY, size, progress, i, photos, state.rolling);
    }
    text(state.rolling ? '转呀转，好运马上到！' : '小小骰子，大大可能', width / 2, y + stageH - 15, 11, '#8ca476', 'center');
    if (state.rolling) box(x + 14, y + stageH - 3, Math.max(1, (w - 28) * progress), 3, COLORS.green, 1.5);
    y += stageH + 14;

    box(x, y, w, 210, COLORS.white, 19, COLORS.line);
    text('LET’S PLAY', x + pad, y + 22, 9, '#95a47c', 'left', 'bold');
    text('今天，玩几颗？', x + pad, y + 49, 20, COLORS.ink, 'left', 'bold');
    tinyDie(x + w - 33, y + 18, 15, COLORS.white, '#a3b58d');
    const optionGap = 5, optionW = (inner - optionGap * 5) / 6;
    for (let n = 1; n <= 6; n++) button(x + pad + (n - 1) * (optionW + optionGap), y + 75, optionW, 39, n, 'count', n, n === count, busy, 19);
    text(`${count} 颗骰子`, x + pad, y + 129, 10, COLORS.muted);
    text('每颗 1–6 点', x + w - pad, y + 129, 10, COLORS.muted, 'right');
    const btnY = y + 145;
    ctx.save(); if (busy) ctx.globalAlpha = 0.68;
    box(x + pad, btnY + 3, inner, 47, '#24634f', 13); box(x + pad, btnY, inner, 47, COLORS.green, 13);
    tinyDie(x + pad + 21, btnY + 16, 16, COLORS.green, COLORS.white);
    text(state.rolling ? '好运转起来…' : state.photoBusy ? '照片准备中…' : '掷出好运', width / 2, btnY + 24, 19, COLORS.white, 'center', 'bold');
    text('→', x + w - pad - 24, btnY + 24, 23, '#d6ead8', 'center'); ctx.restore(); region(x + pad, btnY, inner, 50, 'roll', undefined, busy);
    y += 224;

    const photoY = y;
    let photoH = 73;
    if (state.photoOpen) {
      photoH += 53;
      if (photos.mode === 'single') photoH += 108;
      else if (photos.mode === 'six') photoH += 245;
      else photoH += 52;
      photoH += 89;
      if (state.photoStatus) photoH += 35;
    }
    box(x, y, w, photoH, COLORS.white, 19, COLORS.line);
    circle(x + 31, y + 34, 17, COLORS.pale); star(x + 31, y + 34, 10, '#93ad7e');
    text('给骰子穿新衣', x + 57, y + 27, 15, COLORS.ink, 'left', 'bold');
    text('把喜欢的照片，放上骰子的六个面', x + 57, y + 48, Math.min(10, (inner - 43) / 18), COLORS.muted);
    text(state.photoOpen ? '−' : '+', x + w - 22, y + 33, 22, COLORS.green, 'center'); region(x, y, w, 72, 'togglePhotos');
    if (state.photoOpen) {
      y += 79;
      const modeW = (inner - 10) / 3;
      for (const [i, mode] of ['default', 'single', 'six'].entries()) button(x + pad + i * (modeW + 5), y, modeW, 35, ['原色骰子', '一张铺满六面', '六面分别设置'][i], 'mode', mode, photos.mode === mode, busy, width < 350 ? 10 : 11);
      y += 52;
      if (photos.mode === 'single') {
        photoPreview(photos.single, x + pad, y, 81, 81, '选择照片'); region(x + pad, y, 81, 81, 'chooseSingle', undefined, busy);
        text('一张喜欢的照片', x + pad + 94, y + 14, 13, COLORS.ink, 'left', 'bold');
        text('六个面都穿同一件新衣。', x + pad + 94, y + 35, 10, COLORS.muted);
        button(x + pad + 94, y + 49, Math.min(inner - 94, 135), 33, photos.single ? '换一张照片' : '从相册选择', 'chooseSingle', undefined, false, busy, 12);
        y += 108;
      } else if (photos.mode === 'six') {
        text('按点数选图，每一面都有惊喜。', x + pad, y + 3, 11, COLORS.muted); y += 21;
        const gap = 8, faceW = (inner - gap * 2) / 3, faceH = 71;
        for (let i = 0; i < 6; i++) {
          const xx = x + pad + (i % 3) * (faceW + gap), yy = y + Math.floor(i / 3) * (faceH + 8);
          photoPreview((photos.faces || [])[i], xx, yy, faceW, faceH, `${i + 1} 点面`); region(xx, yy, faceW, faceH, 'chooseFace', i + 1, busy);
        }
        y += 164;
        button(x + pad, y, inner, 35, '一次选择六张照片', 'chooseSix', undefined, false, busy, 12); y += 60;
      } else {
        tinyDie(x + pad + 3, y + 2, 26, COLORS.white, '#87a87b'); text('清清爽爽的原色，也很好看。', x + pad + 43, y + 15, 12, COLORS.muted); y += 52;
      }
      button(x + pad, y, inner, 33, '恢复原色并清除照片', 'clearPhotos', undefined, false, busy, 11); y += 49;
      if (state.photoStatus) { wrappedText(state.photoStatus, x + pad, y + 2, inner, 11, COLORS.green, 17); y += 35; }
      wrappedText('照片只保存在当前设备，不会上传。清除不会影响相册原图。', x + pad, y + 1, inner, 10, COLORS.muted, 16);
    }
    y = photoY + photoH + 14;

    const history = (state.history || []).slice(0, 8), historyH = history.length ? 60 + history.length * 37 : 95;
    box(x, y, w, historyH, COLORS.white, 19, COLORS.line);
    text('刚刚的小幸运', x + pad, y + 25, 15, COLORS.ink, 'left', 'bold');
    if (history.length) { text('清空', x + w - pad, y + 25, 11, COLORS.muted, 'right'); region(x + w - 65, y + 7, 54, 36, 'clearHistory'); }
    else text('掷出第一颗骰子，记下今天的好运。', x + pad, y + 63, 11, COLORS.muted);
    history.forEach((entry, i) => {
      const yy = y + 62 + i * 37;
      if (i) { ctx.fillStyle = '#edf0e5'; ctx.fillRect(x + pad, yy - 18, inner, 1); }
      const vals = entry.values || [], sum = vals.reduce((a, b) => a + b, 0);
      text(vals.join(' · '), x + pad, yy, 14, COLORS.green, 'left', 'bold');
      text(`${sum} 点`, x + w - pad, yy, 13, COLORS.green, 'right', 'bold');
      const date = new Date(entry.time);
      if (!Number.isNaN(date.getTime()) && width >= 350) text(`${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`, x + w - pad - 54, yy, 10, '#a0aa96', 'right');
    });
    y += historyH + 25;
    text('陪伴，就是最好的运气。', width / 2, y, 11, COLORS.muted, 'center');
    contentHeight = y + 28 + safeBottom;

    const celebrationAge = state.celebrateAt == null ? Infinity : now - state.celebrateAt;
    if (celebrationAge >= 0 && celebrationAge < 1500 && !state.rolling) {
      const t = celebrationAge / 1500;
      ctx.save(); ctx.globalAlpha = Math.max(0, 1 - t * t);
      for (let i = 0; i < 30; i++) {
        const seed = Math.sin(i * 145.43 + 1.7) * 43758.5, random = seed - Math.floor(seed);
        const xx = width / 2 + Math.cos(i * 2.4) * (22 + t * w * 0.6);
        const yy = stageY + 60 + Math.sin(i * 2.4) * t * 130 + 190 * t * t;
        const color = [COLORS.gold, '#85b58e', '#dba08a', '#adc8bc'][i % 4];
        ctx.save(); ctx.translate(xx, yy); ctx.rotate(t * (3 + random * 8) + i); ctx.fillStyle = color; ctx.fillRect(-2, -4, 4, 7); ctx.restore();
      }
      ctx.restore();
    }
    ctx.restore();
    if (scrollY > 4 || contentHeight > height + 6) {
      const available = height - safeTop - safeBottom - 12;
      const thumbH = Math.max(28, available * height / contentHeight);
      const thumbY = safeTop + 6 + (available - thumbH) * Math.min(1, scrollY / Math.max(1, contentHeight - height));
      box(width - 4, thumbY, 2, thumbH, 'rgba(69,109,77,0.22)', 1);
    }
  }

  function hitTest(px, py) {
    if (py < (metrics.safeTop || 0) || py > metrics.height) return null;
    const menu = metrics.menuRect;
    if (menu && px >= menu.left && px <= menu.right && py >= menu.top && py <= menu.bottom) return null;
    const y = py + scrollY;
    for (let i = regions.length - 1; i >= 0; i--) {
      const item = regions[i];
      if (px >= item.x && px <= item.x + item.w && y >= item.y && y <= item.y + item.h) return { action: item.action, value: item.value };
    }
    return null;
  }
  return { draw, hitTest, resize, getContentHeight: () => contentHeight };
}

module.exports = { createRenderer };
