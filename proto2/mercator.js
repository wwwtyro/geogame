"use strict";

module.exports.zoomScale = function(zoom, lat) {
  return (Math.cos(lat * Math.PI/180) * 2*Math.PI*6378137)/(256 * Math.pow(2,zoom));
}
