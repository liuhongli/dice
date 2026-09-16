// Physical face values use the usual rule: opposite sides add up to seven.
export const FACE_VALUES = Object.freeze({
  front: 1,
  back: 6,
  right: 3,
  left: 4,
  top: 2,
  bottom: 5,
});

// CSS applies rotateY first, then rotateX. These rotations place the result
// face toward world up (0, -1, 0), before the outer camera tilt is applied.
export const TOP_ORIENTATIONS = Object.freeze({
  1: Object.freeze([90, 0]),
  2: Object.freeze([0, 0]),
  3: Object.freeze([90, -90]),
  4: Object.freeze([90, 90]),
  5: Object.freeze([180, 0]),
  6: Object.freeze([-90, 0]),
});
