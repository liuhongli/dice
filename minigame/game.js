const { createGame } = require("./controller.js");
const { createPhotoStore } = require("./photos.js");
const { createRenderer } = require("./render.js");

const canvas = wx.createCanvas();
let dirty = true;
let visible = true;
let frameId;
let touch;

function metrics() {
  const info = typeof wx.getWindowInfo === "function" ? wx.getWindowInfo() : wx.getSystemInfoSync();
  let menuRect = null;
  try {
    if (wx.getMenuButtonBoundingClientRect) menuRect = wx.getMenuButtonBoundingClientRect();
  } catch (_) {}
  return {
    width: info.windowWidth || info.screenWidth || 375,
    height: info.windowHeight || info.screenHeight || 667,
    pixelRatio: Math.min(info.pixelRatio || 1, 3),
    safeTop: Math.max(info.safeArea ? info.safeArea.top : info.statusBarHeight || 0, menuRect ? menuRect.bottom + 8 : 0),
    safeBottom: info.safeArea ? Math.max(0, info.screenHeight - info.safeArea.bottom) : 0,
    menuRect,
  };
}
let size = metrics();
const renderer = createRenderer(canvas, {
  ...size,
  createImage(path, onLoad, onError) {
    const image = wx.createImage();
    image.onload = () => { onLoad(); dirty = true; };
    image.onerror = (error) => { if (onError) onError(error); dirty = true; };
    image.src = path;
    return image;
  },
});
let photoStore;
try {
  photoStore = createPhotoStore(wx);
} catch (_) {
  const defaults = () => ({ mode: "default", single: null, faces: Array(6).fill(null) });
  photoStore = {
    defaultSettings: defaults,
    load: defaults,
    save() { throw new Error("当前微信无法保存照片，请更新微信后再试。"); },
    select() { return Promise.reject(new Error("当前微信无法选择照片，请更新微信后再试。")); },
    remove() { return Promise.resolve(); },
  };
}
const game = createGame({ wxApi: wx, photoStore, invalidate: () => { dirty = true; } });
const nextFrame = typeof requestAnimationFrame === "function" ? requestAnimationFrame : (callback) => setTimeout(callback, 16);
const stopFrame = typeof cancelAnimationFrame === "function" ? cancelAnimationFrame : clearTimeout;
function frame() {
  if (!visible) return;
  const now = Date.now();
  const celebrating = game.state.celebrateAt !== null && now - game.state.celebrateAt < 1800;
  if (dirty || game.state.rolling || celebrating) {
    renderer.draw(game.state, now);
    const maximum = Math.max(0, renderer.getContentHeight() - size.height);
    if (game.state.scrollY > maximum) {
      game.setScroll(maximum, maximum);
      renderer.draw(game.state, now);
    }
    dirty = false;
  }
  frameId = nextFrame(frame);
}
function point(event) {
  const finger = (event.touches && event.touches[0]) || (event.changedTouches && event.changedTouches[0]);
  return finger && { x: finger.clientX === undefined ? finger.x : finger.clientX, y: finger.clientY === undefined ? finger.y : finger.clientY };
}
wx.onTouchStart((event) => {
  const at = point(event);
  touch = at ? { ...at, scrollY: game.state.scrollY, moved: false } : null;
});
wx.onTouchMove((event) => {
  if (!touch) return;
  const at = point(event);
  if (!at) return;
  if (Math.hypot(at.x - touch.x, at.y - touch.y) > 8) touch.moved = true;
  if (touch.moved) game.setScroll(touch.scrollY + touch.y - at.y, Math.max(0, renderer.getContentHeight() - size.height));
});
wx.onTouchEnd((event) => {
  const at = point(event);
  if (touch && !touch.moved && at && Math.hypot(at.x - touch.x, at.y - touch.y) <= 8) {
    const target = renderer.hitTest(at.x, at.y);
    Promise.resolve(game.handleAction(target)).catch(() => {
      wx.showToast({ title: "暂时没能完成，请再试一次", icon: "none" });
    });
  }
  touch = null;
});
if (wx.onTouchCancel) wx.onTouchCancel(() => { touch = null; });
wx.onHide(() => {
  visible = false;
  stopFrame(frameId);
  touch = null;
  game.hide();
});
wx.onShow(() => {
  if (visible) return;
  visible = true;
  game.show();
  frame();
});
if (wx.onWindowResize) wx.onWindowResize(() => {
  size = metrics();
  renderer.resize(size);
  dirty = true;
});
try {
  if (wx.showShareMenu) wx.showShareMenu({ withShareTicket: false });
  if (wx.onShareAppMessage) wx.onShareAppMessage(() => ({ title: "随机1-6 · 一点点运气，满满的快乐" }));
} catch (_) {}
frame();
