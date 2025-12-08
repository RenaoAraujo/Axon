(() => {
	const STORAGE_KEY = 'axonPCB.v1';
	const canvas = document.getElementById('pcb-canvas');
	const ctx = canvas.getContext('2d');
	const cursorPosEl = document.getElementById('cursor-pos');
	const zoomLevelEl = document.getElementById('zoom-level');
	const selectionInfoEl = document.getElementById('selection-info');
	const layerSelect = document.getElementById('layer-select');
	const traceWidthSelect = document.getElementById('trace-width');
	const gridSizeSelect = document.getElementById('grid-size');
	const snapToGridCheckbox = document.getElementById('snap-to-grid');
	const componentsPanel = document.getElementById('components-panel');
	const propertiesPanel = document.getElementById('properties-panel');
	const exportModal = document.getElementById('export-modal');
	const layersModal = document.getElementById('layers-modal');

	if (!canvas) return;

	// Estado do editor
	let state = {
		elements: [],
		selectedIds: new Set(),
		selectedPadRef: null, // { elementId, padIndex }
		highlightNet: null,
		drcIssues: [],
		drc: {
			minTraceWidth: 0.25,        // mm
			minClearance: 0.2,          // mm - trilha↔trilha
			padTraceClearance: 0.2,     // mm - pad↔trilha
			componentClearance: 0.2,    // mm - bounding box de componentes
			viaClearance: 0.2           // mm - via↔via
		},
		currentTool: 'select',
		currentLayer: 'top',
		traceWidth: 0.3,
		padDiameter: 1.5,
		viaDiameter: 0.8,
		viaHoleDiameter: 0.4,
		gridSize: 1.0,
		snapToGrid: true,
		zoom: 1.0,
		panX: 0,
		panY: 0,
		layerVisibility: {
			top: true,
			bottom: true,
			'silk-top': true,
			'silk-bottom': true,
			drill: true,
			outline: true
		},
		layerOpacity: {
			top: 1.0,
			bottom: 1.0,
			'silk-top': 1.0,
			'silk-bottom': 1.0,
			drill: 1.0,
			outline: 1.0
		}
	};

	// Sistema de histórico para undo/redo
	let history = [];
	let historyIndex = -1;
	const MAX_HISTORY = 50;

	function saveHistoryState() {
		// Remove estados futuros se estamos no meio do histórico
		if (historyIndex < history.length - 1) {
			history = history.slice(0, historyIndex + 1);
		}
		
		// Salva o estado atual
		const stateCopy = {
			elements: JSON.parse(JSON.stringify(state.elements))
		};
		
		history.push(stateCopy);
		
		// Limita o tamanho do histórico
		if (history.length > MAX_HISTORY) {
			history.shift();
		} else {
			historyIndex++;
		}
	}

	function selectWithinRect(x1, y1, x2, y2, additive = false) {
		const minX = Math.min(x1, x2);
		const maxX = Math.max(x1, x2);
		const minY = Math.min(y1, y2);
		const maxY = Math.max(y1, y2);
		const inside = (x, y) => x >= minX && x <= maxX && y >= minY && y <= maxY;

		if (!additive) state.selectedIds.clear();

		for (const el of state.elements) {
			if (el.type === 'component') {
				const comp = COMPONENT_LIBRARY[el.componentId];
				const pads = el.pads && Array.isArray(el.pads) ? el.pads : (comp ? comp.pads : []);
				let bbMinX = Infinity, bbMinY = Infinity, bbMaxX = -Infinity, bbMaxY = -Infinity;
				pads.forEach(p => {
					const cx = el.x + p.x;
					const cy = el.y + p.y;
					bbMinX = Math.min(bbMinX, cx - (p.width || p.diameter || 1) / 2);
					bbMaxX = Math.max(bbMaxX, cx + (p.width || p.diameter || 1) / 2);
					bbMinY = Math.min(bbMinY, cy - (p.height || p.diameter || 1) / 2);
					bbMaxY = Math.max(bbMaxY, cy + (p.height || p.diameter || 1) / 2);
				});
				if (!pads.length) {
					bbMinX = el.x - 0.5; bbMaxX = el.x + 0.5;
					bbMinY = el.y - 0.5; bbMaxY = el.y + 0.5;
				}
				// Interseção AABB
				const overlap = !(bbMaxX < minX || bbMinX > maxX || bbMaxY < minY || bbMinY > maxY);
				if (overlap) state.selectedIds.add(el.id);
			} else if (el.type === 'pad' || el.type === 'via') {
				const r = (el.diameter || 1.5) / 2;
				const cx = Math.max(minX, Math.min(el.x, maxX));
				const cy = Math.max(minY, Math.min(el.y, maxY));
				const d = Math.hypot(cx - el.x, cy - el.y);
				if (d <= r || inside(el.x, el.y)) state.selectedIds.add(el.id);
			} else if (el.type === 'trace') {
				if (el.points && el.points.length >= 2) {
					let hit = false;
					for (let i = 0; i < el.points.length - 1 && !hit; i++) {
						const [sx1, sy1] = el.points[i];
						const [sx2, sy2] = el.points[i + 1];
						const d = distSegRect(sx1, sy1, sx2, sy2, (minX + maxX) / 2, (minY + maxY) / 2, maxX - minX, maxY - minY);
						if (d === 0 || inside(sx1, sy1) || inside(sx2, sy2)) hit = true;
					}
					if (hit) state.selectedIds.add(el.id);
				} else {
					const d = distSegRect(el.x1, el.y1, el.x2, el.y2, (minX + maxX) / 2, (minY + maxY) / 2, maxX - minX, maxY - minY);
					if (d === 0 || inside(el.x1, el.y1) || inside(el.x2, el.y2)) state.selectedIds.add(el.id);
				}
			} else if (el.type === 'text') {
				const w = (el.size || 1.6) * (el.text?.length || 1);
				const h = (el.size || 1.6);
				const bbMinX = el.x - w / 2, bbMaxX = el.x + w / 2;
				const bbMinY = el.y - h / 2, bbMaxY = el.y + h / 2;
				const overlap = !(bbMaxX < minX || bbMinX > maxX || bbMaxY < minY || bbMinY > maxY);
				if (overlap) state.selectedIds.add(el.id);
			} else if (el.type === 'measure') {
				const d = distSegRect(el.x1, el.y1, el.x2, el.y2, (minX + maxX) / 2, (minY + maxY) / 2, maxX - minX, maxY - minY);
				if (d === 0 || inside(el.x1, el.y1) || inside(el.x2, el.y2)) state.selectedIds.add(el.id);
			}
		}
	}

	function undo() {
		if (historyIndex > 0) {
			historyIndex--;
			const previousState = history[historyIndex];
			state.elements = JSON.parse(JSON.stringify(previousState.elements));
			state.selectedIds.clear();
			render();
			saveState();
		}
	}

	function redo() {
		if (historyIndex < history.length - 1) {
			historyIndex++;
			const nextState = history[historyIndex];
			state.elements = JSON.parse(JSON.stringify(nextState.elements));
			state.selectedIds.clear();
			render();
			saveState();
		}
	}

	// Ferramentas temporárias
	let tempElement = null;
	let isDragging = false;
	let isPanning = false;
	let dragStartX = 0;
	let dragStartY = 0;
	let lastMouseX = 0;
	let lastMouseY = 0;
	let dragPrevX = null;
	let dragPrevY = null;
	let dragHistorySaved = false;
	let dragHasMoved = false;
	let isSelectingRect = false;
	let rectStartX = 0, rectStartY = 0, rectCurX = 0, rectCurY = 0;

	// Cores das camadas
	const LAYER_COLORS = {
		top: '#DC2626',
		bottom: '#2563EB',
		'silk-top': '#FFFFFF',
		'silk-bottom': '#FCD34D',
		drill: '#000000',
		outline: '#22C55E'
	};

	// Biblioteca de componentes
	const COMPONENT_LIBRARY = {
		'resistor-0805': {
			name: 'Resistor 0805',
			pads: [
				{ x: -1.0, y: 0, width: 1.2, height: 1.4 },
				{ x: 1.0, y: 0, width: 1.2, height: 1.4 }
			],
			silk: [
				{ type: 'rect', x: -0.5, y: -0.6, width: 1.0, height: 1.2 }
			]
		},
		'resistor-1206': {
			name: 'Resistor 1206',
			pads: [
				{ x: -1.5, y: 0, width: 1.4, height: 1.7 },
				{ x: 1.5, y: 0, width: 1.4, height: 1.7 }
			],
			silk: [
				{ type: 'rect', x: -1.0, y: -0.8, width: 2.0, height: 1.6 }
			]
		},
		'cap-0805': {
			name: 'Capacitor 0805',
			pads: [
				{ x: -1.0, y: 0, width: 1.2, height: 1.4 },
				{ x: 1.0, y: 0, width: 1.2, height: 1.4 }
			],
			silk: [
				{ type: 'rect', x: -0.5, y: -0.6, width: 1.0, height: 1.2 }
			]
		},
		'dip-8': {
			name: 'DIP-8',
			pads: [
				{ x: -3.81, y: -7.62, width: 1.5, height: 1.5, hole: 0.8 },
				{ x: -1.27, y: -7.62, width: 1.5, height: 1.5, hole: 0.8 },
				{ x: 1.27, y: -7.62, width: 1.5, height: 1.5, hole: 0.8 },
				{ x: 3.81, y: -7.62, width: 1.5, height: 1.5, hole: 0.8 },
				{ x: 3.81, y: 7.62, width: 1.5, height: 1.5, hole: 0.8 },
				{ x: 1.27, y: 7.62, width: 1.5, height: 1.5, hole: 0.8 },
				{ x: -1.27, y: 7.62, width: 1.5, height: 1.5, hole: 0.8 },
				{ x: -3.81, y: 7.62, width: 1.5, height: 1.5, hole: 0.8 }
			],
			silk: [
				{ type: 'rect', x: -5.0, y: -9.0, width: 10.0, height: 18.0 },
				{ type: 'arc', x: -3.5, y: -8.0, radius: 0.8 }
			]
		},
		'soic-8': {
			name: 'SOIC-8',
			pads: [
				{ x: -2.7, y: -1.905, width: 1.5, height: 0.6 },
				{ x: -2.7, y: -0.635, width: 1.5, height: 0.6 },
				{ x: -2.7, y: 0.635, width: 1.5, height: 0.6 },
				{ x: -2.7, y: 1.905, width: 1.5, height: 0.6 },
				{ x: 2.7, y: 1.905, width: 1.5, height: 0.6 },
				{ x: 2.7, y: 0.635, width: 1.5, height: 0.6 },
				{ x: 2.7, y: -0.635, width: 1.5, height: 0.6 },
				{ x: 2.7, y: -1.905, width: 1.5, height: 0.6 }
			],
			silk: [
				{ type: 'rect', x: -2.0, y: -2.5, width: 4.0, height: 5.0 },
				{ type: 'circle', x: -1.5, y: -2.2, radius: 0.3 }
			]
		},
		'led-0805': {
			name: 'LED 0805',
			pads: [
				{ x: -1.0, y: 0, width: 1.2, height: 1.4 },
				{ x: 1.0, y: 0, width: 1.2, height: 1.4 }
			],
			silk: [
				{ type: 'rect', x: -0.5, y: -0.6, width: 1.0, height: 1.2 },
				{ type: 'line', x1: 0.3, y1: -0.6, x2: 0.3, y2: 0.6 }
			]
		},
		'header-1x2': {
			name: 'Header 1x2',
			pads: [
				{ x: 0, y: -1.27, width: 1.5, height: 1.5, hole: 1.0 },
				{ x: 0, y: 1.27, width: 1.5, height: 1.5, hole: 1.0 }
			],
			silk: [
				{ type: 'rect', x: -1.27, y: -2.54, width: 2.54, height: 5.08 }
			]
		},
		'usb-c': {
			name: 'USB Type-C',
			pads: [
				{ x: -3.2, y: 0, width: 0.6, height: 1.15 },
				{ x: -2.4, y: 0, width: 0.3, height: 0.7 },
				{ x: -1.6, y: 0, width: 0.3, height: 0.7 },
				{ x: -0.8, y: 0, width: 0.3, height: 0.7 },
				{ x: 0, y: 0, width: 0.3, height: 0.7 },
				{ x: 0.8, y: 0, width: 0.3, height: 0.7 },
				{ x: 1.6, y: 0, width: 0.3, height: 0.7 },
				{ x: 2.4, y: 0, width: 0.3, height: 0.7 },
				{ x: 3.2, y: 0, width: 0.6, height: 1.15 }
			],
			silk: [
				{ type: 'rect', x: -4.5, y: -3.5, width: 9.0, height: 7.0 }
			]
		},
		// Mais Resistores
		'resistor-0603': {
			name: 'Resistor 0603',
			pads: [
				{ x: -0.75, y: 0, width: 1.0, height: 1.2 },
				{ x: 0.75, y: 0, width: 1.0, height: 1.2 }
			],
			silk: [
				{ type: 'rect', x: -0.4, y: -0.5, width: 0.8, height: 1.0 }
			]
		},
		'resistor-0402': {
			name: 'Resistor 0402',
			pads: [
				{ x: -0.5, y: 0, width: 0.8, height: 1.0 },
				{ x: 0.5, y: 0, width: 0.8, height: 1.0 }
			],
			silk: [
				{ type: 'rect', x: -0.3, y: -0.4, width: 0.6, height: 0.8 }
			]
		},
		'resistor-2512': {
			name: 'Resistor 2512 (Power)',
			pads: [
				{ x: -2.0, y: 0, width: 1.6, height: 2.0 },
				{ x: 2.0, y: 0, width: 1.6, height: 2.0 }
			],
			silk: [
				{ type: 'rect', x: -1.5, y: -1.0, width: 3.0, height: 2.0 }
			]
		},
		'resistor-th': {
			name: 'Resistor Through-hole',
			pads: [
				{ x: -5.08, y: 0, width: 1.5, height: 1.5, hole: 1.0 },
				{ x: 5.08, y: 0, width: 1.5, height: 1.5, hole: 1.0 }
			],
			silk: [
				{ type: 'rect', x: -2.5, y: -1.5, width: 5.0, height: 3.0 }
			]
		},
		// Mais Capacitores
		'cap-0603': {
			name: 'Capacitor 0603',
			pads: [
				{ x: -0.75, y: 0, width: 1.0, height: 1.2 },
				{ x: 0.75, y: 0, width: 1.0, height: 1.2 }
			],
			silk: [
				{ type: 'rect', x: -0.4, y: -0.5, width: 0.8, height: 1.0 }
			]
		},
		'cap-1206': {
			name: 'Capacitor 1206',
			pads: [
				{ x: -1.5, y: 0, width: 1.4, height: 1.7 },
				{ x: 1.5, y: 0, width: 1.4, height: 1.7 }
			],
			silk: [
				{ type: 'rect', x: -1.0, y: -0.8, width: 2.0, height: 1.6 }
			]
		},
		'cap-elec': {
			name: 'Capacitor Eletrolítico',
			pads: [
				{ x: -2.54, y: 0, width: 1.5, height: 1.5, hole: 1.0 },
				{ x: 2.54, y: 0, width: 1.5, height: 1.5, hole: 1.0 }
			],
			silk: [
				{ type: 'circle', x: -2.54, y: 0, radius: 2.0 },
				{ type: 'line', x1: -2.54, y1: -2.0, x2: -2.54, y2: 2.0 }
			]
		},
		'cap-tantalum': {
			name: 'Capacitor Tântalo',
			pads: [
				{ x: -1.5, y: 0, width: 1.2, height: 1.8 },
				{ x: 1.5, y: 0, width: 1.2, height: 1.8 }
			],
			silk: [
				{ type: 'rect', x: -1.0, y: -1.0, width: 2.0, height: 2.0 },
				{ type: 'line', x1: 0.5, y1: -1.0, x2: 0.5, y2: 1.0 }
			]
		},
		// Diodos
		'diode-sod123': {
			name: 'Diodo SOD-123',
			pads: [
				{ x: -1.0, y: 0, width: 1.2, height: 1.4 },
				{ x: 1.0, y: 0, width: 1.2, height: 1.4 }
			],
			silk: [
				{ type: 'rect', x: -0.5, y: -0.6, width: 1.0, height: 1.2 },
				{ type: 'line', x1: 0.2, y1: -0.6, x2: 0.2, y2: 0.6 }
			]
		},
		'diode-sma': {
			name: 'Diodo SMA',
			pads: [
				{ x: -1.5, y: 0, width: 1.4, height: 1.7 },
				{ x: 1.5, y: 0, width: 1.4, height: 1.7 }
			],
			silk: [
				{ type: 'rect', x: -1.0, y: -0.8, width: 2.0, height: 1.6 },
				{ type: 'line', x1: 0.3, y1: -0.8, x2: 0.3, y2: 0.8 }
			]
		},
		'diode-th': {
			name: 'Diodo Through-hole',
			pads: [
				{ x: -5.08, y: 0, width: 1.5, height: 1.5, hole: 1.0 },
				{ x: 5.08, y: 0, width: 1.5, height: 1.5, hole: 1.0 }
			],
			silk: [
				{ type: 'rect', x: -2.0, y: -1.0, width: 4.0, height: 2.0 },
				{ type: 'line', x1: 1.0, y1: -1.0, x2: 1.0, y2: 1.0 }
			]
		},
		// LEDs
		'led-0603': {
			name: 'LED 0603',
			pads: [
				{ x: -0.75, y: 0, width: 1.0, height: 1.2 },
				{ x: 0.75, y: 0, width: 1.0, height: 1.2 }
			],
			silk: [
				{ type: 'rect', x: -0.4, y: -0.5, width: 0.8, height: 1.0 },
				{ type: 'line', x1: 0.2, y1: -0.5, x2: 0.2, y2: 0.5 }
			]
		},
		'led-1206': {
			name: 'LED 1206',
			pads: [
				{ x: -1.5, y: 0, width: 1.4, height: 1.7 },
				{ x: 1.5, y: 0, width: 1.4, height: 1.7 }
			],
			silk: [
				{ type: 'rect', x: -1.0, y: -0.8, width: 2.0, height: 1.6 },
				{ type: 'line', x1: 0.3, y1: -0.8, x2: 0.3, y2: 0.8 }
			]
		},
		'led-th': {
			name: 'LED Through-hole 5mm',
			pads: [
				{ x: -2.54, y: 0, width: 1.5, height: 1.5, hole: 1.0 },
				{ x: 2.54, y: 0, width: 1.5, height: 1.5, hole: 1.0 }
			],
			silk: [
				{ type: 'circle', x: 0, y: 0, radius: 2.5 },
				{ type: 'line', x1: 1.0, y1: -2.0, x2: 1.0, y2: 2.0 }
			]
		},
		// Transistores
		'transistor-sot23': {
			name: 'Transistor SOT-23',
			pads: [
				{ x: -0.95, y: -0.65, width: 0.6, height: 0.6 },
				{ x: -0.95, y: 0.65, width: 0.6, height: 0.6 },
				{ x: 0.95, y: 0, width: 0.6, height: 0.6 }
			],
			silk: [
				{ type: 'rect', x: -1.5, y: -1.0, width: 3.0, height: 2.0 }
			]
		},
		'transistor-to92': {
			name: 'Transistor TO-92',
			pads: [
				{ x: -2.54, y: 0, width: 1.5, height: 1.5, hole: 1.0 },
				{ x: 0, y: -2.54, width: 1.5, height: 1.5, hole: 1.0 },
				{ x: 2.54, y: 0, width: 1.5, height: 1.5, hole: 1.0 }
			],
			silk: [
				{ type: 'rect', x: -3.0, y: -3.0, width: 6.0, height: 6.0 }
			]
		},
		// Mais CIs
		'dip-14': {
			name: 'DIP-14',
			pads: [
				{ x: -3.81, y: -7.62, width: 1.5, height: 1.5, hole: 0.8 },
				{ x: -1.27, y: -7.62, width: 1.5, height: 1.5, hole: 0.8 },
				{ x: 1.27, y: -7.62, width: 1.5, height: 1.5, hole: 0.8 },
				{ x: 3.81, y: -7.62, width: 1.5, height: 1.5, hole: 0.8 },
				{ x: 3.81, y: -2.54, width: 1.5, height: 1.5, hole: 0.8 },
				{ x: 3.81, y: 0, width: 1.5, height: 1.5, hole: 0.8 },
				{ x: 3.81, y: 2.54, width: 1.5, height: 1.5, hole: 0.8 },
				{ x: 3.81, y: 7.62, width: 1.5, height: 1.5, hole: 0.8 },
				{ x: 1.27, y: 7.62, width: 1.5, height: 1.5, hole: 0.8 },
				{ x: -1.27, y: 7.62, width: 1.5, height: 1.5, hole: 0.8 },
				{ x: -3.81, y: 7.62, width: 1.5, height: 1.5, hole: 0.8 },
				{ x: -3.81, y: 2.54, width: 1.5, height: 1.5, hole: 0.8 },
				{ x: -3.81, y: 0, width: 1.5, height: 1.5, hole: 0.8 },
				{ x: -3.81, y: -2.54, width: 1.5, height: 1.5, hole: 0.8 }
			],
			silk: [
				{ type: 'rect', x: -5.0, y: -9.0, width: 10.0, height: 18.0 },
				{ type: 'arc', x: -3.5, y: -8.0, radius: 0.8 }
			]
		},
		'dip-16': {
			name: 'DIP-16',
			pads: [
				{ x: -3.81, y: -7.62, width: 1.5, height: 1.5, hole: 0.8 },
				{ x: -1.27, y: -7.62, width: 1.5, height: 1.5, hole: 0.8 },
				{ x: 1.27, y: -7.62, width: 1.5, height: 1.5, hole: 0.8 },
				{ x: 3.81, y: -7.62, width: 1.5, height: 1.5, hole: 0.8 },
				{ x: 3.81, y: -5.08, width: 1.5, height: 1.5, hole: 0.8 },
				{ x: 3.81, y: -2.54, width: 1.5, height: 1.5, hole: 0.8 },
				{ x: 3.81, y: 0, width: 1.5, height: 1.5, hole: 0.8 },
				{ x: 3.81, y: 2.54, width: 1.5, height: 1.5, hole: 0.8 },
				{ x: 3.81, y: 5.08, width: 1.5, height: 1.5, hole: 0.8 },
				{ x: 3.81, y: 7.62, width: 1.5, height: 1.5, hole: 0.8 },
				{ x: 1.27, y: 7.62, width: 1.5, height: 1.5, hole: 0.8 },
				{ x: -1.27, y: 7.62, width: 1.5, height: 1.5, hole: 0.8 },
				{ x: -3.81, y: 7.62, width: 1.5, height: 1.5, hole: 0.8 },
				{ x: -3.81, y: 5.08, width: 1.5, height: 1.5, hole: 0.8 },
				{ x: -3.81, y: 2.54, width: 1.5, height: 1.5, hole: 0.8 },
				{ x: -3.81, y: 0, width: 1.5, height: 1.5, hole: 0.8 },
				{ x: -3.81, y: -2.54, width: 1.5, height: 1.5, hole: 0.8 },
				{ x: -3.81, y: -5.08, width: 1.5, height: 1.5, hole: 0.8 }
			],
			silk: [
				{ type: 'rect', x: -5.0, y: -9.0, width: 10.0, height: 18.0 },
				{ type: 'arc', x: -3.5, y: -8.0, radius: 0.8 }
			]
		},
		'soic-14': {
			name: 'SOIC-14',
			pads: [
				{ x: -3.9, y: -1.905, width: 1.5, height: 0.6 },
				{ x: -3.9, y: -0.635, width: 1.5, height: 0.6 },
				{ x: -3.9, y: 0.635, width: 1.5, height: 0.6 },
				{ x: -3.9, y: 1.905, width: 1.5, height: 0.6 },
				{ x: -3.9, y: 3.175, width: 1.5, height: 0.6 },
				{ x: -3.9, y: 4.445, width: 1.5, height: 0.6 },
				{ x: -3.9, y: 5.715, width: 1.5, height: 0.6 },
				{ x: 3.9, y: 5.715, width: 1.5, height: 0.6 },
				{ x: 3.9, y: 4.445, width: 1.5, height: 0.6 },
				{ x: 3.9, y: 3.175, width: 1.5, height: 0.6 },
				{ x: 3.9, y: 1.905, width: 1.5, height: 0.6 },
				{ x: 3.9, y: 0.635, width: 1.5, height: 0.6 },
				{ x: 3.9, y: -0.635, width: 1.5, height: 0.6 },
				{ x: 3.9, y: -1.905, width: 1.5, height: 0.6 }
			],
			silk: [
				{ type: 'rect', x: -2.5, y: -2.5, width: 5.0, height: 8.5 },
				{ type: 'circle', x: -2.0, y: -2.2, radius: 0.3 }
			]
		},
		'soic-16': {
			name: 'SOIC-16',
			pads: [
				{ x: -3.9, y: -2.54, width: 1.5, height: 0.6 },
				{ x: -3.9, y: -1.27, width: 1.5, height: 0.6 },
				{ x: -3.9, y: 0, width: 1.5, height: 0.6 },
				{ x: -3.9, y: 1.27, width: 1.5, height: 0.6 },
				{ x: -3.9, y: 2.54, width: 1.5, height: 0.6 },
				{ x: -3.9, y: 3.81, width: 1.5, height: 0.6 },
				{ x: -3.9, y: 5.08, width: 1.5, height: 0.6 },
				{ x: -3.9, y: 6.35, width: 1.5, height: 0.6 },
				{ x: 3.9, y: 6.35, width: 1.5, height: 0.6 },
				{ x: 3.9, y: 5.08, width: 1.5, height: 0.6 },
				{ x: 3.9, y: 3.81, width: 1.5, height: 0.6 },
				{ x: 3.9, y: 2.54, width: 1.5, height: 0.6 },
				{ x: 3.9, y: 1.27, width: 1.5, height: 0.6 },
				{ x: 3.9, y: 0, width: 1.5, height: 0.6 },
				{ x: 3.9, y: -1.27, width: 1.5, height: 0.6 },
				{ x: 3.9, y: -2.54, width: 1.5, height: 0.6 }
			],
			silk: [
				{ type: 'rect', x: -2.5, y: -3.0, width: 5.0, height: 9.5 },
				{ type: 'circle', x: -2.0, y: -2.7, radius: 0.3 }
			]
		},
		'qfp-32': {
			name: 'QFP-32',
			pads: (() => {
				const pads = [];
				const pitch = 0.8;
				const size = 5.0;
				for (let i = 0; i < 8; i++) {
					pads.push({ x: -size/2 + i * pitch, y: -size/2, width: 0.5, height: 0.3 });
					pads.push({ x: size/2, y: -size/2 + i * pitch, width: 0.3, height: 0.5 });
					pads.push({ x: size/2 - i * pitch, y: size/2, width: 0.5, height: 0.3 });
					pads.push({ x: -size/2, y: size/2 - i * pitch, width: 0.3, height: 0.5 });
				}
				return pads;
			})(),
			silk: [
				{ type: 'rect', x: -2.5, y: -2.5, width: 5.0, height: 5.0 },
				{ type: 'circle', x: -2.0, y: -2.2, radius: 0.2 }
			]
		},
		'qfn-16': {
			name: 'QFN-16',
			pads: (() => {
				const pads = [];
				const pitch = 0.65;
				const size = 3.0;
				for (let i = 0; i < 4; i++) {
					pads.push({ x: -size/2 + i * pitch, y: -size/2, width: 0.4, height: 0.25 });
					pads.push({ x: size/2, y: -size/2 + i * pitch, width: 0.25, height: 0.4 });
					pads.push({ x: size/2 - i * pitch, y: size/2, width: 0.4, height: 0.25 });
					pads.push({ x: -size/2, y: size/2 - i * pitch, width: 0.25, height: 0.4 });
				}
				return pads;
			})(),
			silk: [
				{ type: 'rect', x: -1.5, y: -1.5, width: 3.0, height: 3.0 },
				{ type: 'circle', x: -1.2, y: -1.2, radius: 0.2 }
			]
		},
		// Conectores
		'header-1x3': {
			name: 'Header 1x3',
			pads: [
				{ x: 0, y: -2.54, width: 1.5, height: 1.5, hole: 1.0 },
				{ x: 0, y: 0, width: 1.5, height: 1.5, hole: 1.0 },
				{ x: 0, y: 2.54, width: 1.5, height: 1.5, hole: 1.0 }
			],
			silk: [
				{ type: 'rect', x: -1.27, y: -3.81, width: 2.54, height: 7.62 }
			]
		},
		'header-1x4': {
			name: 'Header 1x4',
			pads: [
				{ x: 0, y: -3.81, width: 1.5, height: 1.5, hole: 1.0 },
				{ x: 0, y: -1.27, width: 1.5, height: 1.5, hole: 1.0 },
				{ x: 0, y: 1.27, width: 1.5, height: 1.5, hole: 1.0 },
				{ x: 0, y: 3.81, width: 1.5, height: 1.5, hole: 1.0 }
			],
			silk: [
				{ type: 'rect', x: -1.27, y: -5.08, width: 2.54, height: 10.16 }
			]
		},
		'header-2x3': {
			name: 'Header 2x3',
			pads: [
				{ x: -2.54, y: -2.54, width: 1.5, height: 1.5, hole: 1.0 },
				{ x: -2.54, y: 0, width: 1.5, height: 1.5, hole: 1.0 },
				{ x: -2.54, y: 2.54, width: 1.5, height: 1.5, hole: 1.0 },
				{ x: 2.54, y: -2.54, width: 1.5, height: 1.5, hole: 1.0 },
				{ x: 2.54, y: 0, width: 1.5, height: 1.5, hole: 1.0 },
				{ x: 2.54, y: 2.54, width: 1.5, height: 1.5, hole: 1.0 }
			],
			silk: [
				{ type: 'rect', x: -3.81, y: -3.81, width: 7.62, height: 7.62 }
			]
		},
		'header-2x4': {
			name: 'Header 2x4',
			pads: [
				{ x: -2.54, y: -3.81, width: 1.5, height: 1.5, hole: 1.0 },
				{ x: -2.54, y: -1.27, width: 1.5, height: 1.5, hole: 1.0 },
				{ x: -2.54, y: 1.27, width: 1.5, height: 1.5, hole: 1.0 },
				{ x: -2.54, y: 3.81, width: 1.5, height: 1.5, hole: 1.0 },
				{ x: 2.54, y: -3.81, width: 1.5, height: 1.5, hole: 1.0 },
				{ x: 2.54, y: -1.27, width: 1.5, height: 1.5, hole: 1.0 },
				{ x: 2.54, y: 1.27, width: 1.5, height: 1.5, hole: 1.0 },
				{ x: 2.54, y: 3.81, width: 1.5, height: 1.5, hole: 1.0 }
			],
			silk: [
				{ type: 'rect', x: -3.81, y: -5.08, width: 7.62, height: 10.16 }
			]
		},
		'usb-a': {
			name: 'USB-A',
			pads: [
				{ x: -3.0, y: 0, width: 1.0, height: 2.0 },
				{ x: -1.0, y: 0, width: 1.0, height: 2.0 },
				{ x: 1.0, y: 0, width: 1.0, height: 2.0 },
				{ x: 3.0, y: 0, width: 1.0, height: 2.0 }
			],
			silk: [
				{ type: 'rect', x: -6.0, y: -4.0, width: 12.0, height: 8.0 }
			]
		},
		'usb-micro': {
			name: 'USB Micro',
			pads: [
				{ x: -1.5, y: 0, width: 0.8, height: 1.5 },
				{ x: -0.5, y: 0, width: 0.8, height: 1.5 },
				{ x: 0.5, y: 0, width: 0.8, height: 1.5 },
				{ x: 1.5, y: 0, width: 0.8, height: 1.5 },
				{ x: 0, y: -2.0, width: 1.2, height: 1.0 }
			],
			silk: [
				{ type: 'rect', x: -3.0, y: -3.0, width: 6.0, height: 6.0 }
			]
		},
		'jack-3.5mm': {
			name: 'Jack 3.5mm',
			pads: [
				{ x: -2.0, y: 0, width: 1.5, height: 1.5, hole: 1.0 },
				{ x: 0, y: 0, width: 1.5, height: 1.5, hole: 1.0 },
				{ x: 2.0, y: 0, width: 1.5, height: 1.5, hole: 1.0 }
			],
			silk: [
				{ type: 'rect', x: -3.5, y: -2.5, width: 7.0, height: 5.0 }
			]
		},
		// Reguladores
		'regulator-7805': {
			name: 'Regulador 7805',
			pads: [
				{ x: -2.54, y: 0, width: 1.5, height: 1.5, hole: 1.0 },
				{ x: 0, y: 0, width: 1.5, height: 1.5, hole: 1.0 },
				{ x: 2.54, y: 0, width: 1.5, height: 1.5, hole: 1.0 }
			],
			silk: [
				{ type: 'rect', x: -4.0, y: -2.0, width: 8.0, height: 4.0 }
			]
		},
		'regulator-sot223': {
			name: 'Regulador SOT-223',
			pads: [
				{ x: -2.3, y: -1.9, width: 1.0, height: 0.6 },
				{ x: -2.3, y: 0, width: 1.0, height: 0.6 },
				{ x: -2.3, y: 1.9, width: 1.0, height: 0.6 },
				{ x: 2.3, y: 0, width: 1.5, height: 2.5 }
			],
			silk: [
				{ type: 'rect', x: -3.0, y: -2.5, width: 6.0, height: 5.0 }
			]
		},
		// Cristais e Osciladores
		'crystal-hc49': {
			name: 'Cristal HC-49',
			pads: [
				{ x: -5.08, y: 0, width: 1.5, height: 1.5, hole: 1.0 },
				{ x: 5.08, y: 0, width: 1.5, height: 1.5, hole: 1.0 }
			],
			silk: [
				{ type: 'rect', x: -6.0, y: -2.5, width: 12.0, height: 5.0 }
			]
		},
		'crystal-smd': {
			name: 'Cristal SMD',
			pads: [
				{ x: -1.5, y: 0, width: 1.2, height: 1.4 },
				{ x: 1.5, y: 0, width: 1.2, height: 1.4 }
			],
			silk: [
				{ type: 'rect', x: -2.0, y: -1.0, width: 4.0, height: 2.0 }
			]
		},
		// Botões e Switches
		'button-tactile': {
			name: 'Botão Táctil 6x6',
			pads: [
				{ x: -2.5, y: -2.5, width: 1.2, height: 1.2 },
				{ x: 2.5, y: -2.5, width: 1.2, height: 1.2 },
				{ x: -2.5, y: 2.5, width: 1.2, height: 1.2 },
				{ x: 2.5, y: 2.5, width: 1.2, height: 1.2 }
			],
			silk: [
				{ type: 'rect', x: -3.0, y: -3.0, width: 6.0, height: 6.0 },
				{ type: 'circle', x: 0, y: 0, radius: 2.0 }
			]
		},
		'switch-toggle': {
			name: 'Switch Toggle',
			pads: [
				{ x: -3.81, y: 0, width: 1.5, height: 1.5, hole: 1.0 },
				{ x: 0, y: 0, width: 1.5, height: 1.5, hole: 1.0 },
				{ x: 3.81, y: 0, width: 1.5, height: 1.5, hole: 1.0 }
			],
			silk: [
				{ type: 'rect', x: -5.0, y: -2.0, width: 10.0, height: 4.0 }
			]
		},
		// Soquetes
		'socket-ic-8': {
			name: 'Soquete IC 8 pinos',
			pads: [
				{ x: -3.81, y: -7.62, width: 1.5, height: 1.5, hole: 1.0 },
				{ x: -1.27, y: -7.62, width: 1.5, height: 1.5, hole: 1.0 },
				{ x: 1.27, y: -7.62, width: 1.5, height: 1.5, hole: 1.0 },
				{ x: 3.81, y: -7.62, width: 1.5, height: 1.5, hole: 1.0 },
				{ x: 3.81, y: 7.62, width: 1.5, height: 1.5, hole: 1.0 },
				{ x: 1.27, y: 7.62, width: 1.5, height: 1.5, hole: 1.0 },
				{ x: -1.27, y: 7.62, width: 1.5, height: 1.5, hole: 1.0 },
				{ x: -3.81, y: 7.62, width: 1.5, height: 1.5, hole: 1.0 }
			],
			silk: [
				{ type: 'rect', x: -5.0, y: -9.0, width: 10.0, height: 18.0 }
			]
		},
		'socket-ic-14': {
			name: 'Soquete IC 14 pinos',
			pads: [
				{ x: -3.81, y: -7.62, width: 1.5, height: 1.5, hole: 1.0 },
				{ x: -1.27, y: -7.62, width: 1.5, height: 1.5, hole: 1.0 },
				{ x: 1.27, y: -7.62, width: 1.5, height: 1.5, hole: 1.0 },
				{ x: 3.81, y: -7.62, width: 1.5, height: 1.5, hole: 1.0 },
				{ x: 3.81, y: -2.54, width: 1.5, height: 1.5, hole: 1.0 },
				{ x: 3.81, y: 0, width: 1.5, height: 1.5, hole: 1.0 },
				{ x: 3.81, y: 2.54, width: 1.5, height: 1.5, hole: 1.0 },
				{ x: 3.81, y: 7.62, width: 1.5, height: 1.5, hole: 1.0 },
				{ x: 1.27, y: 7.62, width: 1.5, height: 1.5, hole: 1.0 },
				{ x: -1.27, y: 7.62, width: 1.5, height: 1.5, hole: 1.0 },
				{ x: -3.81, y: 7.62, width: 1.5, height: 1.5, hole: 1.0 },
				{ x: -3.81, y: 2.54, width: 1.5, height: 1.5, hole: 1.0 },
				{ x: -3.81, y: 0, width: 1.5, height: 1.5, hole: 1.0 },
				{ x: -3.81, y: -2.54, width: 1.5, height: 1.5, hole: 1.0 }
			],
			silk: [
				{ type: 'rect', x: -5.0, y: -9.0, width: 10.0, height: 18.0 }
			]
		}
	};

	// Inicialização
	function init() {
		loadState();
		// Inicializar histórico com estado inicial
		saveHistoryState();
		resizeCanvas();
		setupEventListeners();
		render();
		zoomLevelEl.textContent = `Zoom: x${Math.round(state.zoom * 500)}`;
		
		// Esconder painéis laterais por padrão para maximizar área de desenho
		if (componentsPanel) componentsPanel.hidden = true;
		if (propertiesPanel) propertiesPanel.hidden = true;
		
		window.addEventListener('resize', () => {
			resizeCanvas();
			render();
		});
	}

	function resizeCanvas() {
		const container = canvas.parentElement;
		if (!container) return;
		// Força o recálculo do tamanho do container
		const width = container.clientWidth || container.offsetWidth;
		const height = container.clientHeight || container.offsetHeight;
		canvas.width = width;
		canvas.height = height;
	}

	function setupEventListeners() {
		// Ferramentas
		document.querySelectorAll('.tool-btn').forEach(btn => {
			btn.addEventListener('click', () => {
				document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
				btn.classList.add('active');
				state.currentTool = btn.dataset.tool;
				state.selectedPadRef = null;
				state.highlightNet = null;
				tempElement = null;
			});
		});

		// Camada
		layerSelect.addEventListener('change', (e) => {
			state.currentLayer = e.target.value;
		});

		// Largura da trilha
		traceWidthSelect.addEventListener('change', (e) => {
			state.traceWidth = parseFloat(e.target.value);
		});

		// Tamanho da grade
		gridSizeSelect.addEventListener('change', (e) => {
			state.gridSize = parseFloat(e.target.value);
			render();
		});

		// Snap to grid
		snapToGridCheckbox.addEventListener('change', (e) => {
			state.snapToGrid = e.target.checked;
		});

		// Canvas events
		canvas.addEventListener('mousedown', handleMouseDown);
		canvas.addEventListener('mousemove', handleMouseMove);
		canvas.addEventListener('mouseup', handleMouseUp);
		canvas.addEventListener('wheel', handleWheel, { passive: false });
		canvas.addEventListener('contextmenu', (e) => e.preventDefault());

		// Keyboard shortcuts
		window.addEventListener('keydown', handleKeyDown);

		// Botões
		document.getElementById('btn-components')?.addEventListener('click', toggleComponentsPanel);
		document.getElementById('btn-layers')?.addEventListener('click', () => {
			if (layersModal) {
				layersModal.hidden = false;
				layersModal.style.display = 'flex';
			}
		});
		document.getElementById('btn-export')?.addEventListener('click', () => {
			if (exportModal) {
				exportModal.hidden = false;
				exportModal.style.display = 'flex';
			}
		});
		document.getElementById('btn-clear')?.addEventListener('click', clearAll);

		// Definir NET (cria se não existir no HTML)
		let defineNetBtn = document.getElementById('btn-define-net');
		if (!defineNetBtn) {
			const toolbar = document.querySelector('.pcb-toolbar') || document.querySelector('.pcb-header');
			if (toolbar) {
				defineNetBtn = document.createElement('button');
				defineNetBtn.id = 'btn-define-net';
				defineNetBtn.className = 'pcb-btn';
				defineNetBtn.textContent = 'Definir Net';
				toolbar.appendChild(defineNetBtn);
			}
		}
		defineNetBtn?.addEventListener('click', defineNetForSelection);

		// Controles de tamanho: Pad e Via (criamos se não existir no HTML)
		const toolbar = document.querySelector('.pcb-toolbar') || document.querySelector('.pcb-header');
		if (toolbar) {
			// Botão ferramenta: Linha de contorno (outline)
			if (!document.getElementById('btn-outline')) {
				const btn = document.createElement('button');
				btn.id = 'btn-outline';
				btn.className = 'pcb-btn tool-btn';
				btn.dataset.tool = 'outline';
				btn.textContent = 'Linha (contorno)';
				btn.addEventListener('click', () => {
					state.selectedPadRef = null;
					state.highlightNet = null;
					tempElement = null;
					selectTool('outline');
				});
				toolbar.appendChild(btn);
			}

			// Pad diameter
			if (!document.getElementById('pad-diameter')) {
				const wrap = document.createElement('div');
				wrap.style.display = 'inline-flex';
				wrap.style.alignItems = 'center';
				wrap.style.gap = '6px';
				const label = document.createElement('label');
				label.textContent = 'Pad Ø';
				label.style.color = '#fff';
				const input = document.createElement('input');
				input.type = 'number';
				input.step = '0.1';
				input.min = '0.2';
				input.value = String(state.padDiameter);
				input.style.width = '64px';
				input.id = 'pad-diameter';
				wrap.appendChild(label);
				wrap.appendChild(input);
				toolbar.appendChild(wrap);
				input.addEventListener('input', () => {
					const v = Math.max(0.2, parseFloat(input.value) || state.padDiameter);
					state.padDiameter = v;
					// aplicar em pads selecionados
					state.elements.forEach(el => {
						if (state.selectedIds.has(el.id) && el.type === 'pad') {
							el.diameter = v;
						}
					});
					saveState();
					updateDRC();
					render();
				});
			}
			// Via diameter
			if (!document.getElementById('via-diameter')) {
				const wrap = document.createElement('div');
				wrap.style.display = 'inline-flex';
				wrap.style.alignItems = 'center';
				wrap.style.gap = '6px';
				const label = document.createElement('label');
				label.textContent = 'Via Ø';
				label.style.color = '#fff';
				const input = document.createElement('input');
				input.type = 'number';
				input.step = '0.1';
				input.min = '0.3';
				input.value = String(state.viaDiameter);
				input.style.width = '64px';
				input.id = 'via-diameter';
				wrap.appendChild(label);
				wrap.appendChild(input);
				toolbar.appendChild(wrap);
				input.addEventListener('input', () => {
					let v = Math.max(0.3, parseFloat(input.value) || state.viaDiameter);
					// garantir anel mínimo de 0.1 mm em relação ao furo
					if (v <= state.viaHoleDiameter + 0.1) v = state.viaHoleDiameter + 0.1;
					state.viaDiameter = v;
					state.elements.forEach(el => {
						if (state.selectedIds.has(el.id) && el.type === 'via') {
							el.diameter = v;
							if (el.holeDiameter >= v) el.holeDiameter = Math.max(0.2, v - 0.1);
						}
					});
					saveState();
					updateDRC();
					render();
				});
			}
			// Via hole
			if (!document.getElementById('via-hole')) {
				const wrap = document.createElement('div');
				wrap.style.display = 'inline-flex';
				wrap.style.alignItems = 'center';
				wrap.style.gap = '6px';
				const label = document.createElement('label');
				label.textContent = 'Furo Ø';
				label.style.color = '#fff';
				const input = document.createElement('input');
				input.type = 'number';
				input.step = '0.05';
				input.min = '0.15';
				input.value = String(state.viaHoleDiameter);
				input.style.width = '64px';
				input.id = 'via-hole';
				wrap.appendChild(label);
				wrap.appendChild(input);
				toolbar.appendChild(wrap);
				input.addEventListener('input', () => {
					let v = Math.max(0.15, parseFloat(input.value) || state.viaHoleDiameter);
					// manter furo < diâmetro via (anel mínimo 0.1 mm)
					if (v >= state.viaDiameter - 0.1) v = Math.max(0.15, state.viaDiameter - 0.1);
					state.viaHoleDiameter = v;
					state.elements.forEach(el => {
						if (state.selectedIds.has(el.id) && el.type === 'via') {
							el.holeDiameter = v;
							if (el.holeDiameter >= el.diameter) el.holeDiameter = Math.max(0.15, el.diameter - 0.1);
						}
					});
					saveState();
					updateDRC();
					render();
				});
			}

			// Botão painel DRC
			let drcBtn = document.getElementById('btn-drc');
			if (!drcBtn) {
				drcBtn = document.createElement('button');
				drcBtn.id = 'btn-drc';
				drcBtn.className = 'pcb-btn';
				drcBtn.textContent = 'DRC';
				toolbar.appendChild(drcBtn);
			}
			drcBtn.addEventListener('click', toggleDrcPanel);
		}

		// Componentes
		document.querySelectorAll('.component-item').forEach(btn => {
			btn.addEventListener('click', () => {
				placeComponent(btn.dataset.component);
			});
		});

		// Busca de componentes
		const componentSearch = document.getElementById('component-search');
		if (componentSearch) {
			componentSearch.addEventListener('input', (e) => {
				const query = e.target.value.toLowerCase().trim();
				const items = document.querySelectorAll('.component-item');
				const categories = document.querySelectorAll('.component-category');
				
				if (!query) {
					items.forEach(item => item.style.display = 'block');
					categories.forEach(cat => cat.style.display = 'block');
					return;
				}
				
				let hasVisible = false;
				categories.forEach(cat => {
					const catItems = cat.querySelectorAll('.component-item');
					let catHasVisible = false;
					catItems.forEach(item => {
						const text = item.textContent.toLowerCase();
						if (text.includes(query)) {
							item.style.display = 'block';
							catHasVisible = true;
							hasVisible = true;
						} else {
							item.style.display = 'none';
						}
					});
					cat.style.display = catHasVisible ? 'block' : 'none';
				});
			});
		}

		// Export
		document.getElementById('export-svg')?.addEventListener('click', exportSVG);
		document.getElementById('export-json')?.addEventListener('click', exportJSON);
		document.getElementById('export-png')?.addEventListener('click', exportPNG);

		// Modals
		document.querySelectorAll('[data-action="close-modal"]').forEach(btn => {
			btn.addEventListener('click', (e) => {
				console.log('[PCB] Fechando modal');
				e.preventDefault();
				e.stopPropagation();
				if (exportModal) {
					exportModal.style.display = 'none';
					exportModal.hidden = true;
				}
				if (layersModal) {
					layersModal.style.display = 'none';
					layersModal.hidden = true;
				}
			});
		});

		// Fechar modal ao clicar fora
		if (exportModal) {
			exportModal.addEventListener('click', (e) => {
				if (e.target === exportModal) {
					exportModal.style.display = 'none';
					exportModal.hidden = true;
				}
			});
		}
		if (layersModal) {
			layersModal.addEventListener('click', (e) => {
				if (e.target === layersModal) {
					layersModal.style.display = 'none';
					layersModal.hidden = true;
				}
			});
		}

		// Layer visibility
		document.querySelectorAll('.opacity-slider').forEach(slider => {
			slider.addEventListener('input', (e) => {
				const layer = e.target.dataset.layer;
				state.layerOpacity[layer] = parseFloat(e.target.value) / 100;
				render();
			});
		});
	}

	function hasTraceAtPoint(x, y, checkEndPoint = false) {
		// Tolerância para considerar que uma trilha está conectada ao ponto
		const tolerance = Math.max(0.1, state.traceWidth / 2);
		
		// Verificar todas as trilhas existentes
		for (const el of state.elements) {
			if (el.type !== 'trace') continue;
			
			// Verificar se o ponto está próximo ao início da trilha (ponto de saída)
			const dist1 = Math.sqrt(Math.pow(el.x1 - x, 2) + Math.pow(el.y1 - y, 2));
			
			// Se estamos verificando o ponto final, também verificar dist2
			if (checkEndPoint) {
				const dist2 = Math.sqrt(Math.pow(el.x2 - x, 2) + Math.pow(el.y2 - y, 2));
				// Para ponto final, verificar se já existe uma trilha saindo deste ponto
				if (dist2 <= tolerance) {
					return true;
				}
			}
			
			// Se o ponto está muito próximo ao início de alguma trilha, já tem uma trilha saindo
			if (dist1 <= tolerance) {
				return true;
			}
		}
		
		// Verificar também se está próximo a um pad ou via
		const pad = findElementAt(x, y);
		if (pad && (pad.type === 'pad' || pad.type === 'via')) {
			// Verificar se já existe uma trilha saindo deste pad/via
			for (const el of state.elements) {
				if (el.type !== 'trace') continue;
				
				const dist1 = Math.sqrt(Math.pow(el.x1 - pad.x, 2) + Math.pow(el.y1 - pad.y, 2));
				const padRadius = (pad.diameter || pad.holeDiameter || 1.5) / 2;
				
				// Se uma trilha começa neste pad/via, já tem uma trilha saindo
				if (dist1 <= padRadius + tolerance) {
					return true;
				}
			}
		}
		
		return false;
	}

	function handleMouseDown(e) {
		const rect = canvas.getBoundingClientRect();
		const x = (e.clientX - rect.left - canvas.width / 2 - state.panX) / state.zoom;
		const y = (e.clientY - rect.top - canvas.height / 2 - state.panY) / state.zoom;
		
		lastMouseX = x;
		lastMouseY = y;
		dragStartX = x;
		dragStartY = y;

		if (e.button === 1 || (e.button === 0 && e.altKey)) {
			// Pan com middle click ou Alt+click
			isPanning = true;
			canvas.style.cursor = 'grabbing';
			return;
		}

		let { sx: snappedX, sy: snappedY } = getSnappedPoint(x, y, null);

		if (state.currentTool === 'select') {
			const clicked = findElementAt(snappedX, snappedY);
			if (clicked) {
				if (!e.shiftKey) state.selectedIds.clear();
				state.selectedIds.add(clicked.id);
				// pad dentro de componente? guardar referência
				state.selectedPadRef = getPadRefAt(clicked, snappedX, snappedY);
				// destacar net no ponto (se houver)
				const n = getNetAtPoint(snappedX, snappedY);
				state.highlightNet = n || null;
				isDragging = true;
				// preparar base de arrasto com snap apenas ao grid
				dragPrevX = state.snapToGrid ? snapToGrid(x) : x;
				dragPrevY = state.snapToGrid ? snapToGrid(y) : y;
				// Salvar histórico quando começa a arrastar (estado inicial)
				if (!dragHistorySaved) {
					saveHistoryState();
					dragHistorySaved = true;
				}
			} else {
				// Inicia seleção por retângulo (marquee)
				isSelectingRect = true;
				rectStartX = snappedX;
				rectStartY = snappedY;
				rectCurX = snappedX;
				rectCurY = snappedY;
				state.selectedPadRef = null;
				state.highlightNet = null;
			}
		} else if (state.currentTool === 'trace') {
			// Verificar se já existe uma trilha conectada a este ponto
			if (hasTraceAtPoint(snappedX, snappedY)) {
				// Mostrar feedback visual (pode adicionar um alerta ou mudar cursor)
				canvas.style.cursor = 'not-allowed';
				setTimeout(() => {
					canvas.style.cursor = 'crosshair';
				}, 500);
				return;
			}
			// Herdar NET do ponto inicial, se houver
			const startNet = getNetAtPoint(snappedX, snappedY);
			
			tempElement = {
				type: 'trace',
				layer: state.currentLayer,
				width: state.traceWidth,
				net: startNet || null,
				x1: snappedX,
				y1: snappedY,
				x2: snappedX,
				y2: snappedY,
				points: [[snappedX, snappedY]]
			};
		} else if (state.currentTool === 'pad') {
			addElement({
				type: 'pad',
				layer: state.currentLayer,
				x: snappedX,
				y: snappedY,
				diameter: state.padDiameter,
				net: null
			});
		} else if (state.currentTool === 'via') {
			addElement({
				type: 'via',
				x: snappedX,
				y: snappedY,
				diameter: state.viaDiameter,
				holeDiameter: state.viaHoleDiameter
			});
		} else if (state.currentTool === 'outline') {
			// iniciar uma linha de contorno com snap a 45°/grid
			const start = { x: snappedX, y: snappedY };
			tempElement = {
				type: 'outline',
				layer: 'outline',
				width: 0.2,
				x1: start.x,
				y1: start.y,
				x2: start.x,
				y2: start.y
			};
		} else if (state.currentTool === 'text') {
			const content = prompt('Texto a inserir:', '');
			if (content && content.trim()) {
				addElement({
					type: 'text',
					layer: 'silk-top',
					x: snappedX,
					y: snappedY,
					text: content.trim(),
					size: 1.6, // mm aproximado
					rotation: 0,
					align: 'left'
				});
			}
		} else if (state.currentTool === 'measure') {
			tempElement = {
				type: 'measure',
				x1: snappedX,
				y1: snappedY,
				x2: snappedX,
				y2: snappedY
			};
		}

		render();
	}

	function handleMouseMove(e) {
		const rect = canvas.getBoundingClientRect();
		const x = (e.clientX - rect.left - canvas.width / 2 - state.panX) / state.zoom;
		const y = (e.clientY - rect.top - canvas.height / 2 - state.panY) / state.zoom;

		if (isPanning) {
			state.panX += (x - lastMouseX) * state.zoom;
			state.panY += (y - lastMouseY) * state.zoom;
			render();
			lastMouseX = x;
			lastMouseY = y;
			return;
		}

		const anchor = tempElement && tempElement.type === 'trace' ? { x: tempElement.x1, y: tempElement.y1 } : null;
		let { sx: snappedX, sy: snappedY } = getSnappedPoint(x, y, anchor);

		// Atualizar posição do cursor
		cursorPosEl.textContent = `X: ${snappedX.toFixed(2)}mm Y: ${snappedY.toFixed(2)}mm`;

		if (isSelectingRect) {
			rectCurX = snappedX;
			rectCurY = snappedY;
			render();
			return;
		}

		if (isDragging && state.selectedIds.size > 0) {
			// snap apenas ao grid durante arrasto para evitar “grudar” em pads/endpoints/45°
			const dragX = state.snapToGrid ? snapToGrid(x) : x;
			const dragY = state.snapToGrid ? snapToGrid(y) : y;
			const dx = dragX - (dragPrevX ?? dragX);
			const dy = dragY - (dragPrevY ?? dragY);
			if (Math.abs(dx) > 0.01 || Math.abs(dy) > 0.01) {
				dragHasMoved = true;
			}
			state.elements.forEach(el => {
				if (state.selectedIds.has(el.id)) {
					if (el.x !== undefined) {
						el.x += dx;
						el.y += dy;
					}
					if (el.x1 !== undefined) {
						el.x1 += dx;
						el.y1 += dy;
						el.x2 += dx;
						el.y2 += dy;
					}
					if (el.points && Array.isArray(el.points)) {
						for (let i = 0; i < el.points.length; i++) {
							el.points[i][0] += dx;
							el.points[i][1] += dy;
						}
					}
				}
			});
			dragPrevX = dragX;
			dragPrevY = dragY;
			render();
		} else if (tempElement) {
			if (tempElement.type === 'trace') {
				// Auto-roteamento 45° com chanfro (duas bordas 45°)
				const pts = buildAuto45Path({ x: tempElement.x1, y: tempElement.y1 }, { x: snappedX, y: snappedY });
				tempElement.points = pts.map(p => [p.x, p.y]);
				const last = pts[pts.length - 1];
				tempElement.x2 = last.x;
				tempElement.y2 = last.y;
			} else if (tempElement.type === 'outline') {
				const anchorPt = { x: tempElement.x1, y: tempElement.y1 };
				const { sx, sy } = getSnappedPoint(x, y, anchorPt);
				tempElement.x2 = sx;
				tempElement.y2 = sy;
			} else if (tempElement.type === 'measure') {
				tempElement.x2 = snappedX;
				tempElement.y2 = snappedY;
			}
			render();
		}

		lastMouseX = x;
		lastMouseY = y;
	}

	function handleMouseUp(e) {
		if (isPanning) {
			isPanning = false;
			canvas.style.cursor = 'default';
			return;
		}

		if (isSelectingRect) {
			// Finaliza seleção por retângulo
			selectWithinRect(rectStartX, rectStartY, rectCurX, rectCurY, e.shiftKey);
			isSelectingRect = false;
			render();
			return;
		}

		if (tempElement) {
			if (tempElement.type === 'trace') {
				const dist = Math.sqrt(
					Math.pow(tempElement.x2 - tempElement.x1, 2) +
					Math.pow(tempElement.y2 - tempElement.y1, 2)
				);
				if (dist > 0.1) {
					addElement(tempElement);
				}
			} else if (tempElement.type === 'measure') {
				const dist = Math.sqrt(
					Math.pow(tempElement.x2 - tempElement.x1, 2) +
					Math.pow(tempElement.y2 - tempElement.y1, 2)
				);
				if (dist > 0.1) {
					addElement(tempElement);
				}
			} else if (tempElement.type === 'outline') {
				const dist = Math.sqrt(
					Math.pow(tempElement.x2 - tempElement.x1, 2) +
					Math.pow(tempElement.y2 - tempElement.y1, 2)
				);
				if (dist > 0.1) {
					addElement(tempElement);
				}
			}
			tempElement = null;
		}

		isDragging = false;
		// Se houve movimento durante o arrasto, salvar o estado final no histórico
		if (dragHasMoved && dragHistorySaved) {
			saveHistoryState();
		}
		dragHistorySaved = false;
		dragHasMoved = false;
		render();
		saveState();
		updateDRC();

		// Se moveu vias, não permitir violar via↔via; reverte
		const movedViaIds = new Set(Array.from(state.selectedIds).filter(id => {
			const el = state.elements.find(e => e.id === id);
			return el && el.type === 'via';
		}));
		if (movedViaIds.size > 0) {
			const minClr = state.drc?.viaClearance ?? 0.2;
			let violated = false;
			const vias = state.elements.filter(e => e.type === 'via');
			for (const a of vias) {
				for (const b of vias) {
					if (a.id === b.id) continue;
					if (!(movedViaIds.has(a.id) || movedViaIds.has(b.id))) continue;
					const dCenter = Math.hypot(a.x - b.x, a.y - b.y);
					const rSum = (a.diameter / 2) + (b.diameter / 2);
					if (dCenter - rSum < minClr) { violated = true; break; }
				}
				if (violated) break;
			}
			if (violated) {
				undo();
				updateDRC();
				if (selectionInfoEl) selectionInfoEl.textContent = `DRC: Movimento de via bloqueado (min ${minClr}mm)`;
				return;
			}
		}
	}

	function handleWheel(e) {
		e.preventDefault();
		const delta = e.deltaY > 0 ? 0.95 : 1.05;
		const newZoom = Math.max(0.2, Math.min(10, state.zoom * delta));
		
		const rect = canvas.getBoundingClientRect();
		const mouseX = e.clientX - rect.left - canvas.width / 2;
		const mouseY = e.clientY - rect.top - canvas.height / 2;
		
		state.panX = mouseX - (mouseX - state.panX) * (newZoom / state.zoom);
		state.panY = mouseY - (mouseY - state.panY) * (newZoom / state.zoom);
		state.zoom = newZoom;
		
		zoomLevelEl.textContent = `Zoom: x${Math.round(state.zoom * 500)}`;
		render();
	}

	function handleKeyDown(e) {
		// Undo/Redo
		if (e.ctrlKey || e.metaKey) {
			if (e.key === 'z' || e.key === 'Z') {
				e.preventDefault();
				if (e.shiftKey) {
					redo();
				} else {
					undo();
				}
				return;
			}
			if (e.key === 'y' || e.key === 'Y') {
				e.preventDefault();
				redo();
				return;
			}
		}
		
		// Fechar modais com ESC
		if (e.key === 'Escape') {
			if (!exportModal.hidden || !layersModal.hidden) {
				if (exportModal) {
					exportModal.hidden = true;
					exportModal.style.display = 'none';
				}
				if (layersModal) {
					layersModal.hidden = true;
					layersModal.style.display = 'none';
				}
				return;
			}
			state.selectedIds.clear();
			tempElement = null;
			render();
			return;
		}
		
		// Atalhos
		if (e.key === 'v' || e.key === 'V') selectTool('select');
		else if (e.key === 't' || e.key === 'T') selectTool('trace');
		else if (e.key === 'p' || e.key === 'P') selectTool('pad');
		else if (e.key === 'i' || e.key === 'I') selectTool('via');
		else if (e.key === 'c' || e.key === 'C') selectTool('component');
		else if (e.key === 'x' || e.key === 'X') selectTool('text');
		else if (e.key === 'm' || e.key === 'M') selectTool('measure');
		else if (e.key === 'Delete' || e.key === 'Backspace') deleteSelected();
	}

	function selectTool(tool) {
		state.currentTool = tool;
		document.querySelectorAll('.tool-btn').forEach(btn => {
			btn.classList.toggle('active', btn.dataset.tool === tool);
		});
	}

	function snapToGrid(value) {
		return Math.round(value / state.gridSize) * state.gridSize;
	}

	function addElement(element) {
		saveHistoryState();
		// Validação específica: via não pode violar distância mínima via↔via
		if (element.type === 'via') {
			const minClr = state.drc?.viaClearance ?? 0.2;
			for (const v of state.elements) {
				if (v.type !== 'via') continue;
				const dCenter = Math.hypot((element.x) - v.x, (element.y) - v.y);
				const rSum = ((element.diameter || state.viaDiameter) / 2) + (v.diameter / 2);
				if (dCenter - rSum < minClr) {
					if (selectionInfoEl) selectionInfoEl.textContent = `DRC: Via muito próxima (min ${minClr}mm)`;
					// descarta a inserção
					history.pop(); // reverte saveHistoryState da tentativa
					return;
				}
			}
		}
		element.id = uid();
		state.elements.push(element);
		saveState();
		updateDRC();
		render();
	}

	function deleteSelected() {
		if (state.selectedIds.size === 0) return;
		saveHistoryState();
		state.elements = state.elements.filter(el => !state.selectedIds.has(el.id));
		state.selectedIds.clear();
		saveState();
		render();
	}

	function findElementAt(x, y) {
		const tolerance = 0.5 / state.zoom;
		for (let i = state.elements.length - 1; i >= 0; i--) {
			const el = state.elements[i];
			if (el.type === 'pad' || el.type === 'via') {
				const dist = Math.sqrt(Math.pow(el.x - x, 2) + Math.pow(el.y - y, 2));
				if (dist <= el.diameter / 2 + tolerance) return el;
			} else if (el.type === 'trace') {
				// considerar polilinha se existir
				if (el.points && el.points.length >= 2) {
					for (let j = 0; j < el.points.length - 1; j++) {
						const [x1, y1] = el.points[j];
						const [x2, y2] = el.points[j + 1];
						const dist = pointToLineDistance(x, y, x1, y1, x2, y2);
						if (dist <= el.width / 2 + tolerance) return el;
					}
				} else {
					const dist = pointToLineDistance(x, y, el.x1, el.y1, el.x2, el.y2);
					if (dist <= el.width / 2 + tolerance) return el;
				}
			} else if (el.type === 'outline') {
				const dist = pointToLineDistance(x, y, el.x1, el.y1, el.x2, el.y2);
				if (dist <= el.width / 2 + tolerance) return el;
			} else if (el.type === 'component') {
				const comp = COMPONENT_LIBRARY[el.componentId];
				if (!comp) continue;
				const pads = el.pads && Array.isArray(el.pads) ? el.pads : comp.pads;
				for (const pad of pads) {
					const px = el.x + pad.x;
					const py = el.y + pad.y;
					if (Math.abs(px - x) <= pad.width / 2 && Math.abs(py - y) <= pad.height / 2) {
						return el;
					}
				}
			} else if (el.type === 'text') {
				// caixa aproximada de seleção de texto
				const w = (el.size || 1.6) * (el.text?.length || 1);
				const h = (el.size || 1.6);
				if (Math.abs(el.x - x) <= w / 2 && Math.abs(el.y - y) <= h / 2) return el;
			} else if (el.type === 'measure') {
				// seleção por proximidade da linha
				const dist = pointToLineDistance(x, y, el.x1, el.y1, el.x2, el.y2);
				if (dist <= 0.5 / state.zoom) return el;
			}
		}
		return null;
	}

	function pointToLineDistance(px, py, x1, y1, x2, y2) {
		const A = px - x1;
		const B = py - y1;
		const C = x2 - x1;
		const D = y2 - y1;
		const dot = A * C + B * D;
		const lenSq = C * C + D * D;
		let param = -1;
		if (lenSq !== 0) param = dot / lenSq;
		let xx, yy;
		if (param < 0) {
			xx = x1;
			yy = y1;
		} else if (param > 1) {
			xx = x2;
			yy = y2;
		} else {
			xx = x1 + param * C;
			yy = y1 + param * D;
		}
		const dx = px - xx;
		const dy = py - yy;
		return Math.sqrt(dx * dx + dy * dy);
	}

	function distSegSeg(x1, y1, x2, y2, x3, y3, x4, y4) {
		// aproximação: min distância entre extremos e segmentos
		const d1 = pointToLineDistance(x1, y1, x3, y3, x4, y4);
		const d2 = pointToLineDistance(x2, y2, x3, y3, x4, y4);
		const d3 = pointToLineDistance(x3, y3, x1, y1, x2, y2);
		const d4 = pointToLineDistance(x4, y4, x1, y1, x2, y2);
		return Math.min(d1, d2, d3, d4);
	}

	function distSegRect(x1, y1, x2, y2, rx, ry, rw, rh) {
		// distancia mínima entre segmento e retângulo axis-aligned (centro rx,ry)
		const left = rx - rw / 2;
		const right = rx + rw / 2;
		const top = ry - rh / 2;
		const bottom = ry + rh / 2;
		// se segmento completamente fora: usar aproximação por amostragem nos 4 lados
		const dTop = distSegSeg(x1, y1, x2, y2, left, top, right, top);
		const dBottom = distSegSeg(x1, y1, x2, y2, left, bottom, right, bottom);
		const dLeft = distSegSeg(x1, y1, x2, y2, left, top, left, bottom);
		const dRight = distSegSeg(x1, y1, x2, y2, right, top, right, bottom);
		// se interseção, distância 0
		const inside = (x) => (x >= left && x <= right);
		// projeções rápidas
		if (inside(x1) && y1 >= top && y1 <= bottom) return 0;
		if (inside(x2) && y2 >= top && y2 <= bottom) return 0;
		return Math.min(dTop, dBottom, dLeft, dRight);
	}

	// Construir polilinha com cantos 45° (chanfro duplo) entre dois pontos
	function buildAuto45Path(a, b) {
		const dx = b.x - a.x;
		const dy = b.y - a.y;
		const ax = Math.abs(dx);
		const ay = Math.abs(dy);
		const sx = Math.sign(dx) || 1;
		const sy = Math.sign(dy) || 1;
		// Caso linha reta 0/90
		if (ax < 1e-6 || ay < 1e-6) return [a, b];
		// Caso 45 exato
		if (Math.abs(ax - ay) < 1e-6) return [a, b];
		// Chanfro com duas bordas 45° e um trecho central retilíneo
		const m = Math.min(ax, ay);
		const p1 = { x: a.x + sx * (m / 2), y: a.y + sy * (m / 2) };
		const p2 = { x: b.x - sx * (m / 2), y: b.y - sy * (m / 2) };
		// opcional: snap ao grid para p1/p2 também
		if (state.snapToGrid) {
			p1.x = snapToGrid(p1.x); p1.y = snapToGrid(p1.y);
			p2.x = snapToGrid(p2.x); p2.y = snapToGrid(p2.y);
		}
		return [a, p1, p2, b];
	}

	function getWorldTolerance() {
		return Math.max(0.3, 8 / state.zoom);
	}

	function findNearestPadOrVia(x, y) {
		const tol = getWorldTolerance();
		let best = null;
		let bestDist = Infinity;
		for (let i = state.elements.length - 1; i >= 0; i--) {
			const el = state.elements[i];
			if (el.type === 'pad' || el.type === 'via') {
				const d = Math.hypot(el.x - x, el.y - y);
				if (d <= tol && d < bestDist) {
					bestDist = d;
					best = { sx: el.x, sy: el.y };
				}
			} else if (el.type === 'component') {
				const comp = COMPONENT_LIBRARY[el.componentId];
				const pads = el.pads && Array.isArray(el.pads) ? el.pads : (comp ? comp.pads : []);
				for (const p of pads) {
					const px = el.x + p.x;
					const py = el.y + p.y;
					const d = Math.hypot(px - x, py - y);
					if (d <= tol && d < bestDist) {
						bestDist = d;
						best = { sx: px, sy: py };
					}
				}
			}
		}
		return best;
	}

	function findNearestTraceEndOrMid(x, y) {
		const tol = getWorldTolerance();
		let best = null;
		let bestDist = Infinity;
		for (const el of state.elements) {
			if (el.type !== 'trace') continue;
			const pts = (el.points && el.points.length >= 2)
				? el.points.map(([px,py]) => ({ x: px, y: py }))
				: [{ x: el.x1, y: el.y1 }, { x: el.x2, y: el.y2 }];
			// endpoints
			const p1 = pts[0];
			const p2 = pts[pts.length - 1];
			const d1 = Math.hypot(p1.x - x, p1.y - y);
			if (d1 <= tol && d1 < bestDist) { bestDist = d1; best = { sx: p1.x, sy: p1.y }; }
			const d2 = Math.hypot(p2.x - x, p2.y - y);
			if (d2 <= tol && d2 < bestDist) { bestDist = d2; best = { sx: p2.x, sy: p2.y }; }
			// midpoints por segmento
			for (let i = 0; i < pts.length - 1; i++) {
				const mx = (pts[i].x + pts[i+1].x) / 2;
				const my = (pts[i].y + pts[i+1].y) / 2;
				const dm = Math.hypot(mx - x, my - y);
				if (dm <= tol && dm < bestDist) { bestDist = dm; best = { sx: mx, sy: my }; }
			}
		}
		return best;
	}

	function quantizeAngle45(anchor, x, y) {
		const dx = x - anchor.x;
		const dy = y - anchor.y;
		const r = Math.hypot(dx, dy);
		if (r < 0.05) return { sx: x, sy: y };
		const step = Math.PI / 4; // 45°
		const ang = Math.atan2(dy, dx);
		const q = Math.round(ang / step) * step;
		return { sx: anchor.x + r * Math.cos(q), sy: anchor.y + r * Math.sin(q) };
	}

	function getSnappedPoint(x, y, anchor /* {x,y} | null */) {
		// 1) snap to pads/vias
		const a = findNearestPadOrVia(x, y);
		if (a) return a;
		// 2) snap to endpoints/midpoints
		const b = findNearestTraceEndOrMid(x, y);
		if (b) return b;
		// 3) snap to 45° if drawing a trace
		if (anchor) {
			const ang = quantizeAngle45(anchor, x, y);
			// optional grid after 45°
			if (state.snapToGrid) {
				ang.sx = snapToGrid(ang.sx);
				ang.sy = snapToGrid(ang.sy);
			}
			return ang;
		}
		// 4) snap to grid (default)
		return {
			sx: state.snapToGrid ? snapToGrid(x) : x,
			sy: state.snapToGrid ? snapToGrid(y) : y
		};
	}

	function placeComponent(componentId) {
		const comp = COMPONENT_LIBRARY[componentId];
		if (!comp) return;
		
		// Instanciar pads com net: null para este componente
		const padsInstance = (comp.pads || []).map(p => ({ ...p, net: null }));
		addElement({
			type: 'component',
			componentId,
			layer: state.currentLayer,
			x: 0,
			y: 0,
			rotation: 0,
			pads: padsInstance,
			silk: comp.silk ? JSON.parse(JSON.stringify(comp.silk)) : undefined
		});
		
		componentsPanel.hidden = true;
		state.currentTool = 'select';
		selectTool('select');
	}

	function toggleComponentsPanel() {
		componentsPanel.hidden = !componentsPanel.hidden;
		const btn = document.getElementById('btn-components');
		if (btn) {
			btn.style.background = componentsPanel.hidden ? '' : 'linear-gradient(135deg, #4cc9f0, #4361ee)';
			btn.style.color = componentsPanel.hidden ? '' : 'white';
		}
	}

	function clearAll() {
		if (!confirm('Tem certeza que deseja limpar tudo?')) return;
		state.elements = [];
		state.selectedIds.clear();
		saveState();
		updateDRC();
		render();
	}

	// Renderização
	function render() {
		ctx.clearRect(0, 0, canvas.width, canvas.height);
		ctx.save();
		
		// Fundo
		ctx.fillStyle = '#1a1f2e';
		ctx.fillRect(0, 0, canvas.width, canvas.height);
		
		// Transformação para coordenadas do mundo
		ctx.translate(canvas.width / 2 + state.panX, canvas.height / 2 + state.panY);
		ctx.scale(state.zoom, state.zoom);
		
		// Grade
		renderGrid();
		
		// Elementos
		state.elements.forEach(el => {
			if (el.layer && !state.layerVisibility[el.layer]) return;
			renderElement(el);
		});
		
		// Elemento temporário
		if (tempElement) {
			renderElement(tempElement, true);
		}

		// Retângulo de seleção (marquee)
		if (isSelectingRect) {
			renderSelectionRect();
		}
		
		// Seleção
		state.selectedIds.forEach(id => {
			const el = state.elements.find(e => e.id === id);
			if (el) renderSelection(el);
		});

		// DRC resumo
		if (selectionInfoEl) {
			const n = state.drcIssues?.length || 0;
			selectionInfoEl.textContent = n ? `DRC: ${n} violações` : '';
		}
		
		ctx.restore();
	}

	function renderSelectionRect() {
		const minX = Math.min(rectStartX, rectCurX);
		const minY = Math.min(rectStartY, rectCurY);
		const w = Math.abs(rectCurX - rectStartX);
		const h = Math.abs(rectCurY - rectStartY);
		ctx.save();
		ctx.strokeStyle = 'rgba(100,180,255,0.9)';
		ctx.fillStyle = 'rgba(100,180,255,0.15)';
		ctx.lineWidth = 0.3 / state.zoom;
		ctx.setLineDash([1 / state.zoom, 1 / state.zoom]);
		ctx.strokeRect(minX, minY, w, h);
		ctx.setLineDash([]);
		ctx.fillRect(minX, minY, w, h);
		ctx.restore();
	}

	// -------- Painel DRC --------
	let drcPanel = null;
	function toggleDrcPanel() {
		if (!drcPanel) {
			createDrcPanel();
		}
		const visible = drcPanel.style.display !== 'none';
		drcPanel.style.display = visible ? 'none' : 'block';
		if (!visible) syncDrcPanelInputs();
	}

	function createDrcPanel() {
		drcPanel = document.createElement('div');
		drcPanel.id = 'drc-panel';
		Object.assign(drcPanel.style, {
			position: 'fixed',
			right: '16px',
			top: '72px',
			width: '260px',
			background: '#0f172a',
			color: '#fff',
			border: '1px solid rgba(255,255,255,0.1)',
			borderRadius: '8px',
			boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
			padding: '12px',
			zIndex: 9999,
			display: 'block',
			fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI'
		});

		const header = document.createElement('div');
		header.textContent = 'Regras DRC';
		Object.assign(header.style, { fontWeight: '600', marginBottom: '8px' });

		const close = document.createElement('button');
		close.textContent = '×';
		close.title = 'Fechar';
		Object.assign(close.style, {
			position: 'absolute',
			right: '8px',
			top: '4px',
			background: 'transparent',
			color: '#fff',
			border: 'none',
			fontSize: '18px',
			cursor: 'pointer'
		});
		close.addEventListener('click', () => drcPanel.style.display = 'none');

		const grid = document.createElement('div');
		Object.assign(grid.style, { display: 'grid', gridTemplateColumns: '1fr auto', rowGap: '8px', columnGap: '8px' });

		const addRow = (labelText, id, step, min, getter, setter) => {
			const lbl = document.createElement('label');
			lbl.textContent = labelText;
			lbl.htmlFor = id;
			lbl.style.fontSize = '12px';

			const inp = document.createElement('input');
			inp.type = 'number';
			inp.id = id;
			inp.step = String(step);
			inp.min = String(min);
			inp.value = String(getter());
			inp.style.width = '90px';
			inp.addEventListener('input', () => {
				const v = Math.max(min, parseFloat(inp.value) || getter());
				setter(v);
				saveState();
				updateDRC();
				render();
			});

			grid.appendChild(lbl);
			grid.appendChild(inp);
		};

		addRow('W trilha ≥ (mm)', 'drcp-min-trace', 0.05, 0.1, () => state.drc.minTraceWidth, v => state.drc.minTraceWidth = v);
		addRow('Clr trilha↔trilha ≥ (mm)', 'drcp-tt', 0.05, 0.1, () => state.drc.minClearance, v => state.drc.minClearance = v);
		addRow('Clr pad↔trilha ≥ (mm)', 'drcp-pt', 0.05, 0.1, () => state.drc.padTraceClearance, v => state.drc.padTraceClearance = v);
		addRow('Clr via↔via ≥ (mm)', 'drcp-vv', 0.05, 0.1, () => state.drc.viaClearance, v => state.drc.viaClearance = v);

		const actions = document.createElement('div');
		Object.assign(actions.style, { marginTop: '10px', display: 'flex', gap: '8px' });

		const btnApply = document.createElement('button');
		btnApply.textContent = 'Aplicar';
		Object.assign(btnApply.style, { flex: '1', background: '#2563EB', color: '#fff', border: 'none', padding: '6px 10px', borderRadius: '6px', cursor: 'pointer' });
		btnApply.addEventListener('click', () => {
			saveState();
			updateDRC();
			render();
		});

		const btnClose = document.createElement('button');
		btnClose.textContent = 'Fechar';
		Object.assign(btnClose.style, { background: '#334155', color: '#fff', border: 'none', padding: '6px 10px', borderRadius: '6px', cursor: 'pointer' });
		btnClose.addEventListener('click', () => drcPanel.style.display = 'none');

		actions.appendChild(btnApply);
		actions.appendChild(btnClose);

		drcPanel.appendChild(header);
		drcPanel.appendChild(close);
		drcPanel.appendChild(grid);
		drcPanel.appendChild(actions);

		document.body.appendChild(drcPanel);
	}

	function syncDrcPanelInputs() {
		const setVal = (id, v) => {
			const el = document.getElementById(id);
			if (el) el.value = String(v);
		};
		setVal('drcp-min-trace', state.drc.minTraceWidth);
		setVal('drcp-tt', state.drc.minClearance);
		setVal('drcp-pt', state.drc.padTraceClearance);
		setVal('drcp-vv', state.drc.viaClearance);
	}

	function getPadRefAt(el, x, y) {
		if (!el || el.type !== 'component') return null;
		const comp = COMPONENT_LIBRARY[el.componentId];
		const pads = el.pads && Array.isArray(el.pads) ? el.pads : (comp ? comp.pads : []);
		for (let i = 0; i < pads.length; i++) {
			const pad = pads[i];
			const px = el.x + pad.x;
			const py = el.y + pad.y;
			if (Math.abs(px - x) <= pad.width / 2 && Math.abs(py - y) <= pad.height / 2) {
				return { elementId: el.id, padIndex: i };
			}
		}
		return null;
	}

	function getNetAtPoint(x, y) {
		// Prioridade: pad de componente > pad/via > trilha
		for (let i = state.elements.length - 1; i >= 0; i--) {
			const el = state.elements[i];
			if (el.type === 'component') {
				const comp = COMPONENT_LIBRARY[el.componentId];
				const pads = el.pads && Array.isArray(el.pads) ? el.pads : (comp ? comp.pads : []);
				for (const pad of pads) {
					const px = el.x + pad.x;
					const py = el.y + pad.y;
					if (Math.abs(px - x) <= pad.width / 2 && Math.abs(py - y) <= pad.height / 2) {
						return pad.net || null;
					}
				}
			} else if (el.type === 'pad') {
				const dist = Math.sqrt(Math.pow(el.x - x, 2) + Math.pow(el.y - y, 2));
				if (dist <= el.diameter / 2 + 0.5 / state.zoom) return el.net || null;
			} else if (el.type === 'trace') {
				const dist = pointToLineDistance(x, y, el.x1, el.y1, el.x2, el.y2);
				if (dist <= el.width / 2 + 0.5 / state.zoom) return el.net || null;
			}
		}
		return null;
	}

	function defineNetForSelection() {
		// Se houver pad de componente selecionado
		if (state.selectedPadRef) {
			const el = state.elements.find(e => e.id === state.selectedPadRef.elementId);
			if (!el || !el.pads) return;
			const current = el.pads[state.selectedPadRef.padIndex]?.net || '';
			const net = prompt('Nome da NET (ex.: VCC, GND, SIGNAL1):', current);
			if (!net) return;
			el.pads[state.selectedPadRef.padIndex].net = net.trim();
			state.highlightNet = net.trim();
			saveState();
			render();
			return;
		}
		// Caso contrário, aplicar ao último elemento selecionado (pad solto/trilha)
		const lastSelected = [...state.selectedIds][state.selectedIds.size - 1];
		if (!lastSelected) return;
		const el = state.elements.find(e => e.id === lastSelected);
		if (!el) return;
		const net = prompt('Nome da NET (ex.: VCC, GND, SIGNAL1):', el.net || '');
		if (!net) return;
		el.net = net.trim();
		state.highlightNet = net.trim();
		saveState();
		render();
	}

	function renderGrid() {
		const gridSize = state.gridSize;
		const spacing = gridSize * state.zoom;
		
		if (spacing < 5) return; // Não desenhar se muito pequeno
		
		ctx.strokeStyle = 'rgba(255,255,255,0.1)';
		ctx.lineWidth = 1 / state.zoom;
		
		const startX = Math.floor((-canvas.width / 2 - state.panX) / state.zoom / gridSize) * gridSize;
		const endX = Math.ceil((canvas.width / 2 - state.panX) / state.zoom / gridSize) * gridSize;
		const startY = Math.floor((-canvas.height / 2 - state.panY) / state.zoom / gridSize) * gridSize;
		const endY = Math.ceil((canvas.height / 2 - state.panY) / state.zoom / gridSize) * gridSize;
		
		ctx.beginPath();
		for (let x = startX; x <= endX; x += gridSize) {
			ctx.moveTo(x, startY);
			ctx.lineTo(x, endY);
		}
		for (let y = startY; y <= endY; y += gridSize) {
			ctx.moveTo(startX, y);
			ctx.lineTo(endX, y);
		}
		ctx.stroke();
		
		// Origem
		ctx.strokeStyle = 'rgba(255,255,255,0.3)';
		ctx.lineWidth = 2 / state.zoom;
		ctx.beginPath();
		ctx.moveTo(-5, 0);
		ctx.lineTo(5, 0);
		ctx.moveTo(0, -5);
		ctx.lineTo(0, 5);
		ctx.stroke();
	}

	function renderElement(el, isTemp = false) {
		const alpha = isTemp ? 0.6 : (el.layer ? state.layerOpacity[el.layer] : 1);
		
		if (el.type === 'trace') {
			ctx.globalAlpha = alpha;
			const hasErr = (state.drcIssues || []).some(v => v.aId === el.id || v.bId === el.id);
			if (hasErr) {
				ctx.strokeStyle = '#EF4444';
			} else if (state.highlightNet && el.net && state.highlightNet === el.net) {
				ctx.strokeStyle = '#ffd27f';
			} else {
				ctx.strokeStyle = LAYER_COLORS[el.layer] || '#FFFFFF';
			}
			ctx.lineWidth = el.width;
			ctx.lineCap = 'round';
			const pts = (el.points && el.points.length >= 2)
				? el.points
				: [[el.x1, el.y1], [el.x2, el.y2]];
			ctx.beginPath();
			ctx.moveTo(pts[0][0], pts[0][1]);
			for (let i = 1; i < pts.length; i++) {
				ctx.lineTo(pts[i][0], pts[i][1]);
			}
			ctx.stroke();
			ctx.globalAlpha = 1;
		} else if (el.type === 'outline') {
			if (el.layer && !state.layerVisibility[el.layer]) return;
			ctx.globalAlpha = state.layerOpacity[el.layer] ?? 1;
			ctx.strokeStyle = LAYER_COLORS[el.layer] || '#22C55E';
			ctx.lineWidth = el.width || 0.2;
			ctx.lineCap = 'square';
			ctx.beginPath();
			ctx.moveTo(el.x1, el.y1);
			ctx.lineTo(el.x2, el.y2);
			ctx.stroke();
			ctx.globalAlpha = 1;
		} else if (el.type === 'pad') {
			ctx.globalAlpha = alpha;
			const hasErr = (state.drcIssues || []).some(v => v.aId === el.id || v.bId === el.id);
			if (hasErr) {
				ctx.fillStyle = '#EF4444';
			} else if (state.highlightNet && el.net && state.highlightNet === el.net) {
				ctx.fillStyle = '#ffd27f';
			} else {
				ctx.fillStyle = LAYER_COLORS[el.layer] || '#FFFFFF';
			}
			ctx.beginPath();
			ctx.arc(el.x, el.y, el.diameter / 2, 0, Math.PI * 2);
			ctx.fill();
			ctx.globalAlpha = 1;
		} else if (el.type === 'via') {
			ctx.globalAlpha = alpha;
			ctx.fillStyle = '#999999';
			ctx.beginPath();
			ctx.arc(el.x, el.y, el.diameter / 2, 0, Math.PI * 2);
			ctx.fill();
			ctx.fillStyle = '#000000';
			ctx.beginPath();
			ctx.arc(el.x, el.y, el.holeDiameter / 2, 0, Math.PI * 2);
			ctx.fill();
			ctx.globalAlpha = 1;
		} else if (el.type === 'component') {
			const comp = COMPONENT_LIBRARY[el.componentId];
			if (!comp) return;
			
			ctx.save();
			ctx.translate(el.x, el.y);
			ctx.rotate((el.rotation || 0) * Math.PI / 180);
			
			// Pads (instância com nets ou fallback da biblioteca)
			ctx.globalAlpha = alpha;
			const instPads = el.pads && Array.isArray(el.pads) ? el.pads : comp.pads;
			instPads.forEach(pad => {
				if (state.highlightNet && pad.net && state.highlightNet === pad.net) {
					ctx.fillStyle = '#ffd27f';
				} else {
					ctx.fillStyle = LAYER_COLORS[el.layer] || '#DC2626';
				}
				ctx.fillRect(pad.x - pad.width / 2, pad.y - pad.height / 2, pad.width, pad.height);
				if (pad.hole) {
					ctx.fillStyle = '#000000';
					ctx.beginPath();
					ctx.arc(pad.x, pad.y, pad.hole / 2, 0, Math.PI * 2);
					ctx.fill();
				}
			});
			
			// Silkscreen
			ctx.strokeStyle = '#FFFFFF';
			ctx.lineWidth = 0.15;
			(comp.silk || el.silk || [])?.forEach(shape => {
				if (shape.type === 'rect') {
					ctx.strokeRect(shape.x, shape.y, shape.width, shape.height);
				} else if (shape.type === 'circle') {
					ctx.beginPath();
					ctx.arc(shape.x, shape.y, shape.radius, 0, Math.PI * 2);
					ctx.stroke();
				} else if (shape.type === 'arc') {
					ctx.beginPath();
					ctx.arc(shape.x, shape.y, shape.radius, 0, Math.PI * 2);
					ctx.fill();
				} else if (shape.type === 'line') {
					ctx.beginPath();
					ctx.moveTo(shape.x1, shape.y1);
					ctx.lineTo(shape.x2, shape.y2);
					ctx.stroke();
				}
			});
			
			ctx.restore();
			ctx.globalAlpha = 1;
		} else if (el.type === 'text') {
			ctx.globalAlpha = alpha;
			// texto na serigrafia superior por padrão
			ctx.fillStyle = '#FFFFFF';
			const size = Math.max(1.2, el.size || 1.6); // mm aprox
			// fonte em px; será escalada pela transform, então manter valor baixo
			ctx.font = `${size * 3}px sans-serif`;
			ctx.textAlign = el.align || 'left';
			ctx.textBaseline = 'middle';
			ctx.save();
			ctx.translate(el.x, el.y);
			ctx.rotate((el.rotation || 0) * Math.PI / 180);
			ctx.fillText(el.text || '', 0, 0);
			ctx.restore();
			ctx.globalAlpha = 1;
		} else if (el.type === 'measure') {
			// Cota/medição: linha e texto com comprimento
			ctx.globalAlpha = 1;
			ctx.strokeStyle = '#FFD166';
			ctx.fillStyle = '#FFD166';
			ctx.lineWidth = 0.2;
			ctx.lineCap = 'round';
			// linha principal
			ctx.beginPath();
			ctx.moveTo(el.x1, el.y1);
			ctx.lineTo(el.x2, el.y2);
			ctx.stroke();
			// marcadores nos extremos
			const r = 0.3;
			ctx.beginPath();
			ctx.arc(el.x1, el.y1, r, 0, Math.PI * 2);
			ctx.arc(el.x2, el.y2, r, 0, Math.PI * 2);
			ctx.fill();
			// texto de distância
			const dx = el.x2 - el.x1;
			const dy = el.y2 - el.y1;
			const dist = Math.hypot(dx, dy);
			const mx = (el.x1 + el.x2) / 2;
			const my = (el.y1 + el.y2) / 2;
			const label = `${dist.toFixed(2)} mm`;
			ctx.font = `${2.8}px sans-serif`;
			ctx.textAlign = 'center';
			ctx.textBaseline = 'bottom';
			// offset normal à linha para não colidir
			const ang = Math.atan2(dy, dx);
			const ox = Math.sin(ang) * 0.8;
			const oy = -Math.cos(ang) * 0.8;
			ctx.fillText(label, mx + ox, my + oy);
		}
	}

	function renderSelection(el) {
		ctx.strokeStyle = '#00FF00';
		ctx.lineWidth = 0.3 / state.zoom;
		ctx.setLineDash([0.5 / state.zoom, 0.5 / state.zoom]);
		
		if (el.type === 'pad' || el.type === 'via') {
			ctx.beginPath();
			ctx.arc(el.x, el.y, el.diameter / 2 + 0.3, 0, Math.PI * 2);
			ctx.stroke();
		} else if (el.type === 'trace') {
			const angle = Math.atan2(el.y2 - el.y1, el.x2 - el.x1);
			const perpX = Math.sin(angle) * (el.width / 2 + 0.3);
			const perpY = -Math.cos(angle) * (el.width / 2 + 0.3);
			
			ctx.beginPath();
			ctx.moveTo(el.x1 + perpX, el.y1 + perpY);
			ctx.lineTo(el.x2 + perpX, el.y2 + perpY);
			ctx.lineTo(el.x2 - perpX, el.y2 - perpY);
			ctx.lineTo(el.x1 - perpX, el.y1 - perpY);
			ctx.closePath();
			ctx.stroke();
		} else if (el.type === 'outline') {
			const angle = Math.atan2(el.y2 - el.y1, el.x2 - el.x1);
			const perpX = Math.sin(angle) * (el.width / 2 + 0.3);
			const perpY = -Math.cos(angle) * (el.width / 2 + 0.3);
			ctx.beginPath();
			ctx.moveTo(el.x1 + perpX, el.y1 + perpY);
			ctx.lineTo(el.x2 + perpX, el.y2 + perpY);
			ctx.lineTo(el.x2 - perpX, el.y2 - perpY);
			ctx.lineTo(el.x1 - perpX, el.y1 - perpY);
			ctx.closePath();
			ctx.stroke();
		} else if (el.type === 'component') {
			const comp = COMPONENT_LIBRARY[el.componentId];
			if (!comp) return;
			
			// Bounding box
			let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
			comp.pads.forEach(pad => {
				const x = el.x + pad.x;
				const y = el.y + pad.y;
				minX = Math.min(minX, x - pad.width / 2);
				maxX = Math.max(maxX, x + pad.width / 2);
				minY = Math.min(minY, y - pad.height / 2);
				maxY = Math.max(maxY, y + pad.height / 2);
			});
			
			ctx.strokeRect(minX - 0.3, minY - 0.3, maxX - minX + 0.6, maxY - minY + 0.6);
		}
		
		ctx.setLineDash([]);
	}

	// Exportação
	function exportSVG() {
		const bbox = getBoundingBox();
		const width = bbox.maxX - bbox.minX + 10;
		const height = bbox.maxY - bbox.minY + 10;
		const cx = (bbox.minX + bbox.maxX) / 2;
		const cy = (bbox.minY + bbox.maxY) / 2;
		
		let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}mm" height="${height}mm" viewBox="${cx - width/2} ${cy - height/2} ${width} ${height}">\n`;
		svg += `  <rect x="${cx - width/2}" y="${cy - height/2}" width="${width}" height="${height}" fill="#1a1f2e"/>\n`;
		
		state.elements.forEach(el => {
			if (el.type === 'trace') {
				svg += `  <line x1="${el.x1}" y1="${el.y1}" x2="${el.x2}" y2="${el.y2}" stroke="${LAYER_COLORS[el.layer]}" stroke-width="${el.width}" stroke-linecap="round"/>\n`;
			} else if (el.type === 'pad') {
				svg += `  <circle cx="${el.x}" cy="${el.y}" r="${el.diameter/2}" fill="${LAYER_COLORS[el.layer]}"/>\n`;
			} else if (el.type === 'via') {
				svg += `  <circle cx="${el.x}" cy="${el.y}" r="${el.diameter/2}" fill="#999999"/>\n`;
				svg += `  <circle cx="${el.x}" cy="${el.y}" r="${el.holeDiameter/2}" fill="#000000"/>\n`;
			} else if (el.type === 'outline') {
				svg += `  <line x1="${el.x1}" y1="${el.y1}" x2="${el.x2}" y2="${el.y2}" stroke="${LAYER_COLORS[el.layer] || '#22C55E'}" stroke-width="${el.width || 0.2}" />\n`;
			}
		});
		
		svg += '</svg>';
		
		downloadFile('pcb-design.svg', svg, 'image/svg+xml');
		exportModal.hidden = true;
	}

	function exportJSON() {
		const data = JSON.stringify(state.elements, null, 2);
		downloadFile('pcb-design.json', data, 'application/json');
		exportModal.hidden = true;
	}

	function exportPNG() {
		const tempCanvas = document.createElement('canvas');
		const tempCtx = tempCanvas.getContext('2d');
		const bbox = getBoundingBox();
		const padding = 10;
		const width = bbox.maxX - bbox.minX + padding * 2;
		const height = bbox.maxY - bbox.minY + padding * 2;
		const scale = 10; // pixels per mm
		
		tempCanvas.width = width * scale;
		tempCanvas.height = height * scale;
		
		tempCtx.fillStyle = '#1a1f2e';
		tempCtx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);
		
		tempCtx.translate(padding * scale - bbox.minX * scale, padding * scale - bbox.minY * scale);
		tempCtx.scale(scale, scale);
		
		// Renderizar elementos
		state.elements.forEach(el => {
			if (el.type === 'trace') {
				tempCtx.strokeStyle = LAYER_COLORS[el.layer];
				tempCtx.lineWidth = el.width;
				tempCtx.lineCap = 'round';
				tempCtx.beginPath();
				tempCtx.moveTo(el.x1, el.y1);
				tempCtx.lineTo(el.x2, el.y2);
				tempCtx.stroke();
			} else if (el.type === 'pad') {
				tempCtx.fillStyle = LAYER_COLORS[el.layer];
				tempCtx.beginPath();
				tempCtx.arc(el.x, el.y, el.diameter / 2, 0, Math.PI * 2);
				tempCtx.fill();
			} else if (el.type === 'via') {
				tempCtx.fillStyle = '#999999';
				tempCtx.beginPath();
				tempCtx.arc(el.x, el.y, el.diameter / 2, 0, Math.PI * 2);
				tempCtx.fill();
				tempCtx.fillStyle = '#000000';
				tempCtx.beginPath();
				tempCtx.arc(el.x, el.y, el.holeDiameter / 2, 0, Math.PI * 2);
				tempCtx.fill();
			} else if (el.type === 'outline') {
				tempCtx.strokeStyle = LAYER_COLORS[el.layer] || '#22C55E';
				tempCtx.lineWidth = el.width || 0.2;
				tempCtx.beginPath();
				tempCtx.moveTo(el.x1, el.y1);
				tempCtx.lineTo(el.x2, el.y2);
				tempCtx.stroke();
			}
		});
		
		tempCanvas.toBlob(blob => {
			const url = URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url;
			a.download = 'pcb-design.png';
			a.click();
			URL.revokeObjectURL(url);
		});
		
		exportModal.hidden = true;
	}

	function getBoundingBox() {
		let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
		
		state.elements.forEach(el => {
			if (el.type === 'trace') {
				minX = Math.min(minX, el.x1, el.x2);
				maxX = Math.max(maxX, el.x1, el.x2);
				minY = Math.min(minY, el.y1, el.y2);
				maxY = Math.max(maxY, el.y1, el.y2);
			} else if (el.type === 'outline') {
				minX = Math.min(minX, el.x1, el.x2);
				maxX = Math.max(maxX, el.x1, el.x2);
				minY = Math.min(minY, el.y1, el.y2);
				maxY = Math.max(maxY, el.y1, el.y2);
			} else if (el.x !== undefined) {
				minX = Math.min(minX, el.x);
				maxX = Math.max(maxX, el.x);
				minY = Math.min(minY, el.y);
				maxY = Math.max(maxY, el.y);
			}
		});
		
		if (minX === Infinity) {
			return { minX: -50, minY: -50, maxX: 50, maxY: 50 };
		}
		
		return { minX, minY, maxX, maxY };
	}

	function downloadFile(filename, content, mimeType) {
		const blob = new Blob([content], { type: mimeType });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = filename;
		a.click();
		URL.revokeObjectURL(url);
	}

	// --------- DRC (Design Rule Check) ---------
	function updateDRC() {
		const rules = state.drc;
		const issues = [];

		// Helper: obter pads absolutos (componentes + pads soltos)
		function* iteratePads() {
			for (const el of state.elements) {
				if (el.type === 'pad') {
					yield { x: el.x, y: el.y, w: el.diameter, h: el.diameter, elId: el.id, type: 'pad' };
				} else if (el.type === 'via') {
					yield { x: el.x, y: el.y, w: el.diameter, h: el.diameter, elId: el.id, type: 'via' };
				} else if (el.type === 'component') {
					const comp = COMPONENT_LIBRARY[el.componentId];
					const pads = el.pads && Array.isArray(el.pads) ? el.pads : (comp ? comp.pads : []);
					for (let i = 0; i < pads.length; i++) {
						const p = pads[i];
						yield { x: el.x + p.x, y: el.y + p.y, w: p.width || p.diameter || 1, h: p.height || p.diameter || 1, elId: el.id, type: 'comp-pad' };
					}
				}
			}
		}

		// largura mínima das trilhas
		for (const tr of state.elements) {
			if (tr.type === 'trace' && tr.width < rules.minTraceWidth) {
				issues.push({ aId: tr.id, type: 'min-trace-width', msg: `Trilha < ${rules.minTraceWidth}mm` });
			}
		}

		// clearance trilha↔trilha
		const traces = state.elements.filter(e => e.type === 'trace');
		const getSegs = (tr) => {
			const pts = (tr.points && tr.points.length >= 2)
				? tr.points.map(([x,y]) => ({ x, y }))
				: [{ x: tr.x1, y: tr.y1 }, { x: tr.x2, y: tr.y2 }];
			const segs = [];
			for (let i = 0; i < pts.length - 1; i++) {
				segs.push([pts[i].x, pts[i].y, pts[i+1].x, pts[i+1].y]);
			}
			return segs;
		};
		for (let i = 0; i < traces.length; i++) {
			for (let j = i + 1; j < traces.length; j++) {
				const a = traces[i], b = traces[j];
				const sa = getSegs(a), sb = getSegs(b);
				let minD = Infinity;
				for (const [ax1, ay1, ax2, ay2] of sa) {
					for (const [bx1, by1, bx2, by2] of sb) {
						const d = distSegSeg(ax1, ay1, ax2, ay2, bx1, by1, bx2, by2);
						if (d < minD) minD = d;
					}
				}
				const dEdge = minD - (a.width / 2 + b.width / 2);
				if (dEdge < rules.minClearance) issues.push({ aId: a.id, bId: b.id, type: 'trace-trace', msg: 'Clearance trilha↔trilha' });
			}
		}

		// clearance pad↔trilha
		const padsArr = Array.from(iteratePads());
		for (const pad of padsArr) {
			for (const tr of traces) {
				const segs = getSegs(tr);
				for (const [x1,y1,x2,y2] of segs) {
					const d = distSegRect(x1, y1, x2, y2, pad.x, pad.y, pad.w, pad.h);
					const dEdge = d - tr.width / 2;
					if (dEdge < rules.padTraceClearance) {
						issues.push({ aId: tr.id, bId: pad.elId, type: 'pad-trace', msg: 'Clearance pad↔trilha' });
						break;
					}
				}
			}
		}

		// clearance via↔via (círculos)
		const vias = state.elements.filter(e => e.type === 'via');
		for (let i = 0; i < vias.length; i++) {
			for (let j = i + 1; j < vias.length; j++) {
				const a = vias[i], b = vias[j];
				const dCenter = Math.hypot(a.x - b.x, a.y - b.y);
				const rSum = (a.diameter / 2) + (b.diameter / 2);
				const dEdge = dCenter - rSum;
				if (dEdge < rules.viaClearance) {
					issues.push({ aId: a.id, bId: b.id, type: 'via-via', msg: 'Clearance via↔via' });
				}
			}
		}

		// colisão de footprints (bounding boxes) - simples
		const comps = state.elements.filter(e => e.type === 'component');
		function compBBox(el) {
			const comp = COMPONENT_LIBRARY[el.componentId];
			const pads = el.pads && Array.isArray(el.pads) ? el.pads : (comp ? comp.pads : []);
			let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
			pads.forEach(p => {
				minX = Math.min(minX, el.x + p.x - (p.width || p.diameter || 1) / 2);
				maxX = Math.max(maxX, el.x + p.x + (p.width || p.diameter || 1) / 2);
				minY = Math.min(minY, el.y + p.y - (p.height || p.diameter || 1) / 2);
				maxY = Math.max(maxY, el.y + p.y + (p.height || p.diameter || 1) / 2);
			});
			if (!pads.length) {
				// fallback
				minX = el.x - 1; maxX = el.x + 1; minY = el.y - 1; maxY = el.y + 1;
			}
			// expand por clearance
			const c = state.drc.componentClearance;
			return { minX: minX - c, minY: minY - c, maxX: maxX + c, maxY: maxY + c };
		}
		function bboxOverlap(a, b) {
			return !(a.maxX < b.minX || a.minX > b.maxX || a.maxY < b.minY || a.minY > b.maxY);
		}
		for (let i = 0; i < comps.length; i++) {
			for (let j = i + 1; j < comps.length; j++) {
				const A = compBBox(comps[i]);
				const B = compBBox(comps[j]);
				if (bboxOverlap(A, B)) {
					issues.push({ aId: comps[i].id, bId: comps[j].id, type: 'footprint-collision', msg: 'Colisão de footprints' });
				}
			}
		}

		state.drcIssues = issues;
	}

	// Persistência
	function saveState() {
		try {
			const data = {
				elements: state.elements,
				zoom: state.zoom,
				panX: state.panX,
				panY: state.panY,
				padDiameter: state.padDiameter,
				viaDiameter: state.viaDiameter,
				viaHoleDiameter: state.viaHoleDiameter,
				drc: state.drc
			};
			localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
		} catch (e) {
			console.error('Erro ao salvar estado:', e);
		}
	}

	function loadState() {
		try {
			const raw = localStorage.getItem(STORAGE_KEY);
			if (!raw) return;
			const data = JSON.parse(raw);
			if (data.elements) state.elements = data.elements;
			if (data.zoom) state.zoom = data.zoom;
			if (data.panX !== undefined) state.panX = data.panX;
			if (data.panY !== undefined) state.panY = data.panY;
			if (data.padDiameter) state.padDiameter = data.padDiameter;
			if (data.viaDiameter) state.viaDiameter = data.viaDiameter;
			if (data.viaHoleDiameter) state.viaHoleDiameter = data.viaHoleDiameter;
			if (data.drc) {
				state.drc.minTraceWidth = data.drc.minTraceWidth ?? state.drc.minTraceWidth;
				state.drc.minClearance = data.drc.minClearance ?? state.drc.minClearance;
				state.drc.padTraceClearance = data.drc.padTraceClearance ?? state.drc.padTraceClearance;
				state.drc.componentClearance = data.drc.componentClearance ?? state.drc.componentClearance;
				state.drc.viaClearance = data.drc.viaClearance ?? state.drc.viaClearance;
			}
			zoomLevelEl.textContent = `Zoom: x${Math.round(state.zoom * 500)}`;
		} catch (e) {
			console.error('Erro ao carregar estado:', e);
		}
	}

	function uid() {
		return Date.now().toString(36) + Math.random().toString(36).slice(2);
	}

	// Iniciar
	init();
	
	// Força resize após carregar completamente
	setTimeout(() => {
		resizeCanvas();
		render();
	}, 100);
})();

