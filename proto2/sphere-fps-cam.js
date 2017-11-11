'use strict';

const mat4 = require('gl-matrix').mat4;
const vec3 = require('gl-matrix').vec3;

module.exports = function(position, forward) {

  const pi = Math.PI;

  position = position.slice();
  forward = forward.slice();

  let right = [];
  let up = [];

  let phi = 0;

  normalize();

  function dump() {
    return {
      position: position.slice(),
      forward: forward.slice(),
    };
  }

  function normalize() {
    up = vec3.normalize([], position);
    forward = vec3.normalize(forward, forward);
    vec3.cross(right, forward, up);
    vec3.cross(forward, up, right);
  }

  function lookRight(delta) {
    const rotAroundUp = mat4.rotate([], mat4.create(), -delta, up);
    vec3.transformMat4(forward, forward, rotAroundUp);
    normalize();
  }

  function lookUp(delta) {
    phi += delta;
    phi = Math.min(Math.max(-0.99 * pi/2, phi), 0.99 * pi/2);
  }

  function moveForward(delta) {
    vec3.add(position, position, vec3.scale([], forward, delta));
    normalize();
  }

  function moveUp(delta) {
    vec3.add(position, position, vec3.scale([], up, delta));
    normalize();
  }

  function moveRight(delta) {
    vec3.add(position, position, vec3.scale([], right, delta));
    normalize();
  }

  function getView(zero) {
    normalize();
    const rotAroundRight = mat4.rotate([], mat4.create(), phi, right);
    const f = vec3.transformMat4([], forward, rotAroundRight);
    if (zero) {
      return mat4.lookAt([], [0,0,0], f, up);
    }
    const center = vec3.add([], position, f);
    return mat4.lookAt([], position, center, up);
  }

  function getPosition() {
    return position.slice();
  }

  return {
    getView: getView,
    getPosition: getPosition,
    lookRight: lookRight,
    lookUp: lookUp,
    moveForward: moveForward,
    moveUp: moveUp,
    moveRight: moveRight,
    dump: dump,
  }

}
