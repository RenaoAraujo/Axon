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
		currentTool: 'select',
		currentLayer: 'top',
		traceWidth: 0.3,
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
			drill: true
		},
		layerOpacity: {
			top: 1.0,
			bottom: 1.0,
			'silk-top': 1.0,
			'silk-bottom': 1.0,
			drill: 1.0
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
	let dragHistorySaved = false;
	let dragHasMoved = false;

	// Cores das camadas
	const LAYER_COLORS = {
		top: '#DC2626',
		bottom: '#2563EB',
		'silk-top': '#FFFFFF',
		'silk-bottom': '#FCD34D',
		drill: '#000000'
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

		const snappedX = state.snapToGrid ? snapToGrid(x) : x;
		const snappedY = state.snapToGrid ? snapToGrid(y) : y;

		if (state.currentTool === 'select') {
			const clicked = findElementAt(snappedX, snappedY);
			if (clicked) {
				if (!e.shiftKey) state.selectedIds.clear();
				state.selectedIds.add(clicked.id);
				isDragging = true;
				// Salvar histórico quando começa a arrastar (estado inicial)
				if (!dragHistorySaved) {
					saveHistoryState();
					dragHistorySaved = true;
				}
			} else {
				state.selectedIds.clear();
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
			
			tempElement = {
				type: 'trace',
				layer: state.currentLayer,
				width: state.traceWidth,
				x1: snappedX,
				y1: snappedY,
				x2: snappedX,
				y2: snappedY
			};
		} else if (state.currentTool === 'pad') {
			addElement({
				type: 'pad',
				layer: state.currentLayer,
				x: snappedX,
				y: snappedY,
				diameter: 1.5
			});
		} else if (state.currentTool === 'via') {
			addElement({
				type: 'via',
				x: snappedX,
				y: snappedY,
				diameter: 0.8,
				holeDiameter: 0.4
			});
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

		const snappedX = state.snapToGrid ? snapToGrid(x) : x;
		const snappedY = state.snapToGrid ? snapToGrid(y) : y;

		// Atualizar posição do cursor
		cursorPosEl.textContent = `X: ${snappedX.toFixed(2)}mm Y: ${snappedY.toFixed(2)}mm`;

		if (isDragging && state.selectedIds.size > 0) {
			const dx = snappedX - lastMouseX;
			const dy = snappedY - lastMouseY;
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
				}
			});
			lastMouseX = snappedX;
			lastMouseY = snappedY;
			render();
		} else if (tempElement) {
			if (tempElement.type === 'trace') {
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

		if (tempElement) {
			if (tempElement.type === 'trace') {
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
	}

	function handleWheel(e) {
		e.preventDefault();
		const delta = e.deltaY > 0 ? 0.9 : 1.1;
		const newZoom = Math.max(0.1, Math.min(10, state.zoom * delta));
		
		const rect = canvas.getBoundingClientRect();
		const mouseX = e.clientX - rect.left - canvas.width / 2;
		const mouseY = e.clientY - rect.top - canvas.height / 2;
		
		state.panX = mouseX - (mouseX - state.panX) * (newZoom / state.zoom);
		state.panY = mouseY - (mouseY - state.panY) * (newZoom / state.zoom);
		state.zoom = newZoom;
		
		zoomLevelEl.textContent = `Zoom: ${Math.round(state.zoom * 100)}%`;
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
		element.id = uid();
		state.elements.push(element);
		saveState();
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
				const dist = pointToLineDistance(x, y, el.x1, el.y1, el.x2, el.y2);
				if (dist <= el.width / 2 + tolerance) return el;
			} else if (el.type === 'component') {
				const comp = COMPONENT_LIBRARY[el.componentId];
				if (!comp) continue;
				for (const pad of comp.pads) {
					const px = el.x + pad.x;
					const py = el.y + pad.y;
					if (Math.abs(px - x) <= pad.width / 2 && Math.abs(py - y) <= pad.height / 2) {
						return el;
					}
				}
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

	function placeComponent(componentId) {
		const comp = COMPONENT_LIBRARY[componentId];
		if (!comp) return;
		
		addElement({
			type: 'component',
			componentId,
			layer: state.currentLayer,
			x: 0,
			y: 0,
			rotation: 0
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
		
		// Seleção
		state.selectedIds.forEach(id => {
			const el = state.elements.find(e => e.id === id);
			if (el) renderSelection(el);
		});
		
		ctx.restore();
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
			ctx.strokeStyle = LAYER_COLORS[el.layer] || '#FFFFFF';
			ctx.lineWidth = el.width;
			ctx.lineCap = 'round';
			ctx.beginPath();
			ctx.moveTo(el.x1, el.y1);
			ctx.lineTo(el.x2, el.y2);
			ctx.stroke();
			ctx.globalAlpha = 1;
		} else if (el.type === 'pad') {
			ctx.globalAlpha = alpha;
			ctx.fillStyle = LAYER_COLORS[el.layer] || '#FFFFFF';
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
			
			// Pads
			ctx.globalAlpha = alpha;
			ctx.fillStyle = LAYER_COLORS[el.layer] || '#DC2626';
			comp.pads.forEach(pad => {
				ctx.fillRect(pad.x - pad.width / 2, pad.y - pad.height / 2, pad.width, pad.height);
				if (pad.hole) {
					ctx.fillStyle = '#000000';
					ctx.beginPath();
					ctx.arc(pad.x, pad.y, pad.hole / 2, 0, Math.PI * 2);
					ctx.fill();
					ctx.fillStyle = LAYER_COLORS[el.layer] || '#DC2626';
				}
			});
			
			// Silkscreen
			ctx.strokeStyle = '#FFFFFF';
			ctx.lineWidth = 0.15;
			comp.silk?.forEach(shape => {
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

	// Persistência
	function saveState() {
		try {
			const data = {
				elements: state.elements,
				zoom: state.zoom,
				panX: state.panX,
				panY: state.panY
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
			zoomLevelEl.textContent = `Zoom: ${Math.round(state.zoom * 100)}%`;
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

