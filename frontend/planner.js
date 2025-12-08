(() => {
	const STORAGE_KEY = 'axonPlanner.v1';
	const CAL_STORAGE_KEY = 'axonCalendar.v1';
	const STATUS_OPTIONS = ['Planejado', 'Em andamento', 'Bloqueado', 'Concluído'];
	const TABLE_TEMPLATES = {
		tarefas: {
			label: 'Tarefas',
			columns: [
				{ key: 'title', label: 'Tarefa', placeholder: 'Tarefa' },
				{ key: 'owner', label: 'Responsável', placeholder: 'Responsável' },
				{ key: 'status', label: 'Status', type: 'select', options: STATUS_OPTIONS },
				{ key: 'due', label: 'Prazo', placeholder: 'dd/mm/aaaa', deadline: true },
			],
		},
		financeiro: {
			label: 'Financeiro',
			columns: [
				{ key: 'description', label: 'Descrição', placeholder: 'Conta de luz' },
				{ key: 'category', label: 'Categoria', placeholder: 'Moradia' },
				{ key: 'amount', label: 'Valor (R$)', placeholder: '0,00' },
				{ key: 'due', label: 'Vencimento', placeholder: 'dd/mm/aaaa', deadline: true },
				{ key: 'status', label: 'Status', type: 'select', options: ['Previsto', 'Pago', 'Atrasado'] },
			],
		},
	};
	const DEFAULT_TABLE_TEMPLATE = 'tarefas';
	const LEGACY_COLUMN_LABELS = {
		'tarefa': 'title',
		'title': 'title',
		'responsável': 'owner',
		'responsavel': 'owner',
		'owner': 'owner',
		'descrição': 'description',
		'descricao': 'description',
		'description': 'description',
		'categoria': 'category',
		'category': 'category',
		'amount': 'amount',
		'valor': 'amount',
		'valor (r$)': 'amount',
		'status': 'status',
		'prazo': 'due',
		'vencimento': 'due',
		'deadline': 'due',
		'data': 'due',
		'data limite': 'due',
	};
	function getTemplateConfig(target) {
		const templateId = typeof target === 'string' ? target : target?.template;
		return TABLE_TEMPLATES[templateId] || TABLE_TEMPLATES[DEFAULT_TABLE_TEMPLATE];
	}
	function getTemplateColumns(target) {
		return getTemplateConfig(target).columns;
	}
	const grid = document.getElementById('planner-grid');
	const tablesGrid = document.getElementById('tables-grid');
	const plannerRoot = document.querySelector('.planner-screen');
	const alertsBox = document.getElementById('planner-alerts');
	const btnAddList = document.getElementById('btn-add-list');
	const btnAddTable = document.getElementById('btn-add-table');
	const btnReset = document.getElementById('btn-reset-board');
	const tabs = document.querySelectorAll('.tab-btn[data-view]');
	const views = document.querySelectorAll('.planner-view');
	const miniForm = document.getElementById('calendar-mini-form');
	const miniList = document.getElementById('calendar-mini-list');
	const miniName = document.getElementById('mini-event-name');
	const miniPlace = document.getElementById('mini-event-place');
	const miniDate = document.getElementById('mini-event-date');
	const calendarLabel = document.getElementById('calendar-current-label');
	const calendarGrid = document.getElementById('calendar-grid');
	const calendarPrev = document.getElementById('calendar-prev');
	const calendarNext = document.getElementById('calendar-next');
	const calendarTodayBtn = document.getElementById('calendar-today');

	if (!grid || !tablesGrid || !plannerRoot) return;

	let state = loadState();
	let currentMonthDate = startOfMonth(new Date());
	if (!state) {
		state = seedState();
		saveState();
	}
	let bootstrapped = false;
	state.blocks.forEach((block) => {
		if (ensureBlockDefaults(block)) bootstrapped = true;
		if (block.type === 'table') {
			if (resyncDeadlineColumn(block)) bootstrapped = true;
		}
	});
	if (bootstrapped) saveState();
	render();
	renderCalendarView();

	btnAddList?.addEventListener('click', () => {
		state.blocks.push(createListBlock(`Lista ${state.blocks.length + 1}`));
		commit();
	});

	miniForm?.addEventListener('submit', (e) => {
		e.preventDefault();
		if (!miniName.value.trim() || !miniPlace.value.trim() || !miniDate.value) return;
		const events = loadCalendarEvents();
		events.push({
			id: uid(),
			name: miniName.value.trim(),
			place: miniPlace.value.trim(),
			date: miniDate.value,
			linkedRow: null,
			blockId: null,
		});
		events.sort((a, b) => new Date(a.date) - new Date(b.date));
		saveCalendarEvents(events);
		renderCalendarView();
		miniForm.reset();
	});

	miniList?.addEventListener('click', (e) => {
		const btn = e.target.closest('button[data-event]');
		if (!btn) return;
		const events = loadCalendarEvents().filter((ev) => ev.id !== btn.dataset.event);
		saveCalendarEvents(events);
		renderCalendarView();
	});

	btnAddTable?.addEventListener('click', () => {
		const templateId = promptTableTemplate();
		const template = getTemplateConfig(templateId);
		const count = state.blocks.filter((b) => b.type === 'table' && (b.template || DEFAULT_TABLE_TEMPLATE) === templateId).length + 1;
		state.blocks.push(createTableBlock(`${template.label} ${count}`, templateId));
		commit();
	});

	btnReset?.addEventListener('click', () => {
		if (!confirm('Deseja limpar todo o planner? Os dados locais serão perdidos.')) return;
		state.blocks.forEach((block) => {
			if (block.type === 'table') block.rows.forEach((row) => removeRowDeadline(row));
		});
		state = { blocks: [] };
		commit();
	});

	tabs.forEach((tab) => {
		tab.addEventListener('click', () => {
			const view = tab.dataset.view;
			if (!view) return;
			tabs.forEach((t) => t.classList.toggle('active', t === tab));
			views.forEach((v) => v.classList.toggle('active', v.dataset.view === view));
		});
	});

	calendarPrev?.addEventListener('click', () => {
		currentMonthDate.setMonth(currentMonthDate.getMonth() - 1);
		renderCalendarView();
	});
	calendarNext?.addEventListener('click', () => {
		currentMonthDate.setMonth(currentMonthDate.getMonth() + 1);
		renderCalendarView();
	});
	calendarTodayBtn?.addEventListener('click', () => {
		currentMonthDate = startOfMonth(new Date());
		renderCalendarView();
	});

	calendarGrid?.addEventListener('click', (e) => {
		const day = e.target.closest('.calendar-day');
		if (!day || !day.dataset.date) return;
		if (miniDate) {
			miniDate.value = `${day.dataset.date}T09:00`;
			miniDate.focus();
		}
	});

	plannerRoot.addEventListener('click', (e) => {
		const btn = e.target.closest('button[data-action]');
		if (!btn) return;
		const blockEl = btn.closest('.planner-block');
		if (!blockEl) return;
		const block = state.blocks.find((b) => b.id === blockEl.dataset.id);
		if (!block) return;

		switch (btn.dataset.action) {
			case 'add-card':
				block.cards.push(createCard('Novo item', 'Descreva a tarefa', 'Backlog'));
				commit();
				break;
			case 'delete-block':
				if (!confirm('Remover este quadro?')) return;
				if (block.type === 'table') {
					block.rows.forEach((row) => removeRowDeadline(row));
				}
				state.blocks = state.blocks.filter((b) => b.id !== block.id);
				commit();
				break;
			case 'delete-card': {
				const cardId = btn.dataset.card;
				block.cards = block.cards.filter((c) => c.id !== cardId);
				commit();
				break;
			}
			case 'toggle-favorite': {
				block.favorite = !block.favorite;
				saveState();
				render();
				break;
			}
			case 'add-row': {
				const columns = getTemplateColumns(block);
				const inputs = Array.from(blockEl.querySelectorAll('.table-new [data-field]'));
				const data = {};
				const inputsByKey = {};
				let invalid = false;
				inputs.forEach((el) => {
					const key = el.dataset.field;
					if (!key) return;
					const column = columns.find((c) => c.key === key);
					if (!column) return;
					inputsByKey[key] = el;
					let value = column.type === 'select' ? el.value : el.value.trim();
					if (columnIsDeadline(column) && value) {
						const normalized = normalizeDateBr(value);
						if (!normalized) {
							markInvalid(el);
							invalid = true;
							return;
						}
						value = normalized;
					}
					data[key] = value;
				});
				const requiredKey = columns[0]?.key;
				if (requiredKey && !data[requiredKey]) {
					const requiredInput = inputsByKey[requiredKey];
					if (requiredInput) markInvalid(requiredInput);
					return;
				}
				if (invalid) return;
				const row = createRow();
				columns.forEach((column) => {
					row[column.key] = data[column.key] || '';
				});
				block.rows.push(row);
				syncRowDeadline(block, row);
				inputs.forEach((input) => {
					if (input.tagName === 'SELECT') {
						input.value = input.querySelector('option')?.value || '';
					} else {
						input.value = '';
					}
				});
				commit();
				break;
			}
			case 'delete-row': {
				const rowId = btn.dataset.row;
				const row = block.rows.find((r) => r.id === rowId);
				if (row) removeRowDeadline(row);
				block.rows = block.rows.filter((r) => r.id !== rowId);
				commit();
				break;
			}
			default:
				break;
		}
	});

	plannerRoot.addEventListener('focusin', (e) => {
		const target = e.target;
		if (target.matches('[contenteditable]')) {
			target.dataset.prevValue = target.textContent || '';
		}
	});

	plannerRoot.addEventListener('input', (e) => {
		const target = e.target;
		const blockEl = target.closest('.planner-block');
		if (!blockEl) return;
		const block = state.blocks.find((b) => b.id === blockEl.dataset.id);
		if (!block) return;

		if (target.classList.contains('block-title')) {
			block.title = target.value;
			saveState();
			if (block.type === 'table') {
				block.rows.forEach((row) => {
					if (row.eventId) syncRowDeadline(block, row);
				});
			}
			return;
		}
		if (block.type === 'kanban') {
			if (target.classList.contains('card-title')) {
				const card = block.cards.find((c) => c.id === target.dataset.card);
				if (!card) return;
				card.title = target.value;
				saveState();
			} else if (target.classList.contains('card-notes')) {
				const card = block.cards.find((c) => c.id === target.dataset.card);
				if (!card) return;
				card.notes = target.value;
				saveState();
			}
		}
	});

	plannerRoot.addEventListener('change', (e) => {
		const target = e.target;
		const blockEl = target.closest('.planner-block');
		if (!blockEl) return;
		const block = state.blocks.find((b) => b.id === blockEl.dataset.id);
		if (!block) return;

		if (block.type === 'kanban' && target.classList.contains('card-status')) {
			const card = block.cards.find((c) => c.id === target.dataset.card);
			if (!card) return;
			card.status = target.value;
			commit(false);
		}
	});

	plannerRoot.addEventListener('focusout', (e) => {
		const target = e.target;
		if (!target.matches('[contenteditable]')) return;
		const blockEl = target.closest('.planner-block');
		if (!blockEl) return;
		const block = state.blocks.find((b) => b.id === blockEl.dataset.id);
		if (!block || block.type !== 'table') return;
		const row = block.rows.find((r) => r.id === target.dataset.row);
		if (!row) return;
		const columns = getTemplateColumns(block);
		const column = columns.find((c) => c.key === target.dataset.field);
		if (!column) return;
		if (!(column.key in row)) row[column.key] = '';
		let text = (target.textContent || '').trim();
		if (columnIsDeadline(column)) {
			if (!text) {
				row[column.key] = '';
				removeRowDeadline(row);
			} else {
				const normalized = normalizeDateBr(text);
				if (!normalized) {
					target.textContent = row[column.key] || '';
					markInvalid(target);
					return;
				}
				row[column.key] = normalized;
				target.textContent = normalized;
				syncRowDeadline(block, row);
			}
		} else {
			row[column.key] = text;
			if (row.eventId && column.key === 'title') {
				syncRowDeadline(block, row);
			}
		}
		saveState();
	});

	function render() {
		grid.innerHTML = '';
		tablesGrid.innerHTML = '';
		const ordered = [...state.blocks].sort((a, b) => Number(Boolean(b.favorite)) - Number(Boolean(a.favorite)));
		const cards = ordered.filter((block) => block.type === 'kanban');
		const tables = ordered.filter((block) => block.type === 'table');

		if (!cards.length) {
			const empty = document.createElement('p');
			empty.className = 'planner-empty';
			empty.textContent = 'Nenhum quadro criado. Utilize os botões acima para começar.';
			grid.appendChild(empty);
		} else {
			cards.forEach((block) => grid.appendChild(renderBlock(block)));
		}

		if (!tables.length) {
			const emptyTables = document.createElement('p');
			emptyTables.className = 'planner-empty';
			emptyTables.textContent = 'Nenhuma tabela criada.';
			tablesGrid.appendChild(emptyTables);
		} else {
			tables.forEach((block) => tablesGrid.appendChild(renderBlock(block)));
		}

		updateAlerts();
	}

	function renderBlock(block) {
		const article = document.createElement('article');
		article.className = `planner-block ${block.type}`;
		if (block.favorite) article.classList.add('favorite');
		article.dataset.id = block.id;

		const head = document.createElement('div');
		head.className = 'block-head';

		const titleWrap = document.createElement('div');
		titleWrap.className = 'block-title-wrap';

		const title = document.createElement('input');
		title.className = 'block-title';
		title.value = block.title;
		title.placeholder = 'Título do quadro';
		titleWrap.appendChild(title);

		const favBtn = document.createElement('button');
		favBtn.type = 'button';
		favBtn.className = `favorite-toggle${block.favorite ? ' active' : ''}`;
		favBtn.dataset.action = 'toggle-favorite';
		favBtn.textContent = block.favorite ? '★' : '☆';
		titleWrap.appendChild(favBtn);

		head.appendChild(titleWrap);

		const actions = document.createElement('div');
		actions.className = 'block-actions';

		const addBtn = document.createElement('button');
		addBtn.className = 'planner-btn ghost';
		addBtn.dataset.action = block.type === 'kanban' ? 'add-card' : 'add-row';
		addBtn.textContent = block.type === 'kanban' ? '+ Cartão' : '+ Linha';
		actions.appendChild(addBtn);

		const delBtn = document.createElement('button');
		delBtn.className = 'planner-btn ghost';
		delBtn.dataset.action = 'delete-block';
		delBtn.textContent = 'Excluir';
		actions.appendChild(delBtn);

		head.appendChild(actions);
		article.appendChild(head);

		if (block.type === 'kanban') {
			const cardsWrap = document.createElement('div');
			cardsWrap.className = 'kanban-cards';
			block.cards.forEach((card) => cardsWrap.appendChild(renderCard(card)));
			article.appendChild(cardsWrap);
		} else {
			article.appendChild(renderTable(block));
		}

		article.style.gridColumn = '';
		return article;
	}

	function renderCard(card) {
		const cardEl = document.createElement('article');
		cardEl.className = 'kanban-card';
		cardEl.dataset.card = card.id;

		const title = document.createElement('input');
		title.className = 'card-title';
		title.value = card.title;
		title.dataset.card = card.id;
		cardEl.appendChild(title);

		const notes = document.createElement('textarea');
		notes.className = 'card-notes';
		notes.rows = 3;
		notes.value = card.notes;
		notes.dataset.card = card.id;
		cardEl.appendChild(notes);

		const footer = document.createElement('div');
		footer.className = 'card-footer';

		const select = document.createElement('select');
		select.className = 'card-status';
		select.dataset.card = card.id;
		['Backlog', 'Em andamento', 'Em revisão', 'Concluído'].forEach((label) => {
			const opt = document.createElement('option');
			opt.value = label;
			opt.textContent = label;
			if (card.status === label) opt.selected = true;
			select.appendChild(opt);
		});
		footer.appendChild(select);

		const remove = document.createElement('button');
		remove.className = 'planner-btn ghost';
		remove.dataset.action = 'delete-card';
		remove.dataset.card = card.id;
		remove.textContent = 'Excluir';
		footer.appendChild(remove);

		cardEl.appendChild(footer);
		return cardEl;
	}

	function renderTable(block) {
		ensureBlockDefaults(block);
		const columns = getTemplateColumns(block);
		const wrap = document.createElement('div');
		wrap.className = 'table-wrapper';

		const table = document.createElement('table');
		table.className = 'planner-table';

		const thead = document.createElement('thead');
		const headRow = document.createElement('tr');
		columns.forEach((column) => {
			const th = document.createElement('th');
			th.textContent = column.label;
			headRow.appendChild(th);
		});
		const actionsTh = document.createElement('th');
		headRow.appendChild(actionsTh);
		thead.appendChild(headRow);
		table.appendChild(thead);

		const tbody = document.createElement('tbody');
		block.rows.forEach((row) => {
			const tr = document.createElement('tr');
			tr.dataset.row = row.id;
			columns.forEach((column) => {
				const td = document.createElement('td');
				td.contentEditable = 'true';
				td.dataset.field = column.key;
				td.dataset.row = row.id;
				td.textContent = row[column.key] || '';
				tr.appendChild(td);
			});
			const tdActions = document.createElement('td');
			const btn = document.createElement('button');
			btn.className = 'planner-btn ghost';
			btn.dataset.action = 'delete-row';
			btn.dataset.row = row.id;
			btn.textContent = 'Excluir';
			tdActions.appendChild(btn);
			tr.appendChild(tdActions);
			tbody.appendChild(tr);
		});
		table.appendChild(tbody);
		wrap.appendChild(table);

		const newRow = document.createElement('div');
		newRow.className = 'table-new';
		columns.forEach((column) => {
			let input;
			if (column.type === 'select' && Array.isArray(column.options)) {
				input = document.createElement('select');
				column.options.forEach((label) => {
					const opt = document.createElement('option');
					opt.value = label;
					opt.textContent = label;
					input.appendChild(opt);
				});
			} else {
				input = document.createElement('input');
				input.type = 'text';
			}
			input.placeholder = column.placeholder || column.label;
			input.dataset.field = column.key;
			if (columnIsDeadline(column)) {
				input.inputMode = 'numeric';
				input.pattern = '\\d{2}/\\d{2}/\\d{4}';
				input.dataset.deadline = 'true';
			}
			newRow.appendChild(input);
		});

		const hint = document.createElement('button');
		hint.className = 'planner-btn';
		hint.dataset.action = 'add-row';
		hint.textContent = 'Adicionar linha';
		newRow.appendChild(hint);

		wrap.appendChild(newRow);
		return wrap;
	}

	function commit(shouldRender = true) {
		saveState();
		if (shouldRender) render();
	}

	function loadState() {
		try {
			const raw = localStorage.getItem(STORAGE_KEY);
			if (!raw) return null;
			const parsed = JSON.parse(raw);
			if (!parsed || !Array.isArray(parsed.blocks)) return null;
			parsed.blocks.forEach((block) => ensureBlockDefaults(block));
			return parsed;
		} catch {
			return null;
		}
	}

	function saveState() {
		try {
			localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
		} catch {
			// ignore quota issues
		}
	}

	function markInvalid(el) {
		if (!el) return;
		el.classList.add('shake');
		setTimeout(() => el.classList.remove('shake'), 400);
	}

	function updateAlerts() {
		if (!alertsBox) return;
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
			alertsBox.hidden = true;
			alertsBox.innerHTML = '';
			return;
		}

		const list = upcoming
			.map((item) => {
				const label = escapeHtml(item.label || 'Compromisso');
				const meta = escapeHtml(`${item.dateBr} · ${item.context}`);
				return `<li><strong>${label}</strong><span>${meta}</span></li>`;
			})
			.join('');

		alertsBox.innerHTML = `
			<div class="alerts-title">Compromissos nas próximas 24h</div>
			<ul>${list}</ul>
		`;
		alertsBox.hidden = false;
	}

	function ensureBlockDefaults(block) {
		let changed = false;
		if (typeof block.favorite !== 'boolean') {
			block.favorite = false;
			changed = true;
		}
		if (!Array.isArray(block.rows)) {
			block.rows = [];
			changed = true;
		}
		if (block.type === 'table') {
			if (!TABLE_TEMPLATES[block.template]) {
				block.template = DEFAULT_TABLE_TEMPLATE;
				changed = true;
			}
			const columns = getTemplateColumns(block);
			const legacyColumns = Array.isArray(block.columns) ? block.columns : null;
			block.rows.forEach((row) => {
				if (!row.id) {
					row.id = uid();
					changed = true;
				}
				if (typeof row.eventId === 'undefined') {
					row.eventId = null;
					changed = true;
				}
				if (legacyColumns?.length) {
					legacyColumns.forEach((legacyCol, idx) => {
						const canonical = resolveLegacyColumn(legacyCol, columns[idx]?.key);
						if (!canonical) return;
						if (typeof row[canonical] === 'string' && row[canonical].length) return;
						const legacyValue = row[legacyCol.key];
						if (typeof legacyValue === 'string' && legacyValue.length) {
							row[canonical] = legacyValue;
							changed = true;
						}
					});
				}
				columns.forEach((column) => {
					if (typeof row[column.key] !== 'string') {
						row[column.key] = row[column.key] ?? '';
						changed = true;
					}
				});
			});
			if (legacyColumns) {
				delete block.columns;
				changed = true;
			}
		}
		return changed;
	}

	function resolveLegacyColumn(column, fallback) {
		if (!column) return fallback || null;
		const label = (column.label || '').trim().toLowerCase();
		const key = (column.key || '').trim().toLowerCase();
		return LEGACY_COLUMN_LABELS[label] || LEGACY_COLUMN_LABELS[key] || fallback || null;
	}

	function promptTableTemplate() {
		const entries = Object.entries(TABLE_TEMPLATES);
		const defaultId = entries[0]?.[0] || DEFAULT_TABLE_TEMPLATE;
		const message = entries.map(([id, cfg], idx) => `${idx + 1} - ${cfg.label}`).join('\n');
		const answer = (prompt(`Escolha o tipo de tabela:\n${message}`, '1') || '').trim().toLowerCase();
		const index = Number(answer);
		if (Number.isFinite(index) && entries[index - 1]) return entries[index - 1][0];
		const match = entries.find(([id, cfg]) => id === answer || cfg.label.toLowerCase() === answer);
		return match ? match[0] : defaultId;
	}

	function seedState() {
		const base = {
			blocks: [
				createListBlock('Backlog', [
					createCard('Mapear necessidades', 'Junte todas as demandas da equipe', 'Backlog'),
					createCard('Priorizar entregas', 'Classifique por impacto e esforço', 'Backlog'),
				]),
				createListBlock('Em andamento', [
					createCard('Protótipo Planner', 'Validar fluxo de colunas e tabelas', 'Em andamento'),
				]),
				createTableBlock('Tabela semanal', 'tarefas', [
					createRow({ title: 'Onboarding', owner: 'Time CX', status: 'Planejado', due: '03/12/2025' }),
					createRow({ title: 'Revisão sprint', owner: 'Squad Axon', status: 'Em andamento', due: '05/12/2025' }),
				]),
				createTableBlock('Controle financeiro', 'financeiro', [
					createRow({ description: 'Aluguel', category: 'Moradia', amount: '1.500', due: '05/12/2025', status: 'Previsto' }),
					createRow({ description: 'Internet', category: 'Serviços', amount: '129', due: '12/12/2025', status: 'Pago' }),
				]),
			],
		};
		return base;
	}

	function createListBlock(title, cards = []) {
		return { id: uid(), type: 'kanban', title, cards: cards.map((card) => ({ ...card })), favorite: false };
	}

	function createTableBlock(title, templateId = DEFAULT_TABLE_TEMPLATE, rows = []) {
		const chosenTemplate = TABLE_TEMPLATES[templateId] ? templateId : DEFAULT_TABLE_TEMPLATE;
		return {
			id: uid(),
			type: 'table',
			title,
			template: chosenTemplate,
			favorite: false,
			rows: rows.map((row) => createRow(row)),
		};
	}

	function createCard(title, notes = '', status = 'Backlog') {
		return { id: uid(), title, notes, status };
	}

	function createRow(initial = {}) {
		return { id: uid(), eventId: null, ...initial };
	}

	function uid() {
		return Math.random().toString(36).slice(2, 9);
	}

	function loadCalendarEvents() {
		try {
			const raw = localStorage.getItem(CAL_STORAGE_KEY);
			if (!raw) return [];
			const parsed = JSON.parse(raw);
			if (!Array.isArray(parsed)) return [];
			return parsed.map((event) => ({
				id: event.id,
				name: event.name,
				place: event.place,
				date: event.date,
				linkedRow: event.linkedRow ?? null,
				blockId: event.blockId ?? null,
			}));
		} catch {
			return [];
		}
	}

	function saveCalendarEvents(events) {
		try {
			localStorage.setItem(CAL_STORAGE_KEY, JSON.stringify(events));
		} catch {}
	}

	function renderCalendarView() {
		const events = loadCalendarEvents();
		if (calendarLabel) {
			try {
				calendarLabel.textContent = currentMonthDate.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
			} catch {
				calendarLabel.textContent = `${currentMonthDate.getMonth() + 1}/${currentMonthDate.getFullYear()}`;
			}
		}
		renderCalendarGrid(events);
		renderCalendarList(events);
		updateAlerts();
	}

	function renderCalendarGrid(events) {
		if (!calendarGrid) return;
		const weekdays = ['SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SÁB', 'DOM'];
		calendarGrid.innerHTML = '';
		weekdays.forEach((day) => {
			const cell = document.createElement('div');
			cell.className = 'weekday';
			cell.textContent = day;
			calendarGrid.appendChild(cell);
		});

		const year = currentMonthDate.getFullYear();
		const month = currentMonthDate.getMonth();
		const first = startOfMonth(currentMonthDate);
		const offset = (first.getDay() + 6) % 7; // segunda é 0
		const daysInMonth = new Date(year, month + 1, 0).getDate();
		const totalCells = Math.ceil((offset + daysInMonth) / 7) * 7;
		const today = new Date();

		for (let i = 0; i < totalCells; i++) {
			const dayNumber = i - offset + 1;
			const cellDate = new Date(year, month, dayNumber);
			const inMonth = dayNumber >= 1 && dayNumber <= daysInMonth;
			const dateKey = getDateKey(cellDate);
			const dayEvents = events.filter((ev) => ev.date && getDateKey(ev.date) === dateKey);

			const cell = document.createElement('div');
			cell.className = 'calendar-day';
			if (!inMonth) cell.classList.add('outside');
			if (isSameDay(cellDate, today)) cell.classList.add('today');
			cell.dataset.date = dateKey;

			const label = document.createElement('div');
			label.className = 'date';
			label.textContent = cellDate.getDate();
			cell.appendChild(label);

			const eventsWrap = document.createElement('div');
			eventsWrap.className = 'events';
			const maxVisible = 2;
			dayEvents.slice(0, maxVisible).forEach((event) => {
				const chip = document.createElement('div');
				chip.className = 'calendar-chip';
				chip.textContent = `${formatTime(event.date)} • ${event.name}`;
				eventsWrap.appendChild(chip);
			});
			if (dayEvents.length > maxVisible) {
				const more = document.createElement('div');
				more.className = 'calendar-chip more';
				more.textContent = `+${dayEvents.length - maxVisible}`;
				eventsWrap.appendChild(more);
			}
			cell.appendChild(eventsWrap);
			calendarGrid.appendChild(cell);
		}
	}

	function renderCalendarList(events) {
		if (!miniList) return;
		miniList.innerHTML = '';
		if (!events.length) {
			const info = document.createElement('p');
			info.className = 'planner-empty';
			info.textContent = 'Sem compromissos.';
			miniList.appendChild(info);
			return;
		}
		events
			.slice()
			.sort((a, b) => new Date(a.date) - new Date(b.date))
			.forEach((event) => {
				const card = document.createElement('article');
				card.className = 'calendar-card';

				const header = document.createElement('header');
				const title = document.createElement('h3');
				title.textContent = event.name;
				header.appendChild(title);
				const remove = document.createElement('button');
				remove.className = 'planner-btn ghost';
				remove.dataset.event = event.id;
				remove.textContent = 'Remover';
				header.appendChild(remove);
				card.appendChild(header);

				const place = document.createElement('p');
				place.textContent = event.place;
				card.appendChild(place);

				const time = document.createElement('time');
				time.dateTime = event.date;
				time.textContent = formatFullDate(event.date);
				card.appendChild(time);

				miniList.appendChild(card);
			});
	}

	function formatFullDate(value) {
		const date = new Date(value);
		const options = { weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' };
		try {
			return date.toLocaleString('pt-BR', options).replace('.', '');
		} catch {
			return value;
		}
	}

	function formatTime(value) {
		const date = new Date(value);
		try {
			return date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
		} catch {
			return '--:--';
		}
	}

	function startOfMonth(date) {
		return new Date(date.getFullYear(), date.getMonth(), 1);
	}

	function getDateKey(value) {
		const date = new Date(value);
		const y = date.getFullYear();
		const m = String(date.getMonth() + 1).padStart(2, '0');
		const d = String(date.getDate()).padStart(2, '0');
		return `${y}-${m}-${d}`;
	}

	function isSameDay(a, b) {
		return getDateKey(a) === getDateKey(b);
	}

	function columnIsDeadline(column) {
		return Boolean(column?.deadline);
	}

	function getRowLabelForEvent(block, row) {
		const primaryKey = getTemplateColumns(block)[0]?.key;
		return (primaryKey && row[primaryKey]) || row.title || row.description || '';
	}

	function resolveEventDetails(event) {
		if (!event?.date) return null;
		const date = new Date(event.date);
		if (Number.isNaN(date.getTime())) return null;
		let label = event.name || '';
		let context = event.place || 'Calendário';
		if (event.blockId) {
			const block = state.blocks.find((b) => b.id === event.blockId);
			if (block) {
				context = block.title || context;
				if (event.linkedRow) {
					const row = block.rows?.find((r) => r.id === event.linkedRow);
					if (row) label = getRowLabelForEvent(block, row) || label;
				}
			}
		}
		return {
			label: label || 'Compromisso',
			context,
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

	function normalizeDateBr(value) {
		const date = parseDateBr(value);
		if (!date) return null;
		return `${pad2(date.getDate())}/${pad2(date.getMonth() + 1)}/${date.getFullYear()}`;
	}

	function parseDateBr(value) {
		if (typeof value !== 'string') return null;
		const match = value.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
		if (!match) return null;
		const day = Number(match[1]);
		const month = Number(match[2]) - 1;
		const year = Number(match[3]);
		const date = new Date(year, month, day);
		if (date.getFullYear() !== year || date.getMonth() !== month || date.getDate() !== day) return null;
		return date;
	}

	function pad2(value) {
		return String(value).padStart(2, '0');
	}

	function getDeadlineColumn(block) {
		return getTemplateColumns(block).find((column) => columnIsDeadline(column)) || null;
	}

	function syncRowDeadline(block, row) {
		const column = getDeadlineColumn(block);
		if (!column) return removeRowDeadline(row);
		const raw = (row[column.key] || '').trim();
		if (!raw) return removeRowDeadline(row);
		const normalized = normalizeDateBr(raw);
		if (!normalized) return false;
		let changed = false;
		if (row[column.key] !== normalized) {
			row[column.key] = normalized;
			changed = true;
		}
		const date = parseDateBr(normalized);
		if (!date) return changed;
		date.setHours(9, 0, 0, 0);
		const iso = date.toISOString();
		const events = loadCalendarEvents();
		let event = events.find((ev) => ev.id === row.eventId);
		const eventName = getRowLabelForEvent(block, row) || normalized;
		if (!event) {
			event = {
				id: row.eventId || uid(),
				name: eventName,
				place: block.title || '',
				date: iso,
				linkedRow: row.id,
				blockId: block.id,
			};
			row.eventId = event.id;
			events.push(event);
			changed = true;
		} else {
			event.name = eventName || event.name || normalized;
			event.place = block.title || event.place || '';
			event.date = iso;
			event.linkedRow = row.id;
			event.blockId = block.id;
		}
		saveCalendarEvents(events);
		renderCalendarView();
		return changed;
	}

	function removeRowDeadline(row) {
		if (!row?.eventId) return false;
		const events = loadCalendarEvents();
		const idx = events.findIndex((ev) => ev.id === row.eventId && ev.linkedRow === row.id);
		if (idx === -1) {
			row.eventId = null;
			return false;
		}
		events.splice(idx, 1);
		saveCalendarEvents(events);
		renderCalendarView();
		row.eventId = null;
		return true;
	}

	function resyncDeadlineColumn(block) {
		if (block.type !== 'table') return false;
		let changed = false;
		const deadlineColumn = getDeadlineColumn(block);
		block.rows.forEach((row) => {
			if (!deadlineColumn || !(row[deadlineColumn.key] || '').trim()) {
				changed = removeRowDeadline(row) || changed;
				return;
			}
			changed = syncRowDeadline(block, row) || changed;
		});
		return changed;
	}
})();

