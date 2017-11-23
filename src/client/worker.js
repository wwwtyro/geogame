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
  
  const bounds = {min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity]};

  for (let i = 0; i < res - 1; i++) {
    for (let j = 0; j < res - 1; j++) {

      let x0 = i, x1 = i + 1;
      let y0 = j, y1 = j + 1;

      const a = vec3.add([], vec3.add([], sw, vec3.scale([], right, x0)), vec3.scale([], up, y0));
      const b = vec3.add([], vec3.add([], sw, vec3.scale([], right, x1)), vec3.scale([], up, y0));
      const c = vec3.add([], vec3.add([], sw, vec3.scale([], right, x1)), vec3.scale([], up, y1));
      const d = vec3.add([], vec3.add([], sw, vec3.scale([], right, x0)), vec3.scale([], up, y1));

      const ea = hmap[y0 * res + x0];
      const eb = hmap[y0 * res + x1];
      const ec = hmap[y1 * res + x1];
      const ed = hmap[y1 * res + x0];

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

      noiseuvs.push((i + 0)/(res + 0) * 32); noiseuvs.push((j + 0)/(res+0) * 32);
      noiseuvs.push((i + 1)/(res + 0) * 32); noiseuvs.push((j + 0)/(res+0) * 32);
      noiseuvs.push((i + 1)/(res + 0) * 32); noiseuvs.push((j + 1)/(res+0) * 32);
      noiseuvs.push((i + 0)/(res + 0) * 32); noiseuvs.push((j + 0)/(res+0) * 32);
      noiseuvs.push((i + 1)/(res + 0) * 32); noiseuvs.push((j + 1)/(res+0) * 32);
      noiseuvs.push((i + 0)/(res + 0) * 32); noiseuvs.push((j + 1)/(res+0) * 32);
      
    }
  }

  bounds.center = vec3.add([], bounds.min, vec3.scale([], vec3.sub([], bounds.max, bounds.min), 0.5));
  for (let i = 0; i < positions.length / 3; i++) {
    positions[i * 3 + 0] -= bounds.center[0];
    positions[i * 3 + 1] -= bounds.center[1];
    positions[i * 3 + 2] -= bounds.center[2];
  }

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


