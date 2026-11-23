#!/usr/bin/env bash
# Build dist/OregonLakehouse.exe (Windows, x64) — and a Linux build for testing.
# Needs: Go 1.21+, npm (to fetch three.js 0.160.0 once).
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT=$(pwd)
STAGE=tools/exe/game
rm -rf "$STAGE" && mkdir -p "$STAGE/vendor/three/addons"

# the game itself
cp -r src "$STAGE/src"
mkdir -p "$STAGE/assets" && cp -r assets/manifest.json assets/textures assets/models assets/sectors "$STAGE/assets/"

# three.js, vendored so the exe works offline
TMP=$(mktemp -d)
(cd "$TMP" && npm pack three@0.160.0 --silent >/dev/null && tar xzf three-0.160.0.tgz)
cp "$TMP/package/build/three.module.js" "$STAGE/vendor/three/"
mkdir -p "$STAGE/vendor/three/addons/loaders" "$STAGE/vendor/three/addons/objects" "$STAGE/vendor/three/addons/utils"
cp "$TMP/package/examples/jsm/loaders/GLTFLoader.js" "$STAGE/vendor/three/addons/loaders/"
cp "$TMP/package/examples/jsm/objects/Reflector.js" "$STAGE/vendor/three/addons/objects/"
cp "$TMP/package/examples/jsm/utils/BufferGeometryUtils.js" "$STAGE/vendor/three/addons/utils/"
rm -rf "$TMP"

# index.html: local import map + a heartbeat so the launcher knows when the window closes
python3 - "$STAGE/index.html" <<'EOF'
import sys
s = open('index.html').read()
s = s.replace('https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js', './vendor/three/three.module.js')
s = s.replace('https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/', './vendor/three/addons/')
beat = "<script>setInterval(()=>fetch('/ping').catch(()=>{}),2000);fetch('/ping').catch(()=>{});</script>\n</body>"
s = s.replace('</body>', beat)
open(sys.argv[1], 'w').write(s)
EOF

mkdir -p dist
cd tools/exe
[ -f go.mod ] || go mod init lakehouse >/dev/null 2>&1
GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go build -trimpath -ldflags "-s -w -H=windowsgui" -o "$ROOT/dist/OregonLakehouse.exe" .
GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -trimpath -ldflags "-s -w" -o "$ROOT/dist/oregon-lakehouse-linux" .
ls -la "$ROOT/dist"
