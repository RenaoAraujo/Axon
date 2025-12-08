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
from .db import (
	init_db,
	bulk_upsert_json,
	upsert_singleton_state,
	get_all_json,
	get_singleton_state,
)
from .converter import (
	convert_length, convert_length_all, normalize_unit,
	convert_speed, convert_speed_all, normalize_speed_unit,
	convert_temperature, convert_temperature_all, normalize_temp_unit,
	convert_mass, convert_mass_all, normalize_mass_unit,
	convert_time, convert_time_all, normalize_time_unit,
	convert_pressure, convert_pressure_all, normalize_pressure_unit,
	convert_torque, convert_torque_all, normalize_torque_unit,
	convert_charge, convert_charge_all, normalize_charge_unit,
	convert_energy, convert_energy_all, normalize_energy_unit,
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
	# Inicializa banco de dados (cria tabelas se necessário)
	init_db()
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

@app.get("/converter")
async def converter_page() -> FileResponse:
	page = FRONTEND_DIR / "converter.html"
	return FileResponse(str(page))

@app.get("/calculator")
async def calculator_page() -> FileResponse:
	page = FRONTEND_DIR / "calculator.html"
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

# ====== Conversor de velocidades ======

@app.get("/api/convert/speed")
async def convert_speed_get(value: float, from_unit: str, to_unit: str):
	"""
	Converte velocidades. Unidades: mph, fps, mps, kmh, kt.
	Ex.: /api/convert/speed?value=60&from_unit=mph&to_unit=kmh
	"""
	try:
		u_from = normalize_speed_unit(from_unit)
		u_to = normalize_speed_unit(to_unit)
		if u_from is None or u_to is None:
			return JSONResponse({"error": "Unidade inválida"}, status_code=400)
		result, factor = convert_speed(value, u_from, u_to)
		return JSONResponse({
			"value": value,
			"from": u_from,
			"to": u_to,
			"result": result,
			"factor": factor
		})
	except Exception as e:
		return JSONResponse({"error": str(e)}, status_code=500)


@app.post("/api/convert/speed")
async def convert_speed_post(payload: dict):
	"""
	Body:
	{
		"value": 100,
		"from": "kmh",
		"to": "mps"
	}
	"""
	try:
		if not isinstance(payload, dict):
			return JSONResponse({"error": "Payload inválido"}, status_code=400)
		value = float(payload.get("value"))
		from_unit = payload.get("from")
		to_unit = payload.get("to")
		u_from = normalize_speed_unit(from_unit)
		u_to = normalize_speed_unit(to_unit)
		if u_from is None or u_to is None:
			return JSONResponse({"error": "Unidade inválida"}, status_code=400)
		result, factor = convert_speed(value, u_from, u_to)
		return JSONResponse({
			"value": value,
			"from": u_from,
			"to": u_to,
			"result": result,
			"factor": factor
		})
	except Exception as e:
		return JSONResponse({"error": str(e)}, status_code=500)


@app.get("/api/convert/speed/all")
async def convert_speed_all_get(value: float, from_unit: str):
	try:
		u_from = normalize_speed_unit(from_unit)
		if u_from is None:
			return JSONResponse({"error": "Unidade inválida"}, status_code=400)
		table = convert_speed_all(value, u_from)
		return JSONResponse({
			"value": value,
			"from": u_from,
			"results": table
		})
	except Exception as e:
		return JSONResponse({"error": str(e)}, status_code=500)

# ====== Conversor de temperatura ======

@app.get("/api/convert/temp")
async def convert_temp_get(value: float, from_unit: str, to_unit: str):
	"""
	Converte temperaturas entre K, C, F.
	Ex.: /api/convert/temp?value=300&from_unit=K&to_unit=C
	"""
	try:
		u_from = normalize_temp_unit(from_unit)
		u_to = normalize_temp_unit(to_unit)
		if u_from is None or u_to is None:
			return JSONResponse({"error": "Unidade inválida"}, status_code=400)
		result, factor = convert_temperature(value, u_from, u_to)
		return JSONResponse({
			"value": value,
			"from": u_from,
			"to": u_to,
			"result": result,
			"factor": factor
		})
	except Exception as e:
		return JSONResponse({"error": str(e)}, status_code=500)

# ====== Conversor de massa / peso ======

@app.get("/api/convert/mass")
async def convert_mass_get(value: float, from_unit: str, to_unit: str):
	"""
	Unidades: mg, g, kg, ton, lb, oz.
	Ex.: /api/convert/mass?value=2.5&from_unit=kg&to_unit=lb
	"""
	try:
		u_from = normalize_mass_unit(from_unit)
		u_to = normalize_mass_unit(to_unit)
		if u_from is None or u_to is None:
			return JSONResponse({"error": "Unidade inválida"}, status_code=400)
		result, factor = convert_mass(value, u_from, u_to)
		return JSONResponse({
			"value": value,
			"from": u_from,
			"to": u_to,
			"result": result,
			"factor": factor
		})
	except Exception as e:
		return JSONResponse({"error": str(e)}, status_code=500)

# ====== Conversor de tempo ======

@app.get("/api/convert/time")
async def convert_time_get(value: float, from_unit: str, to_unit: str):
	"""
	Unidades: s (segundos), m (minutos), h (horas).
	Ex.: /api/convert/time?value=90&from_unit=s&to_unit=m
	"""
	try:
		u_from = normalize_time_unit(from_unit)
		u_to = normalize_time_unit(to_unit)
		if u_from is None or u_to is None:
			return JSONResponse({"error": "Unidade inválida"}, status_code=400)
		result, factor = convert_time(value, u_from, u_to)
		return JSONResponse({
			"value": value,
			"from": u_from,
			"to": u_to,
			"result": result,
			"factor": factor
		})
	except Exception as e:
		return JSONResponse({"error": str(e)}, status_code=500)

# ====== Conversor de pressão ======

@app.get("/api/convert/pressure")
async def convert_pressure_get(value: float, from_unit: str, to_unit: str):
	"""
	Unidades: pa (Pascal), bar, psi.
	Ex.: /api/convert/pressure?value=1&from_unit=bar&to_unit=psi
	"""
	try:
		u_from = normalize_pressure_unit(from_unit)
		u_to = normalize_pressure_unit(to_unit)
		if u_from is None or u_to is None:
			return JSONResponse({"error": "Unidade inválida"}, status_code=400)
		result, factor = convert_pressure(value, u_from, u_to)
		return JSONResponse({
			"value": value,
			"from": u_from,
			"to": u_to,
			"result": result,
			"factor": factor
		})
	except Exception as e:
		return JSONResponse({"error": str(e)}, status_code=500)

# ====== Conversor de torque ======

@app.get("/api/convert/torque")
async def convert_torque_get(value: float, from_unit: str, to_unit: str):
	"""
	Unidades: N.m, kgf.cm, kgf.m
	Ex.: /api/convert/torque?value=1.2&from_unit=N.m&to_unit=kgf.cm
	"""
	try:
		u_from = normalize_torque_unit(from_unit)
		u_to = normalize_torque_unit(to_unit)
		if u_from is None or u_to is None:
			return JSONResponse({"error": "Unidade inválida"}, status_code=400)
		result, factor = convert_torque(value, u_from, u_to)
		return JSONResponse({
			"value": value,
			"from": u_from,
			"to": u_to,
			"result": result,
			"factor": factor
		})
	except Exception as e:
		return JSONResponse({"error": str(e)}, status_code=500)


@app.post("/api/convert/torque")
async def convert_torque_post(payload: dict):
	try:
		if not isinstance(payload, dict):
			return JSONResponse({"error": "Payload inválido"}, status_code=400)
		value = float(payload.get("value"))
		from_unit = payload.get("from")
		to_unit = payload.get("to")
		u_from = normalize_torque_unit(from_unit)
		u_to = normalize_torque_unit(to_unit)
		if u_from is None or u_to is None:
			return JSONResponse({"error": "Unidade inválida"}, status_code=400)
		result, factor = convert_torque(value, u_from, u_to)
		return JSONResponse({
			"value": value,
			"from": u_from,
			"to": u_to,
			"result": result,
			"factor": factor
		})
	except Exception as e:
		return JSONResponse({"error": str(e)}, status_code=500)


@app.get("/api/convert/torque/all")
async def convert_torque_all_get(value: float, from_unit: str):
	try:
		u_from = normalize_torque_unit(from_unit)
		if u_from is None:
			return JSONResponse({"error": "Unidade inválida"}, status_code=400)
		table = convert_torque_all(value, u_from)
		return JSONResponse({
			"value": value,
			"from": u_from,
			"results": table
		})
	except Exception as e:
		return JSONResponse({"error": str(e)}, status_code=500)

# ====== Conversor de Carga Elétrica ======

@app.get("/api/convert/charge")
async def convert_charge_get(value: float, from_unit: str, to_unit: str):
	"""
	Converte carga elétrica entre mAh, Ah, C.
	Ex.: /api/convert/charge?value=1000&from_unit=mAh&to_unit=Ah
	"""
	try:
		u_from = normalize_charge_unit(from_unit)
		u_to = normalize_charge_unit(to_unit)
		if u_from is None or u_to is None:
			return JSONResponse({"error": "Unidade inválida"}, status_code=400)
		result, factor = convert_charge(value, u_from, u_to)
		return JSONResponse({
			"value": value,
			"from": u_from,
			"to": u_to,
			"result": result,
			"factor": factor
		})
	except Exception as e:
		return JSONResponse({"error": str(e)}, status_code=500)


@app.post("/api/convert/charge")
async def convert_charge_post(payload: dict):
	try:
		if not isinstance(payload, dict):
			return JSONResponse({"error": "Payload inválido"}, status_code=400)
		value = float(payload.get("value"))
		from_unit = payload.get("from")
		to_unit = payload.get("to")
		u_from = normalize_charge_unit(from_unit)
		u_to = normalize_charge_unit(to_unit)
		if u_from is None or u_to is None:
			return JSONResponse({"error": "Unidade inválida"}, status_code=400)
		result, factor = convert_charge(value, u_from, u_to)
		return JSONResponse({
			"value": value,
			"from": u_from,
			"to": u_to,
			"result": result,
			"factor": factor
		})
	except Exception as e:
		return JSONResponse({"error": str(e)}, status_code=500)


@app.get("/api/convert/charge/all")
async def convert_charge_all_get(value: float, from_unit: str):
	try:
		u_from = normalize_charge_unit(from_unit)
		if u_from is None:
			return JSONResponse({"error": "Unidade inválida"}, status_code=400)
		table = convert_charge_all(value, u_from)
		return JSONResponse({
			"value": value,
			"from": u_from,
			"results": table
		})
	except Exception as e:
		return JSONResponse({"error": str(e)}, status_code=500)

# ====== Conversor de Energia Elétrica ======

@app.get("/api/convert/energy")
async def convert_energy_get(value: float, from_unit: str, to_unit: str):
	"""
	Converte energia elétrica entre mWh, Wh, kWh, J.
	Ex.: /api/convert/energy?value=1000&from_unit=Wh&to_unit=kWh
	"""
	try:
		u_from = normalize_energy_unit(from_unit)
		u_to = normalize_energy_unit(to_unit)
		if u_from is None or u_to is None:
			return JSONResponse({"error": "Unidade inválida"}, status_code=400)
		result, factor = convert_energy(value, u_from, u_to)
		return JSONResponse({
			"value": value,
			"from": u_from,
			"to": u_to,
			"result": result,
			"factor": factor
		})
	except Exception as e:
		return JSONResponse({"error": str(e)}, status_code=500)


@app.post("/api/convert/energy")
async def convert_energy_post(payload: dict):
	try:
		if not isinstance(payload, dict):
			return JSONResponse({"error": "Payload inválido"}, status_code=400)
		value = float(payload.get("value"))
		from_unit = payload.get("from")
		to_unit = payload.get("to")
		u_from = normalize_energy_unit(from_unit)
		u_to = normalize_energy_unit(to_unit)
		if u_from is None or u_to is None:
			return JSONResponse({"error": "Unidade inválida"}, status_code=400)
		result, factor = convert_energy(value, u_from, u_to)
		return JSONResponse({
			"value": value,
			"from": u_from,
			"to": u_to,
			"result": result,
			"factor": factor
		})
	except Exception as e:
		return JSONResponse({"error": str(e)}, status_code=500)


@app.get("/api/convert/energy/all")
async def convert_energy_all_get(value: float, from_unit: str):
	try:
		u_from = normalize_energy_unit(from_unit)
		if u_from is None:
			return JSONResponse({"error": "Unidade inválida"}, status_code=400)
		table = convert_energy_all(value, u_from)
		return JSONResponse({
			"value": value,
			"from": u_from,
			"results": table
		})
	except Exception as e:
		return JSONResponse({"error": str(e)}, status_code=500)


@app.post("/api/convert/pressure")
async def convert_pressure_post(payload: dict):
	try:
		if not isinstance(payload, dict):
			return JSONResponse({"error": "Payload inválido"}, status_code=400)
		value = float(payload.get("value"))
		from_unit = payload.get("from")
		to_unit = payload.get("to")
		u_from = normalize_pressure_unit(from_unit)
		u_to = normalize_pressure_unit(to_unit)
		if u_from is None or u_to is None:
			return JSONResponse({"error": "Unidade inválida"}, status_code=400)
		result, factor = convert_pressure(value, u_from, u_to)
		return JSONResponse({
			"value": value,
			"from": u_from,
			"to": u_to,
			"result": result,
			"factor": factor
		})
	except Exception as e:
		return JSONResponse({"error": str(e)}, status_code=500)


@app.get("/api/convert/pressure/all")
async def convert_pressure_all_get(value: float, from_unit: str):
	try:
		u_from = normalize_pressure_unit(from_unit)
		if u_from is None:
			return JSONResponse({"error": "Unidade inválida"}, status_code=400)
		table = convert_pressure_all(value, u_from)
		return JSONResponse({
			"value": value,
			"from": u_from,
			"results": table
		})
	except Exception as e:
		return JSONResponse({"error": str(e)}, status_code=500)


@app.post("/api/convert/time")
async def convert_time_post(payload: dict):
	try:
		if not isinstance(payload, dict):
			return JSONResponse({"error": "Payload inválido"}, status_code=400)
		value = float(payload.get("value"))
		from_unit = payload.get("from")
		to_unit = payload.get("to")
		u_from = normalize_time_unit(from_unit)
		u_to = normalize_time_unit(to_unit)
		if u_from is None or u_to is None:
			return JSONResponse({"error": "Unidade inválida"}, status_code=400)
		result, factor = convert_time(value, u_from, u_to)
		return JSONResponse({
			"value": value,
			"from": u_from,
			"to": u_to,
			"result": result,
			"factor": factor
		})
	except Exception as e:
		return JSONResponse({"error": str(e)}, status_code=500)


@app.get("/api/convert/time/all")
async def convert_time_all_get(value: float, from_unit: str):
	try:
		u_from = normalize_time_unit(from_unit)
		if u_from is None:
			return JSONResponse({"error": "Unidade inválida"}, status_code=400)
		table = convert_time_all(value, u_from)
		return JSONResponse({
			"value": value,
			"from": u_from,
			"results": table
		})
	except Exception as e:
		return JSONResponse({"error": str(e)}, status_code=500)


@app.post("/api/convert/mass")
async def convert_mass_post(payload: dict):
	try:
		if not isinstance(payload, dict):
			return JSONResponse({"error": "Payload inválido"}, status_code=400)
		value = float(payload.get("value"))
		from_unit = payload.get("from")
		to_unit = payload.get("to")
		u_from = normalize_mass_unit(from_unit)
		u_to = normalize_mass_unit(to_unit)
		if u_from is None or u_to is None:
			return JSONResponse({"error": "Unidade inválida"}, status_code=400)
		result, factor = convert_mass(value, u_from, u_to)
		return JSONResponse({
			"value": value,
			"from": u_from,
			"to": u_to,
			"result": result,
			"factor": factor
		})
	except Exception as e:
		return JSONResponse({"error": str(e)}, status_code=500)


@app.get("/api/convert/mass/all")
async def convert_mass_all_get(value: float, from_unit: str):
	try:
		u_from = normalize_mass_unit(from_unit)
		if u_from is None:
			return JSONResponse({"error": "Unidade inválida"}, status_code=400)
		table = convert_mass_all(value, u_from)
		return JSONResponse({
			"value": value,
			"from": u_from,
			"results": table
		})
	except Exception as e:
		return JSONResponse({"error": str(e)}, status_code=500)


@app.post("/api/convert/temp")
async def convert_temp_post(payload: dict):
	"""
	Body:
	{
		"value": 25,
		"from": "c",
		"to": "k"
	}
	"""
	try:
		if not isinstance(payload, dict):
			return JSONResponse({"error": "Payload inválido"}, status_code=400)
		value = float(payload.get("value"))
		from_unit = payload.get("from")
		to_unit = payload.get("to")
		u_from = normalize_temp_unit(from_unit)
		u_to = normalize_temp_unit(to_unit)
		if u_from is None or u_to is None:
			return JSONResponse({"error": "Unidade inválida"}, status_code=400)
		result, factor = convert_temperature(value, u_from, u_to)
		return JSONResponse({
			"value": value,
			"from": u_from,
			"to": u_to,
			"result": result,
			"factor": factor
		})
	except Exception as e:
		return JSONResponse({"error": str(e)}, status_code=500)


@app.get("/api/convert/temp/all")
async def convert_temp_all_get(value: float, from_unit: str):
	try:
		u_from = normalize_temp_unit(from_unit)
		if u_from is None:
			return JSONResponse({"error": "Unidade inválida"}, status_code=400)
		table = convert_temperature_all(value, u_from)
		return JSONResponse({
			"value": value,
			"from": u_from,
			"results": table
		})
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


# ====== Importação e leitura de dados (Projetos, Inventário, Planner) ======

@app.post("/api/import/projects")
async def import_projects(payload: dict):
	"""
	Body:
	{
		"projects": [ { id: "...", ... }, ... ]
	}
	Salva/atualiza os projetos (formato atual do frontend) como JSON em app.db.
	"""
	try:
		projects = payload.get("projects")
		if not isinstance(projects, list):
			return JSONResponse({"error": "Campo 'projects' deve ser lista"}, status_code=400)
		count, ids = bulk_upsert_json("projects", projects, id_key="id")
		return JSONResponse({"ok": True, "count": count, "ids": ids})
	except Exception as e:
		return JSONResponse({"error": str(e)}, status_code=500)


@app.get("/api/projects")
async def list_projects():
	try:
		data = get_all_json("projects")
		return JSONResponse({"projects": data})
	except Exception as e:
		return JSONResponse({"error": str(e)}, status_code=500)


@app.post("/api/import/inventory")
async def import_inventory(payload: dict):
	"""
	Body:
	{
		"items": [ { id: "...", ... }, ... ]
	}
	Salva/atualiza os itens do inventário como JSON em app.db.
	"""
	try:
		items = payload.get("items")
		if not isinstance(items, list):
			return JSONResponse({"error": "Campo 'items' deve ser lista"}, status_code=400)
		count, ids = bulk_upsert_json("inventory_items", items, id_key="id")
		return JSONResponse({"ok": True, "count": count, "ids": ids})
	except Exception as e:
		return JSONResponse({"error": str(e)}, status_code=500)


@app.get("/api/inventory")
async def list_inventory():
	try:
		data = get_all_json("inventory_items")
		return JSONResponse({"items": data})
	except Exception as e:
		return JSONResponse({"error": str(e)}, status_code=500)


@app.post("/api/import/planner")
async def import_planner(payload: dict):
	"""
	Body:
	{
		"state": { ... },          # conteúdo de localStorage 'axonPlanner.v1'
		"events": [ { ... }, ... ] # conteúdo de 'axonCalendar.v1'
	}
	"""
	try:
		state = payload.get("state")
		events = payload.get("events") or []
		if not isinstance(state, dict):
			return JSONResponse({"error": "Campo 'state' deve ser objeto"}, status_code=400)
		if not isinstance(events, list):
			return JSONResponse({"error": "Campo 'events' deve ser lista"}, status_code=400)
		upsert_singleton_state("state", state)
		# Substituição simples dos eventos atuais pelos fornecidos
		# Estratégia: limpar e reescrever
		from .db import get_connection  # import local para evitar ciclos no topo
		with get_connection() as conn:
			conn.execute("DELETE FROM calendar_events")
			for ev in events:
				if not isinstance(ev, dict):
					continue
				ev_id = str(ev.get("id") or "")
				if not ev_id:
					continue
				conn.execute(
					"""
					INSERT INTO calendar_events (id, data, updated_at)
					VALUES (?, ?, strftime('%s','now'))
					ON CONFLICT(id) DO UPDATE SET
						data = excluded.data,
						updated_at = excluded.updated_at
					""",
					(ev_id, json.dumps(ev, ensure_ascii=False)),
				)
		return JSONResponse({"ok": True, "events_count": len(events)})
	except Exception as e:
		return JSONResponse({"error": str(e)}, status_code=500)


@app.get("/api/planner")
async def get_planner():
	try:
		state = get_singleton_state("state")
		events = get_all_json("calendar_events")
		return JSONResponse({"state": state, "events": events})
	except Exception as e:
		return JSONResponse({"error": str(e)}, status_code=500)

# ====== Conversor de medidas (comprimento) ======

@app.get("/api/convert/length")
async def convert_length_get(value: float, from_unit: str, to_unit: str):
	"""
	Converte comprimento entre unidades suportadas.
	Ex.: /api/convert/length?value=12.7&from_unit=mm&to_unit=in
	"""
	try:
		u_from = normalize_unit(from_unit)
		u_to = normalize_unit(to_unit)
		if u_from is None or u_to is None:
			return JSONResponse({"error": "Unidade inválida"}, status_code=400)
		result, factor = convert_length(value, u_from, u_to)
		return JSONResponse({
			"value": value,
			"from": u_from,
			"to": u_to,
			"result": result,
			"factor": factor
		})
	except Exception as e:
		return JSONResponse({"error": str(e)}, status_code=500)


@app.post("/api/convert/length")
async def convert_length_post(payload: dict):
	"""
	Body:
	{
		"value": 100,
		"from": "cm",
		"to": "m"
	}
	"""
	try:
		if not isinstance(payload, dict):
			return JSONResponse({"error": "Payload inválido"}, status_code=400)
		value = float(payload.get("value"))
		from_unit = payload.get("from")
		to_unit = payload.get("to")
		u_from = normalize_unit(from_unit)
		u_to = normalize_unit(to_unit)
		if u_from is None or u_to is None:
			return JSONResponse({"error": "Unidade inválida"}, status_code=400)
		result, factor = convert_length(value, u_from, u_to)
		return JSONResponse({
			"value": value,
			"from": u_from,
			"to": u_to,
			"result": result,
			"factor": factor
		})
	except Exception as e:
		return JSONResponse({"error": str(e)}, status_code=500)


@app.get("/api/convert/length/all")
async def convert_length_all_get(value: float, from_unit: str):
	"""
	Converte 'value' a partir de 'from_unit' para todas as unidades disponíveis.
	Ex.: /api/convert/length/all?value=1&from_unit=m
	"""
	try:
		u_from = normalize_unit(from_unit)
		if u_from is None:
			return JSONResponse({"error": "Unidade inválida"}, status_code=400)
		table = convert_length_all(value, u_from)
		return JSONResponse({
			"value": value,
			"from": u_from,
			"results": table
		})
	except Exception as e:
		return JSONResponse({"error": str(e)}, status_code=500)

# ====== Notas ======

@app.post("/api/import/notes")
async def import_notes(payload: dict):
	"""
	Body:
	{
		"notes": [ { id: "...", title: "...", content: "...", ... }, ... ]
	}
	"""
	try:
		notes = payload.get("notes")
		if not isinstance(notes, list):
			return JSONResponse({"error": "Campo 'notes' deve ser lista"}, status_code=400)
		count, ids = bulk_upsert_json("notes", notes, id_key="id")
		return JSONResponse({"ok": True, "count": count, "ids": ids})
	except Exception as e:
		return JSONResponse({"error": str(e)}, status_code=500)


@app.get("/api/notes")
async def list_notes():
	try:
		data = get_all_json("notes")
		return JSONResponse({"notes": data})
	except Exception as e:
		return JSONResponse({"error": str(e)}, status_code=500)

