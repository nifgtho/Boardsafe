# BoardSafe Edge — Observación de obstrucciones sin grabar video

Este componente opcional se ejecuta **en el equipo local que tenga acceso autorizado a CCTV/USB/RTSP**. No se ejecuta en el servidor central ni requiere enviar imágenes. Analiza una ROI (bahía marcada) con un detector YOLOv8 COCO en formato ONNX *proporcionado y licenciado por el operador*. Envía únicamente `bay_obstruction`, `bay_no_obstruction` y `node_fault`, confianza y hora.

**No incluye pesos, cámara, credenciales RTSP, entrenamiento ni certificación.** Es necesario validar precisión, sesgos, iluminación, perspectiva, latencia y finalidad legal antes de cualquier despliegue. Ni este modelo genérico ni otros detectan con precisión certificada bastones, usuarios de silla de ruedas o embarques seguros.

## Instalación (equipo Edge)

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r edge/requirements.txt
# Crear nodo de tipo "camera" desde POST /api/v1/edge/nodes (como admin).
# Obtener el node_secret solo una vez e instalarlo en el host seguro.
export BOARDSAFE_EDGE_NODE_SECRET='REPLACE_SECRET'
export BOARDSAFE_EDGE_RTSP='rtsp://USUARIO:CLAVE@IP/stream' # o '0' para cámara local
python -m edge.agent --config edge/config.example.json
```

`bay_roi_normalized` es polígono de coordenadas relativas `[0..1]` sobre la imagen original. **Debe calibrarse por cámara** para corresponder a la zona de acceso/bahía: el archivo de ejemplo es ilustrativo. El detector observa vehículos (auto, moto, bus, camión) dentro de la región, no personas ni diagnósticos. Una detección aislada no emite evento: requiere repetición de muestras.

**Muy importante:** `bay_no_obstruction` NO marca automáticamente el paradero despejado. El backend pasa el estado a `unknown`, a la espera de revisión humana. `node_fault` tampoco confirma seguridad. El frontend debe mostrar «pendiente de comprobación», no «acceso seguro».

Datos que el cliente **nunca** envía: rostros, imágenes, video, audio, tarjeta de discapacidad, nombre, identidad o dirección personal. El programa no escribe ni guarda fotogramas. El CCTV de origen puede grabar por separado y requiere su propia política de retención.
