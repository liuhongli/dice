import assert from "node:assert/strict";
import test from "node:test";
import { FACE_VALUES, TOP_ORIENTATIONS } from "../dice-geometry.js";

// These normals describe the physical faces before the cube is rotated.
// In CSS coordinates, negative Y points up and positive Z points at the viewer.
const normals = {
  front: [0, 0, 1],
  back: [0, 0, -1],
  right: [1, 0, 0],
  left: [-1, 0, 0],
  top: [0, -1, 0],
  bottom: [0, 1, 0],
};
const tolerance = 1e-10;

function rotate([x, y, z], [rx, ry]) {
  const ax = (rx * Math.PI) / 180;
  const ay = (ry * Math.PI) / 180;
  const afterY = [
    Math.cos(ay) * x + Math.sin(ay) * z,
    y,
    -Math.sin(ay) * x + Math.cos(ay) * z,
  ];
  return [
    afterY[0],
    Math.cos(ax) * afterY[1] - Math.sin(ax) * afterY[2],
    Math.sin(ax) * afterY[1] + Math.cos(ax) * afterY[2],
  ];
}

test("dice have all six values and opposing faces add up to seven", () => {
  assert.deepEqual(Object.values(FACE_VALUES).sort(), [1, 2, 3, 4, 5, 6]);
  for (const [side, normal] of Object.entries(normals)) {
    const opposite = Object.keys(normals).find((other) =>
      normals[other].every((axis, index) => axis === -normal[index]),
    );
    assert.ok(opposite, `${side} has an opposite face`);
    assert.equal(FACE_VALUES[side] + FACE_VALUES[opposite], 7);
  }
});

for (let result = 1; result <= 6; result += 1) {
  test(`result ${result} is the only upward face and is most visible`, () => {
    const rotatedFaces = Object.entries(normals).map(([side, normal]) => ({
      value: FACE_VALUES[side],
      normal: rotate(normal, TOP_ORIENTATIONS[result]),
    }));
    const upwardFaces = rotatedFaces.filter(
      ({ normal: [x, y, z] }) =>
        Math.abs(x) < tolerance &&
        Math.abs(y + 1) < tolerance &&
        Math.abs(z) < tolerance,
    );
    assert.deepEqual(
      upwardFaces.map(({ value }) => value),
      [result],
    );

    // At the chosen viewing angle, the top has the largest projected area.
    const projectedFaces = rotatedFaces.map(({ value, normal }) => ({
      value,
      facingViewer: rotate(normal, [-58, -28])[2],
    }));
    const largestFace = projectedFaces.reduce((largest, face) =>
      face.facingViewer > largest.facingViewer ? face : largest,
    );
    assert.equal(largestFace.value, result);
    assert.ok(largestFace.facingViewer > 0.8);
  });
}
