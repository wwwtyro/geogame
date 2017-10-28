"use strict";

const REGL = require('regl');
const glMatrix = require('gl-matrix');
const Trackball = require('trackball-controller');

const mat4 = glMatrix.mat4;
const vec3 = glMatrix.vec3;

main();

function mod(q, n) {
  return ((q % n) + n) % n;
}

async function main() {

  const img = await loadImage('elevation.png');

  const width = 1024;
  const height = 512;

  const canvas = document.getElementById('render-canvas');
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  canvas.width = canvas.clientWidth;
  canvas.height = canvas.clientHeight;
  const rect = canvas.getBoundingClientRect();

  const ctx = canvas.getContext('2d');

  canvas.addEventListener('mousemove', function(e) {
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const phi = Math.PI * y/(height - 1);
    const theta = 2 * Math.PI * x/(width-1);
    document.getElementById('coords').innerText = `${theta}, ${phi}`;
    ctx.drawImage(img, 0, 0, width, height);

    const deg = Math.PI/180;
    const range = 10;

    const left = theta - range * deg;
    const right = theta + range * deg;
    const bottom = phi + range * deg;
    const top = phi - range * deg;

    const steps = 10;
    for (let i = 0; i < steps; i++) {
      for (let j = 0; j < steps; j++) {
        let theta_ = left + i * (right - left)/steps;
        let phi_ = bottom + j * (top - bottom)/steps;
        if (phi_ < 0) {
          phi_ = Math.abs(phi_);
          theta_ += Math.PI;
        } else if (phi_ > Math.PI) {
          phi_ = -phi_ + 2 * Math.PI;
          theta_ += Math.PI;
        }
        theta_ = mod(theta_, 2 * Math.PI);
        let x_ = width * theta_/(2 * Math.PI);
        let y_ = height * phi_/Math.PI;
        ctx.fillStyle = '#FF0000';
        ctx.fillRect(x_, y_, 3, 3);
      }
    }
  });

  ctx.drawImage(img, 0, 0, width, height);

}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}
