"use strict";

const vec3 = require('gl-matrix').vec3;
const constants = require('../common/constants');
const QuadSphere = require('../common/quadsphere');

const qs = QuadSphere(constants.earthRadius);

onmessage = function(e) {

  const id = e.data.id;

  fetch(localurl(`/node/${id}`))
  .then(function(resp) {
    return resp.arrayBuffer();
  })
  .then(function(ab) {
    const heightmap = new Float32Array(ab);
    const mesh = buildMesh(id, heightmap);
    postMessage({
      id: id,
      offset: mesh.offset,
      count: mesh.count,
      positions: mesh.positions.buffer,
      normals: mesh.normals.buffer,
      uvs: mesh.uvs.buffer,
      noiseuvs: mesh.noiseuvs.buffer,
      heightmap: heightmap.buffer,
    }, [mesh.positions.buffer, mesh.normals.buffer, mesh.uvs.buffer, mesh.noiseuvs.buffer, heightmap.buffer]);
  });

}


function buildMesh(id, hmap) {
  if (id === "px-") console.log(hmap.length);

  const t0 = performance.now();

  const node = qs.nodeFromId(id);
  const res = constants.nodeResolution;
  const rad = constants.earthRadius;

  const positions = [];
  const normals = [];
  const uvs = [];
  const noiseuvs = [];

  const sw = node.cube.sw;
  const se = node.cube.se;
  const nw = node.cube.nw;
  const right = vec3.scale([], vec3.sub([], se, sw), 1 / (res - 1));
  const up = vec3.scale([], vec3.sub([], nw, sw), 1 / (res - 1));
  const nup = vec3.normalize([], node.cube.c);
  const skirt = vec3.length(vec3.sub([], node.sphere.sw, node.sphere.se)) * 0.1;
  
  const bounds = {min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity]};

  for (let i = -1; i <= res - 1; i++) {
    for (let j = -1; j <= res - 1; j++) {

      // Cut corners.
      if (i === -1 || i === res - 1) {
        if (j === -1 || j === res - 1) continue;
      }

      let x0 = i, x1 = i + 1;
      let y0 = j, y1 = j + 1;
      let sa = 0;
      let sb = 0;
      let sc = 0;
      let sd = 0;
      
      if (i === -1) {
        x0 = 0;
        sa = -skirt;
        sd = -skirt;
      }
      if (i === res - 1) {
        x1 = res - 1;
        sb = -skirt;
        sc = -skirt;
      }
      if (j === -1) {
        y0 = 0;
        sa = -skirt;
        sb = -skirt;
      }
      if (j === res - 1) {
        y1 = res - 1;
        sc = -skirt;
        sd = -skirt;
      }

      const a = vec3.add([], vec3.add([], sw, vec3.scale([], right, x0)), vec3.scale([], up, y0));
      const b = vec3.add([], vec3.add([], sw, vec3.scale([], right, x1)), vec3.scale([], up, y0));
      const c = vec3.add([], vec3.add([], sw, vec3.scale([], right, x1)), vec3.scale([], up, y1));
      const d = vec3.add([], vec3.add([], sw, vec3.scale([], right, x0)), vec3.scale([], up, y1));

      const ea = sa + hmap[y0 * res + x0];
      const eb = sb + hmap[y0 * res + x1];
      const ec = sc + hmap[y1 * res + x1];
      const ed = sd + hmap[y1 * res + x0];

      const ma = vec3.scale([], vec3.normalize([], a), rad + ea);
      const mb = vec3.scale([], vec3.normalize([], b), rad + eb);
      const mc = vec3.scale([], vec3.normalize([], c), rad + ec);
      const md = vec3.scale([], vec3.normalize([], d), rad + ed);

      positions.push(ma[0]); positions.push(ma[1]); positions.push(ma[2]);
      positions.push(mb[0]); positions.push(mb[1]); positions.push(mb[2]);
      positions.push(mc[0]); positions.push(mc[1]); positions.push(mc[2]);
      positions.push(ma[0]); positions.push(ma[1]); positions.push(ma[2]);
      positions.push(mc[0]); positions.push(mc[1]); positions.push(mc[2]);
      positions.push(md[0]); positions.push(md[1]); positions.push(md[2]);
      
      vec3.min(bounds.min, bounds.min, ma);
      vec3.min(bounds.min, bounds.min, mb);
      vec3.min(bounds.min, bounds.min, mc);
      vec3.min(bounds.min, bounds.min, md);
      vec3.max(bounds.max, bounds.max, ma);
      vec3.max(bounds.max, bounds.max, mb);
      vec3.max(bounds.max, bounds.max, mc);
      vec3.max(bounds.max, bounds.max, md);

      const ab = vec3.normalize([], vec3.sub([], mb, ma));
      const ac = vec3.normalize([], vec3.sub([], mc, ma));
      const ad = vec3.normalize([], vec3.sub([], md, ma));
      let n0 = vec3.normalize([], vec3.cross([], ab, ac));
      let n1 = vec3.normalize([], vec3.cross([], ac, ad));
      if (i === -1 || j === -1 || i === res - 1 || j === res - 1) {
        n0 = nup;
        n1 = nup;
      }
      normals.push(n0[0]); normals.push(n0[1]); normals.push(n0[2]);
      normals.push(n0[0]); normals.push(n0[1]); normals.push(n0[2]);
      normals.push(n0[0]); normals.push(n0[1]); normals.push(n0[2]);
      normals.push(n1[0]); normals.push(n1[1]); normals.push(n1[2]);
      normals.push(n1[0]); normals.push(n1[1]); normals.push(n1[2]);
      normals.push(n1[0]); normals.push(n1[1]); normals.push(n1[2]);
      
      const muv = vec3.scale([], vec3.add([], ma, mc), 0.5);
      const uv = pointToEquirectangular(muv);
      
      uvs.push(uv.x); uvs.push(uv.y);
      uvs.push(uv.x); uvs.push(uv.y);
      uvs.push(uv.x); uvs.push(uv.y);
      uvs.push(uv.x); uvs.push(uv.y);
      uvs.push(uv.x); uvs.push(uv.y);
      uvs.push(uv.x); uvs.push(uv.y);

      noiseuvs.push((i + 0)/(res + 2)); noiseuvs.push((j + 0)/(res+2));
      noiseuvs.push((i + 1)/(res + 2)); noiseuvs.push((j + 0)/(res+2));
      noiseuvs.push((i + 1)/(res + 2)); noiseuvs.push((j + 1)/(res+2));
      noiseuvs.push((i + 0)/(res + 2)); noiseuvs.push((j + 0)/(res+2));
      noiseuvs.push((i + 1)/(res + 2)); noiseuvs.push((j + 1)/(res+2));
      noiseuvs.push((i + 0)/(res + 2)); noiseuvs.push((j + 1)/(res+2));
      
    }
  }

  bounds.center = vec3.add([], bounds.min, vec3.scale([], vec3.sub([], bounds.max, bounds.min), 0.5));
  for (let i = 0; i < positions.length / 3; i++) {
    positions[i * 3 + 0] -= bounds.center[0];
    positions[i * 3 + 1] -= bounds.center[1];
    positions[i * 3 + 2] -= bounds.center[2];
  }

  console.log(`Mesh Worker: built mesh in ${performance.now() - t0} ms.`);

  return {
    offset: bounds.center,
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    uvs: new Float32Array(uvs),
    noiseuvs: new Float32Array(noiseuvs),
    count: positions.length/3
  }

}


function localurl(endpoint) {
  const url = location.protocol+'//'+location.hostname+(location.port ? ':'+location.port: '');
  return url + endpoint;
}


function clamp(n, min, max) {
  return Math.min(Math.max(n, min), max);
}


function pointToEquirectangular(p) {
  const PI = Math.PI;
  p = vec3.normalize([], p);
  const y = p[0];
  const z = p[1]
  const x = p[2];
  const theta = Math.acos(z);
  const phi = Math.atan2(y,x);
  const px = (phi + PI)/(2 * PI);
  const py = theta / PI;
  return {
    x: clamp(px, 0, 1.0),
    y: clamp(py, 0, 1.0),
  };
}


// main();

// async function main() {

//   onmessage = function(e) {

//     const vScale = e.data.vScale;
//     const earthRadius = constants.earthRadius;
//     const node = e.data.node;
//     const enode = e.data.enode;

//     const nup = vec3.normalize([], node.cube.c);

//     const res = enode.resolution;

//     const right = vec3.scale([], vec3.sub([], node.cube.se, node.cube.sw), 1/res);
//     const up = vec3.scale([], vec3.sub([], node.cube.nw, node.cube.sw), 1/res);
//     const positions = [], colors = [], normals = [], uvs = [];

//     const bounds = {min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity]};

//     for (let i = 0; i < res; i++) {
//       for (let j = 0; j < res; j++) {

//         let a = vec3.add([], vec3.add([], node.cube.sw, vec3.scale([], right, i + 0)), vec3.scale([], up, j + 0));
//         let b = vec3.add([], vec3.add([], node.cube.sw, vec3.scale([], right, i + 1)), vec3.scale([], up, j + 0));
//         let c = vec3.add([], vec3.add([], node.cube.sw, vec3.scale([], right, i + 1)), vec3.scale([], up, j + 1));
//         let d = vec3.add([], vec3.add([], node.cube.sw, vec3.scale([], right, i + 0)), vec3.scale([], up, j + 1));

//         let ea = enode.elevations[i+0][j+0];
//         let eb = enode.elevations[i+1][j+0];
//         let ec = enode.elevations[i+1][j+1];
//         let ed = enode.elevations[i+0][j+1];

//         const ma = vec3.scale([], vec3.normalize([], a), vScale * ea + earthRadius);
//         const mb = vec3.scale([], vec3.normalize([], b), vScale * eb + earthRadius);
//         const mc = vec3.scale([], vec3.normalize([], c), vScale * ec + earthRadius);
//         const md = vec3.scale([], vec3.normalize([], d), vScale * ed + earthRadius);

//         positions.push(ma.slice());
//         positions.push(mb.slice());
//         positions.push(mc.slice());
//         positions.push(ma.slice());
//         positions.push(mc.slice());
//         positions.push(md.slice());

//         vec3.min(bounds.min, bounds.min, ma);
//         vec3.min(bounds.min, bounds.min, mb);
//         vec3.min(bounds.min, bounds.min, mc);
//         vec3.min(bounds.min, bounds.min, md);
//         vec3.max(bounds.max, bounds.max, ma);
//         vec3.max(bounds.max, bounds.max, mb);
//         vec3.max(bounds.max, bounds.max, mc);
//         vec3.max(bounds.max, bounds.max, md);

//         let ab = vec3.normalize([], vec3.sub([], mb, ma));
//         let ac = vec3.normalize([], vec3.sub([], mc, ma));
//         let n = vec3.cross([], ab, ac);
//         normals.push(n);
//         normals.push(n);
//         normals.push(n);
//         let ad = vec3.normalize([], vec3.sub([], md, ma));
//         n = vec3.cross([], ac, ad);
//         normals.push(n);
//         normals.push(n);
//         normals.push(n);

//         const uva = [4 * (i + 0) / res, 4 * (j + 0) / res];
//         const uvb = [4 * (i + 1) / res, 4 * (j + 0) / res];
//         const uvc = [4 * (i + 1) / res, 4 * (j + 1) / res];
//         const uvd = [4 * (i + 0) / res, 4 * (j + 1) / res];

//         uvs.push(uva);
//         uvs.push(uvb);
//         uvs.push(uvc);
//         uvs.push(uva);
//         uvs.push(uvc);
//         uvs.push(uvd);

//         const ca = vec3.scale([], enode.color[i+0][j+0], 1/255);
//         const cb = vec3.scale([], enode.color[i+1][j+0], 1/255);
//         const cc = vec3.scale([], enode.color[i+1][j+1], 1/255);
//         const cd = vec3.scale([], enode.color[i+0][j+1], 1/255);
//         let cabc = vec3.scale([], vec3.add([], ca, vec3.add([], cb, cc)), 1/3);
//         let cacd = vec3.scale([], vec3.add([], ca, vec3.add([], cc, cd)), 1/3);
//         colors.push(cabc);
//         colors.push(cabc);
//         colors.push(cabc);
//         colors.push(cacd);
//         colors.push(cacd);
//         colors.push(cacd);
//       }
//     }

//     bounds.center = vec3.add([], bounds.min, vec3.scale([], vec3.sub([], bounds.max, bounds.min), 0.5));
//     for (let i = 0; i < positions.length; i++) {
//       vec3.sub(positions[i], positions[i], bounds.center);
//     }

//     postMessage({
//       node: node,
//       offset: bounds.center,
//       positions: positions,
//       colors: colors,
//       uvs: uvs,
//       normals: normals,
//       count: positions.length,
//     });

//   }

// }

// function loadImage(src) {
//   return new Promise((resolve, reject) => {
//     const img = new Image();
//     img.onload = () => resolve(img);
//     img.onerror = reject;
//     img.src = src;
//   });
// }

// function clamp(n, min, max) {
//   return Math.min(Math.max(n, min), max);
// }

// function saturate(c, delta) {
//   const p = Math.sqrt(
//     c[0]*c[0]*0.299,
//     c[1]*c[1]*0.587,
//     c[2]*c[2]*0.114
//   );
//   return [
//     p + (c[0] - p) * delta,
//     p + (c[1] - p) * delta,
//     p + (c[2] - p) * delta,
//   ];
// }
