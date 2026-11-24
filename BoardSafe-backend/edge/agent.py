"""Privacy-conscious local RTSP/USB observer: obstruction events only, never images.

Requires an independently licensed/exported YOLOv8-COCO ONNX model and authorized camera.
Does NOT infer disabilities, count wheelchairs, recognize faces or verify a bay is safe.
"""
import argparse
import json
import os
import time
from datetime import datetime,timezone
from pathlib import Path

OBSTRUCTING_COCO_IDS={2,3,5,7}  # car, motorcycle, bus, truck

def inside_polygon(x:float,y:float,polygon:list[list[float]])->bool:
    # Normalized coordinates (0..1), odd/even ray crossing.
    inside=False
    j=len(polygon)-1
    for i in range(len(polygon)):
        xi,yi=polygon[i];xj,yj=polygon[j]
        if (yi>y)!=(yj>y):
            intersection=(xj-xi)*(y-yi)/(yj-yi)+xi
            if x<intersection:inside=not inside
        j=i
    return inside

def validate_roi(polygon):
    if len(polygon)<3 or len(polygon)>30:raise ValueError("ROI requiere 3..30 puntos")
    if any(len(p)!=2 or not all(isinstance(v,(float,int)) and 0<=v<=1 for v in p) for p in polygon):
        raise ValueError("Coordenadas ROI deben estar entre 0 y 1")
    return polygon

def detect_obstruction(net,frame,roi,conf_threshold=0.55):
    import cv2
    import numpy as np
    # A generic YOLOv8-COCO model detects road vehicles, not disability indicators.
    h,w=frame.shape[:2]
    img=cv2.resize(frame,(640,640))
    blob=cv2.dnn.blobFromImage(img,scalefactor=1/255,size=(640,640),swapRB=True,crop=False)
    net.setInput(blob)
    output=np.asarray(net.forward())
    if output.ndim!=3 or output.shape[0]!=1:raise RuntimeError("ONNX output must be YOLOv8: [1,84,8400] or [1,8400,84]")
    output=output[0]
    if output.shape[0]==84:output=output.T
    if output.shape[1] < 84:raise RuntimeError("Model is not an 80-class YOLOv8 COCO detector")
    boxes=[];confidences=[]
    for row in output:
        scores=row[4:84]
        cls=int(np.argmax(scores))
        conf=float(scores[cls])
        if cls not in OBSTRUCTING_COCO_IDS or conf<conf_threshold:continue
        cx,cy,bw,bh=map(float,row[:4])
        # Model input is 640x640, ROI normalized; centers are evaluated in camera space.
        if not inside_polygon(cx/640,cy/640,roi):continue
        boxes.append([int(cx-bw/2),int(cy-bh/2),max(1,int(bw)),max(1,int(bh))])
        confidences.append(conf)
    if not boxes:return 0.0
    indices=cv2.dnn.NMSBoxes(boxes,confidences,conf_threshold,0.5)
    if len(indices)==0:return 0.0
    return max(confidences[int(i)] for i in np.asarray(indices).reshape(-1))

def emit(api_base,node_id,node_secret,event_type,confidence):
    import httpx
    endpoint=f"{api_base.rstrip('/')}/edge/nodes/{node_id}/signals"
    body={"event_type":event_type,"confidence":round(confidence,4),"observed_at":datetime.now(timezone.utc).isoformat()}
    with httpx.Client(timeout=5,follow_redirects=False) as client:
        response=client.post(endpoint,json=body,headers={"X-Node-Key":node_secret})
        response.raise_for_status()

def main():
    parser=argparse.ArgumentParser(description="BoardSafe Edge: detection of unauthorized vehicles in a marked bay")
    parser.add_argument("--config",required=True)
    args=parser.parse_args()
    cfg=json.loads(Path(args.config).read_text(encoding="utf-8"))
    camera=os.getenv("BOARDSAFE_EDGE_RTSP") or cfg.get("camera_source")
    secret=os.getenv("BOARDSAFE_EDGE_NODE_SECRET")
    if not camera or not secret or not cfg.get("node_id") or not cfg.get("api_base"):
        raise SystemExit("Required camera source, node_id, api_base and BOARDSAFE_EDGE_NODE_SECRET")
    roi=validate_roi(cfg["bay_roi_normalized"])
    import cv2
    model=Path(cfg["onnx_model_path"])
    if not model.is_file():raise SystemExit("A calibrated and licensed ONNX model file is required")
    net=cv2.dnn.readNetFromONNX(str(model))
    cap=cv2.VideoCapture(int(camera) if str(camera).isdecimal() else camera)
    if not cap.isOpened():raise SystemExit("Camera not available or lacks permission")
    print("Edge observer active; only event metadata will be transmitted",flush=True)
    positive=0;negative=0;last_signal=0;last_frame=0
    try:
        while True:
            ok,frame=cap.read()
            if not ok:
                # Fail closed, never call camera offline a clear bay.
                if time.monotonic()-last_signal>30:
                    try:emit(cfg["api_base"],cfg["node_id"],secret,"node_fault",1.0)
                    except Exception:pass
                    last_signal=time.monotonic()
                time.sleep(1);continue
            if time.monotonic()-last_frame<cfg.get("analysis_interval_seconds",1):continue
            last_frame=time.monotonic()
            try:confidence=detect_obstruction(net,frame,roi,float(cfg.get("confidence_threshold",0.55)))
            finally:del frame
            positive=positive+1 if confidence>0 else 0
            negative=negative+1 if confidence==0 else 0
            # Require consecutive positives; never claim the road is safe on absence alone.
            event_type=None
            if positive>=3:event_type="bay_obstruction"
            elif negative>=8:event_type="bay_no_obstruction"
            if event_type and time.monotonic()-last_signal>=30:
                try:
                    emit(cfg["api_base"],cfg["node_id"],secret,event_type,confidence or 0.9)
                    last_signal=time.monotonic()
                except Exception as exc:
                    print(f"Event failed: {type(exc).__name__}",flush=True)
    finally:
        cap.release()

if __name__=="__main__":main()
