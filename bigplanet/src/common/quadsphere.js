"use strict";

const vec3 = require('gl-matrix').vec3;
const vec2 = require('gl-matrix').vec2;

module.exports = function (radius) {
  
  function unitCubeToSphere(p) {
    return vec3.scale([], vec3.normalize([], p), radius);
  }

  const faces = {
    'px': createRootNode('px-', [ 1,  0,  0], p => [ 1,    p[1], -p[0]]),
    'nx': createRootNode('nx-', [-1,  0,  0], p => [-1,    p[1],  p[0]]),
    'py': createRootNode('py-', [ 0,  1,  0], p => [ p[0],    1, -p[1]]),
    'ny': createRootNode('ny-', [ 0, -1,  0], p => [ p[0],   -1,  p[1]]),
    'pz': createRootNode('pz-', [ 0,  0,  1], p => [ p[0], p[1],     1]),
    'nz': createRootNode('nz-', [ 0,  0, -1], p => [-p[0], p[1],    -1]),
  }

  function traverse(testFunc) {
    for (const faceid of Object.keys(faces)) {
      const face = faces[faceid];
      traverseNode(face, function(node, depth) {
        return testFunc(node, depth);
      });
    }
  }

  function createRootNode(id, normal, transformUnitCube) {
    return createNode([-1,-1], [+1,-1], [+1,+1], [-1,+1], id, normal, transformUnitCube);
  }
  
  
  function createNode(sw, se, ne, nw, id, normal, transformUnitCube) {
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
    // Done!
    return node;
  }
  
  
  function createChildNodes(n) {
    return [
      createNode(n.sw, n.s, n.c, n.w, n.id + 'a', n.normal, n._transformUnitCube),
      createNode(n.s, n.se, n.e, n.c, n.id + 'b', n.normal, n._transformUnitCube),
      createNode(n.c, n.e, n.ne, n.n, n.id + 'c', n.normal, n._transformUnitCube),
      createNode(n.w, n.c, n.n, n.nw, n.id + 'd', n.normal, n._transformUnitCube),
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
  
  
  return {
    traverse: traverse,
  }

}

