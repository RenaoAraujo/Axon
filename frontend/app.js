(() => {
	const wsStatusEl = document.getElementById('ws-status');
	const tapMarker = document.getElementById('tap-marker');
	const detCanvas = document.getElementById('det-canvas');
	const dctx = detCanvas.getContext('2d');
	const hero = document.getElementById('hero');
	const appRoot = document.getElementById('app');
	const sophiaBtn = document.getElementById('sophia-btn');
	const sophiaWheel = document.getElementById('sophia-wheel');
	const orbitRing = document.getElementById('orbit-ring');
	const homeAlertsBox = document.getElementById('home-alerts');
	const STORAGE_KEY = 'sophiaWheelSlots.v1';
	const CAL_STORAGE_KEY = 'axonCalendar.v1';
	let loadedSlotsThisOpen = false;
	let selectedItem = null;
	let suppressNextClick = false;

	function setWsStatus(text, ok) {
		wsStatusEl.textContent = text;
		wsStatusEl.className = ok ? 'badge ok' : 'badge';
	}

	function showTapMarker(xPx, yPx) {
		tapMarker.style.left = `${xPx - 12}px`;
		tapMarker.style.top = `${yPx - 12}px`;
		tapMarker.hidden = false;
		clearTimeout(showTapMarker._t);
        showTapMarker._t = setTimeout(() => { tapMarker.hidden = true; }, 300);
	}

	function switchScreen(target) {
		const screens = document.querySelectorAll('.screen');
		screens.forEach(s => s.classList.remove('active'));
		const next = document.querySelector(`.screen[data-screen="${target}"]`);
		if (next) next.classList.add('active');
	}

	// Navegação por clique normal
	document.addEventListener('click', (e) => {
		const btn = e.target.closest('button.nav');
		if (btn) {
			const next = btn.getAttribute('data-target');
			if (next) switchScreen(next);
		}
	});

	// WebSocket para receber toques normalizados (x,y em [0..1])
	let ws;
	function connectWs() {
		const proto = location.protocol === 'https:' ? 'wss' : 'ws';
		ws = new WebSocket(`${proto}://${location.host}/ws`);
		ws.onopen = () => setWsStatus('Conectado', true);
		ws.onclose = () => { setWsStatus('Desconectado', false); setTimeout(connectWs, 1000); };
		ws.onerror = () => setWsStatus('Erro', false);
		ws.onmessage = (evt) => {
			try {
				const msg = JSON.parse(evt.data);
				if (msg.type === 'tap' && typeof msg.x === 'number' && typeof msg.y === 'number') {
					handleTap(msg.x, msg.y);
				} else if (msg.type === 'detections' && Array.isArray(msg.objects)) {
					// Se houver objetos mapeados ao projetor, usa centros (cx,cy) normalizados
					if (Array.isArray(msg.objects_mapped) && msg.projector_mapped) {
						const projected = msg.objects_mapped.map(o => ({
							label: o.label,
							confidence: o.confidence,
							// desenharemos círculos com raio fixo/relativo
							x1: o.cx, y1: o.cy, x2: o.cx, y2: o.cy
						}));
						renderDetections(projected);
					} else {
						renderDetections(msg.objects);
					}
				}
			} catch {}
		};
	}
	connectWs();

	// Exibir menu Sophia inicialmente (oculta app até clicar)
	if (hero && appRoot) appRoot.style.display = 'none';

	function loadSavedSlots(items) {
		try {
			const raw = localStorage.getItem(STORAGE_KEY);
			if (!raw) return;
			const saved = JSON.parse(raw);
			if (!saved || typeof saved !== 'object') return;
			// Se o número de botões mudou, limpa o cache
			const savedCount = Object.keys(saved).length;
			if (savedCount !== items.length) {
				localStorage.removeItem(STORAGE_KEY);
				return;
			}
			items.forEach((el) => {
				const key = el.getAttribute('data-action') || '';
				if (key in saved) el.dataset.slot = String(saved[key]);
			});
		} catch {}
	}
	function saveSlots(items) {
		const map = {};
		items.forEach((el) => {
			const key = el.getAttribute('data-action') || '';
			map[key] = Number(el.dataset.slot || 0);
		});
		try { localStorage.setItem(STORAGE_KEY, JSON.stringify(map)); } catch {}
	}

	function ensureUniqueSlots(items) {
		const n = items.length;
		const taken = new Set();
		items.forEach((el, idx) => {
			let slot = Number(el.dataset.slot);
			if (!Number.isFinite(slot)) slot = idx;
			let guard = 0;
			while (taken.has(slot) && guard < n) {
				slot = (slot + 1) % n;
				guard++;
			}
			el.dataset.slot = String(slot);
			taken.add(slot);
		});
	}

	// Roda de seleção: posicionamento dinâmico
	function layoutWheel() {
		if (!sophiaWheel) return;
		const items = Array.from(sophiaWheel.querySelectorAll('.wheel-item'));
		if (!items.length) return;
		const n = items.length;
		// aplica slots salvos na primeira abertura após toggle
		if (!loadedSlotsThisOpen) {
			loadSavedSlots(items);
			ensureUniqueSlots(items);
			loadedSlotsThisOpen = true;
		}
		const radius = computeRadius(items);
		items.forEach((el, idx) => {
			if (el.dataset.slot === undefined) el.dataset.slot = String(idx);
			const slot = Number(el.dataset.slot) % n;
			const angle = (-90 + (360 * slot / n)) * Math.PI / 180;
			const x = Math.cos(angle) * radius;
			const y = Math.sin(angle) * radius;
			const isSelected = el.classList.contains('selected');
			el.style.transform = `translate(-50%, -50%) translate(${x}px, ${y}px)${isSelected ? ' scale(1.12)' : ''}`;
		});
		// Dimensiona o anel para cruzar os centros das opções
		if (orbitRing) {
			orbitRing.style.width = `${radius * 2}px`;
			orbitRing.style.height = `${radius * 2}px`;
		}
	}
	function computeRadius(items) {
		// Baseado no tamanho do botão central (Jarvis) e dos itens, com margem
		const baseMin = Math.min(window.innerWidth, window.innerHeight);
		const btnRect = sophiaBtn.getBoundingClientRect();
		const jarvisR = Math.max(btnRect.width, btnRect.height) / 2;
		const itemSize = items[0].offsetWidth || 72;
		const itemR = itemSize / 2;
		const margin = 28; // px entre Jarvis e itens
		const minRadius = jarvisR + itemR + margin;
		const autoRadius = baseMin * 0.28;
		return Math.max(140, minRadius, autoRadius);
	}
	window.addEventListener('resize', () => {
		if (sophiaWheel?.classList.contains('open')) layoutWheel();
	});

	// Toggle da roda ao clicar em Sophia
	if (sophiaBtn && sophiaWheel) {
		sophiaBtn.addEventListener('click', () => {
			const expanded = sophiaBtn.getAttribute('aria-expanded') === 'true';
			if (expanded) {
				sophiaBtn.setAttribute('aria-expanded', 'false');
				sophiaWheel.classList.remove('open');
				if (orbitRing) orbitRing.hidden = true;
				setTimeout(() => { sophiaWheel.hidden = true; }, 250);
				loadedSlotsThisOpen = false;
			} else {
				sophiaBtn.setAttribute('aria-expanded', 'true');
				sophiaWheel.hidden = false;
				requestAnimationFrame(() => {
					sophiaWheel.classList.add('open');
					bindSelectSwap();
					layoutWheel();
					if (orbitRing) orbitRing.hidden = false;
				});
			}
		});
	}

	// Ações dos itens da roda
	if (sophiaWheel) {
		sophiaWheel.addEventListener('click', (e) => {
			const btn = e.target.closest('.wheel-item');
			console.log('[Wheel] Click detectado, btn:', btn);
			if (!btn) return;
			if (selectedItem) {
				e.preventDefault();
				e.stopPropagation();
				if (btn !== selectedItem) {
					swapSlots(selectedItem, btn);
					saveSlots(Array.from(sophiaWheel.querySelectorAll('.wheel-item')));
				}
				selectedItem.classList.remove('selected');
				selectedItem = null;
				layoutWheel();
				return;
			}
			if (suppressNextClick) {
				e.preventDefault();
				e.stopPropagation();
				suppressNextClick = false;
				return;
			}
			const action = btn.getAttribute('data-action');
			console.log('[Wheel] Botão clicado:', btn, 'Action:', action);
			if (action === 'calibration') {
				// Ao navegar para calibração, a página própria gerencia start/stop
				// Aqui apenas navegamos
				window.location.href = '/calibration';
			} else if (action === 'scanner') {
				// Abrir página dedicada do Scanner
				window.location.href = '/scanner';
			} else if (action === 'home') {
				const home = document.querySelector('.screen[data-screen="home"]');
				if (home) {
					document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
					home.classList.add('active');
				}
				// Parar scanner ao sair
				try { fetch('/api/scanner/stop', { method: 'POST' }); } catch {}
			} else if (action === 'sistema') {
				const sys = document.querySelector('.screen[data-screen="sistema"]');
				if (sys) {
					document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
					sys.classList.add('active');
				}
				// Parar scanner ao sair
				try { fetch('/api/scanner/stop', { method: 'POST' }); } catch {}
			} else if (action === 'sketch') {
				window.location.href = '/sketch';
			} else if (action === 'planner') {
				window.location.href = '/planner';
		} else if (action === 'projects') {
			window.location.href = '/projects';
		} else if (action === 'inventory') {
			window.location.href = '/inventory';
			} else if (action === 'pcb') {
				window.location.href = '/pcb';
			} else if (action === 'notes') {
				window.location.href = '/notes';
			}
		});
	}

	// Reordenar por seleção (long press) e toque para trocar
	function bindSelectSwap() {
		const items = Array.from(sophiaWheel.querySelectorAll('.wheel-item'));
		const n = items.length;
		let pressTimer = null;

		items.forEach(el => {
			el.style.touchAction = 'none';
			el.addEventListener('pointerdown', (e) => {
				pressTimer && clearTimeout(pressTimer);
				pressTimer = setTimeout(() => {
					activateSelection(el);
				}, 400);
			});
			el.addEventListener('pointerup', (e) => {
				pressTimer && clearTimeout(pressTimer);
			});
			el.addEventListener('pointercancel', () => { pressTimer && clearTimeout(pressTimer); });
			el.addEventListener('pointermove', () => {});
		});

		function centerOfWheel() {
			const rect = sophiaWheel.getBoundingClientRect();
			return { cx: rect.left + rect.width / 2, cy: rect.top + rect.height / 2 };
		}
		function nearestSlot(clientX, clientY, n) {
			const { cx, cy } = centerOfWheel();
			const dx = clientX - cx;
			const dy = clientY - cy;
			let ang = Math.atan2(dy, dx) * 180 / Math.PI; // -180..180
			ang = (ang + 450) % 360; // 0 no topo
			const step = 360 / n;
			return Math.round(ang / step) % n;
		}
		function assignToSlot(el, slot, n) {
			// Se o slot estiver ocupado, faz swap
			const other = Array.from(sophiaWheel.querySelectorAll('.wheel-item')).find(x => Number(x.dataset.slot) === slot && x !== el);
			const oldSlot = Number(el.dataset.slot);
			if (other) {
				other.dataset.slot = String(oldSlot);
			}
			el.dataset.slot = String(slot);
		}
		// Tocar fora dos círculos cancela seleção
		if (!hero._cancelSelBound) {
			hero.addEventListener('pointerdown', (e) => {
				if (!selectedItem) return;
				if (e.target.closest('.wheel-item')) return;
				if (e.target === sophiaBtn || e.target.closest('#sophia-btn')) return;
				selectedItem.classList.remove('selected');
				selectedItem = null;
				layoutWheel();
			}, { capture: true });
			hero._cancelSelBound = true;
		}
	}

	function activateSelection(el) {
		selectedItem?.classList.remove('selected');
		selectedItem = el;
		el.classList.add('selected');
		suppressNextClick = true;
		layoutWheel();
	}

	function swapSlots(a, b) {
		const aSlot = Number(a.dataset.slot || 0);
		const bSlot = Number(b.dataset.slot || 0);
		a.dataset.slot = String(bSlot);
		b.dataset.slot = String(aSlot);
	}

	function handleTap(nx, ny) {
		// Converte normalizado para pixel no viewport
		const x = Math.max(0, Math.min(1, nx)) * window.innerWidth;
		const y = Math.max(0, Math.min(1, ny)) * window.innerHeight;
		showTapMarker(x, y);
	}

	// Desenho das detecções
	function fitCanvas() {
		const ratio = window.devicePixelRatio || 1;
		detCanvas.width = Math.floor(window.innerWidth * ratio);
		detCanvas.height = Math.floor(window.innerHeight * ratio);
		detCanvas.style.width = `${window.innerWidth}px`;
		detCanvas.style.height = `${window.innerHeight}px`;
		dctx.setTransform(ratio, 0, 0, ratio, 0, 0);
	}
	window.addEventListener('resize', fitCanvas);
	fitCanvas();

	let lastDetectionsAt = 0;
	function clearIfStale() {
		const now = performance.now();
		if (now - lastDetectionsAt > 800) {
			dctx.clearRect(0, 0, detCanvas.width, detCanvas.height);
		}
		requestAnimationFrame(clearIfStale);
	}
	requestAnimationFrame(clearIfStale);

	function renderDetections(objects) {
		lastDetectionsAt = performance.now();
		dctx.clearRect(0, 0, detCanvas.width, detCanvas.height);
		dctx.lineWidth = 3;
		dctx.font = '12px system-ui';
		objects.forEach(o => {
			const x1 = Math.max(0, Math.min(1, o.x1)) * window.innerWidth;
			const y1 = Math.max(0, Math.min(1, o.y1)) * window.innerHeight;
			const x2 = Math.max(0, Math.min(1, o.x2)) * window.innerWidth;
			const y2 = Math.max(0, Math.min(1, o.y2)) * window.innerHeight;
			const w = Math.max(0, x2 - x1);
			const h = Math.max(0, y2 - y1);
			const cx = x1 + w / 2;
			const cy = y1 + h / 2;
			let r = Math.max(w, h) / 2;
			if (w === 0 && h === 0) {
				r = Math.max(16, Math.min(window.innerWidth, window.innerHeight) * 0.03);
			}
			const color = '#4cc9f0'; // cor do destaque

			// círculo
			dctx.beginPath();
			dctx.strokeStyle = color;
			dctx.arc(cx, cy, r, 0, Math.PI * 2);
			dctx.stroke();

			// rótulo acima do círculo
			const text = `${o.label} ${(o.confidence * 100).toFixed(0)}%`;
			const pad = 4;
			const tw = dctx.measureText(text).width + pad * 2;
			const th = 16 + pad * 2;
			const tx = Math.max(0, Math.min(window.innerWidth - tw, cx - tw / 2));
			const ty = Math.max(0, cy - r - th - 6);
			dctx.fillStyle = 'rgba(14,20,34,0.9)';
			dctx.fillRect(tx, ty, tw, th);
			dctx.fillStyle = '#e8ecf1';
			dctx.fillText(text, tx + pad, ty + 12 + pad);
		});
	}

	// Extensão do onmessage para detecções
	(function extendWsHandler() {
		const baseConnect = connectWs;
		connectWs = function() {
			const proto = location.protocol === 'https:' ? 'wss' : 'ws';
			ws = new WebSocket(`${proto}://${location.host}/ws`);
			ws.onopen = () => setWsStatus('Conectado', true);
			ws.onclose = () => { setWsStatus('Desconectado', false); setTimeout(connectWs, 1000); };
			ws.onerror = () => setWsStatus('Erro', false);
			ws.onmessage = (evt) => {
				try {
					const msg = JSON.parse(evt.data);
					if (msg.type === 'tap' && typeof msg.x === 'number' && typeof msg.y === 'number') {
						handleTap(msg.x, msg.y);
					} else if (msg.type === 'detections' && Array.isArray(msg.objects)) {
						renderDetections(msg.objects);
					}
				} catch {}
			};
		};
	})();

	function updateHomeAlerts() {
		if (!homeAlertsBox) return;
		const events = loadCalendarEvents();
		const now = new Date();
		const upcoming = events
			.map(resolveEventDetails)
			.filter((item) => {
				if (!item || !item.date) return false;
				const diff = item.date.getTime() - now.getTime();
				return diff >= 0 && diff <= 86400000;
			})
			.sort((a, b) => a.date - b.date)
			.slice(0, 4);

		if (!upcoming.length) {
			homeAlertsBox.hidden = true;
			homeAlertsBox.innerHTML = '';
			return;
		}
		const list = upcoming
			.map((item) => {
				const label = escapeHtml(item.label || 'Compromisso');
				const meta = escapeHtml(`${item.dateBr} · ${item.context}`);
				return `<li><strong>${label}</strong><span>${meta}</span></li>`;
			})
			.join('');
		homeAlertsBox.innerHTML = `
			<div class="alerts-title">Compromissos nas próximas 24h</div>
			<ul>${list}</ul>
		`;
		homeAlertsBox.hidden = false;
	}

	function loadCalendarEvents() {
		try {
			const raw = localStorage.getItem(CAL_STORAGE_KEY);
			if (!raw) return [];
			const parsed = JSON.parse(raw);
			return Array.isArray(parsed) ? parsed : [];
		} catch {
			return [];
		}
	}

	function resolveEventDetails(event) {
		if (!event?.date) return null;
		const date = new Date(event.date);
		if (Number.isNaN(date.getTime())) return null;
		return {
			label: event.name || 'Compromisso',
			context: event.place || 'Calendário',
			date,
			dateBr: formatDateBrShort(date),
		};
	}

	function formatDateBrShort(date) {
		try {
			return date.toLocaleDateString('pt-BR', {
				day: '2-digit',
				month: '2-digit',
				hour: '2-digit',
				minute: '2-digit',
			});
		} catch {
			return date.toISOString().slice(0, 16).replace('T', ' ');
		}
	}

	function escapeHtml(str) {
		return String(str).replace(/[&<>"']/g, (ch) => (
			({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch] || ch
		));
	}

	updateHomeAlerts();
	window.addEventListener('focus', updateHomeAlerts);
	setInterval(updateHomeAlerts, 60000);

	// Garantir que o cache seja limpo se o número de botões mudou
	const wheelItems = document.querySelectorAll('.wheel-item');
	console.log('[Wheel] Total de botões:', wheelItems.length);
	const expectedActions = ['calibration', 'scanner', 'planner', 'sketch', 'projects', 'inventory', 'pcb', 'notes'];
	const currentActions = Array.from(wheelItems).map(item => item.getAttribute('data-action'));
	
	wheelItems.forEach((item, idx) => {
		const action = item.getAttribute('data-action');
		const slot = item.dataset.slot;
		console.log(`[Wheel] Botão ${idx}: action="${action}", slot="${slot}"`);
	});
	
	// Verificar se todas as ações esperadas estão presentes
	const hasAllActions = expectedActions.every(action => currentActions.includes(action));
	if (!hasAllActions || wheelItems.length !== 7) {
		console.log('[Wheel] Limpando cache - ações ou número de botões não correspondem');
		try {
			localStorage.removeItem(STORAGE_KEY);
		} catch {}
	}

})(); 


