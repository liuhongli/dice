'use strict';

const PI = Math.PI;
const FACES = [
  { value: 1, normal: [0, 0, 1], corners: [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]] },
  { value: 6, normal: [0, 0, -1], corners: [[1, -1, -1], [-1, -1, -1], [-1, 1, -1], [1, 1, -1]] },
  { value: 3, normal: [1, 0, 0], corners: [[1, -1, 1], [1, -1, -1], [1, 1, -1], [1, 1, 1]] },
  { value: 4, normal: [-1, 0, 0], corners: [[-1, -1, -1], [-1, -1, 1], [-1, 1, 1], [-1, 1, -1]] },
  { value: 2, normal: [0, -1, 0], corners: [[-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1]] },
  { value: 5, normal: [0, 1, 0], corners: [[-1, 1, 1], [1, 1, 1], [1, 1, -1], [-1, 1, -1]] },
];
const TOP_ORIENTATIONS = { 1: [90, 0], 2: [0, 0], 3: [90, -90], 4: [90, 90], 5: [180, 0], 6: [-90, 0] };
const PIPS = {
  1: [[0.5, 0.5]],
  2: [[0.27, 0.27], [0.73, 0.73]],
  3: [[0.27, 0.27], [0.5, 0.5], [0.73, 0.73]],
  4: [[0.27, 0.27], [0.73, 0.27], [0.27, 0.73], [0.73, 0.73]],
  5: [[0.27, 0.27], [0.73, 0.27], [0.5, 0.5], [0.27, 0.73], [0.73, 0.73]],
  6: [[0.27, 0.25], [0.73, 0.25], [0.27, 0.5], [0.73, 0.5], [0.27, 0.75], [0.73, 0.75]],
};

function rotate(point, rx, ry, rz = 0) {
  const [x, y, z] = point;
  const ax = rx * PI / 180, ay = ry * PI / 180, az = rz * PI / 180;
  const xx = Math.cos(ay) * x + Math.sin(ay) * z;
  const zz = -Math.sin(ay) * x + Math.cos(ay) * z;
  const yy = Math.cos(ax) * y - Math.sin(ax) * zz;
  const zzz = Math.sin(ax) * y + Math.cos(ax) * zz;
  return [Math.cos(az) * xx - Math.sin(az) * yy, Math.sin(az) * xx + Math.cos(az) * yy, zzz];
}

function getOrientation(value, progress = 1, index = 0) {
  const base = TOP_ORIENTATIONS[value] || TOP_ORIENTATIONS[1];
  const t = Math.max(0, Math.min(1, progress));
  if (t === 1) return [base[0], base[1], 0];
  const remaining = Math.pow(1 - t, 2.7);
  return [base[0] + remaining * (1080 + index * 180), base[1] + remaining * (720 + index * 90), Math.sin(t * PI * 4 + index) * remaining * 18];
}

function projectDie(value, progress = 1, index = 0) {
  const orientation = getOrientation(value, progress, index);
  const transform = (point) => rotate(rotate(point, ...orientation), -58, -28);
  return FACES.map((face) => {
    const normal = transform(face.normal);
    const corners = face.corners.map(transform);
    return { value: face.value, normal, corners, depth: corners.reduce((sum, point) => sum + point[2], 0) / 4 };
  }).filter((face) => face.normal[2] > 0.001).sort((a, b) => a.depth - b.depth);
}

module.exports = { FACES, TOP_ORIENTATIONS, PIPS, rotate, getOrientation, projectDie };
