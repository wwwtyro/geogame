'use strict';

const mat4 = require('gl-matrix').mat4;
const vec3 = require('gl-matrix').vec3;
const quat = require('gl-matrix').quat;

module.exports = function(position, theta, phi) {
  const forward0 = [0, 0, -1];
  const up0 = [0, 1, 0];
  const right0 = [1, 0, 0];

  const rotAroundUp = mat4.rotate([], mat4.create(), theta, up0);
  const forward1 = vec3.transformMat4([], forward0, rotAroundUp);
  const right1 = vec3.transformMat4([], right0, rotAroundUp);

  const rotAroundRight = mat4.rotate([], mat4.create(), phi, right1);
  const forward2 = vec3.transformMat4([], forward1, rotAroundRight);
  
  const up = vec3.normalize([], position);
  const qRot = quat.rotationTo([], up0, up);
  const forward = vec3.transformQuat([], forward2, qRot);
  const right = vec3.transformQuat([], right1, qRot);
  const view = mat4.lookAt([], [0,0,0], forward, up);
  return {
    up: up,
    forward: forward,
    right: right,
    view: view,
  };
}