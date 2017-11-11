"use strict";

const vec3 = require('gl-matrix').vec3;
const vec2 = require('gl-matrix').vec2;

module.exports = function (radius) {
  
  function unitCubeToSphere(p) {
    return vec3.scale([], vec3.normalize([], p), radius);
  }

  const faces = {
    'px': createRootNode('px-', [ 1,  0,  0], p => [ 1,    p[1], -p[0]], p => [-p[2], p[1]]),
    'nx': createRootNode('nx-', [-1,  0,  0], p => [-1,    p[1],  p[0]], p => [ p[2], p[1]]),
    'py': createRootNode('py-', [ 0,  1,  0], p => [ p[0],    1, -p[1]], p => [ p[0],-p[2]]),
    'ny': createRootNode('ny-', [ 0, -1,  0], p => [ p[0],   -1,  p[1]], p => [ p[0], p[2]]),
    'pz': createRootNode('pz-', [ 0,  0,  1], p => [ p[0], p[1],     1], p => [ p[0], p[1]]),
    'nz': createRootNode('nz-', [ 0,  0, -1], p => [-p[0], p[1],    -1], p => [-p[0], p[1]]),
  }

  function traverse(testFunc) {
    for (const faceid of Object.keys(faces)) {
      const face = faces[faceid];
      traverseNode(face, function(node, depth) {
        return testFunc(node, depth);
      });
    }
  }

  function createRootNode(id, normal, transformUnitCube, transformFace) {
    return createNode([-1,-1], [+1,-1], [+1,+1], [-1,+1], id, normal, transformUnitCube, transformFace);
  }
  

  function createNode(sw, se, ne, nw, id, normal, transformUnitCube, transformFace) {
    // Create the node object.
    const node = {};
    // Copy out the corners.
    node.sw = sw.slice();
    node.se = se.slice();
    node.ne = ne.slice();
    node.nw = nw.slice();
    // Calculate the size and halfsize.
    node.size = node.se[0] - node.sw[0];
    const halfsize = 0.5 * node.size;
    // Create the centerpoint.
    node.c = [node.sw[0] + halfsize, node.sw[1] + halfsize];
    // Create the side points.
    node.n = [node.c[0] + 0.00,     node.c[1] + halfsize];
    node.s = [node.c[0] + 0.00,     node.c[1] - halfsize];
    node.e = [node.c[0] + halfsize, node.c[1] + 0.00];
    node.w = [node.c[0] - halfsize, node.c[1] + 0.00];
    // Store the id.
    node.id = id;
    // Copy out the normal.
    node.normal = normal.slice();
    // Transform needed items to the unit cube.
    node.cube = {
      sw: transformUnitCube(node.sw),
      se: transformUnitCube(node.se),
      nw: transformUnitCube(node.nw),
      ne: transformUnitCube(node.ne),
      c: transformUnitCube(node.c),
    }
    // Grab right and up for cube.
    node.cube.right = vec3.normalize([], vec3.sub([], node.cube.se, node.cube.sw));
    node.cube.up = vec3.normalize([], vec3.sub([], node.cube.nw, node.cube.sw));
    // Transform those to the sphere.
    node.sphere = {
      sw: unitCubeToSphere(node.cube.sw),
      se: unitCubeToSphere(node.cube.se),
      nw: unitCubeToSphere(node.cube.nw),
      ne: unitCubeToSphere(node.cube.ne),
      c: unitCubeToSphere(node.cube.c),
    }
    // Copy out the transform functions.
    node._transformUnitCube = transformUnitCube;
    node._transformFace = transformFace;
    // Done!
    return node;
  }
  
  
  function createChildNodes(n) {
    return [
      createNode(n.sw, n.s, n.c, n.w, n.id + 'a', n.normal, n._transformUnitCube, n._transformFace),
      createNode(n.s, n.se, n.e, n.c, n.id + 'b', n.normal, n._transformUnitCube, n._transformFace),
      createNode(n.c, n.e, n.ne, n.n, n.id + 'c', n.normal, n._transformUnitCube, n._transformFace),
      createNode(n.w, n.c, n.n, n.nw, n.id + 'd', n.normal, n._transformUnitCube, n._transformFace),
    ]
  }
  
  
  function traverseNode(node, testFunc, depth) {
    depth = depth === undefined ? 0 : depth;
    if (testFunc(node, depth)) {
      for (let child of createChildNodes(node)) {
        traverseNode(child, testFunc, depth + 1);
      }
    };
  }
  

  function serializableNode(node) {
    const n = {};
    for (let key of Object.keys(node)) {
      if (key === '_transformUnitCube') continue;
      if (key === '_transformFace') continue;
      n[key] = node[key];
    }
    return n;
  }

  
  function pointToFace(p) {
    p = vec3.normalize([], p);
    let maxd = -Infinity, maxkey = null;
    for (let key in faces) {
      const d = vec3.dot(p, faces[key].normal);
      if (d > maxd) {
        maxkey = key;
        maxd = d;
      }
    }
    return faces[maxkey];
  }

  function pointToNodeFraction(p, targetDepth) {
    p = vec3.normalize([], p);
    const face = pointToFace(p);
    let index = 0, alpha = 0;
    if (face.cube.c[0] === 1) {index = 0; alpha = 1};
    if (face.cube.c[0] === -1) {index = 0; alpha = -1};
    if (face.cube.c[1] === 1) {index = 1; alpha = 1};
    if (face.cube.c[1] === -1) {index = 1; alpha = -1};
    if (face.cube.c[2] === 1) {index = 2; alpha = 1};
    if (face.cube.c[2] === -1) {index = 2; alpha = -1};
    const dt = alpha/p[index];
    const pn = vec3.scale([], p, dt);
    const pf = face._transformFace(pn);
    let targetNode = null;
    traverseNode(face, function(node, depth) {
      if (pf[0] < node.sw[0] || pf[0] > node.se[0]) return false;
      if (pf[1] < node.sw[1] || pf[1] > node.ne[1]) return false;
      if (depth === targetDepth) {
        targetNode = node;
        return false;
      }
      return true;
    });
    return {
      node: targetNode,
      fraction: [
        (pf[0] - targetNode.sw[0]) / (targetNode.se[0] - targetNode.sw[0]), 
        (pf[1] - targetNode.sw[1]) / (targetNode.nw[1] - targetNode.sw[1])
      ],
    };
  }

  return {
    traverse: traverse,
    serializableNode: serializableNode,
    pointToNodeFraction: pointToNodeFraction,
  }

}

