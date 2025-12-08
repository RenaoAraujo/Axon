(() => {
	const categoryEl = document.getElementById('conv-category');
	const valueEl = document.getElementById('conv-value');
	const fromEl = document.getElementById('conv-from');
	const toEl = document.getElementById('conv-to');
	const runBtn = document.getElementById('conv-run');
	const resultBox = document.getElementById('conv-result');

	const UNITS = {
		length: { label: 'Comprimento', endpoint: '/api/convert/length', all: '/api/convert/length/all', units: ['mm', 'cm', 'm', 'km', 'in', 'ft', 'yd', 'mi', 'nm'] },
		speed: { label: 'Velocidade', endpoint: '/api/convert/speed', all: '/api/convert/speed/all', units: ['mps', 'kmh', 'mph', 'fps', 'kt'] },
		temp: { label: 'Temperatura', endpoint: '/api/convert/temp', all: '/api/convert/temp/all', units: ['c', 'k', 'f'] },
		mass: { label: 'Massa/Peso', endpoint: '/api/convert/mass', all: '/api/convert/mass/all', units: ['mg', 'g', 'kg', 'ton', 'lb', 'oz'] },
		time: { label: 'Tempo', endpoint: '/api/convert/time', all: '/api/convert/time/all', units: ['s', 'm', 'h'] },
		pressure: { label: 'Pressão', endpoint: '/api/convert/pressure', all: '/api/convert/pressure/all', units: ['pa', 'bar', 'psi'] },
		torque: { label: 'Torque', endpoint: '/api/convert/torque', all: '/api/convert/torque/all', units: ['N.m', 'kgf.cm', 'kgf.m'] },
		charge: { label: 'Carga Elétrica', endpoint: '/api/convert/charge', all: '/api/convert/charge/all', units: ['mah', 'ah', 'c'] },
		energy: { label: 'Energia Elétrica', endpoint: '/api/convert/energy', all: '/api/convert/energy/all', units: ['mwh', 'wh', 'kwh', 'j'] },
	};

	// Labels amigáveis por categoria
	const LABELS = {
		length: {
			mm: 'Milímetros (mm)', cm: 'Centímetros (cm)', m: 'Metros (m)', km: 'Quilômetros (km)',
			in: 'Polegadas (in)', ft: 'Pés (ft)', yd: 'Jardas (yd)', mi: 'Milhas (mi)', nm: 'Milhas náuticas (nm)',
		},
		speed: {
			mps: 'm/s', kmh: 'km/h', mph: 'mph',
			fps: 'Pés por segundo (ft/s)', kt: 'Nós (kt)',
		},
		temp: { c: 'Graus Celsius (°C)', k: 'Kelvin (K)', f: 'Graus Fahrenheit (°F)' },
		mass: {
			mg: 'Miligramas (mg)', g: 'Gramas (g)', kg: 'Quilogramas (kg)', ton: 'Toneladas (ton)', lb: 'Libras (lb)', oz: 'Onças (oz)',
		},
		time: { s: 'Segundos (s)', m: 'Minutos (min)', h: 'Horas (h)' },
		pressure: { pa: 'Pascal (Pa)', bar: 'Bar (bar)', psi: 'PSI (psi)' },
		torque: { 'N.m': 'Newton-metro (N·m)', 'kgf.cm': 'Quilograma-força centímetro (kgf·cm)', 'kgf.m': 'Quilograma-força metro (kgf·m)' },
		charge: { mah: 'Miliamperes-hora (mAh)', ah: 'Amperes-hora (Ah)', c: 'Coulombs (C)' },
		energy: { mwh: 'Miliwatts-hora (mWh)', wh: 'Watts-hora (Wh)', kwh: 'Quilowatts-hora (kWh)', j: 'Joules (J)' },
	};

	// Símbolo curto para exibição de resultados
	const SYMBOLS = {
		length: { mm: 'mm', cm: 'cm', m: 'm', km: 'km', in: 'in', ft: 'ft', yd: 'yd', mi: 'mi', nm: 'nm' },
		speed: { mps: 'm/s', kmh: 'km/h', mph: 'mph', fps: 'ft/s', kt: 'kt' },
		temp: { c: '°C', k: 'K', f: '°F' },
		mass: { mg: 'mg', g: 'g', kg: 'kg', ton: 'ton', lb: 'lb', oz: 'oz' },
		time: { s: 's', m: 'min', h: 'h' },
		pressure: { pa: 'Pa', bar: 'bar', psi: 'psi' },
		torque: { 'N.m': 'N·m', 'kgf.cm': 'kgf·cm', 'kgf.m': 'kgf·m' },
		charge: { mah: 'mAh', ah: 'Ah', c: 'C' },
		energy: { mwh: 'mWh', wh: 'Wh', kwh: 'kWh', j: 'J' },
	};

	function labelFor(cat, unit) {
		return (LABELS[cat] && LABELS[cat][unit]) ? LABELS[cat][unit] : unit;
	}
	function symbolFor(cat, unit) {
		return (SYMBOLS[cat] && SYMBOLS[cat][unit]) ? SYMBOLS[cat][unit] : unit;
	}

	function fillUnits() {
		const def = UNITS[categoryEl.value];
		fromEl.innerHTML = '';
		toEl.innerHTML = '';
		def.units.forEach(u => {
			const a = document.createElement('option'); a.value = u; a.textContent = labelFor(categoryEl.value, u); fromEl.appendChild(a);
			const b = document.createElement('option'); b.value = u; b.textContent = labelFor(categoryEl.value, u); toEl.appendChild(b);
		});
		// valores padrão
		fromEl.value = def.units[0];
		toEl.value = def.units[1] || def.units[0];
	}

	function showResult(text) {
		resultBox.hidden = false;
		resultBox.textContent = text;
	}

	function clearResult() {
		resultBox.hidden = true;
		resultBox.textContent = '';
	}

	function formatNumber(n) {
		if (typeof n !== 'number' || !Number.isFinite(n)) return String(n);
		const abs = Math.abs(n);
		if (abs !== 0 && (abs < 1e-3 || abs >= 1e6)) return n.toExponential(6);
		return n.toLocaleString('pt-BR', { maximumFractionDigits: 6 });
	}

	async function doConvert() {
		clearResult();
		const def = UNITS[categoryEl.value];
		const value = parseFloat(valueEl.value || '0');
		const from = fromEl.value;
		const to = toEl.value;
		try {
			const url = `${def.endpoint}?value=${encodeURIComponent(value)}&from_unit=${encodeURIComponent(from)}&to_unit=${encodeURIComponent(to)}`;
			const res = await fetch(url);
			const json = await res.json();
			if (!res.ok || json.error) {
				showResult(`Erro: ${json.error || 'Falha ao converter'}`);
				return;
			}
			const factorInfo = (json.factor === null || json.factor === undefined) ? '' : ` (fator: ${formatNumber(json.factor)})`;
			const fromSym = symbolFor(categoryEl.value, json.from);
			const toSym = symbolFor(categoryEl.value, json.to);
			showResult(`${formatNumber(json.value)} ${fromSym} = ${formatNumber(json.result)} ${toSym}${factorInfo}`);
		} catch (e) {
			showResult('Erro de rede');
		}
	}

	categoryEl?.addEventListener('change', fillUnits);
	runBtn?.addEventListener('click', doConvert);
	valueEl?.addEventListener('keydown', (e) => { if (e.key === 'Enter') doConvert(); });

	fillUnits();
	doConvert();
})();


