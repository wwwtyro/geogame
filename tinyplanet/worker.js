"use strict";

const vec3 = require('gl-matrix').vec3;

main();

async function main() {

  onmessage = function(e) {

    const vScale = e.data.vScale;
    const earthRadius = e.data.earthRadius;
    const node = e.data.node;
    const enode = e.data.enode;

    const swsc = vec3.scale([], vec3.normalize([], node.sw), earthRadius);
    const sesc = vec3.scale([], vec3.normalize([], node.se), earthRadius);
    const skirt = vec3.length(vec3.sub([], swsc, sesc)) * 0.1;

    const res = enode.resolution;

    const right = vec3.scale([], node.right, 2/res);
    const up = vec3.scale([], node.up, 2/res);
    const positions = [], colors = [], normals = [], uvs = [];

    const bounds = {min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity]};

    for (let i = -1; i <= res; i++) {
      for (let j = -1; j <= res; j++) {

        let ii, jj;
        ii = i === -1 ? 0 : i;
        ii = i === res ? res - 1 : ii;
        jj = j === -1 ? 0 : j;
        jj = j === res ? res - 1 : jj;

        let a = vec3.add([], vec3.add([], node.sw, vec3.scale([], right, ii + 0)), vec3.scale([], up, jj + 0));
        let b = vec3.add([], vec3.add([], node.sw, vec3.scale([], right, ii + 1)), vec3.scale([], up, jj + 0));
        let c = vec3.add([], vec3.add([], node.sw, vec3.scale([], right, ii + 1)), vec3.scale([], up, jj + 1));
        let d = vec3.add([], vec3.add([], node.sw, vec3.scale([], right, ii + 0)), vec3.scale([], up, jj + 1));

        let ea = enode.elevations[ii+0][jj+0];
        let eb = enode.elevations[ii+1][jj+0];
        let ec = enode.elevations[ii+1][jj+1];
        let ed = enode.elevations[ii+0][jj+1];

        if (i === -1) {
          ea -= skirt;
          ed -= skirt;
        }
        if (j === -1) {
          ea -= skirt;
          eb -= skirt;
        }
        if (i === res) {
          eb -= skirt;
          ec -= skirt;
        }
        if (j === res) {
          ec -= skirt;
          ed -= skirt;
        }

        const ma = vec3.scale([], vec3.normalize([], a), vScale * ea + earthRadius);
        const mb = vec3.scale([], vec3.normalize([], b), vScale * eb + earthRadius);
        const mc = vec3.scale([], vec3.normalize([], c), vScale * ec + earthRadius);
        const md = vec3.scale([], vec3.normalize([], d), vScale * ed + earthRadius);

        positions.push(ma.slice());
        positions.push(mb.slice());
        positions.push(mc.slice());
        positions.push(ma.slice());
        positions.push(mc.slice());
        positions.push(md.slice());

        vec3.min(bounds.min, bounds.min, ma);
        vec3.min(bounds.min, bounds.min, mb);
        vec3.min(bounds.min, bounds.min, mc);
        vec3.min(bounds.min, bounds.min, md);
        vec3.max(bounds.max, bounds.max, ma);
        vec3.max(bounds.max, bounds.max, mb);
        vec3.max(bounds.max, bounds.max, mc);
        vec3.max(bounds.max, bounds.max, md);

        let ab = vec3.normalize([], vec3.sub([], mb, ma));
        let ac = vec3.normalize([], vec3.sub([], mc, ma));
        let n = vec3.cross([], ab, ac);
        normals.push(n);
        normals.push(n);
        normals.push(n);

        let ad = vec3.normalize([], vec3.sub([], md, ma));
        n = vec3.cross([], ac, ad);
        normals.push(n);
        normals.push(n);
        normals.push(n);

        const uva = [4 * (i + 0) / res, 4 * (j + 0) / res];
        const uvb = [4 * (i + 1) / res, 4 * (j + 0) / res];
        const uvc = [4 * (i + 1) / res, 4 * (j + 1) / res];
        const uvd = [4 * (i + 0) / res, 4 * (j + 1) / res];

        uvs.push(uva);
        uvs.push(uvb);
        uvs.push(uvc);
        uvs.push(uva);
        uvs.push(uvc);
        uvs.push(uvd);

        const ca = vec3.scale([], enode.color[ii+0][jj+0], 1/255);
        const cb = vec3.scale([], enode.color[ii+1][jj+0], 1/255);
        const cc = vec3.scale([], enode.color[ii+1][jj+1], 1/255);
        const cd = vec3.scale([], enode.color[ii+0][jj+1], 1/255);
        let cabc = vec3.scale([], vec3.add([], ca, vec3.add([], cb, cc)), 1/3);
        let cacd = vec3.scale([], vec3.add([], ca, vec3.add([], cc, cd)), 1/3);
        colors.push(cabc);
        colors.push(cabc);
        colors.push(cabc);
        colors.push(cacd);
        colors.push(cacd);
        colors.push(cacd);
      }
    }

    bounds.center = vec3.add([], bounds.min, vec3.scale([], vec3.sub([], bounds.max, bounds.min), 0.5));
    for (let i = 0; i < positions.length; i++) {
      vec3.sub(positions[i], positions[i], bounds.center);
    }

    const bc = [];
    for (let i = 0; i < positions.length/3; i++) {
      bc.push([1,0,0]);
      bc.push([0,1,0]);
      bc.push([0,0,1]);
    }

    postMessage({
      node: node,
      offset: bounds.center,
      positions: positions,
      colors: colors,
      uvs: uvs,
      normals: normals,
      bc: bc,
      count: positions.length,
    });

  }

}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function clamp(n, min, max) {
  return Math.min(Math.max(n, min), max);
}

function saturate(c, delta) {
  const p = Math.sqrt(
    c[0]*c[0]*0.299,
    c[1]*c[1]*0.587,
    c[2]*c[2]*0.114
  );
  return [
    p + (c[0] - p) * delta,
    p + (c[1] - p) * delta,
    p + (c[2] - p) * delta,
  ];
}
