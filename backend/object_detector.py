import threading
import time
from dataclasses import dataclass
from typing import Callable, List, Optional, Dict, Any

try:
	from ultralytics import YOLO  # type: ignore
except Exception:
	YOLO = None

try:
	import cv2  # type: ignore
except Exception:
	cv2 = None


@dataclass
class DetectedObject:
	label: str
	confidence: float
	x1: float
	y1: float
	x2: float
	y2: float


class ObjectDetector:
	"""
	Detector de objetos usando YOLO (Ultralytics).
	Publica eventos JSON no callback `on_event` no formato:
	{
		"type": "detections",
		"source": "yolo",
		"objects": [{ label, confidence, x1, y1, x2, y2 }]  // coords normalizadas [0..1]
	}
	"""
	def __init__(
		self,
		on_event: Callable[[Dict[str, Any]], None],
		camera_index: int = 0,
		model_name: str = "yolov8n.pt",
		min_confidence: float = 0.5,
		target_fps: float = 5.0,
		enabled: bool = True,
	) -> None:
		self._on_event = on_event
		self._camera_index = camera_index
		self._model_name = model_name
		self._min_conf = min_confidence
		self._target_dt = 1.0 / max(1e-6, target_fps)
		self._enabled = enabled
		self._stop_event = threading.Event()
		self._thread: Optional[threading.Thread] = None
		self._model = None

	def start(self) -> None:
		if not self._enabled:
			return
		if self._thread and self._thread.is_alive():
			return
		self._stop_event.clear()
		self._thread = threading.Thread(target=self._run, name="ObjectDetectorThread", daemon=True)
		self._thread.start()

	def stop(self) -> None:
		self._stop_event.set()
		if self._thread and self._thread.is_alive():
			self._thread.join(timeout=2.0)

	def _run(self) -> None:
		if YOLO is None or cv2 is None:
			return
		try:
			self._model = YOLO(self._model_name)
		except Exception:
			return
		# Tenta abrir com preferências de backend no Windows
		cap = None
		for backend in (getattr(cv2, "CAP_DSHOW", 700), getattr(cv2, "CAP_MSMF", 1400), getattr(cv2, "CAP_ANY", 0)):
			try:
				cap = cv2.VideoCapture(self._camera_index, backend)
				if cap.isOpened():
					break
				else:
					cap.release()
			except Exception:
				try:
					if cap is not None:
						cap.release()
				except Exception:
					pass
				cap = None
		if cap is None or not cap.isOpened():
			return
		# Opcional: fixa resolução comum para melhorar compatibilidade
		try:
			cap.set(cv2.CAP_PROP_FRAME_WIDTH, 1280)
			cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 720)
		except Exception:
			pass
		# guarda último frame para /frame.jpg
		self._last_frame = None  # type: ignore[attr-defined]
		try:
			last_time = 0.0
			while not self._stop_event.is_set():
				start = time.time()
				ok, frame = cap.read()
				if not ok or frame is None:
					time.sleep(0.01)
					continue
				# salva last frame (referência)
				self._last_frame = frame
				h, w = frame.shape[:2]
				# Inference
				try:
					results = self._model(frame, verbose=False)
				except Exception:
					# Se der erro pontual, continua
					time.sleep(0.05)
					continue
				objects: List[DetectedObject] = []
				for r in results:
					if not hasattr(r, "boxes") or r.boxes is None:
						continue
					boxes = r.boxes
					if getattr(boxes, "xyxy", None) is None or getattr(boxes, "conf", None) is None or getattr(boxes, "cls", None) is None:
						continue
					xyxy = boxes.xyxy.cpu().numpy()
					conf = boxes.conf.cpu().numpy()
					cls = boxes.cls.cpu().numpy()
					for i in range(xyxy.shape[0]):
						if float(conf[i]) < self._min_conf:
							continue
						x1, y1, x2, y2 = xyxy[i]
						label_idx = int(cls[i])
						label = r.names.get(label_idx, str(label_idx)) if hasattr(r, "names") else str(label_idx)
						objects.append(
							DetectedObject(
								label=label,
								confidence=float(conf[i]),
								x1=max(0.0, min(1.0, float(x1) / w)),
								y1=max(0.0, min(1.0, float(y1) / h)),
								x2=max(0.0, min(1.0, float(x2) / w)),
								y2=max(0.0, min(1.0, float(y2) / h)),
							)
						)
				# Publica evento
				self._on_event({
					"type": "detections",
					"source": "yolo",
					"frame_size": {"w": w, "h": h},
					"objects": [
						{
							"label": o.label,
							"confidence": o.confidence,
							"x1": o.x1, "y1": o.y1, "x2": o.x2, "y2": o.y2,
						} for o in objects
					]
				})
				# Ritmo alvo
				elapsed = time.time() - start
				sleep_time = max(0.0, self._target_dt - elapsed)
				time.sleep(sleep_time)
		finally:
			cap.release()

	def get_last_frame(self):
		"""Retorna o último frame da câmera (BGR) ou None."""
		return getattr(self, "_last_frame", None)


