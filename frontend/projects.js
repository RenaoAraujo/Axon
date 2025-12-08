(() => {
	const STORAGE_KEY = 'axonProjects.v1';
	
	// Elementos DOM - Biblioteca
	const projectsGrid = document.getElementById('projects-grid');
	const projectsEmpty = document.getElementById('projects-empty');
	const projectsContent = document.querySelector('.projects-content');
	const btnNewProject = document.getElementById('btn-new-project');
	const searchInput = document.getElementById('search-projects');
	const filterArea = document.getElementById('filter-area');
	const filterStatus = document.getElementById('filter-status');
	const btnToggleView = document.getElementById('btn-toggle-view');
	
	// Elementos DOM - Detalhes
	const projectDetail = document.getElementById('project-detail');
	const projectsLibrary = document.getElementById('projects-library');
	const btnBackToLibrary = document.getElementById('btn-back-to-library');
	const projectName = document.getElementById('project-name');
	const projectArea = document.getElementById('project-area');
	const projectStatus = document.getElementById('project-status');
	const projectDescription = document.getElementById('project-description');
	const btnSaveProject = document.getElementById('btn-save-project');
	const btnDeleteProject = document.getElementById('btn-delete-project');
	const btnFavorite = document.getElementById('btn-favorite');
	
	// Elementos DOM - Materiais (formulário simples, sem modal)
	const materialSearchInput = document.getElementById('material-search');
	const manualNameInput = document.getElementById('manual-name');
	const manualQtyInput = document.getElementById('manual-qty');
	const manualUnitInput = document.getElementById('manual-unit');
	const manualSupplierInput = document.getElementById('manual-supplier');
	
	// Estado
	let projects = [];
	let currentProjectId = null;
	let viewMode = 'grid'; // 'grid' ou 'list'
	let filters = {
		search: '',
		area: '',
		status: ''
	};
	
	// Inicialização
	function init() {
		loadProjects();
		setupEventListeners();
		renderProjects();
		updateStats();
	}
	
	function setupEventListeners() {
		// Biblioteca
		btnNewProject?.addEventListener('click', createNewProject);
		searchInput?.addEventListener('input', handleSearch);
		filterArea?.addEventListener('change', handleFilterChange);
		filterStatus?.addEventListener('change', handleFilterChange);
		btnToggleView?.addEventListener('click', toggleView);
		
		// Detalhes
		btnBackToLibrary?.addEventListener('click', backToLibrary);
		btnSaveProject?.addEventListener('click', saveCurrentProject);
		btnDeleteProject?.addEventListener('click', deleteCurrentProject);
		btnFavorite?.addEventListener('click', toggleFavorite);
		
		// Inputs do projeto
		projectName?.addEventListener('input', debounce(autoSave, 1000));
		projectArea?.addEventListener('change', debounce(autoSave, 500));
		projectStatus?.addEventListener('change', debounce(autoSave, 500));
		projectDescription?.addEventListener('input', debounce(autoSave, 1000));
		
		// Abas
		document.querySelectorAll('.tab-btn').forEach(btn => {
			btn.addEventListener('click', (e) => switchTab(e.target.dataset.tab));
		});
		
		// Tarefas
		document.getElementById('btn-new-task')?.addEventListener('click', addTask);
		
		// Materiais (form sempre visível, sem modal)
		document.getElementById('btn-add-material')?.addEventListener('click', addMaterial);
		document.getElementById('btn-clear-material')?.addEventListener('click', clearMaterialForm);
		
		// Arquivos
		document.getElementById('btn-upload-file')?.addEventListener('click', () => {
			document.getElementById('file-input')?.click();
		});
		document.getElementById('file-input')?.addEventListener('change', handleFileUpload);
		
		// Logs
		document.getElementById('btn-new-log')?.addEventListener('click', addLog);
		
		// Versões
		document.getElementById('btn-new-version')?.addEventListener('click', addVersion);
		
		// Tags
		document.getElementById('tag-input')?.addEventListener('keypress', (e) => {
			if (e.key === 'Enter') {
				addTag(e.target.value);
				e.target.value = '';
			}
		});
		
		// Atalhos
		window.addEventListener('keydown', (e) => {
			if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
				e.preventDefault();
				createNewProject();
			}
		});
	}
	
	// ========== CRUD DE PROJETOS ==========
	
	function createNewProject() {
		const newProject = {
			id: uid(),
			name: '',
			area: 'eletronica',
			status: 'planejamento',
			description: '',
			tags: [],
			favorite: false,
			dates: {
				created: Date.now(),
				start: null,
				end: null,
				modified: Date.now()
			},
			tasks: [],
			materials: [],
			files: [],
			logs: [],
			versions: []
		};
		
		projects.unshift(newProject);
		saveProjects();
		openProject(newProject.id);
	}
	
	function openProject(projectId) {
		const project = projects.find(p => p.id === projectId);
		if (!project) return;
		
		currentProjectId = projectId;
		
		// Preencher dados
		projectName.value = project.name || '';
		projectArea.value = project.area;
		projectStatus.value = project.status;
		projectDescription.value = project.description || '';
		
		// Atualizar favorito
		btnFavorite.classList.toggle('active', project.favorite);
		
		// Atualizar datas
		document.getElementById('date-created').textContent = formatDate(new Date(project.dates.created));
		document.getElementById('date-modified').textContent = formatDate(new Date(project.dates.modified));
		
		const dateStart = document.getElementById('date-start');
		const dateEnd = document.getElementById('date-end');
		
		if (project.dates.start) {
			dateStart.value = new Date(project.dates.start).toISOString().split('T')[0];
		}
		if (project.dates.end) {
			dateEnd.value = new Date(project.dates.end).toISOString().split('T')[0];
		}
		
		dateStart.addEventListener('change', () => {
			project.dates.start = dateStart.value ? new Date(dateStart.value).getTime() : null;
			autoSave();
		});
		
		dateEnd.addEventListener('change', () => {
			project.dates.end = dateEnd.value ? new Date(dateEnd.value).getTime() : null;
			autoSave();
		});
		
		// Renderizar seções
		renderTags(project);
		renderTasks(project);
		renderMaterials(project);
		renderFiles(project);
		renderLogs(project);
		renderVersions(project);
		updateProgress(project);
		
		// Mostrar tela de detalhes logo abaixo dos cards / stats
		if (projectsContent) {
			projectsContent.style.display = 'none';
		}
		projectDetail.hidden = false;
		
		// Focar no nome se vazio
		if (!project.name) {
			projectName.focus();
		}
	}
	
	function backToLibrary() {
		// Voltar a mostrar a lista de projetos logo abaixo dos cards de estatísticas,
		// sem mexer no scroll da página (efeito de "minimizar" os detalhes)
		if (projectsContent) {
			projectsContent.style.display = '';
		}
		projectDetail.hidden = true;
		currentProjectId = null;
	}
	
	function saveCurrentProject() {
		if (!currentProjectId) return;
		
		const project = projects.find(p => p.id === currentProjectId);
		if (!project) return;
		
		project.name = projectName.value.trim();
		project.area = projectArea.value;
		project.status = projectStatus.value;
		project.description = projectDescription.value.trim();
		project.dates.modified = Date.now();
		
		saveProjects();
		showNotification('Projeto salvo com sucesso!');
	}
	
	function autoSave() {
		if (!currentProjectId) return;
		
		const project = projects.find(p => p.id === currentProjectId);
		if (!project) return;
		
		project.name = projectName.value.trim();
		project.area = projectArea.value;
		project.status = projectStatus.value;
		project.description = projectDescription.value.trim();
		project.dates.modified = Date.now();
		
		saveProjects();
		// Atualizar cabeçalho (totais) após mudanças de status
		updateStats();
	}
	
	function deleteCurrentProject() {
		if (!currentProjectId) return;
		
		const project = projects.find(p => p.id === currentProjectId);
		if (!project) return;
		
		const projectName = project.name || 'Sem nome';
		
		if (!confirm(`Tem certeza que deseja excluir o projeto "${projectName}"?`)) return;
		
		projects = projects.filter(p => p.id !== currentProjectId);
		saveProjects();
		backToLibrary();
		showNotification('Projeto excluído!');
	}
	
	function toggleFavorite() {
		if (!currentProjectId) return;
		
		const project = projects.find(p => p.id === currentProjectId);
		if (!project) return;
		
		project.favorite = !project.favorite;
		btnFavorite.classList.toggle('active', project.favorite);
		saveProjects();
	}
	
	// ========== RENDERIZAÇÃO ==========
	
	function renderProjects() {
		if (!projectsGrid) return;
		
		// Filtrar projetos
		let filtered = projects.filter(project => {
			// Busca
			if (filters.search) {
				const query = filters.search.toLowerCase();
				const name = (project.name || '').toLowerCase();
				const description = (project.description || '').toLowerCase();
				const tags = project.tags.join(' ').toLowerCase();
				
				if (!name.includes(query) && !description.includes(query) && !tags.includes(query)) {
					return false;
				}
			}
			
			// Filtro de área
			if (filters.area && project.area !== filters.area) {
				return false;
			}
			
			// Filtro de status
			if (filters.status && project.status !== filters.status) {
				return false;
			}
			
			return true;
		});
		
		// Ordenar: favoritos primeiro, depois por data modificada
		filtered.sort((a, b) => {
			if (a.favorite && !b.favorite) return -1;
			if (!a.favorite && b.favorite) return 1;
			return b.dates.modified - a.dates.modified;
		});
		
		projectsGrid.innerHTML = '';
		
		if (filtered.length === 0) {
			projectsEmpty.hidden = false;
			return;
		}
		
		projectsEmpty.hidden = true;
		
		filtered.forEach(project => {
			const card = createProjectCard(project);
			projectsGrid.appendChild(card);
		});
	}
	
	function createProjectCard(project) {
		const card = document.createElement('div');
		card.className = `project-card ${viewMode}`;
		if (project.favorite) card.classList.add('favorite');
		
		const statusColors = {
			planejamento: '#8B5CF6',
			construcao: '#F59E0B',
			testes: '#3B82F6',
			finalizado: '#10B981',
			pausado: '#6B7280'
		};
		
		const areaIcons = {
			eletronica: '📱',
			mecanica: '⚙️',
			software: '💻',
			robotica: '🤖',
			iot: '🌐',
			impressao3d: '🖨️',
			outros: '📦'
		};
		
		const progress = calculateProgress(project);
		const statusColor = statusColors[project.status] || '#6B7280';
		
		card.innerHTML = `
			<div class="project-card-header">
				<div class="project-icon">${areaIcons[project.area] || '📦'}</div>
				${project.favorite ? '<div class="favorite-badge">⭐</div>' : ''}
			</div>
			<div class="project-card-body">
				<h3 class="project-card-title">${escapeHtml(project.name || 'Sem nome')}</h3>
				<p class="project-card-description">${escapeHtml(project.description || 'Sem descrição').substring(0, 100)}${project.description && project.description.length > 100 ? '...' : ''}</p>
				<div class="project-card-tags">
					${project.tags.slice(0, 3).map(tag => `<span class="tag">${escapeHtml(tag)}</span>`).join('')}
					${project.tags.length > 3 ? `<span class="tag more">+${project.tags.length - 3}</span>` : ''}
				</div>
			</div>
			<div class="project-card-footer">
				<div class="status-badge" style="background: ${statusColor}20; color: ${statusColor}; border-color: ${statusColor}">
					${getStatusLabel(project.status)}
				</div>
				<div class="project-progress-mini">
					<div class="progress-bar-mini">
						<div class="progress-fill-mini" style="width: ${progress}%; background: ${statusColor}"></div>
					</div>
					<span class="progress-text-mini">${progress}%</span>
				</div>
				<div class="project-date">${formatDateShort(new Date(project.dates.modified))}</div>
			</div>
		`;
		
		card.addEventListener('click', () => openProject(project.id));
		
		return card;
	}
	
	function updateStats() {
		const total = projects.length;
		const active = projects.filter(p => ['planejamento', 'construcao', 'testes'].includes(p.status)).length;
		const completed = projects.filter(p => p.status === 'finalizado').length;
		
		document.getElementById('stat-total').textContent = total;
		document.getElementById('stat-active').textContent = active;
		document.getElementById('stat-completed').textContent = completed;
	}
	
	// ========== TAGS ==========
	
	function renderTags(project) {
		const container = document.getElementById('project-tags');
		if (!container) return;
		
		container.innerHTML = '';
		
		project.tags.forEach(tag => {
			const tagEl = document.createElement('span');
			tagEl.className = 'tag removable';
			tagEl.innerHTML = `
				${escapeHtml(tag)}
				<button class="tag-remove" title="Remover">&times;</button>
			`;
			
			tagEl.querySelector('.tag-remove').addEventListener('click', () => {
				removeTag(project, tag);
			});
			
			container.appendChild(tagEl);
		});
	}
	
	function addTag(tagName) {
		if (!currentProjectId) return;
		
		const project = projects.find(p => p.id === currentProjectId);
		if (!project) return;
		
		const tag = tagName.trim();
		if (!tag || project.tags.includes(tag)) return;
		
		project.tags.push(tag);
		renderTags(project);
		saveProjects();
	}
	
	function removeTag(project, tag) {
		project.tags = project.tags.filter(t => t !== tag);
		renderTags(project);
		saveProjects();
	}
	
	// ========== TAREFAS ==========
	
	function renderTasks(project) {
		const container = document.getElementById('tasks-list');
		if (!container) return;
		
		container.innerHTML = '';
		
		if (project.tasks.length === 0) {
			container.innerHTML = '<div class="empty-state">Nenhuma tarefa adicionada</div>';
			return;
		}
		
		project.tasks.forEach(task => {
			const taskEl = document.createElement('div');
			taskEl.className = 'task-item';
			if (task.completed) taskEl.classList.add('completed');
			
			const priorityColors = {
				baixa: '#10B981',
				media: '#F59E0B',
				alta: '#EF4444'
			};
			
			taskEl.innerHTML = `
				<input type="checkbox" ${task.completed ? 'checked' : ''} class="task-checkbox" />
				<div class="task-content">
					<div class="task-title">${escapeHtml(task.title)}</div>
					${task.description ? `<div class="task-description">${escapeHtml(task.description)}</div>` : ''}
					<div class="task-meta">
						<span class="task-priority" style="color: ${priorityColors[task.priority]}">${task.priority}</span>
						${task.deadline ? `<span class="task-deadline">📅 ${formatDateShort(new Date(task.deadline))}</span>` : ''}
					</div>
				</div>
				<button class="task-delete" title="Excluir">🗑️</button>
			`;
			
			taskEl.querySelector('.task-checkbox').addEventListener('change', (e) => {
				task.completed = e.target.checked;
				taskEl.classList.toggle('completed', task.completed);
				updateProgress(project);
				saveProjects();
			});
			
			taskEl.querySelector('.task-delete').addEventListener('click', () => {
				project.tasks = project.tasks.filter(t => t.id !== task.id);
				renderTasks(project);
				updateProgress(project);
				saveProjects();
			});
			
			container.appendChild(taskEl);
		});
		
		updateProgress(project);
	}
	
	function addTask() {
		if (!currentProjectId) return;
		
		const project = projects.find(p => p.id === currentProjectId);
		if (!project) return;
		
		const title = prompt('Nome da tarefa:');
		if (!title) return;
		
		const task = {
			id: uid(),
			title: title.trim(),
			description: '',
			completed: false,
			priority: 'media',
			deadline: null,
			createdAt: Date.now()
		};
		
		project.tasks.push(task);
		renderTasks(project);
		saveProjects();
	}
	
	function calculateProgress(project) {
		if (!project.tasks || project.tasks.length === 0) return 0;
		const completed = project.tasks.filter(t => t.completed).length;
		return Math.round((completed / project.tasks.length) * 100);
	}
	
	function updateProgress(project) {
		const progress = calculateProgress(project);
		const progressBar = document.getElementById('project-progress');
		const progressText = document.getElementById('progress-text');
		
		if (progressBar) progressBar.style.width = `${progress}%`;
		if (progressText) progressText.textContent = `${progress}%`;
	}
	
	// ========== MATERIAIS ==========
	
	function renderMaterials(project) {
		const container = document.getElementById('materials-list');
		if (!container) return;
		
		container.innerHTML = '';
		
		if (project.materials.length === 0) {
			container.innerHTML = '<div class="empty-state">Nenhum material adicionado</div>';
			return;
		}
		
		project.materials.forEach(material => {
			const matEl = document.createElement('div');
			matEl.className = 'material-item';
			
			matEl.innerHTML = `
				<div class="material-content">
					<div class="material-name">${escapeHtml(material.name)}</div>
					<div class="material-meta">
						${material.quantity ? `<span>Qtd: ${material.quantity}</span>` : ''}
						${material.unit ? `<span>${material.unit}</span>` : ''}
						${material.supplier ? `<span>Fornecedor: ${escapeHtml(material.supplier)}</span>` : ''}
					</div>
				</div>
				<button class="material-delete" title="Excluir">🗑️</button>
			`;
			
			matEl.querySelector('.material-delete').addEventListener('click', () => {
				project.materials = project.materials.filter(m => m.id !== material.id);
				renderMaterials(project);
				saveProjects();
			});
			
			container.appendChild(matEl);
		});
	}
	
	function addMaterial() {
		if (!currentProjectId) return;
		const project = projects.find(p => p.id === currentProjectId);
		if (!project) return;

		// Leitura do formulário simples (sem modal)
		const name = (manualNameInput?.value || '').trim();
		if (!name) {
			alert('Informe o nome do material.');
			return;
		}
		const qtyVal = manualQtyInput?.value || '';
		const qty = qtyVal ? (parseInt(qtyVal, 10) || null) : null;
		const unit = (manualUnitInput?.value || '').trim();
		const supplier = (manualSupplierInput?.value || '').trim();

		const material = {
			id: uid(),
			name,
			quantity: qty,
			unit,
			supplier,
			createdAt: Date.now()
		};

		project.materials.push(material);
		saveProjects();
		renderMaterials(project);
		clearMaterialForm();
	}

	function clearMaterialForm() {
		if (manualNameInput) manualNameInput.value = '';
		if (manualQtyInput) manualQtyInput.value = '';
		if (manualUnitInput) manualUnitInput.value = '';
		if (manualSupplierInput) manualSupplierInput.value = '';
		if (materialSearchInput) materialSearchInput.value = '';
	}
	
	// ========== ARQUIVOS ==========
	
	function renderFiles(project) {
		const container = document.getElementById('files-list');
		if (!container) return;
		
		container.innerHTML = '';
		
		if (project.files.length === 0) {
			container.innerHTML = '<div class="empty-state">Nenhum arquivo anexado</div>';
			return;
		}
		
		project.files.forEach(file => {
			const fileEl = document.createElement('div');
			fileEl.className = 'file-item';
			
			const icon = getFileIcon(file.type);
			
			fileEl.innerHTML = `
				<div class="file-icon">${icon}</div>
				<div class="file-content">
					<div class="file-name">${escapeHtml(file.name)}</div>
					<div class="file-meta">
						<span>${formatFileSize(file.size)}</span>
						<span>${formatDateShort(new Date(file.uploadedAt))}</span>
					</div>
				</div>
				<button class="file-delete" title="Excluir">🗑️</button>
			`;
			
			fileEl.querySelector('.file-delete').addEventListener('click', () => {
				project.files = project.files.filter(f => f.id !== file.id);
				renderFiles(project);
				saveProjects();
			});
			
			container.appendChild(fileEl);
		});
	}
	
	function handleFileUpload(e) {
		if (!currentProjectId) return;
		
		const project = projects.find(p => p.id === currentProjectId);
		if (!project) return;
		
		const files = Array.from(e.target.files);
		
		files.forEach(file => {
			// Em produção, fazer upload real. Por enquanto, só metadata
			const fileData = {
				id: uid(),
				name: file.name,
				size: file.size,
				type: file.type,
				uploadedAt: Date.now()
			};
			
			project.files.push(fileData);
		});
		
		renderFiles(project);
		saveProjects();
		e.target.value = ''; // Reset input
	}
	
	// ========== LOGS ==========
	
	function renderLogs(project) {
		const container = document.getElementById('logs-timeline');
		if (!container) return;
		
		container.innerHTML = '';
		
		if (project.logs.length === 0) {
			container.innerHTML = '<div class="empty-state">Nenhum log registrado</div>';
			return;
		}
		
		// Ordenar logs por data (mais recente primeiro)
		const sortedLogs = [...project.logs].sort((a, b) => b.date - a.date);
		
		sortedLogs.forEach(log => {
			const logEl = document.createElement('div');
			logEl.className = 'log-item';
			
			logEl.innerHTML = `
				<div class="log-date">${formatDate(new Date(log.date))}</div>
				<div class="log-content">
					<div class="log-text">${escapeHtml(log.text)}</div>
				</div>
				<button class="log-delete" title="Excluir">🗑️</button>
			`;
			
			logEl.querySelector('.log-delete').addEventListener('click', () => {
				project.logs = project.logs.filter(l => l.id !== log.id);
				renderLogs(project);
				saveProjects();
			});
			
			container.appendChild(logEl);
		});
	}
	
	function addLog() {
		if (!currentProjectId) return;
		
		const project = projects.find(p => p.id === currentProjectId);
		if (!project) return;
		
		const text = prompt('Descrição do log:');
		if (!text) return;
		
		const log = {
			id: uid(),
			text: text.trim(),
			date: Date.now()
		};
		
		project.logs.push(log);
		renderLogs(project);
		saveProjects();
	}
	
	// ========== VERSÕES ==========
	
	function renderVersions(project) {
		const container = document.getElementById('versions-list');
		if (!container) return;
		
		container.innerHTML = '';
		
		if (project.versions.length === 0) {
			container.innerHTML = '<div class="empty-state">Nenhuma versão registrada</div>';
			return;
		}
		
		// Ordenar versões (mais recente primeiro)
		const sortedVersions = [...project.versions].sort((a, b) => b.date - a.date);
		
		sortedVersions.forEach(version => {
			const versionEl = document.createElement('div');
			versionEl.className = 'version-item';
			
			versionEl.innerHTML = `
				<div class="version-header">
					<span class="version-number">${escapeHtml(version.number)}</span>
					<span class="version-date">${formatDate(new Date(version.date))}</span>
				</div>
				<div class="version-content">
					<div class="version-description">${escapeHtml(version.description)}</div>
					${version.changes ? `<div class="version-changes">${escapeHtml(version.changes)}</div>` : ''}
				</div>
				<button class="version-delete" title="Excluir">🗑️</button>
			`;
			
			versionEl.querySelector('.version-delete').addEventListener('click', () => {
				project.versions = project.versions.filter(v => v.id !== version.id);
				renderVersions(project);
				saveProjects();
			});
			
			container.appendChild(versionEl);
		});
	}
	
	function addVersion() {
		if (!currentProjectId) return;
		
		const project = projects.find(p => p.id === currentProjectId);
		if (!project) return;
		
		const number = prompt('Número da versão (ex: v1.0, v2.1):');
		if (!number) return;
		
		const description = prompt('Descrição da versão:');
		if (!description) return;
		
		const version = {
			id: uid(),
			number: number.trim(),
			description: description.trim(),
			changes: '',
			date: Date.now()
		};
		
		project.versions.push(version);
		renderVersions(project);
		saveProjects();
	}
	
	// ========== ABAS ==========
	
	function switchTab(tabName) {
		// Atualizar botões
		document.querySelectorAll('.tab-btn').forEach(btn => {
			btn.classList.toggle('active', btn.dataset.tab === tabName);
		});
		
		// Atualizar conteúdo
		document.querySelectorAll('.tab-content').forEach(content => {
			content.hidden = content.id !== `tab-${tabName}`;
		});
	}
	
	// ========== FILTROS ==========
	
	function handleSearch(e) {
		filters.search = e.target.value.toLowerCase().trim();
		renderProjects();
	}
	
	function handleFilterChange() {
		filters.area = filterArea.value;
		filters.status = filterStatus.value;
		renderProjects();
	}
	
	function toggleView() {
		viewMode = viewMode === 'grid' ? 'list' : 'grid';
		projectsGrid.classList.toggle('list-mode', viewMode === 'list');
		renderProjects();
	}
	
	// ========== UTILITÁRIOS ==========
	
	function getStatusLabel(status) {
		const labels = {
			planejamento: 'Planejamento',
			construcao: 'Construção',
			testes: 'Testes',
			finalizado: 'Finalizado',
			pausado: 'Pausado'
		};
		return labels[status] || status;
	}
	
	function getFileIcon(type) {
		if (type.startsWith('image/')) return '🖼️';
		if (type.includes('pdf')) return '📄';
		if (type.includes('zip') || type.includes('rar')) return '📦';
		if (type.includes('video')) return '🎥';
		if (type.includes('audio')) return '🎵';
		return '📁';
	}
	
	function formatFileSize(bytes) {
		if (bytes < 1024) return bytes + ' B';
		if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
		return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
	}
	
	function formatDate(date) {
		const now = new Date();
		const diff = now - date;
		const days = Math.floor(diff / (1000 * 60 * 60 * 24));
		
		if (days === 0) return 'Hoje';
		if (days === 1) return 'Ontem';
		if (days < 7) return `${days} dias atrás`;
		
		return date.toLocaleDateString('pt-BR', {
			day: '2-digit',
			month: '2-digit',
			year: 'numeric'
		});
	}
	
	function formatDateShort(date) {
		return date.toLocaleDateString('pt-BR', {
			day: '2-digit',
			month: 'short'
		});
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
	
	function showNotification(message) {
		// Implementar toast notification
		console.log(message);
	}
	
	// ========== STORAGE ==========
	
	function saveProjects() {
		try {
			localStorage.setItem(STORAGE_KEY, JSON.stringify(projects));
		} catch (e) {
			console.error('Erro ao salvar projetos:', e);
		}
	}
	
	function loadProjects() {
		try {
			const raw = localStorage.getItem(STORAGE_KEY);
			if (raw) {
				projects = JSON.parse(raw);
				if (!Array.isArray(projects)) {
					projects = [];
				}
			}
		} catch (e) {
			console.error('Erro ao carregar projetos:', e);
			projects = [];
		}
	}
	
	// Iniciar
	init();
})();

