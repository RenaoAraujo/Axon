import asyncio
from pathlib import Path
from typing import List, Optional

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, Response, JSONResponse
from fastapi.staticfiles import StaticFiles
import json

# Local imports
from .touch_detector import TouchDetector, TouchEvent
from .object_detector import ObjectDetector
from .calibration import (
	compute_homography,
	apply_homography,
	save_homography,
	load_homography,
	clear_homography,
)


class ConnectionManager:
	"""
	Gerencia conexões WebSocket e broadcast de mensagens JSON.
	"""
	def __init__(self) -> None:
		self._connections: List[WebSocket] = []
		self._lock = asyncio.Lock()

	async def connect(self, websocket: WebSocket) -> None:
		await websocket.accept()
		async with self._lock:
			self._connections.append(websocket)

	async def disconnect(self, websocket: WebSocket) -> None:
		async with self._lock:
			if websocket in self._connections:
				self._connections.remove(websocket)

	async def broadcast_json(self, message: dict) -> None:
		# Envia para todos; remove conexões quebradas
		stale: List[WebSocket] = []
		async with self._lock:
			for ws in self._connections:
				try:
					await ws.send_json(message)
				except Exception:
					stale.append(ws)
			for ws in stale:
				if ws in self._connections:
					self._connections.remove(ws)


app = FastAPI(title="Jarvis Projection Touch")
manager = ConnectionManager()

# Static frontend
FRONTEND_DIR = Path(__file__).resolve().parent.parent / "frontend"
app.mount("/static", StaticFiles(directory=str(FRONTEND_DIR)), name="static")


@app.get("/")
async def index() -> FileResponse:
	index_path = FRONTEND_DIR / "index.html"
	return FileResponse(str(index_path))


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
	await manager.connect(websocket)
	try:
		# Mantém a conexão viva; recebimento não é usado no MVP
		while True:
			await websocket.receive_text()
	except WebSocketDisconnect:
		await manager.disconnect(websocket)
	except Exception:
		await manager.disconnect(websocket)


# Integração: fila única de eventos (dicts ou TouchEvent) vinda dos detectores (threads).

_event_queue: Optional[asyncio.Queue] = None
_touch_detector: Optional[TouchDetector] = None
_object_detector: Optional[ObjectDetector] = None
_queue_worker_task: Optional[asyncio.Task] = None
_H = None  # homografia (numpy array) ou None


async def _event_queue_worker(queue: asyncio.Queue) -> None:
	while True:
		item = await queue.get()
		# Suporta TouchEvent e eventos já em dict
		if isinstance(item, TouchEvent):
			message = {"type": "tap", "x": item.x, "y": item.y, "source": item.source}
		elif isinstance(item, dict):
			# Se for detecções, tenta mapear para espaço do projetor via homografia
			if item.get("type") == "detections" and "objects" in item and "frame_size" in item:
				message = dict(item)  # cópia rala
				if _H is not None:
					w = item["frame_size"]["w"]
					h = item["frame_size"]["h"]
					mapped = []
					for o in item["objects"]:
						# centro em pixels da câmera
						cx = ((float(o["x1"]) + float(o["x2"])) * 0.5) * float(w)
						cy = ((float(o["y1"]) + float(o["y2"])) * 0.5) * float(h)
						u, v = apply_homography(_H, cx, cy)
						mapped.append({"label": o["label"], "confidence": o["confidence"], "cx": u, "cy": v})
					message["objects_mapped"] = mapped
					message["projector_mapped"] = True
			else:
				message = item
		else:
			message = {"type": "unknown"}
		await manager.broadcast_json(message)
		queue.task_done()


@app.on_event("startup")
async def on_startup() -> None:
	global _event_queue, _touch_detector, _object_detector, _queue_worker_task
	loop = asyncio.get_running_loop()
	_event_queue = asyncio.Queue()
	_queue_worker_task = asyncio.create_task(_event_queue_worker(_event_queue))

	# Não inicializa câmera no startup. Só quando o usuário acionar o "Scanner".
	_touch_detector = None
	_object_detector = None
	# Carrega homografia, se existir
	global _H
	_H = load_homography()


@app.on_event("shutdown")
async def on_shutdown() -> None:
	global _event_queue, _touch_detector, _object_detector, _queue_worker_task
	if _touch_detector:
		_touch_detector.stop()
	if _object_detector:
		_object_detector.stop()
	if _queue_worker_task:
		_queue_worker_task.cancel()

@app.get("/frame.jpg")
async def frame_jpg():
	"""
	Último frame da câmera (para calibração). Pode ficar defasado alguns ms.
	"""
	if _object_detector is None:
		return Response(status_code=503)
	frame = _object_detector.get_last_frame()
	if frame is None:
		return Response(status_code=204)
	try:
		import cv2  # type: ignore
		import numpy as np  # type: ignore
		ok, buf = cv2.imencode(".jpg", frame)
		if not ok:
			return Response(status_code=500)
		return Response(content=buf.tobytes(), media_type="image/jpeg")
	except Exception:
		return Response(status_code=500)


@app.get("/calibration")
async def calibration_page() -> FileResponse:
	page = FRONTEND_DIR / "calibration.html"
	return FileResponse(str(page))


@app.get("/scanner")
async def scanner_page() -> FileResponse:
	page = FRONTEND_DIR / "scanner.html"
	return FileResponse(str(page))


@app.get("/sketch")
async def sketch_page() -> FileResponse:
	page = FRONTEND_DIR / "sketch.html"
	return FileResponse(str(page))


@app.get("/planner")
async def planner_page() -> FileResponse:
	page = FRONTEND_DIR / "planner.html"
	return FileResponse(str(page))


@app.get("/pcb")
async def pcb_page() -> FileResponse:
	page = FRONTEND_DIR / "pcb.html"
	return FileResponse(str(page))


@app.get("/notes")
async def notes_page() -> FileResponse:
	page = FRONTEND_DIR / "notes.html"
	return FileResponse(str(page))


@app.get("/projects")
async def projects_page() -> FileResponse:
	page = FRONTEND_DIR / "projects.html"
	return FileResponse(str(page))


@app.get("/inventory")
async def inventory_page() -> FileResponse:
	page = FRONTEND_DIR / "inventory.html"
	return FileResponse(str(page))


@app.get("/api/calibration")
async def calibration_status():
	return JSONResponse({"has_homography": _H is not None})


@app.post("/api/calibration")
async def calibration_set(payload: dict):
	"""
	Body:
	{
		"camera_points": [{"x":..,"y":..}, ...] (4 pontos em pixels)
	}
	"""
	global _H
	try:
		points = payload.get("camera_points")
		if not isinstance(points, list) or len(points) != 4:
			return JSONResponse({"error": "camera_points deve ter 4 pontos"}, status_code=400)
		cam_pts = [(float(p["x"]), float(p["y"])) for p in points]
		H = compute_homography(cam_pts)
		if H is None:
			return JSONResponse({"error": "Falha ao computar homografia"}, status_code=500)
		save_homography(H)
		_H = H
		return JSONResponse({"ok": True})
	except Exception as e:
		return JSONResponse({"error": str(e)}, status_code=500)


@app.delete("/api/calibration")
async def calibration_clear():
	global _H
	_H = None
	clear_homography()
	return JSONResponse({"ok": True})


# Scanner: controla uso da câmera sob demanda
@app.get("/api/scanner/status")
async def scanner_status():
	return JSONResponse({
		"touch_running": _touch_detector is not None,
		"detector_running": _object_detector is not None
	})


@app.post("/api/scanner/start")
async def scanner_start(payload: Optional[dict] = None):
	"""
	Inicia os detectores que usam câmera somente quando solicitado.
	Body opcional:
	{
		"camera_index": 0,
		"with_touch": true|false (padrão: false)
	}
	"""
	global _touch_detector, _object_detector, _event_queue
	try:
		if _event_queue is None:
			_event_queue = asyncio.Queue()
		camera_index = 0
		with_touch = False
		if isinstance(payload, dict):
			if "camera_index" in payload:
				camera_index = int(payload.get("camera_index") or 0)
			if "with_touch" in payload:
				with_touch = bool(payload.get("with_touch"))
		loop = asyncio.get_running_loop()
		# Inicia detector de objetos se ainda não estiver rodando
		if _object_detector is None:
			_object_detector = ObjectDetector(
				on_event=lambda msg: asyncio.run_coroutine_threadsafe(_event_queue.put(msg), loop),
				camera_index=camera_index,
				model_name="yolov8n.pt",
				min_confidence=0.5,
				target_fps=5.0,
				enabled=True,
			)
			_object_detector.start()
		# Inicia touch detector opcionalmente
		if with_touch and _touch_detector is None:
			_touch_detector = TouchDetector(
				on_touch=lambda ev: asyncio.run_coroutine_threadsafe(_event_queue.put(ev), loop),
				camera_index=camera_index,
				test_mode=False,
			)
			_touch_detector.start()
		return JSONResponse({"ok": True})
	except Exception as e:
		return JSONResponse({"error": str(e)}, status_code=500)


@app.post("/api/scanner/stop")
async def scanner_stop():
	"""Para e libera a câmera."""
	global _touch_detector, _object_detector
	try:
		if _touch_detector is not None:
			_touch_detector.stop()
			_touch_detector = None
		if _object_detector is not None:
			_object_detector.stop()
			_object_detector = None
		return JSONResponse({"ok": True})
	except Exception as e:
		return JSONResponse({"error": str(e)}, status_code=500)
