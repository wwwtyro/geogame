"use strict";

const mat4 = require('gl-matrix').mat4;
const vec3 = require('gl-matrix').vec3;
const vec2 = require('gl-matrix').vec2;

const pi = Math.PI;

module.exports = function(position, altitude, theta, phi) {

  position = position.slice();

  function moveForward(delta) {
    const forward = [ Math.cos(theta), Math.sin(theta) ];
    position = vec2.add([], position, vec2.scale([], forward, delta));
  }

  function moveRight(delta) {
    const right = [ Math.cos(theta + pi/2), Math.sin(theta + pi/2) ];
    position = vec2.add([], position, vec2.scale([], right, delta));
  }

  function moveUp(delta) {
    altitude += delta;
  }

  function lookRight(delta) {
    theta += delta;
  }

  function lookUp(delta) {
    phi += delta;
    phi = Math.max(Math.min(phi, pi/2 * 0.99), -0.99 * pi/2);
  }

  function getPosition() {
    return [position[0], altitude, position[1]];
  }

  function getLonLat() {
    return position.slice();
  }

  function getView(zero) {
    let eye = [position[0], altitude, position[1]];
    if (zero) {
      eye = [0, 0, 0];
    }
    const forward = [ Math.cos(phi) * Math.cos(theta), Math.sin(phi), Math.cos(phi) * Math.sin(theta) ];
    vec3.normalize(forward, forward);
    const center = vec3.add([], eye, forward);
    return mat4.lookAt([], eye, center, [0,1,0]);
  }

  return {
    moveForward: moveForward,
    moveRight: moveRight,
    moveUp: moveUp,
    lookRight: lookRight,
    lookUp: lookUp,
    getPosition: getPosition,
    getLonLat: getLonLat,
    getView: getView,
  }

}
