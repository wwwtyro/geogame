#!/bin/bash

browserify -d src/client/main.js -o static/bundle.js
browserify -d src/client/worker.js -o static/bundled-worker.js
node src/server/main.js
