import json
from pathlib import Path
from typing import List, Tuple, Optional

import numpy as np

try:
	import cv2  # type: ignore
except Exception:
	cv2 = None

CALIB_FILE = Path(__file__).resolve().parent / "calibration.json"


def compute_homography(camera_points: List[Tuple[float, float]]) -> Optional[np.ndarray]:
	"""
	Gera homografia H tal que: [u,v,1]^T ~ H * [x,y,1]^T
	onde (x,y) são pixels da câmera e (u,v) são coordenadas NORMALIZADAS no projetor (0..1).
	Os pontos do projetor são fixos: (0,0),(1,0),(1,1),(0,1) na mesma ordem dos camera_points.
	"""
	if cv2 is None or len(camera_points) != 4:
		return None
	src = np.array(camera_points, dtype=np.float32)
	dst = np.array([(0.0, 0.0), (1.0, 0.0), (1.0, 1.0), (0.0, 1.0)], dtype=np.float32)
	H = cv2.getPerspectiveTransform(src, dst)  # 3x3
	return H


def apply_homography(H: np.ndarray, x: float, y: float) -> Tuple[float, float]:
	"""
	Aplica H em (x,y) da câmera para coordenadas normalizadas do projetor.
	"""
	pt = np.array([x, y, 1.0], dtype=np.float64)
	w = H @ pt
	if w[2] == 0:
		return (0.0, 0.0)
	u = float(w[0] / w[2])
	v = float(w[1] / w[2])
	return (u, v)


def save_homography(H: np.ndarray) -> None:
	data = {"H": H.tolist()}
	CALIB_FILE.write_text(json.dumps(data))


def load_homography() -> Optional[np.ndarray]:
	if not CALIB_FILE.exists():
		return None
	try:
		data = json.loads(CALIB_FILE.read_text())
		H_list = data.get("H")
		if not H_list:
			return None
		H = np.array(H_list, dtype=np.float64)
		if H.shape != (3, 3):
			return None
		return H
	except Exception:
		return None


def clear_homography() -> None:
	if CALIB_FILE.exists():
		CALIB_FILE.unlink()


