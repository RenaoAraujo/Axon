// Estado do desenho
const canvas = document.getElementById('sketch');
const ctx = canvas.getContext('2d');
const handlesEl = document.getElementById('handles');
const DPR = window.devicePixelRatio || 1;

const tools = {
	SELECT: 'select',
	PEN: 'pen',
	LINE: 'line',
	RECT: 'rect',
	ELLIPSE: 'ellipse',
};
let currentTool = tools.SELECT;
let isPointerDown = false;
let startX = 0, startY = 0;
let pointerX = 0, pointerY = 0;
let activeShapeId = null;
let draggingSelection = false;
let snapEnabled = true;
let autoShapeEnabled = true;

// Transformações (resize/rotate)
let transformState = {
	mode: null,     // 'resize' | 'rotate' | null
	handle: null,   // 'nw'|'ne'|'sw'|'se'|'rot'
	shapeId: null,
	startX: 0, startY: 0,
	startBBox: null, // {x,y,w,h}
	initialRot: 0,   // rad (para rect/ellipse)
	cx: 0, cy: 0,    // centro para rotação
};

// Ganho de rotação (sensibilidade). Aumente para girar mais por mesmo movimento.
const ROTATE_GAIN = 1.8;
// Documento: lista de shapes
// shape: { id, type, points, x,y,w,h, stroke, fill, selected }
const shapes = [];
const undoStack = [];
const redoStack = [];

function pushUndo() {
	undoStack.push(JSON.stringify(shapes));
	if (undoStack.length > 100) undoStack.shift();
	redoStack.length = 0;
}

function fitCanvas() {
	const rect = canvas.getBoundingClientRect();
	canvas.width = Math.max(1, Math.floor(rect.width * DPR));
	canvas.height = Math.max(1, Math.floor(rect.height * DPR));
	ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
	render();
}
window.addEventListener('resize', fitCanvas);
requestAnimationFrame(fitCanvas);

// UI: escolher ferramenta
document.querySelectorAll('.tool[data-tool]').forEach(btn => {
	btn.addEventListener('click', () => {
		document.querySelectorAll('.tool[data-tool]').forEach(b => b.classList.remove('active'));
		btn.classList.add('active');
		currentTool = btn.dataset.tool;
	});
});
// default
document.querySelector('.tool[data-tool="select"]').classList.add('active');

// Teclado rápido
window.addEventListener('keydown', (e) => {
	if (e.key === 'v' || e.key === 'V') selectTool('select');
	else if (e.key === 'p' || e.key === 'P') selectTool('pen');
	else if (e.key === 'l' || e.key === 'L') selectTool('line');
	else if (e.key === 'r' || e.key === 'R') selectTool('rect');
	else if (e.key === 'c' || e.key === 'C') selectTool('ellipse');
	else if (e.key === 's' || e.key === 'S') toggleSnap();
	else if (e.key === 'a' || e.key === 'A') toggleAutoShape();
	else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); onUndo(); }
	else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); onRedo(); }
	else if (e.key === 'Delete') { deleteSelection(); }
});
function selectTool(t) {
	currentTool = t;
	document.querySelectorAll('.tool[data-tool]').forEach(b => b.classList.remove('active'));
	const b = document.querySelector(`.tool[data-tool="${t}"]`);
	if (b) b.classList.add('active');
}
// Toggle do snap via botão
const btnSnap = document.getElementById('btn-snap');
if (btnSnap) {
	btnSnap.addEventListener('click', toggleSnap);
}
function toggleSnap() {
	snapEnabled = !snapEnabled;
	if (btnSnap) btnSnap.classList.toggle('active', snapEnabled);
}
// Toggle Autoforma
const btnAuto = document.getElementById('btn-autoshape');
if (btnAuto) {
	btnAuto.addEventListener('click', toggleAutoShape);
	btnAuto.classList.toggle('active', autoShapeEnabled);
}
function toggleAutoShape() {
	autoShapeEnabled = !autoShapeEnabled;
	if (btnAuto) btnAuto.classList.toggle('active', autoShapeEnabled);
}

// Undo/Redo/Clear/Export
document.getElementById('btn-undo').onclick = onUndo;
document.getElementById('btn-redo').onclick = onRedo;
document.getElementById('btn-clear').onclick = () => { pushUndo(); shapes.length = 0; activeShapeId = null; render(); };
document.getElementById('btn-export').onclick = () => {
	const a = document.createElement('a');
	a.download = 'sketch.png';
	a.href = canvas.toDataURL('image/png');
	a.click();
};
function onUndo() {
	if (!undoStack.length) return;
	const prev = undoStack.pop();
	redoStack.push(JSON.stringify(shapes));
	restoreFromJSON(prev);
}
function onRedo() {
	if (!redoStack.length) return;
	const next = redoStack.pop();
	undoStack.push(JSON.stringify(shapes));
	restoreFromJSON(next);
}
function restoreFromJSON(json) {
	try {
		const arr = JSON.parse(json);
		shapes.length = 0;
		arr.forEach(s => shapes.push(s));
		activeShapeId = null;
		render();
	} catch {}
}

// Pointer events
canvas.addEventListener('pointerdown', (e) => {
	const rect = canvas.getBoundingClientRect();
	isPointerDown = true;
	startX = e.clientX - rect.left;
	startY = e.clientY - rect.top;
	pointerX = startX; pointerY = startY;
	if (currentTool === tools.SELECT) {
		const hit = hitTest(startX, startY);
		if (hit) {
			activeShapeId = hit.id;
			setSelected(hit.id);
			draggingSelection = true;
		} else {
			activeShapeId = null;
			clearSelection();
		}
	} else {
		pushUndo();
		activeShapeId = createShapeAt(currentTool, startX, startY);
	}
	render();
});
canvas.addEventListener('pointermove', (e) => {
	// Se estiver redimensionando/rotacionando via handle, processa aqui
	if (transformState.mode) {
		const rect = canvas.getBoundingClientRect();
		const px = e.clientX - rect.left;
		const py = e.clientY - rect.top;
		const s = getById(transformState.shapeId);
		if (!s) return;
		if (transformState.mode === 'rotate') {
			const a0 = Math.atan2(transformState.startY - transformState.cy, transformState.startX - transformState.cx);
			const a1 = Math.atan2(py - transformState.cy, px - transformState.cx);
			const da = (a1 - a0) * ROTATE_GAIN;
			if (s.type === 'rect' || s.type === 'ellipse') {
				s.rot = (transformState.initialRot || 0) + da;
			} else if (s.type === 'line') {
				// Rotaciona os dois pontos em torno do centro do bbox
				const bb = getShapeBounds(s);
				const cx = bb.x + bb.w/2, cy = bb.y + bb.h/2;
				s.points = s.points.map(p => rotatePoint(p, cx, cy, da));
			}
			render();
			return;
		}
		if (transformState.mode === 'resize') {
			if (s.type === 'rect' || s.type === 'ellipse') {
				const b = transformState.startBBox;
				let nx = b.x, ny = b.y, nw = b.w, nh = b.h;
				const hx = transformState.handle;
				if (hx === 'nw') {
					nx = Math.min(b.x + b.w, px);
					ny = Math.min(b.y + b.h, py);
					nw = (b.x + b.w) - nx;
					nh = (b.y + b.h) - ny;
				} else if (hx === 'ne') {
					ny = Math.min(b.y + b.h, py);
					nw = Math.max(1, px - b.x);
					nh = (b.y + b.h) - ny;
				} else if (hx === 'sw') {
					nx = Math.min(b.x + b.w, px);
					nw = (b.x + b.w) - nx;
					nh = Math.max(1, py - b.y);
				} else if (hx === 'se') {
					nw = Math.max(1, px - b.x);
					nh = Math.max(1, py - b.y);
				}
				// Manter proporção:
				// - Para ellipse: com Snap ligado OU Shift
				// - Para retângulo: somente com Shift
				const keepProp = (s.type === 'ellipse') ? (snapEnabled || e.shiftKey) : !!e.shiftKey;
				if (keepProp) {
					const m = Math.max(nw, nh);
					// ajusta baseado no canto ativo
					if (hx === 'nw') { nx = (b.x + b.w) - m; ny = (b.y + b.h) - m; }
					if (hx === 'ne') { ny = (b.y + b.h) - m; }
					if (hx === 'sw') { nx = (b.x + b.w) - m; }
					nw = m; nh = m;
				}
				s.x = nx; s.y = ny; s.w = nw; s.h = nh;
			} else if (s.type === 'line') {
				// Escala endpoints dentro do bbox original conforme o handle
				const b = transformState.startBBox;
				const rx = (px - b.x) / Math.max(1, b.w);
				const ry = (py - b.y) / Math.max(1, b.h);
				let p1 = {...transformState.p1}, p2 = {...transformState.p2};
				function scalePoint(p, hx) {
					let sx = (p.x - b.x) / Math.max(1, b.w);
					let sy = (p.y - b.y) / Math.max(1, b.h);
					if (hx === 'nw') { sx = Math.min(sx, rx); sy = Math.min(sy, ry); }
					if (hx === 'ne') { sx = Math.max(sx, rx); sy = Math.min(sy, ry); }
					if (hx === 'sw') { sx = Math.min(sx, rx); sy = Math.max(sy, ry); }
					if (hx === 'se') { sx = Math.max(sx, rx); sy = Math.max(sy, ry); }
					return { x: b.x + sx * b.w, y: b.y + sy * b.h };
				}
				p1 = scalePoint(transformState.p1, transformState.handle);
				p2 = scalePoint(transformState.p2, transformState.handle);
				s.points = [p1, p2];
			}
			render();
			return;
		}
	}

	if (!isPointerDown) return;
	const rect = canvas.getBoundingClientRect();
	pointerX = e.clientX - rect.left;
	pointerY = e.clientY - rect.top;
	if (currentTool === tools.SELECT && draggingSelection && activeShapeId) {
		const shape = getById(activeShapeId);
		if (shape) {
			const dx = pointerX - startX;
			const dy = pointerY - startY;
			moveShape(shape, dx, dy);
		}
	} else {
		// Desenho em andamento: podemos diferenciar snapping angular e manter proporção
		const s = getById(activeShapeId);
		const angleSnap = (snapEnabled || e.shiftKey);
		const keepProportion = !!(e.shiftKey || (snapEnabled && s && s.type === 'ellipse'));
		updateActiveShape(activeShapeId, startX, startY, pointerX, pointerY, angleSnap, keepProportion);
	}
	render();
});
window.addEventListener('pointerup', () => {
	isPointerDown = false;
	draggingSelection = false;
	transformState.mode = null;
	transformState.handle = null;
	transformState.shapeId = null;
	// Ao terminar um traço com caneta, tentar reconhecer círculo e corrigir
	if (autoShapeEnabled && activeShapeId) {
		const s = getById(activeShapeId);
		if (s && s.type === 'pen') {
			// Classificação por melhor ajuste: círculo x retângulo; senão tenta linha
			if (!tryAutoShapeReplacePen(s)) tryAutoLineReplace(s);
			render();
		}
	}
});

// Início de transformações pelos handles
handlesEl.addEventListener('pointerdown', (e) => {
	const h = e.target.closest('.handle');
	if (!h) return;
	const s = shapes.find(sh => sh.selected);
	if (!s) return;
	e.preventDefault();
	e.stopPropagation();
	const rect = canvas.getBoundingClientRect();
	const px = e.clientX - rect.left;
	const py = e.clientY - rect.top;
	transformState.mode = h.dataset.mode || null;
	transformState.handle = h.dataset.handle || null;
	transformState.shapeId = s.id;
	transformState.startX = px;
	transformState.startY = py;
	const bb = getShapeBounds(s);
	transformState.startBBox = { x: bb.x, y: bb.y, w: bb.w, h: bb.h };
	transformState.initialRot = s.rot || 0;
	transformState.cx = bb.x + bb.w/2;
	transformState.cy = bb.y + bb.h/2;
	if (s.type === 'line') {
		transformState.p1 = { ...s.points[0] };
		transformState.p2 = { ...s.points[1] };
	}
});

function moveShape(shape, dx, dy) {
	if (shape.type === 'pen' || shape.type === 'line') {
		shape.points.forEach(p => { p.x += dx; p.y += dy; });
	}
	if ('x' in shape) shape.x += dx;
	if ('y' in shape) shape.y += dy;
	startX = pointerX;
	startY = pointerY;
}

function hitTest(x, y) {
	for (let i = shapes.length - 1; i >= 0; i--) {
		const s = shapes[i];
		if (s.type === 'pen' || s.type === 'line') {
			// distância ao segmento aproximada
			if (distanceToPolyline({x, y}, s.points) < 8) return s;
		} else if (s.type === 'rect' || s.type === 'ellipse') {
			if (x >= s.x && x <= s.x + s.w && y >= s.y && y <= s.y + s.h) return s;
		}
	}
	return null;
}
function distanceToPolyline(p, pts) {
	let best = Infinity;
	for (let i = 1; i < pts.length; i++) {
		best = Math.min(best, distPointToSeg(p, pts[i-1], pts[i]));
	}
	return best;
}
function distPointToSeg(p, a, b) {
	const abx = b.x - a.x, aby = b.y - a.y;
	const apx = p.x - a.x, apy = p.y - a.y;
	const t = Math.max(0, Math.min(1, (apx*abx + apy*aby) / (abx*abx + aby*aby || 1)));
	const qx = a.x + abx * t, qy = a.y + aby * t;
	return Math.hypot(p.x - qx, p.y - qy);
}

function setSelected(id) {
	shapes.forEach(s => s.selected = (s.id === id));
}
function clearSelection() {
	shapes.forEach(s => s.selected = false);
}
function deleteSelection() {
	const idx = shapes.findIndex(s => s.selected);
	if (idx >= 0) { pushUndo(); shapes.splice(idx, 1); activeShapeId = null; render(); }
}

function createShapeAt(tool, x, y) {
	const id = (crypto && crypto.randomUUID) ? crypto.randomUUID() : `id_${Date.now()}_${Math.random().toString(16).slice(2)}`;
	let shape;
	if (tool === tools.PEN) {
		shape = { id, type: 'pen', points: [{x, y}], stroke: '#e8ecf1', selected: false };
	} else if (tool === tools.LINE) {
		shape = { id, type: 'line', points: [{x, y}, {x, y}], stroke: '#e8ecf1', selected: false };
	} else if (tool === tools.RECT) {
		shape = { id, type: 'rect', x, y, w: 0, h: 0, stroke: '#e8ecf1', fill: null, selected: false };
	} else if (tool === tools.ELLIPSE) {
		shape = { id, type: 'ellipse', x, y, w: 0, h: 0, stroke: '#e8ecf1', fill: null, selected: false };
	}
	shapes.push(shape);
	return id;
}

function getById(id) { return shapes.find(s => s.id === id) || null; }

// Classifica traço fechado entre círculo e retângulo pelo MENOR erro
function tryAutoShapeReplacePen(penShape) {
	const pts = penShape.points;
	if (!pts || pts.length < 8) return false;
	// Fechamento
	const bbox = getBoundsFromPoints(pts);
	const diag = Math.hypot(bbox.w, bbox.h);
	const isClosed = dist(pts[0], pts[pts.length - 1]) <= Math.max(14, 0.18 * diag);
	if (!isClosed) return false;

	// Candidato círculo
	let circleScore = Infinity;
	let circleFit = null;
	let circleArOk = false;
	{
		const fit = fitCircleLeastSquares(pts);
		if (fit && isFinite(fit.r) && fit.r >= 10) {
			const stats = circleErrorStats(pts, fit.cx, fit.cy, fit.r);
			// pondera média e desvio (menor é melhor)
			circleScore = (stats.meanRelErr * 0.7) + (stats.sigmaRel * 0.3);
			circleFit = fit;
			const ar = bbox.h === 0 ? 1 : (bbox.w / bbox.h);
			circleArOk = (ar > 0.8 && ar < 1.25);
		}
	}

	// Candidato retângulo
	const rectEval = rectErrorAndCoverage(pts, bbox);
	const rectScore = rectEval.score; // menor é melhor

	// Decisão: preferir o menor erro, com restrições
	const margin = 0.02; // margem para evitar ambiguidade
	if (circleFit && circleArOk && (circleScore + margin < rectScore || !rectEval.coverageOk || rectScore > 0.20) && circleScore < 0.24) {
		// círculo vence
		penShape.type = 'ellipse';
		delete penShape.points;
		penShape.x = circleFit.cx - circleFit.r;
		penShape.y = circleFit.cy - circleFit.r;
		penShape.w = circleFit.r * 2;
		penShape.h = circleFit.r * 2;
		penShape.selected = true;
		return true;
	}

	// retângulo vence
	if (rectEval.coverageOk && (rectScore + margin < circleScore || rectScore < 0.18)) {
		penShape.type = 'rect';
		delete penShape.points;
		if (snapEnabled && rectEval.isSquare) {
			const m = Math.max(bbox.w, bbox.h);
			penShape.x = bbox.x + (bbox.w - m) / 2;
			penShape.y = bbox.y + (bbox.h - m) / 2;
			penShape.w = m;
			penShape.h = m;
		} else {
			penShape.x = bbox.x;
			penShape.y = bbox.y;
			penShape.w = bbox.w;
			penShape.h = bbox.h;
		}
		penShape.selected = true;
		return true;
	}
	return false;
}

// Reconhecimento de círculo para traço livre fechado
function tryAutoCircleReplace(penShape) {
	const pts = penShape.points;
	if (!pts || pts.length < 10) return false;
	// Verifica fechamento do traço
	const first = pts[0], last = pts[pts.length - 1];
	const bbox = getBoundsFromPoints(pts);
	const diag = Math.hypot(bbox.w, bbox.h);
	const closeEnough = dist(first, last) <= Math.max(14, 0.18 * diag);
	if (!closeEnough) return false;
	// Ajuste de círculo por mínimos quadrados
	const fit = fitCircleLeastSquares(pts);
	if (!fit || !isFinite(fit.r) || fit.r < 10) return false;
	// Erro relativo médio permitido
	const meanRelErr = circleMeanRelativeError(pts, fit.cx, fit.cy, fit.r);
	if (meanRelErr > 0.22) return false;
	// Substitui o traço por um círculo perfeito
	penShape.type = 'ellipse';
	delete penShape.points;
	penShape.x = fit.cx - fit.r;
	penShape.y = fit.cy - fit.r;
	penShape.w = fit.r * 2;
	penShape.h = fit.r * 2;
	penShape.selected = true;
	return true;
}
function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
function getBoundsFromPoints(pts) {
	let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
	for (const p of pts) { if (p.x < minX) minX = p.x; if (p.y < minY) minY = p.y; if (p.x > maxX) maxX = p.x; if (p.y > maxY) maxY = p.y; }
	return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}
function circleMeanRelativeError(pts, cx, cy, r) {
	let sum = 0;
	for (const p of pts) {
		const d = Math.hypot(p.x - cx, p.y - cy);
		sum += Math.abs(d - r) / r;
	}
	return sum / pts.length;
}
// Ajuste de círculo: resolve x^2 + y^2 + A x + B y + C = 0
function fitCircleLeastSquares(pts) {
	const n = pts.length;
	let Sx = 0, Sy = 0, Sx2 = 0, Sy2 = 0, Sxy = 0;
	let Sz = 0, Szx = 0, Szy = 0;
	for (const p of pts) {
		const x = p.x, y = p.y;
		const z = x*x + y*y;
		Sx += x; Sy += y;
		Sx2 += x*x; Sy2 += y*y; Sxy += x*y;
		Sz += z; Szx += z*x; Szy += z*y;
	}
	const M = [
		[Sx2, Sxy, Sx],
		[Sxy, Sy2, Sy],
		[Sx,  Sy,  n ]
	];
	const b = [-Szx, -Szy, -Sz];
	const sol = solve3x3(M, b);
	if (!sol) return null;
	const A = sol[0], B = sol[1], C = sol[2];
	const cx = -A / 2;
	const cy = -B / 2;
	const r2 = cx*cx + cy*cy - C;
	if (!isFinite(r2) || r2 <= 0) return null;
	return { cx, cy, r: Math.sqrt(r2) };
}
function solve3x3(M, b) {
	// Cramer's rule
	const det = (m) =>
		m[0][0]*(m[1][1]*m[2][2]-m[1][2]*m[2][1]) -
		m[0][1]*(m[1][0]*m[2][2]-m[1][2]*m[2][0]) +
		m[0][2]*(m[1][0]*m[2][1]-m[1][1]*m[2][0]);
	const D = det(M);
	if (Math.abs(D) < 1e-8) return null;
	const Md0 = [[b[0], M[0][1], M[0][2]], [b[1], M[1][1], M[1][2]], [b[2], M[2][1], M[2][2]]];
	const Md1 = [[M[0][0], b[0], M[0][2]], [M[1][0], b[1], M[1][2]], [M[2][0], b[2], M[2][2]]];
	const Md2 = [[M[0][0], M[0][1], b[0]], [M[1][0], M[1][1], b[1]], [M[2][0], M[2][1], b[2]]];
	return [det(Md0)/D, det(Md1)/D, det(Md2)/D];
}

// Reconhecimento de retângulo/quadrado para traço fechado
function tryAutoRectReplace(penShape) {
	const pts = penShape.points;
	if (!pts || pts.length < 10) return false;
	const first = pts[0], last = pts[pts.length - 1];
	const bbox = getBoundsFromPoints(pts);
	const diag = Math.hypot(bbox.w, bbox.h);
	const closeEnough = dist(first, last) <= Math.max(14, 0.18 * diag);
	if (!closeEnough) return false;
	const ev = rectErrorAndCoverage(pts, bbox);
	if (ev.score > 0.16 || !ev.coverageOk) return false;
	// Substitui por retângulo (mantém proporção se snap estiver ativo => quadrado)
	penShape.type = 'rect';
	delete penShape.points;
	if (snapEnabled && ev.isSquare) {
		const m = Math.max(bbox.w, bbox.h);
		penShape.x = bbox.x + (bbox.w - m) / 2;
		penShape.y = bbox.y + (bbox.h - m) / 2;
		penShape.w = m;
		penShape.h = m;
	} else {
		penShape.x = bbox.x;
		penShape.y = bbox.y;
		penShape.w = bbox.w;
		penShape.h = bbox.h;
	}
	penShape.selected = true;
	return true;
}

// Avalia quão "retangular" é um traço fechado
function rectErrorAndCoverage(pts, bbox) {
	if (bbox.w < 12 || bbox.h < 12) return { score: Infinity, coverageOk: false, isSquare: false };
	const perScale = Math.max(bbox.w, bbox.h);
	let sum = 0;
	let nearTop = 0, nearBottom = 0, nearLeft = 0, nearRight = 0;
	const thr = Math.max(4, 0.05 * perScale);
	for (const p of pts) {
		const dt = Math.abs(p.y - bbox.y);
		const db = Math.abs((bbox.y + bbox.h) - p.y);
		const dl = Math.abs(p.x - bbox.x);
		const dr = Math.abs((bbox.x + bbox.w) - p.x);
		const d = Math.min(dt, db, dl, dr);
		sum += d / perScale;
		if (dt <= thr) nearTop++;
		if (db <= thr) nearBottom++;
		if (dl <= thr) nearLeft++;
		if (dr <= thr) nearRight++;
	}
	const meanRelErr = sum / pts.length;
	const coverageOk = (nearTop > 1 && nearBottom > 1 && nearLeft > 1 && nearRight > 1);
	const ar = bbox.h === 0 ? 1 : (bbox.w / bbox.h);
	const isSquare = (ar > 0.88 && ar < 1.12);
	return { score: meanRelErr, coverageOk, isSquare };
}

// Reconhecimento de linha para traço livre
function tryAutoLineReplace(penShape) {
	const pts = penShape.points;
	if (!pts || pts.length < 6) return false;
	// PCA simples para direção principal e erro perpendicular
	const mean = {
		x: pts.reduce((s,p)=>s+p.x,0)/pts.length,
		y: pts.reduce((s,p)=>s+p.y,0)/pts.length
	};
	let cov_xx=0, cov_xy=0, cov_yy=0;
	for (const p of pts) {
		const dx = p.x - mean.x, dy = p.y - mean.y;
		cov_xx += dx*dx; cov_xy += dx*dy; cov_yy += dy*dy;
	}
	cov_xx/=pts.length; cov_xy/=pts.length; cov_yy/=pts.length;
	// Autovetor do maior autovalor
	const trace = cov_xx + cov_yy;
	const det = cov_xx*cov_yy - cov_xy*cov_xy;
	const temp = Math.sqrt(Math.max(0, trace*trace/4 - det));
	const lambda1 = trace/2 + temp; // maior
	const evx = (lambda1 - cov_yy !== 0) ? cov_xy : 1;
	const evy = (lambda1 - cov_yy !== 0) ? (lambda1 - cov_xx) : 0;
	let len = Math.hypot(evx, evy);
	if (len === 0) return false;
	const ax = evx/len, ay = evy/len; // direção
	// distância média perpendicular
	let sumAbs = 0, minT=Infinity, maxT=-Infinity;
	for (const p of pts) {
		const rx = p.x - mean.x, ry = p.y - mean.y;
		const t = rx*ax + ry*ay;
		const px = mean.x + ax*t, py = mean.y + ay*t;
		const d = Math.hypot(p.x - px, p.y - py);
		sumAbs += d;
		if (t < minT) minT = t;
		if (t > maxT) maxT = t;
	}
	const avgPerp = sumAbs / pts.length;
	const lineLen = Math.max(24, maxT - minT);
	if (avgPerp > Math.max(3, 0.06 * lineLen)) return false;
	// Substitui por linha reta entre extremos projetados
	const p1 = { x: mean.x + ax*minT, y: mean.y + ay*minT };
	const p2 = { x: mean.x + ax*maxT, y: mean.y + ay*maxT };
	penShape.type = 'line';
	delete penShape.points;
	penShape.points = [p1, p2];
	penShape.selected = true;
	return true;
}
function updateActiveShape(id, sx, sy, px, py, angleSnap, keepProportion) {
	const s = getById(id);
	if (!s) return;
	if (s.type === 'pen') {
		const last = s.points[s.points.length - 1];
		const dx = px - last.x, dy = py - last.y;
		// evita oversampling
		if (dx*dx + dy*dy > 2) s.points.push({ x: px, y: py });
	} else if (s.type === 'line') {
		let x2 = px, y2 = py;
		if (angleSnap) {
			const ang = Math.atan2(py - sy, px - sx);
			const snapped = snapAngle(ang);
			const len = Math.hypot(px - sx, py - sy);
			x2 = sx + Math.cos(snapped) * len;
			y2 = sy + Math.sin(snapped) * len;
		}
		s.points[0] = { x: sx, y: sy };
		s.points[1] = { x: x2, y: y2 };
	} else if (s.type === 'rect' || s.type === 'ellipse') {
		let x2 = px, y2 = py;
		if (keepProportion) {
			// mantém proporção para quadrado/círculo (apenas quando pedido)
			const w = Math.abs(px - sx);
			const h = Math.abs(py - sy);
			const m = Math.max(w, h);
			x2 = sx + Math.sign(px - sx) * m;
			y2 = sy + Math.sign(py - sy) * m;
		}
		s.x = Math.min(sx, x2);
		s.y = Math.min(sy, y2);
		s.w = Math.abs(x2 - sx);
		s.h = Math.abs(y2 - sy);
	}
}
function snapAngle(a) {
	// Snaps para 0, 45, 90, 135, ... (em radianos)
	const step = Math.PI / 4;
	return Math.round(a / step) * step;
}

function render() {
	ctx.clearRect(0, 0, canvas.width, canvas.height);
	ctx.lineWidth = 2;
	ctx.lineCap = 'round';
	ctx.lineJoin = 'round';
	for (const s of shapes) {
		ctx.strokeStyle = s.selected ? '#4cc9f0' : (s.stroke || '#e8ecf1');
		if (s.type === 'pen' || s.type === 'line') {
			ctx.beginPath();
			ctx.moveTo(s.points[0].x, s.points[0].y);
			for (let i = 1; i < s.points.length; i++) ctx.lineTo(s.points[i].x, s.points[i].y);
			ctx.stroke();
		} else if (s.type === 'rect') {
			const rot = s.rot || 0;
			const cx = s.x + s.w/2, cy = s.y + s.h/2;
			ctx.save();
			ctx.translate(cx, cy);
			if (rot) ctx.rotate(rot);
			if (s.fill) { ctx.fillStyle = s.fill; ctx.fillRect(-s.w/2, -s.h/2, s.w, s.h); }
			ctx.strokeRect(-s.w/2, -s.h/2, s.w, s.h);
			ctx.restore();
		} else if (s.type === 'ellipse') {
			const rot = s.rot || 0;
			const cx = s.x + s.w/2, cy = s.y + s.h/2;
			ctx.beginPath();
			ctx.ellipse(cx, cy, Math.abs(s.w)/2, Math.abs(s.h)/2, rot, 0, Math.PI*2);
			if (s.fill) { ctx.fillStyle = s.fill; ctx.fill(); }
			ctx.stroke();
		}
	}
	updateHandles();
}

function updateHandles() {
	handlesEl.innerHTML = '';
	const s = shapes.find(x => x.selected);
	if (!s) return;
	let x = 0, y = 0, w = 0, h = 0;
	if (s.type === 'pen' || s.type === 'line') {
		const xs = s.points.map(p => p.x);
		const ys = s.points.map(p => p.y);
		x = Math.min(...xs); y = Math.min(...ys);
		w = Math.max(...xs) - x; h = Math.max(...ys) - y;
	} else { x = s.x; y = s.y; w = s.w; h = s.h; }
	// quatro cantos para resize
	const corners = [
		{x, y, key:'nw', cursor:'nwse-resize'},
		{x: x+w, y, key:'ne', cursor:'nesw-resize'},
		{x, y: y+h, key:'sw', cursor:'nesw-resize'},
		{x: x+w, y: y+h, key:'se', cursor:'nwse-resize'}
	];
	for (const c of corners) {
		const el = document.createElement('div');
		el.className = 'handle';
		el.style.left = `${c.x - 4}px`;
		el.style.top = `${c.y - 4}px`;
		el.style.cursor = c.cursor;
		el.dataset.handle = c.key;
		el.dataset.mode = 'resize';
		handlesEl.appendChild(el);
	}
	// handle de rotação (topo central, deslocado para cima)
	const rot = document.createElement('div');
	rot.className = 'handle rot';
	const rcx = x + w/2;
	const rcy = y - 36;
	rot.style.left = `${rcx - 6}px`;
	rot.style.top = `${rcy - 6}px`;
	rot.dataset.handle = 'rot';
	rot.dataset.mode = 'rotate';
	handlesEl.appendChild(rot);
}


// Utilitários
function rotatePoint(p, cx, cy, a) {
	const cos = Math.cos(a), sin = Math.sin(a);
	const dx = p.x - cx, dy = p.y - cy;
	return { x: cx + dx*cos - dy*sin, y: cy + dx*sin + dy*cos };
}
function getShapeBounds(s) {
	if (!s) return { x:0, y:0, w:0, h:0 };
	if (s.type === 'rect' || s.type === 'ellipse') {
		return { x: s.x, y: s.y, w: s.w, h: s.h };
	}
	if (s.points && s.points.length) {
		const xs = s.points.map(p=>p.x), ys = s.points.map(p=>p.y);
		const minX = Math.min(...xs), minY = Math.min(...ys);
		const maxX = Math.max(...xs), maxY = Math.max(...ys);
		return { x:minX, y:minY, w: maxX-minX, h: maxY-minY };
	}
	return { x:0, y:0, w:0, h:0 };
}

