import test from 'node:test';
import assert from 'node:assert/strict';
import geometry from '../minigame/geometry.js';
const { FACES, TOP_ORIENTATIONS, rotate, getOrientation, projectDie } = geometry;

test('game dice retain physical opposite faces and all values', () => {
  assert.deepEqual(FACES.map(face => face.value).sort(), [1, 2, 3, 4, 5, 6]);
  for (const face of FACES) {
    const opposite = FACES.find(other => other.normal.every((axis, i) => axis === -face.normal[i]));
    assert.equal(face.value + opposite.value, 7);
  }
});

for (let value = 1; value <= 6; value++) {
  test(`game result ${value} lands on top and has the largest visible face`, () => {
    const face = FACES.find(item => item.value === value);
    const normal = rotate(face.normal, ...TOP_ORIENTATIONS[value]);
    assert.ok(Math.abs(normal[0]) < 1e-10 && Math.abs(normal[1] + 1) < 1e-10 && Math.abs(normal[2]) < 1e-10);
    const faces = projectDie(value, 1);
    assert.equal(faces.reduce((best, item) => item.normal[2] > best.normal[2] ? item : best).value, value);
    assert.equal(faces.length, 3);
    for (let die = 0; die < 6; die++) {
      assert.deepEqual(getOrientation(value, 1, die), [...TOP_ORIENTATIONS[value], 0]);
      const close = projectDie(value, 0.99999, die);
      assert.equal(close.reduce((best, item) => item.normal[2] > best.normal[2] ? item : best).value, value);
    }
  });
}

test('rolling dice remain finite and expose only camera-facing surfaces', () => {
  for (let frame = 0; frame <= 120; frame++) {
    for (let value = 1; value <= 6; value++) {
      const faces = projectDie(value, frame / 120, value - 1);
      assert.ok(faces.length >= 1 && faces.length <= 3);
      assert.ok(faces.every(face => face.normal[2] > 0 && face.corners.flat().every(Number.isFinite)));
    }
  }
});
