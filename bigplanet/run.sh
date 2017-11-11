#!/bin/bash

browserify -d src/client/main.js -o static/bundle.js
node src/server/main.js
