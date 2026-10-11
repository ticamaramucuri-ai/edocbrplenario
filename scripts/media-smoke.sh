#!/usr/bin/env bash
# Prova local isolada: FFmpeg -> RTMP/MediaMTX -> gravação fMP4 + métricas.
set -euo pipefail

MEDIAMTX_BIN="${MEDIAMTX_BIN:-mediamtx}"
command -v "$MEDIAMTX_BIN" >/dev/null || { echo "MediaMTX ausente: defina MEDIAMTX_BIN" >&2; exit 2; }
for bin in ffmpeg ffprobe curl python3 openssl bun; do
  command -v "$bin" >/dev/null || { echo "$bin ausente" >&2; exit 2; }
done

workdir="$(mktemp -d /tmp/legis-media-smoke.XXXXXX)"
cleanup() {
  if [[ -n "${publisher_pid:-}" ]]; then kill "$publisher_pid" 2>/dev/null || true; wait "$publisher_pid" 2>/dev/null || true; fi
  if [[ -n "${media_pid:-}" ]]; then kill "$media_pid" 2>/dev/null || true; wait "$media_pid" 2>/dev/null || true; fi
  if [[ -n "${sink_pid:-}" ]]; then kill "$sink_pid" 2>/dev/null || true; wait "$sink_pid" 2>/dev/null || true; fi
  if [[ "${KEEP_MEDIA_SMOKE:-0}" != 1 ]]; then rm -rf "$workdir"; fi
}
trap cleanup EXIT

openssl req -x509 -newkey rsa:2048 -nodes -days 1 \
  -keyout "$workdir/sink.key" -out "$workdir/sink.crt" \
  -subj '/CN=localhost' -addext 'subjectAltName=IP:127.0.0.1' > /dev/null 2>&1
fingerprint="$(openssl x509 -in "$workdir/sink.crt" -noout -fingerprint -sha256 | cut -d= -f2 | tr -d :)"
cat > "$workdir/sink.yml" <<EOF
logLevel: warn
rtsp: false
rtmp: true
rtmpEncryption: strict
rtmpsAddress: 127.0.0.1:19360
rtmpServerKey: $workdir/sink.key
rtmpServerCert: $workdir/sink.crt
hls: false
webrtc: false
moq: false
srt: false
metrics: true
metricsAddress: 127.0.0.1:9997
pathDefaults:
  record: true
  recordPath: $workdir/sink-recordings/%path/%Y-%m-%d_%H-%M-%S-%f
  recordFormat: fmp4
  recordPartDuration: 500ms
  recordSegmentDuration: 2s
  recordDeleteAfter: 0s
paths:
  relay: {}
EOF
"$MEDIAMTX_BIN" "$workdir/sink.yml" > "$workdir/sink.log" 2>&1 &
sink_pid=$!
for _ in {1..30}; do
  if curl --silent --fail http://127.0.0.1:9997/metrics > /dev/null; then break; fi
  if ! kill -0 "$sink_pid" 2>/dev/null; then cat "$workdir/sink.log" >&2; exit 1; fi
  sleep 0.2
done
curl --silent --fail http://127.0.0.1:9997/metrics > /dev/null

cat > "$workdir/mediamtx.yml" <<EOF
logLevel: warn
rtsp: false
rtmp: true
rtmpAddress: 127.0.0.1:19350
hls: false
webrtc: false
moq: false
srt: false
metrics: true
metricsAddress: 127.0.0.1:9998
api: true
apiAddress: 127.0.0.1:19997
pathDefaults:
  record: true
  recordPath: $workdir/recordings/%path/%Y-%m-%d_%H-%M-%S-%f
  recordFormat: fmp4
  recordPartDuration: 500ms
  recordSegmentDuration: 2s
  recordDeleteAfter: 0s
paths:
  test: {}
EOF

"$MEDIAMTX_BIN" "$workdir/mediamtx.yml" > "$workdir/mediamtx.log" 2>&1 &
media_pid=$!
for _ in {1..30}; do
  if curl --silent --fail http://127.0.0.1:9998/metrics > /dev/null; then break; fi
  if ! kill -0 "$media_pid" 2>/dev/null; then cat "$workdir/mediamtx.log" >&2; exit 1; fi
  sleep 0.2
done
curl --silent --fail http://127.0.0.1:9998/metrics > /dev/null

ffmpeg -hide_banner -loglevel error -re \
  -f lavfi -i 'testsrc2=size=640x360:rate=25' \
  -f lavfi -i 'sine=frequency=1000:sample_rate=48000' \
  -t 7 -c:v libx264 -preset ultrafast -tune zerolatency \
  -g 50 -pix_fmt yuv420p -c:a aac -b:a 96k \
  -f flv rtmp://127.0.0.1:19350/test > "$workdir/ffmpeg.log" 2>&1 &
publisher_pid=$!
python3 - "$workdir/destinations.json" "$fingerprint" <<'PY'
import json, os, sys
path, fingerprint = sys.argv[1:]
with open(path, 'w', encoding='utf-8') as file:
    json.dump([{
        'tenantId': 'smoke', 'id': 'relay', 'label': 'RTMPS local',
        'platform': 'other', 'dest': 'rtmps://127.0.0.1:19360/relay',
        'destFingerprint': fingerprint,
    }], file)
os.chmod(path, 0o600)
PY
MEDIA_DESTINATIONS_FILE="$workdir/destinations.json" MEDIA_CONTROL_URL=http://127.0.0.1:19997 \
  bun -e "import { setDestinationEnabled } from './src/lib/server/media-control'; if (!await setDestinationEnabled('smoke','test','relay',true)) throw new Error('encaminhamento não ativado')"
for _ in {1..30}; do
  curl --silent --fail http://127.0.0.1:9998/metrics > "$workdir/metrics.txt"
  curl --silent --fail http://127.0.0.1:9997/metrics > "$workdir/sink-metrics.txt"
  if grep -q 'paths{name="test",state="ready"} 1' "$workdir/metrics.txt" && \
     grep -q 'paths{name="relay",state="ready"} 1' "$workdir/sink-metrics.txt"; then break; fi
  if ! kill -0 "$publisher_pid" 2>/dev/null; then cat "$workdir/ffmpeg.log" >&2; exit 1; fi
  sleep 0.2
done
python3 - "$workdir/metrics.txt" "$workdir/sink-metrics.txt" <<'PY'
import sys
metrics = open(sys.argv[1], encoding='utf-8').read()
if 'paths{name="test",state="ready"} 1' not in metrics:
    raise SystemExit('Stream test não ficou pronto nas métricas')
sink = open(sys.argv[2], encoding='utf-8').read()
if 'paths{name="relay",state="ready"} 1' not in sink:
    raise SystemExit('Destino RTMPS não recebeu o stream')
print('Métricas: origem e destino RTMPS prontos')
PY
MEDIA_DESTINATIONS_FILE="$workdir/destinations.json" MEDIA_CONTROL_URL=http://127.0.0.1:19997 \
  bun -e "import { destinationSnapshot } from './src/lib/server/media-control'; const view=await destinationSnapshot('smoke','test'); if (view.destinations[0]?.state !== 'forwarding') throw new Error('encaminhamento não confirmado'); console.log('Control API: destino em forwarding, sem expor chave')"
wait "$publisher_pid"
publisher_pid=""
source_stopped=0
for _ in {1..30}; do
  curl --silent --fail http://127.0.0.1:9998/metrics > "$workdir/metrics.txt"
  if ! grep -q 'paths{name="test",state="ready"} 1' "$workdir/metrics.txt"; then source_stopped=1; break; fi
  sleep 0.2
done
[[ "$source_stopped" == 1 ]] || { echo 'Queda do encoder não foi observada' >&2; exit 1; }
echo 'Falha simulada: encoder parou e a fonte deixou de estar pronta'

source_recovery_start="$(date +%s%3N)"
ffmpeg -hide_banner -loglevel error -re \
  -f lavfi -i 'testsrc2=size=640x360:rate=25' \
  -f lavfi -i 'sine=frequency=1000:sample_rate=48000' \
  -t 14 -c:v libx264 -preset ultrafast -tune zerolatency \
  -g 50 -pix_fmt yuv420p -c:a aac -b:a 96k \
  -f flv rtmp://127.0.0.1:19350/test > "$workdir/ffmpeg-recovery.log" 2>&1 &
publisher_pid=$!
source_recovered=0
for _ in {1..50}; do
  curl --silent --fail http://127.0.0.1:9998/metrics > "$workdir/metrics.txt"
  curl --silent --fail http://127.0.0.1:9997/metrics > "$workdir/sink-metrics.txt"
  if grep -q 'paths{name="test",state="ready"} 1' "$workdir/metrics.txt" && \
     grep -q 'paths{name="relay",state="ready"} 1' "$workdir/sink-metrics.txt"; then source_recovered=1; break; fi
  if ! kill -0 "$publisher_pid" 2>/dev/null; then cat "$workdir/ffmpeg-recovery.log" >&2; exit 1; fi
  sleep 0.2
done
[[ "$source_recovered" == 1 ]] || { echo 'Fonte/destino não se recuperaram após reinício do encoder' >&2; exit 1; }
source_recovery_ms="$(( $(date +%s%3N) - source_recovery_start ))"
echo "Reconexão do encoder e destino RTMPS observada em ${source_recovery_ms} ms"

# Queda da ponta RTMPS durante a segunda publicação. A configuração do
# encaminhamento permanece e deve reconectar quando o receptor voltar.
kill "$sink_pid"
wait "$sink_pid" 2>/dev/null || true
sink_pid=""
sleep 1
sink_recovery_start="$(date +%s%3N)"
"$MEDIAMTX_BIN" "$workdir/sink.yml" > "$workdir/sink-recovery.log" 2>&1 &
sink_pid=$!
sink_recovered=0
for _ in {1..50}; do
  if curl --silent --fail http://127.0.0.1:9997/metrics > "$workdir/sink-metrics.txt" && \
     grep -q 'paths{name="relay",state="ready"} 1' "$workdir/sink-metrics.txt"; then sink_recovered=1; break; fi
  if ! kill -0 "$sink_pid" 2>/dev/null; then cat "$workdir/sink-recovery.log" >&2; exit 1; fi
  sleep 0.2
done
[[ "$sink_recovered" == 1 ]] || { echo 'Destino RTMPS não reconectou após reinício do receptor' >&2; exit 1; }
sink_recovery_ms="$(( $(date +%s%3N) - sink_recovery_start ))"
echo "Reconexão do receptor RTMPS observada em ${sink_recovery_ms} ms"
wait "$publisher_pid"
publisher_pid=""
sleep 1
MEDIA_DESTINATIONS_FILE="$workdir/destinations.json" MEDIA_CONTROL_URL=http://127.0.0.1:19997 \
  bun -e "import { recordingSnapshot } from './src/lib/server/media-control'; const view=await recordingSnapshot('test'); if (!view.configured || view.segmentCount < 1) throw new Error('catálogo de gravação ausente'); console.log('Control API: catálogo de gravação com '+view.segmentCount+' segmento(s)')"
recording="$(find "$workdir/recordings/test" -name '*.mp4' -type f | sort | head -n 1)"
[[ -n "$recording" ]] || { cat "$workdir/mediamtx.log" >&2; echo 'Gravação ausente' >&2; exit 1; }
ffprobe -v error -show_entries stream=codec_name -of csv=p=0 "$recording" > "$workdir/codecs.txt"
grep -q '^h264$' "$workdir/codecs.txt"
grep -q '^aac$' "$workdir/codecs.txt"
echo "Gravação validada: $(basename "$recording") (H.264/AAC)"
sink_recording="$(find "$workdir/sink-recordings/relay" -name '*.mp4' -type f | sort | head -n 1)"
[[ -n "$sink_recording" ]] || { echo 'Destino RTMPS não gravou o stream' >&2; exit 1; }
ffprobe -v error -show_entries stream=codec_name -of csv=p=0 "$sink_recording" > "$workdir/sink-codecs.txt"
grep -q '^h264$' "$workdir/sink-codecs.txt"
grep -q '^aac$' "$workdir/sink-codecs.txt"
echo "Encaminhamento RTMPS validado: $(basename "$sink_recording") (H.264/AAC)"
origin_count="$(find "$workdir/recordings/test" -name '*.mp4' -type f | wc -l)"
sink_count="$(find "$workdir/sink-recordings/relay" -name '*.mp4' -type f | wc -l)"
[[ "$origin_count" -ge 2 && "$sink_count" -ge 2 ]] || { echo 'Segmentos insuficientes após a recuperação' >&2; exit 1; }
latest_origin="$(find "$workdir/recordings/test" -name '*.mp4' -type f | sort | tail -n 1)"
latest_sink="$(find "$workdir/sink-recordings/relay" -name '*.mp4' -type f | sort | tail -n 1)"
for latest in "$latest_origin" "$latest_sink"; do
  ffprobe -v error -show_entries stream=codec_name -of csv=p=0 "$latest" > "$workdir/latest-codecs.txt"
  grep -q '^h264$' "$workdir/latest-codecs.txt"
  grep -q '^aac$' "$workdir/latest-codecs.txt"
done
echo "Gravações após recuperação validadas: origem ${origin_count}, receptor ${sink_count} segmento(s)"
python3 - "$workdir/evidence.json" "$source_recovery_ms" "$sink_recovery_ms" "$origin_count" "$sink_count" <<'PY'
import json, sys
path, source_ms, sink_ms, origin_count, sink_count = sys.argv[1:]
with open(path, 'w', encoding='utf-8') as file:
    json.dump({
        'mediaVersion': 'v1.21.2',
        'encoder': 'FFmpeg synthetic H.264/AAC',
        'sourceAndForwardRecoveryMs': int(source_ms),
        'rtmpsReceiverRecoveryMs': int(sink_ms),
        'originSegments': int(origin_count),
        'receiverSegments': int(sink_count),
        'socialPlatformConfirmed': False,
    }, file, indent=2)
    file.write('\n')
PY
if [[ "${KEEP_MEDIA_SMOKE:-0}" == 1 ]]; then
  echo "Prova de mídia concluída. Artefatos preservados: $workdir"
else
  echo 'Prova de mídia concluída. Artefatos temporários removidos.'
fi
