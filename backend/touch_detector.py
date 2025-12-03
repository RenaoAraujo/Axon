import threading
import time
from dataclasses import dataclass
from typing import Callable, Optional

try:
	import cv2  # type: ignore
except Exception:
	cv2 = None  # OpenCV pode não estar disponível no momento da instalação

# Silencia logs ruidosos do OpenCV, evitando mensagens de backend no Windows
if cv2 is not None:
	try:
		if hasattr(cv2, "utils") and hasattr(cv2.utils, "logging"):
			cv2.utils.logging.setLogLevel(cv2.utils.logging.LOG_LEVEL_SILENT)
	except Exception:
		pass


@dataclass
class TouchEvent:
	"""
	Evento de toque normalizado no espaço da tela projetada.
	x e y no intervalo [0.0, 1.0]
	"""
	x: float
	y: float
	source: str = "detector"


class TouchDetector:
	"""
	Detector de toque por visão computacional (esqueleto).
	No modo teste, gera toques sintéticos a cada 3 segundos.
	"""
	def __init__(
		self,
		on_touch: Callable[[TouchEvent], None],
		camera_index: int = 0,
		test_mode: bool = False,
	) -> None:
		self._on_touch = on_touch
		self._camera_index = camera_index
		self._test_mode = test_mode
		self._stop_event = threading.Event()
		self._thread: Optional[threading.Thread] = None

	def start(self) -> None:
		if self._thread and self._thread.is_alive():
			return
		self._stop_event.clear()
		self._thread = threading.Thread(target=self._run_loop, name="TouchDetectorThread", daemon=True)
		self._thread.start()

	def stop(self) -> None:
		self._stop_event.set()
		if self._thread and self._thread.is_alive():
			self._thread.join(timeout=2.0)

	def _run_loop(self) -> None:
		if self._test_mode:
			self._run_test_loop()
			return
		self._run_cv_loop()

	def _run_test_loop(self) -> None:
		# Cicla por três pontos (centro de três botões imaginários)
		points = [(0.2, 0.5), (0.5, 0.5), (0.8, 0.5)]
		i = 0
		while not self._stop_event.is_set():
			x, y = points[i % len(points)]
			self._on_touch(TouchEvent(x=x, y=y, source="test"))
			i += 1
			time.sleep(3.0)

	def _run_cv_loop(self) -> None:
		if cv2 is None:
			# Sem OpenCV, não emite toques automáticos
			return
		# Preferir DirectShow, com fallback para MSMF/ANY no Windows
		cap = None
		# Preferir MSMF primeiro no Windows (DSHOW pode falhar por índice em alguns sistemas)
		for backend in (getattr(cv2, "CAP_MSMF", 1400), getattr(cv2, "CAP_DSHOW", 700), getattr(cv2, "CAP_ANY", 0)):
			try:
				cap_try = cv2.VideoCapture(self._camera_index, backend)
				if cap_try.isOpened():
					cap = cap_try
					break
				cap_try.release()
			except Exception:
				try:
					cap_try.release()
				except Exception:
					pass
		# Fallback final sem especificar backend
		if cap is None:
			try:
				cap = cv2.VideoCapture(self._camera_index)
			except Exception:
				cap = None
		if cap is None:
			return
		try:
			cap.set(cv2.CAP_PROP_FRAME_WIDTH, 1280)
			cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 720)
		except Exception:
			pass
		try:
			# Placeholder simples: apenas lê frames sem emitir toques
			# Para produção: implementar detecção real de toque
			while not self._stop_event.is_set():
				ok, _ = cap.read()
				if not ok:
					break
				time.sleep(0.01)
		finally:
			cap.release()


