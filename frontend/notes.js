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
		noteTitle?.focus();
	}

	function deleteCurrentNote() {
		if (!currentNoteId) return;
		
		if (!confirm('Tem certeza que deseja excluir esta nota?')) return;
		
		notes = notes.filter(n => n.id !== currentNoteId);
		saveNotes();
		currentNoteId = null;
		renderNotesList();
		showEditorEmpty();
		updateDeleteButton();
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
		
		// Destacar nota selecionada na lista
		document.querySelectorAll('.note-item').forEach(item => {
			item.classList.toggle('active', item.dataset.id === noteId);
		});
	}

	function saveCurrentNote() {
		if (!currentNoteId) return;
		
		const note = notes.find(n => n.id === currentNoteId);
		if (!note) return;
		
		note.title = noteTitle.value.trim();
		note.content = noteContent.value.trim();
		note.updatedAt = Date.now();
		
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
	}

	function updateDeleteButton() {
		if (btnDeleteNote) {
			btnDeleteNote.disabled = !currentNoteId;
		}
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

	// Iniciar
	init();
})();

