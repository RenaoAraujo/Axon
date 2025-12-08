(() => {
	const display = document.getElementById('calc-display');
	const expression = document.getElementById('calc-expression');
	const buttons = document.querySelectorAll('.calc-btn');
	
	let currentValue = '0';
	let previousValue = null;
	let operator = null;
	let shouldResetDisplay = false;
	let expressionText = '';
	
	// Funções para converter entre vírgula (exibição) e ponto (cálculo)
	function toDisplay(value) {
		return value.toString().replace('.', ',');
	}
	
	function toNumber(value) {
		return parseFloat(value.toString().replace(',', '.'));
	}
	
	function updateDisplay() {
		display.textContent = toDisplay(currentValue);
		expression.textContent = expressionText;
	}
	
	function clear() {
		currentValue = '0';
		previousValue = null;
		operator = null;
		shouldResetDisplay = false;
		expressionText = '';
		updateDisplay();
	}
	
	function clearEntry() {
		currentValue = '0';
		shouldResetDisplay = false;
		updateDisplay();
	}
	
	function backspace() {
		if (currentValue.length > 1) {
			currentValue = currentValue.slice(0, -1);
		} else {
			currentValue = '0';
		}
		updateDisplay();
	}
	
	function appendNumber(num) {
		if (shouldResetDisplay) {
			currentValue = '0';
			shouldResetDisplay = false;
		}
		// Aceita tanto vírgula quanto ponto como decimal
		if (num === ',' || num === '.') {
			num = ',';
		}
		if (currentValue === '0' && num !== ',') {
			currentValue = num;
		} else {
			currentValue += num;
		}
		updateDisplay();
	}
	
	function setOperator(op) {
		if (previousValue !== null && operator !== null) {
			calculate();
		}
		previousValue = toNumber(currentValue);
		operator = op;
		shouldResetDisplay = true;
		currentValue = '0';
		expressionText = `${toDisplay(previousValue)} ${getOperatorSymbol(op)}`;
		updateDisplay();
	}
	
	function getOperatorSymbol(op) {
		const symbols = {
			'add': '+',
			'subtract': '−',
			'multiply': '×',
			'divide': '÷',
			'power': '^'
		};
		return symbols[op] || op;
	}
	
	function calculate() {
		if (previousValue === null || operator === null) return;
		
		const current = toNumber(currentValue);
		let result;
		
		switch (operator) {
			case 'add':
				result = previousValue + current;
				break;
			case 'subtract':
				result = previousValue - current;
				break;
			case 'multiply':
				result = previousValue * current;
				break;
			case 'divide':
				if (current === 0) {
					currentValue = 'Erro';
					clear();
					return;
				}
				result = previousValue / current;
				break;
			case 'power':
				result = Math.pow(previousValue, current);
				break;
			default:
				return;
		}
		
		// Formata o resultado
		result = parseFloat(result.toPrecision(15));
		if (result.toString().length > 15) {
			result = parseFloat(result.toFixed(10));
		}
		
		currentValue = result.toString();
		previousValue = null;
		operator = null;
		shouldResetDisplay = true;
		expressionText = '';
		updateDisplay();
	}
	
	function applyFunction(func) {
		const value = toNumber(currentValue);
		let result;
		
		switch (func) {
			case 'sqrt':
				if (value < 0) {
					currentValue = 'Erro';
					clear();
					return;
				}
				result = Math.sqrt(value);
				expressionText = `√(${toDisplay(value)})`;
				break;
			case 'square':
				result = value * value;
				expressionText = `(${toDisplay(value)})²`;
				break;
			case 'percent':
				result = value / 100;
				expressionText = `${toDisplay(value)}%`;
				break;
			case 'sin':
				result = Math.sin(value);
				expressionText = `sin(${toDisplay(value)})`;
				break;
			case 'cos':
				result = Math.cos(value);
				expressionText = `cos(${toDisplay(value)})`;
				break;
			case 'tan':
				result = Math.tan(value);
				expressionText = `tan(${toDisplay(value)})`;
				break;
			case 'log':
				if (value <= 0) {
					currentValue = 'Erro';
					clear();
					return;
				}
				result = Math.log10(value);
				expressionText = `log(${toDisplay(value)})`;
				break;
			case 'ln':
				if (value <= 0) {
					currentValue = 'Erro';
					clear();
					return;
				}
				result = Math.log(value);
				expressionText = `ln(${toDisplay(value)})`;
				break;
			case '1/x':
				if (value === 0) {
					currentValue = 'Erro';
					clear();
					return;
				}
				result = 1 / value;
				expressionText = `1/(${toDisplay(value)})`;
				break;
			case 'pi':
				result = Math.PI;
				expressionText = 'π';
				break;
			case 'e':
				result = Math.E;
				expressionText = 'e';
				break;
			default:
				return;
		}
		
		result = parseFloat(result.toPrecision(15));
		if (result.toString().length > 15) {
			result = parseFloat(result.toFixed(10));
		}
		
		currentValue = result.toString();
		shouldResetDisplay = true;
		updateDisplay();
	}
	
	buttons.forEach(button => {
		button.addEventListener('click', () => {
			const action = button.getAttribute('data-action');
			
			if (action === 'clear') {
				clear();
			} else if (action === 'clear-entry') {
				clearEntry();
			} else if (action === 'backspace') {
				backspace();
			} else if (action === 'decimal') {
				if (!currentValue.includes(',') && !currentValue.includes('.')) {
					appendNumber(',');
				}
			} else if (action === 'equals') {
				calculate();
			} else if (['add', 'subtract', 'multiply', 'divide', 'power'].includes(action)) {
				setOperator(action);
			} else if (['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'].includes(action)) {
				appendNumber(action);
			} else {
				applyFunction(action);
			}
		});
	});
	
	// Suporte para teclado
	document.addEventListener('keydown', (e) => {
		const key = e.key;
		
		if (key >= '0' && key <= '9') {
			appendNumber(key);
		} else if (key === ',' || key === '.') {
			if (!currentValue.includes(',') && !currentValue.includes('.')) {
				appendNumber(',');
			}
		} else if (key === '+') {
			setOperator('add');
		} else if (key === '-') {
			setOperator('subtract');
		} else if (key === '*') {
			setOperator('multiply');
		} else if (key === '/') {
			e.preventDefault();
			setOperator('divide');
		} else if (key === 'Enter' || key === '=') {
			calculate();
		} else if (key === 'Escape') {
			clear();
		} else if (key === 'Backspace') {
			backspace();
		}
	});
	
	updateDisplay();
	
	// Sistema de abas
	const tabButtons = document.querySelectorAll('.calc-tab-btn');
	const tabContents = document.querySelectorAll('.calc-tab-content');
	
	tabButtons.forEach(button => {
		button.addEventListener('click', () => {
			const targetTab = button.getAttribute('data-tab');
			
			// Remove active de todos
			tabButtons.forEach(btn => btn.classList.remove('active'));
			tabContents.forEach(content => {
				content.classList.remove('active');
				content.style.display = 'none';
			});
			
			// Adiciona active no selecionado
			button.classList.add('active');
			const targetContent = document.getElementById(`${targetTab}-tab`);
			if (targetContent) {
				targetContent.classList.add('active');
				targetContent.style.display = 'block';
			}
		});
	});
	
	// Sistema de fórmulas
	const formulaSelect = document.getElementById('formula-select');
	const formulaSubSelectContainer = document.getElementById('formula-sub-select-container');
	const formulaSubSelect = document.getElementById('formula-sub-select');
	const formulaSubSelectLabel = document.getElementById('formula-sub-select-label');
	const formulaDisplay = document.getElementById('formula-display');
	const formulaTitle = document.getElementById('formula-title');
	const formulaEquation = document.getElementById('formula-equation');
	const formulaInputs = document.getElementById('formula-inputs');
	const formulaResultValue = document.getElementById('formula-result-value');
	const conversionTable = document.getElementById('conversion-table');
	const conversionTableContent = document.getElementById('conversion-table-content');
	
	let currentFormula = null;
	let currentConfig = null;
	
	// Configurações das fórmulas
	const formulasConfig = {
		'ohm': {
			name: 'Lei de Ohm',
			hasSubSelect: true,
			subSelectLabel: 'O que deseja descobrir?',
			subSelectOptions: [
				{ value: 'I', label: 'Corrente (I)' },
				{ value: 'V', label: 'Tensão (V)' },
				{ value: 'R', label: 'Resistência (R)' }
			],
			configs: {
				'I': {
					title: 'Lei de Ohm - Calcular Corrente (I)',
					equation: 'I = V / R',
					inputs: [
						{ label: 'V', name: 'V', placeholder: 'Tensão (V)', unit: 'V' },
						{ label: 'R', name: 'R', placeholder: 'Resistência (Ω)', unit: 'Ω' }
					],
					calculate: (values) => {
						const V = parseFloat(values.V.replace(',', '.'));
						const R = parseFloat(values.R.replace(',', '.'));
						if (R === 0) return 'Erro: resistência zero';
						return V / R;
					},
					resultUnit: 'A'
				},
				'V': {
					title: 'Lei de Ohm - Calcular Tensão (V)',
					equation: 'V = I × R',
					inputs: [
						{ label: 'I', name: 'I', placeholder: 'Corrente (A)', unit: 'A' },
						{ label: 'R', name: 'R', placeholder: 'Resistência (Ω)', unit: 'Ω' }
					],
					calculate: (values) => {
						const I = parseFloat(values.I.replace(',', '.'));
						const R = parseFloat(values.R.replace(',', '.'));
						return I * R;
					},
					resultUnit: 'V'
				},
				'R': {
					title: 'Lei de Ohm - Calcular Resistência (R)',
					equation: 'R = V / I',
					inputs: [
						{ label: 'V', name: 'V', placeholder: 'Tensão (V)', unit: 'V' },
						{ label: 'I', name: 'I', placeholder: 'Corrente (A)', unit: 'A' }
					],
					calculate: (values) => {
						const V = parseFloat(values.V.replace(',', '.'));
						const I = parseFloat(values.I.replace(',', '.'));
						if (I === 0) return 'Erro: corrente zero';
						return V / I;
					},
					resultUnit: 'Ω'
				}
			}
		},
		'voltage-divider': {
			name: 'Divisor de Tensão',
			hasSubSelect: false,
			config: {
				title: 'Divisor de Tensão',
				equation: 'Vout = Vin × (R2 / (R1 + R2))',
				inputs: [
					{ label: 'Vin', name: 'Vin', placeholder: 'Tensão de entrada (V)', unit: 'V' },
					{ label: 'R1', name: 'R1', placeholder: 'Resistência R1 (Ω)', unit: 'Ω' },
					{ label: 'R2', name: 'R2', placeholder: 'Resistência R2 (Ω)', unit: 'Ω' }
				],
				calculate: (values) => {
					const Vin = parseFloat(values.Vin.replace(',', '.'));
					const R1 = parseFloat(values.R1.replace(',', '.'));
					const R2 = parseFloat(values.R2.replace(',', '.'));
					if (R1 + R2 === 0) return 'Erro: soma das resistências zero';
					return Vin * (R2 / (R1 + R2));
				},
				resultUnit: 'V'
			}
		},
		'power': {
			name: 'Potência Elétrica',
			hasSubSelect: true,
			subSelectLabel: 'O que deseja descobrir?',
			subSelectOptions: [
				{ value: 'P', label: 'Potência (P)' },
				{ value: 'V', label: 'Tensão (V)' },
				{ value: 'I', label: 'Corrente (I)' },
				{ value: 'R', label: 'Resistência (R)' }
			],
			configs: {
				'P': {
					title: 'Potência Elétrica - Calcular Potência (P)',
					equation: 'P = V × I',
					inputs: [
						{ label: 'V', name: 'V', placeholder: 'Tensão (V)', unit: 'V' },
						{ label: 'I', name: 'I', placeholder: 'Corrente (A)', unit: 'A' }
					],
					calculate: (values) => {
						const V = parseFloat(values.V.replace(',', '.'));
						const I = parseFloat(values.I.replace(',', '.'));
						return V * I;
					},
					resultUnit: 'W'
				},
				'V': {
					title: 'Potência Elétrica - Calcular Tensão (V)',
					equation: 'V = P / I',
					inputs: [
						{ label: 'P', name: 'P', placeholder: 'Potência (W)', unit: 'W' },
						{ label: 'I', name: 'I', placeholder: 'Corrente (A)', unit: 'A' }
					],
					calculate: (values) => {
						const P = parseFloat(values.P.replace(',', '.'));
						const I = parseFloat(values.I.replace(',', '.'));
						if (I === 0) return 'Erro: corrente zero';
						return P / I;
					},
					resultUnit: 'V'
				},
				'I': {
					title: 'Potência Elétrica - Calcular Corrente (I)',
					equation: 'I = P / V',
					inputs: [
						{ label: 'P', name: 'P', placeholder: 'Potência (W)', unit: 'W' },
						{ label: 'V', name: 'V', placeholder: 'Tensão (V)', unit: 'V' }
					],
					calculate: (values) => {
						const P = parseFloat(values.P.replace(',', '.'));
						const V = parseFloat(values.V.replace(',', '.'));
						if (V === 0) return 'Erro: tensão zero';
						return P / V;
					},
					resultUnit: 'A'
				},
				'R': {
					title: 'Potência Elétrica - Calcular Resistência (R)',
					equation: 'R = V² / P',
					inputs: [
						{ label: 'V', name: 'V', placeholder: 'Tensão (V)', unit: 'V' },
						{ label: 'P', name: 'P', placeholder: 'Potência (W)', unit: 'W' }
					],
					calculate: (values) => {
						const V = parseFloat(values.V.replace(',', '.'));
						const P = parseFloat(values.P.replace(',', '.'));
						if (P === 0) return 'Erro: potência zero';
						return (V * V) / P;
					},
					resultUnit: 'Ω'
				}
			}
		},
		'energy-consumption': {
			name: 'Consumo ao Longo do Tempo',
			hasSubSelect: true,
			subSelectLabel: 'O que deseja descobrir?',
			subSelectOptions: [
				{ value: 'E', label: 'Energia Consumida (E)' },
				{ value: 'P', label: 'Potência (P)' },
				{ value: 't', label: 'Tempo (t)' }
			],
			configs: {
				'E': {
					title: 'Consumo - Calcular Energia (E)',
					equation: 'E = P × t',
					inputs: [
						{ label: 'P', name: 'P', placeholder: 'Potência (W)', unit: 'W' },
						{ label: 't', name: 't', placeholder: 'Tempo (h)', unit: 'h' }
					],
					calculate: (values) => {
						const P = parseFloat(values.P.replace(',', '.'));
						const t = parseFloat(values.t.replace(',', '.'));
						return P * t;
					},
					resultUnit: 'Wh'
				},
				'P': {
					title: 'Consumo - Calcular Potência (P)',
					equation: 'P = E / t',
					inputs: [
						{ label: 'E', name: 'E', placeholder: 'Energia (Wh)', unit: 'Wh' },
						{ label: 't', name: 't', placeholder: 'Tempo (h)', unit: 'h' }
					],
					calculate: (values) => {
						const E = parseFloat(values.E.replace(',', '.'));
						const t = parseFloat(values.t.replace(',', '.'));
						if (t === 0) return 'Erro: tempo zero';
						return E / t;
					},
					resultUnit: 'W'
				},
				't': {
					title: 'Consumo - Calcular Tempo (t)',
					equation: 't = E / P',
					inputs: [
						{ label: 'E', name: 'E', placeholder: 'Energia (Wh)', unit: 'Wh' },
						{ label: 'P', name: 'P', placeholder: 'Potência (W)', unit: 'W' }
					],
					calculate: (values) => {
						const E = parseFloat(values.E.replace(',', '.'));
						const P = parseFloat(values.P.replace(',', '.'));
						if (P === 0) return 'Erro: potência zero';
						return E / P;
					},
					resultUnit: 'h'
				}
			}
		},
		'battery-consumption': {
			name: 'Consumo de Bateria',
			hasSubSelect: true,
			subSelectLabel: 'O que deseja descobrir?',
			subSelectOptions: [
				{ value: 't', label: 'Tempo de Duração (t)' },
				{ value: 'C', label: 'Capacidade da Bateria (C)' },
				{ value: 'P', label: 'Consumo de Potência (P)' }
			],
			configs: {
				't': {
					title: 'Bateria - Calcular Tempo de Duração',
					equation: 't = C / P',
					inputs: [
						{ label: 'C', name: 'C', placeholder: 'Capacidade (Wh)', unit: 'Wh' },
						{ label: 'P', name: 'P', placeholder: 'Potência (W)', unit: 'W' }
					],
					calculate: (values) => {
						const C = parseFloat(values.C.replace(',', '.'));
						const P = parseFloat(values.P.replace(',', '.'));
						if (P === 0) return 'Erro: potência zero';
						return C / P;
					},
					resultUnit: 'h'
				},
				'C': {
					title: 'Bateria - Calcular Capacidade Necessária',
					equation: 'C = P × t',
					inputs: [
						{ label: 'P', name: 'P', placeholder: 'Potência (W)', unit: 'W' },
						{ label: 't', name: 't', placeholder: 'Tempo desejado (h)', unit: 'h' }
					],
					calculate: (values) => {
						const P = parseFloat(values.P.replace(',', '.'));
						const t = parseFloat(values.t.replace(',', '.'));
						return P * t;
					},
					resultUnit: 'Wh'
				},
				'P': {
					title: 'Bateria - Calcular Consumo Máximo',
					equation: 'P = C / t',
					inputs: [
						{ label: 'C', name: 'C', placeholder: 'Capacidade (Wh)', unit: 'Wh' },
						{ label: 't', name: 't', placeholder: 'Tempo disponível (h)', unit: 'h' }
					],
					calculate: (values) => {
						const C = parseFloat(values.C.replace(',', '.'));
						const t = parseFloat(values.t.replace(',', '.'));
						if (t === 0) return 'Erro: tempo zero';
						return C / t;
					},
					resultUnit: 'W'
				}
			}
		}
	};
	
	// Quando uma fórmula for selecionada
	formulaSelect.addEventListener('change', (e) => {
		const selectedFormula = e.target.value;
		
		if (!selectedFormula || !formulasConfig[selectedFormula]) {
			formulaSubSelectContainer.style.display = 'none';
			formulaDisplay.style.display = 'none';
			currentFormula = null;
			currentConfig = null;
			return;
		}
		
		currentFormula = selectedFormula;
		const formula = formulasConfig[selectedFormula];
		
		// Configurar sub-select se necessário
		if (formula.hasSubSelect) {
			formulaSubSelectContainer.style.display = 'block';
			formulaSubSelectLabel.textContent = formula.subSelectLabel;
			formulaSubSelect.innerHTML = '<option value="">-- Selecione --</option>';
			formula.subSelectOptions.forEach(option => {
				const opt = document.createElement('option');
				opt.value = option.value;
				opt.textContent = option.label;
				formulaSubSelect.appendChild(opt);
			});
			formulaDisplay.style.display = 'none';
		} else {
			formulaSubSelectContainer.style.display = 'none';
			// Aplicar configuração diretamente
			currentConfig = formula.config;
			displayFormula();
		}
	});
	
	// Quando sub-select mudar (para fórmulas que precisam)
	formulaSubSelect.addEventListener('change', (e) => {
		if (!currentFormula) return;
		
		const selectedSub = e.target.value;
		const formula = formulasConfig[currentFormula];
		
		if (!selectedSub || !formula.configs[selectedSub]) {
			formulaDisplay.style.display = 'none';
			currentConfig = null;
			return;
		}
		
		currentConfig = formula.configs[selectedSub];
		displayFormula();
	});
	
	// Exibir a fórmula selecionada
	function displayFormula() {
		if (!currentConfig) return;
		
		formulaTitle.textContent = currentConfig.title;
		formulaEquation.textContent = currentConfig.equation;
		
		// Limpar inputs anteriores
		formulaInputs.innerHTML = '';
		
		// Criar inputs
		currentConfig.inputs.forEach(input => {
			const inputGroup = document.createElement('div');
			inputGroup.className = 'formula-input-group';
			inputGroup.innerHTML = `
				<label>${input.label} (${input.unit}):</label>
				<input type="text" data-formula="${currentFormula}" data-input="${input.name}" placeholder="${input.placeholder}" />
			`;
			formulaInputs.appendChild(inputGroup);
		});
		
		formulaDisplay.style.display = 'block';
		formulaResultValue.textContent = '-';
		
		// Mostrar tabela de conversões se for Consumo de Bateria
		if (currentFormula === 'battery-consumption') {
			showBatteryConversionTable();
		} else {
			conversionTable.style.display = 'none';
		}
	}
	
	// Mostrar tabela de conversões úteis para bateria
	function showBatteryConversionTable() {
		conversionTable.style.display = 'block';
		conversionTableContent.innerHTML = `
			<div style="display: grid; gap: 16px;">
				<div style="background: rgba(0,0,0,0.2); padding: 12px; border-radius: 6px;">
					<div style="color: rgba(232,236,241,0.9); font-size: 14px; font-weight: 600; margin-bottom: 8px;">mAh → A (Corrente)</div>
					<div style="color: rgba(232,236,241,0.7); font-size: 12px; margin-bottom: 8px;">Fórmula: A = mAh / (1000 × t)</div>
					<div class="formula-input-group" style="margin-top: 8px;">
						<label style="min-width: 80px;">mAh:</label>
						<input type="text" id="conv-mah-to-a-mah" placeholder="mAh" style="flex: 1; background: rgba(0,0,0,0.5); border: 1px solid rgba(232,236,241,0.2); border-radius: 4px; padding: 6px; color: #e8ecf1; font-size: 14px;" />
					</div>
					<div class="formula-input-group" style="margin-top: 8px;">
						<label style="min-width: 80px;">Tempo (h):</label>
						<input type="text" id="conv-mah-to-a-time" placeholder="Horas" style="flex: 1; background: rgba(0,0,0,0.5); border: 1px solid rgba(232,236,241,0.2); border-radius: 4px; padding: 6px; color: #e8ecf1; font-size: 14px;" />
					</div>
					<div style="margin-top: 8px; padding-top: 8px; border-top: 1px solid rgba(232,236,241,0.1);">
						<span style="color: rgba(232,236,241,0.6); font-size: 12px;">Resultado: </span>
						<span id="conv-mah-to-a-result" style="color: rgba(100,200,100,0.9); font-weight: 600;">-</span>
						<span style="color: rgba(232,236,241,0.6);"> A</span>
					</div>
				</div>
				<div style="background: rgba(0,0,0,0.2); padding: 12px; border-radius: 6px;">
					<div style="color: rgba(232,236,241,0.9); font-size: 14px; font-weight: 600; margin-bottom: 8px;">mAh → Wh (Energia)</div>
					<div style="color: rgba(232,236,241,0.7); font-size: 12px; margin-bottom: 8px;">Fórmula: Wh = (mAh × V) / 1000</div>
					<div class="formula-input-group" style="margin-top: 8px;">
						<label style="min-width: 80px;">mAh:</label>
						<input type="text" id="conv-mah-to-wh-mah" placeholder="mAh" style="flex: 1; background: rgba(0,0,0,0.5); border: 1px solid rgba(232,236,241,0.2); border-radius: 4px; padding: 6px; color: #e8ecf1; font-size: 14px;" />
					</div>
					<div class="formula-input-group" style="margin-top: 8px;">
						<label style="min-width: 80px;">Tensão (V):</label>
						<input type="text" id="conv-mah-to-wh-voltage" placeholder="Volts" style="flex: 1; background: rgba(0,0,0,0.5); border: 1px solid rgba(232,236,241,0.2); border-radius: 4px; padding: 6px; color: #e8ecf1; font-size: 14px;" />
					</div>
					<div style="margin-top: 8px; padding-top: 8px; border-top: 1px solid rgba(232,236,241,0.1);">
						<span style="color: rgba(232,236,241,0.6); font-size: 12px;">Resultado: </span>
						<span id="conv-mah-to-wh-result" style="color: rgba(100,200,100,0.9); font-weight: 600;">-</span>
						<span style="color: rgba(232,236,241,0.6);"> Wh</span>
					</div>
				</div>
			</div>
		`;
		
		// Adicionar listeners para cálculos automáticos (usar setTimeout para garantir que os elementos existam)
		setTimeout(() => {
			const mahToAMah = document.getElementById('conv-mah-to-a-mah');
			const mahToATime = document.getElementById('conv-mah-to-a-time');
			const mahToAResult = document.getElementById('conv-mah-to-a-result');
			const mahToWhMah = document.getElementById('conv-mah-to-wh-mah');
			const mahToWhVoltage = document.getElementById('conv-mah-to-wh-voltage');
			const mahToWhResult = document.getElementById('conv-mah-to-wh-result');
			
			if (mahToAMah && mahToATime && mahToAResult) {
				function updateMahToA() {
					const mah = parseFloat((mahToAMah.value || '0').replace(',', '.'));
					const time = parseFloat((mahToATime.value || '0').replace(',', '.'));
					if (mah && time && time > 0) {
						const result = mah / (1000 * time);
						mahToAResult.textContent = toDisplay(result);
					} else {
						mahToAResult.textContent = '-';
					}
				}
				
				mahToAMah.addEventListener('input', updateMahToA);
				mahToATime.addEventListener('input', updateMahToA);
			}
			
			if (mahToWhMah && mahToWhVoltage && mahToWhResult) {
				function updateMahToWh() {
					const mah = parseFloat((mahToWhMah.value || '0').replace(',', '.'));
					const voltage = parseFloat((mahToWhVoltage.value || '0').replace(',', '.'));
					if (mah && voltage) {
						const result = (mah * voltage) / 1000;
						mahToWhResult.textContent = toDisplay(result);
					} else {
						mahToWhResult.textContent = '-';
					}
				}
				
				mahToWhMah.addEventListener('input', updateMahToWh);
				mahToWhVoltage.addEventListener('input', updateMahToWh);
			}
		}, 100);
	}
	
	// Calcular quando valores mudarem
	formulaInputs.addEventListener('input', (e) => {
		if (e.target.matches('input[data-formula]') && currentConfig) {
			// Coletar valores
			const values = {};
			currentConfig.inputs.forEach(input => {
				const inputEl = document.querySelector(`input[data-formula="${currentFormula}"][data-input="${input.name}"]`);
				values[input.name] = inputEl.value || '0';
			});
			
			// Verificar se todos os campos estão preenchidos
			const allFilled = currentConfig.inputs.every(input => {
				const val = values[input.name];
				return val && val !== '0' && val.trim() !== '';
			});
			
			if (allFilled) {
				try {
					const result = currentConfig.calculate(values);
					if (typeof result === 'number') {
						const formatted = toDisplay(result);
						formulaResultValue.textContent = `${formatted} ${currentConfig.resultUnit}`;
					} else {
						formulaResultValue.textContent = result;
					}
				} catch (error) {
					formulaResultValue.textContent = 'Erro';
				}
			} else {
				formulaResultValue.textContent = '-';
			}
		}
	});
	
	// Controle do header escondido
	const headerTriggerArea = document.getElementById('header-trigger-area');
	const appHeader = document.getElementById('app-header');
	
	if (headerTriggerArea && appHeader) {
		let hoverTimeout;
		
		headerTriggerArea.addEventListener('mouseenter', () => {
			clearTimeout(hoverTimeout);
			appHeader.classList.add('visible');
		});
		
		headerTriggerArea.addEventListener('mouseleave', () => {
			hoverTimeout = setTimeout(() => {
				appHeader.classList.remove('visible');
			}, 300);
		});
		
		appHeader.addEventListener('mouseenter', () => {
			clearTimeout(hoverTimeout);
			appHeader.classList.add('visible');
		});
		
		appHeader.addEventListener('mouseleave', () => {
			hoverTimeout = setTimeout(() => {
				appHeader.classList.remove('visible');
			}, 300);
		});
	}
})();