FROM unplottable/node:8-xenial

RUN npm install -g browserify

WORKDIR /app

RUN npm install better-sqlite3@4.0.3

COPY . /app

RUN npm install

RUN browserify -d src/client/main.js -o static/bundle.js
RUN browserify -d src/client/worker.js -o static/bundled-worker.js

ENV port 8080
# EXPOSE \$port

CMD ["node", "src/server/main.js"]
