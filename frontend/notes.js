(() => {
	const STORAGE_KEY = 'axonNotes.v1';
	const notesList = document.getElementById('notes-list');
	const notesEmpty = document.getElementById('notes-empty');
	const editorContent = document.getElementById('editor-content');
	const editorEmpty = document.getElementById('editor-empty');
	const noteTitle = document.getElementById('note-title');
	const noteContent = document.getElementById('note-content');
	const noteDate = document.getElementById('note-date');
	const btnNewNote = document.getElementById('btn-new-note');
	const btnSaveNote = document.getElementById('btn-save-note');
	const btnExportNote = document.getElementById('btn-export-note');
	const btnDeleteNote = document.getElementById('btn-delete-note');
	const searchInput = document.getElementById('search-notes');
	const sortSelect = document.getElementById('sort-notes');

	if (!notesList || !editorContent) return;

	// Estado
	let notes = [];
	let currentNoteId = null;
	let searchQuery = '';
	let sortBy = 'date-desc';

	// Inicialização
	function init() {
		loadNotes();
		setupEventListeners();
		renderNotesList();
		showEditorEmpty();
	}

	function setupEventListeners() {
		btnNewNote?.addEventListener('click', createNewNote);
		btnDeleteNote?.addEventListener('click', deleteCurrentNote);
		
		noteTitle?.addEventListener('input', debounce(saveCurrentNote, 500));
		noteContent?.addEventListener('input', (e) => {
			keepCursorVisible(e.target);
			debounce(saveCurrentNote, 500)();
		});
		
		noteContent?.addEventListener('keyup', (e) => {
			keepCursorVisible(e.target);
		});
		
		searchInput?.addEventListener('input', (e) => {
			searchQuery = e.target.value.toLowerCase().trim();
			renderNotesList();
		});
		
		sortSelect?.addEventListener('change', (e) => {
			sortBy = e.target.value;
			renderNotesList();
		});

		// Atalhos de teclado
		window.addEventListener('keydown', (e) => {
			if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
				e.preventDefault();
				createNewNote();
			}
			if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
				e.preventDefault();
				searchInput?.focus();
			}
			if (e.key === 'Delete' && currentNoteId && document.activeElement !== noteContent && document.activeElement !== noteTitle) {
				deleteCurrentNote();
			}
		});
	}

	function createNewNote() {
		const newNote = {
			id: uid(),
			title: '',
			content: '',
			createdAt: Date.now(),
			updatedAt: Date.now()
		};
		
		notes.unshift(newNote);
		saveNotes();
		renderNotesList();
		selectNote(newNote.id);
		updateSaveButton(); // Garantir que o botão seja habilitado
		noteTitle?.focus();
	}

	function deleteCurrentNote() {
		if (!currentNoteId) return;
		
		const note = notes.find(n => n.id === currentNoteId);
		const noteTitle = note?.title || 'Sem título';
		
		showModal({
			title: 'Excluir Nota',
			message: `Tem certeza que deseja excluir a nota "${noteTitle}"? Esta ação não pode ser desfeita.`,
			inputs: [],
			onConfirm: () => {
				notes = notes.filter(n => n.id !== currentNoteId);
				saveNotes();
				currentNoteId = null;
				renderNotesList();
				showEditorEmpty();
				updateDeleteButton();
				updateSaveButton();
				return true;
			}
		});
	}

	function selectNote(noteId) {
		const note = notes.find(n => n.id === noteId);
		if (!note) return;
		
		currentNoteId = noteId;
		noteTitle.value = note.title || '';
		noteContent.value = note.content || '';
		
		const date = new Date(note.updatedAt);
		noteDate.textContent = formatDate(date);
		
		editorContent.hidden = false;
		editorEmpty.hidden = true;
		updateDeleteButton();
		updateSaveButton();
		
		// Destacar nota selecionada na lista
		document.querySelectorAll('.note-item').forEach(item => {
			item.classList.toggle('active', item.dataset.id === noteId);
		});
	}

	async function saveCurrentNote() {
		if (!currentNoteId) return;
		
		const note = notes.find(n => n.id === currentNoteId);
		if (!note) return;
		
		note.title = noteTitle.value.trim();
		note.content = noteContent.value.trim();
		note.updatedAt = Date.now();
		
		// Salvar no localStorage primeiro
		try {
			localStorage.setItem(STORAGE_KEY, JSON.stringify(notes));
		} catch (e) {
			console.error('Erro ao salvar no localStorage:', e);
		}
		
		// Salvar diretamente no app.db
		try {
			const response = await fetch('/api/import/notes', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ notes: [note] })
			});
			
			const responseText = await response.text();
			let responseData;
			try {
				responseData = JSON.parse(responseText);
			} catch (e) {
				console.error('[Notes] Erro ao parsear resposta:', e);
				return;
			}
			
			if (response.ok && responseData.ok !== false && responseData.count > 0) {
				console.log(`[Notes] ✅ Nota ${note.id} salva no app.db`);
			} else {
				console.error('[Notes] Erro ao salvar no backend:', responseData);
			}
		} catch (e) {
			console.error('[Notes] Erro ao salvar nota:', e);
		}
		
		saveNotes();
		renderNotesList();
	}

	function renderNotesList() {
		if (!notesList) return;
		
		// Filtrar e ordenar notas
		let filtered = notes.filter(note => {
			if (!searchQuery) return true;
			const query = searchQuery.toLowerCase();
			const title = (note.title || '').toLowerCase();
			const content = (note.content || '').toLowerCase();
			return title.includes(query) || content.includes(query);
		});
		
		// Ordenar
		filtered.sort((a, b) => {
			switch (sortBy) {
				case 'date-asc':
					return a.updatedAt - b.updatedAt;
				case 'date-desc':
					return b.updatedAt - a.updatedAt;
				case 'title-asc':
					return (a.title || '').localeCompare(b.title || '');
				case 'title-desc':
					return (b.title || '').localeCompare(a.title || '');
				default:
					return b.updatedAt - a.updatedAt;
			}
		});
		
		// Limpar lista
		notesList.innerHTML = '';
		
		if (filtered.length === 0) {
			notesEmpty.hidden = false;
			return;
		}
		
		notesEmpty.hidden = true;
		
		// Renderizar notas
		filtered.forEach(note => {
			const item = document.createElement('div');
			item.className = 'note-item';
			item.dataset.id = note.id;
			if (note.id === currentNoteId) {
				item.classList.add('active');
			}
			
			const title = note.title || 'Sem título';
			// Manter quebras de linha no preview, limitar a ~200 caracteres
			let preview = (note.content || '').substring(0, 200);
			// Se cortou no meio, tentar cortar no final de uma linha
			if (note.content && note.content.length > 200) {
				const lastNewline = preview.lastIndexOf('\n');
				if (lastNewline > 100) {
					preview = preview.substring(0, lastNewline);
				}
			}
			const date = formatDate(new Date(note.updatedAt));
			
			item.innerHTML = `
				<div class="note-item-title">${escapeHtml(title)}</div>
				${preview ? `<div class="note-item-preview">${escapeHtml(preview)}</div>` : ''}
				<div class="note-item-date">${date}</div>
			`;
			
			item.addEventListener('click', () => selectNote(note.id));
			
			notesList.appendChild(item);
		});
	}

	function showEditorEmpty() {
		editorContent.hidden = true;
		editorEmpty.hidden = false;
		updateDeleteButton();
		updateSaveButton();
	}

	function updateDeleteButton() {
		if (btnDeleteNote) {
			btnDeleteNote.disabled = !currentNoteId;
		}
	}
	
	function updateSaveButton() {
		if (btnSaveNote) {
			const shouldDisable = !currentNoteId;
			btnSaveNote.disabled = shouldDisable;
			console.log('[Notes] Botão salvar:', shouldDisable ? 'DESABILITADO' : 'HABILITADO', 'currentNoteId:', currentNoteId);
		}
		if (btnExportNote) {
			btnExportNote.disabled = !currentNoteId;
		}
	}
	
	function exportCurrentNote() {
		if (!currentNoteId) return;
		
		const note = notes.find(n => n.id === currentNoteId);
		if (!note) return;
		
		// Criar conteúdo do arquivo TXT - apenas o título
		const content = note.title || 'Sem título';
		
		// Criar blob e fazer download
		const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
		const url = URL.createObjectURL(blob);
		const link = document.createElement('a');
		link.href = url;
		link.download = `${(note.title || 'nota').replace(/[^a-z0-9]/gi, '_')}_${Date.now()}.txt`;
		document.body.appendChild(link);
		link.click();
		document.body.removeChild(link);
		URL.revokeObjectURL(url);
		
		console.log('[Notes] ✅ Nota exportada como TXT');
	}

	function keepCursorVisible(textarea) {
		if (!textarea) return;
		
		const wrapper = textarea.parentElement;
		if (!wrapper) return;
		
		setTimeout(() => {
			const cursorPosition = textarea.selectionStart;
			const textBeforeCursor = textarea.value.substring(0, cursorPosition);
			const lines = textBeforeCursor.split('\n');
			const currentLine = lines.length;
			
			// Calcular altura aproximada até o cursor
			const lineHeight = parseFloat(window.getComputedStyle(textarea).lineHeight) || 22.4;
			const paddingTop = parseFloat(window.getComputedStyle(textarea).paddingTop) || 12;
			const approximateCursorTop = (currentLine - 1) * lineHeight + paddingTop;
			
			// Fazer scroll no wrapper para manter o cursor visível
			const scrollMargin = lineHeight * 3;
			const scrollTop = wrapper.scrollTop;
			const clientHeight = wrapper.clientHeight;
			
			if (approximateCursorTop < scrollTop + scrollMargin) {
				wrapper.scrollTop = Math.max(0, approximateCursorTop - scrollMargin);
			} else if (approximateCursorTop > scrollTop + clientHeight - scrollMargin) {
				wrapper.scrollTop = approximateCursorTop - clientHeight + scrollMargin;
			}
		}, 0);
	}

	function formatDate(date) {
		const now = new Date();
		const diff = now - date;
		const days = Math.floor(diff / (1000 * 60 * 60 * 24));
		
		if (days === 0) {
			return 'Hoje';
		} else if (days === 1) {
			return 'Ontem';
		} else if (days < 7) {
			return `${days} dias atrás`;
		} else {
			return date.toLocaleDateString('pt-BR', {
				day: '2-digit',
				month: '2-digit',
				year: 'numeric'
			});
		}
	}

	function escapeHtml(text) {
		const div = document.createElement('div');
		div.textContent = text;
		return div.innerHTML;
	}

	function debounce(func, wait) {
		let timeout;
		return function executedFunction(...args) {
			const later = () => {
				clearTimeout(timeout);
				func(...args);
			};
			clearTimeout(timeout);
			timeout = setTimeout(later, wait);
		};
	}

	function uid() {
		return Date.now().toString(36) + Math.random().toString(36).slice(2);
	}

	function saveNotes() {
		try {
			localStorage.setItem(STORAGE_KEY, JSON.stringify(notes));
		} catch (e) {
			console.error('Erro ao salvar notas:', e);
		}
	}

	function loadNotes() {
		try {
			const raw = localStorage.getItem(STORAGE_KEY);
			if (raw) {
				notes = JSON.parse(raw);
				if (!Array.isArray(notes)) {
					notes = [];
				}
			}
		} catch (e) {
			console.error('Erro ao carregar notas:', e);
			notes = [];
		}
	}

	// ========== MODAL CUSTOMIZADO ==========
	
	let currentModalResolve = null;
	
	function showModal(config) {
		const modal = document.getElementById('custom-modal');
		const modalTitle = document.getElementById('modal-title');
		const modalMessage = document.getElementById('modal-message');
		const modalInputs = document.getElementById('modal-inputs');
		const modalConfirm = document.getElementById('modal-confirm');
		const modalCancel = document.getElementById('modal-cancel');
		const modalClose = document.getElementById('modal-close');
		
		if (!modal) return Promise.resolve(null);
		
		// Configurar título e mensagem
		modalTitle.textContent = config.title || 'Confirmação';
		modalMessage.textContent = config.message || '';
		modalMessage.style.display = config.message ? 'block' : 'none';
		
		// Limpar inputs anteriores
		modalInputs.innerHTML = '';
		
		// Criar inputs
		const inputValues = {};
		if (config.inputs && config.inputs.length > 0) {
			config.inputs.forEach(inputConfig => {
				const inputGroup = document.createElement('div');
				inputGroup.className = 'modal-input-group';
				
				if (inputConfig.type === 'select') {
					const select = document.createElement('select');
					select.id = inputConfig.id;
					select.className = 'modal-input';
					select.required = inputConfig.required || false;
					
					if (inputConfig.options && Array.isArray(inputConfig.options)) {
						inputConfig.options.forEach(option => {
							const optionEl = document.createElement('option');
							optionEl.value = option.value;
							optionEl.textContent = option.label || option.value;
							select.appendChild(optionEl);
						});
					}
					
					inputGroup.appendChild(select);
					inputValues[inputConfig.id] = select;
				} else if (inputConfig.type === 'textarea') {
					const textarea = document.createElement('textarea');
					textarea.id = inputConfig.id;
					textarea.placeholder = inputConfig.placeholder || '';
					textarea.required = inputConfig.required || false;
					textarea.className = 'modal-input';
					textarea.rows = 3;
					inputGroup.appendChild(textarea);
					inputValues[inputConfig.id] = textarea;
				} else {
					const input = document.createElement('input');
					input.type = inputConfig.type || 'text';
					input.id = inputConfig.id;
					input.placeholder = inputConfig.placeholder || '';
					input.required = inputConfig.required || false;
					input.className = 'modal-input';
					inputGroup.appendChild(input);
					inputValues[inputConfig.id] = input;
				}
				
				modalInputs.appendChild(inputGroup);
			});
		}
		
		// Mostrar modal
		modal.hidden = false;
		modal.style.display = 'flex';
		document.body.style.overflow = 'hidden';
		
		// Focar no primeiro input
		if (config.inputs && config.inputs.length > 0) {
			setTimeout(() => {
				const firstInput = document.getElementById(config.inputs[0].id);
				if (firstInput) firstInput.focus();
			}, 100);
		}
		
		// Retornar Promise
		return new Promise((resolve) => {
			currentModalResolve = resolve;
			
			const handleConfirm = () => {
				// Coletar valores dos inputs
				const values = {};
				Object.keys(inputValues).forEach(key => {
					const input = inputValues[key];
					values[key] = input.value;
				});
				
				// Chamar callback de confirmação
				if (config.onConfirm) {
					const result = config.onConfirm(values);
					if (result !== false) {
						closeModal();
						resolve(values);
					}
				} else {
					closeModal();
					resolve(values);
				}
			};
			
			const handleCancel = () => {
				closeModal();
				resolve(null);
			};
			
			// Remover listeners anteriores
			const newConfirm = modalConfirm.cloneNode(true);
			modalConfirm.parentNode.replaceChild(newConfirm, modalConfirm);
			const newCancel = modalCancel.cloneNode(true);
			modalCancel.parentNode.replaceChild(newCancel, modalCancel);
			const newClose = modalClose.cloneNode(true);
			modalClose.parentNode.replaceChild(newClose, modalClose);
			
			// Adicionar novos listeners
			document.getElementById('modal-confirm').addEventListener('click', handleConfirm);
			document.getElementById('modal-cancel').addEventListener('click', handleCancel);
			document.getElementById('modal-close').addEventListener('click', handleCancel);
			
			// Fechar ao clicar no overlay
			const overlay = document.querySelector('.modal-overlay');
			if (overlay) {
				const newOverlay = overlay.cloneNode(true);
				overlay.parentNode.replaceChild(newOverlay, overlay);
				newOverlay.addEventListener('click', handleCancel);
			}
			
			// Fechar com ESC
			const handleEsc = (e) => {
				if (e.key === 'Escape') {
					handleCancel();
					document.removeEventListener('keydown', handleEsc);
				}
			};
			document.addEventListener('keydown', handleEsc);
			
			// Enter no input confirma (exceto textarea e select)
			Object.values(inputValues).forEach(input => {
				input.addEventListener('keydown', (e) => {
					if (e.key === 'Enter' && !e.shiftKey && input.tagName !== 'TEXTAREA' && input.tagName !== 'SELECT') {
						e.preventDefault();
						handleConfirm();
					}
				});
			});
		});
	}
	
	function closeModal() {
		const modal = document.getElementById('custom-modal');
		if (modal) {
			modal.hidden = true;
			modal.style.display = 'none';
			document.body.style.overflow = '';
		}
		currentModalResolve = null;
	}
	
	// Garantir que o modal esteja oculto na inicialização
	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', () => {
			const modal = document.getElementById('custom-modal');
			if (modal) {
				modal.hidden = true;
				modal.style.display = 'none';
			}
		});
	} else {
		const modal = document.getElementById('custom-modal');
		if (modal) {
			modal.hidden = true;
			modal.style.display = 'none';
		}
	}
	
	// Iniciar
	init();
})();

