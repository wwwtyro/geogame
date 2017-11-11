"use strict";

module.exports = function(resolution) {
  const positions = [];
  const uvs = [];
  let count = 0;
  for (let x = 0; x < resolution; x++) {
    const theta0 = 2 * Math.PI * (x + 0)/resolution + Math.PI/2;
    const theta1 = 2 * Math.PI * (x + 1)/resolution + Math.PI/2;
    for (let y = 0; y < resolution/2; y++) {
      const phi0 = Math.PI * (y + 0)/(resolution/2);
      const phi1 = Math.PI * (y + 1)/(resolution/2);
      const a = [Math.sin(phi1) * Math.cos(theta0), Math.cos(phi1), -Math.sin(phi1) * Math.sin(theta0)];
      const b = [Math.sin(phi1) * Math.cos(theta1), Math.cos(phi1), -Math.sin(phi1) * Math.sin(theta1)];
      const c = [Math.sin(phi0) * Math.cos(theta1), Math.cos(phi0), -Math.sin(phi0) * Math.sin(theta1)];
      const d = [Math.sin(phi0) * Math.cos(theta0), Math.cos(phi0), -Math.sin(phi0) * Math.sin(theta0)];
      positions.push(a);
      positions.push(b);
      positions.push(c);
      positions.push(a);
      positions.push(c);
      positions.push(d);
      const uva = [(x+0)/resolution, (y+1)/(resolution/2)];
      const uvb = [(x+1)/resolution, (y+1)/(resolution/2)];
      const uvc = [(x+1)/resolution, (y+0)/(resolution/2)];
      const uvd = [(x+0)/resolution, (y+0)/(resolution/2)];
      uvs.push(uva);
      uvs.push(uvb);
      uvs.push(uvc);
      uvs.push(uva);
      uvs.push(uvc);
      uvs.push(uvd);
      count += 6;
    }
  }
  return {
    positions: positions,
    uvs: uvs,
    count: count,
  };
}