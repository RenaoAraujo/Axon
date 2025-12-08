(() => {
	const STORAGE_KEY = 'axonInventory.v1';
	
	// Elementos DOM - Lista
	const inventoryGrid = document.getElementById('inventory-grid');
	const inventoryEmpty = document.getElementById('inventory-empty');
	const btnNewItem = document.getElementById('btn-new-item');
	const btnLowStock = document.getElementById('btn-low-stock');
	const searchInput = document.getElementById('search-inventory');
	const filterCategory = document.getElementById('filter-category');
	const btnToggleView = document.getElementById('btn-toggle-view');
	
	// Elementos DOM - Detalhes
	const inventoryMain = document.getElementById('inventory-main');
	const inventoryContent = document.getElementById('inventory-content');
	const inventoryDetail = document.getElementById('inventory-detail');
	const btnBackToInventory = document.getElementById('btn-back-to-inventory');
	const itemName = document.getElementById('item-name');
	const itemCategory = document.getElementById('item-category');
	const itemDescription = document.getElementById('item-description');
	const itemQuantity = document.getElementById('item-quantity');
	const itemUnit = document.getElementById('item-unit');
	const itemMinStock = document.getElementById('item-min-stock');
	const itemPrice = document.getElementById('item-price');
	const itemLocation = document.getElementById('item-location');
	const itemSupplier = document.getElementById('item-supplier');
	const itemSku = document.getElementById('item-sku');
	const btnSaveItem = document.getElementById('btn-save-item');
	const btnDeleteItem = document.getElementById('btn-delete-item');
	const btnIncreaseStock = document.getElementById('btn-increase-stock');
	const btnDecreaseStock = document.getElementById('btn-decrease-stock');
	const stockAlert = document.getElementById('stock-alert');
	
	// Estado
	let items = [];
	let currentItemId = null;
	let viewMode = 'grid'; // 'grid' ou 'list'
	let filters = {
		search: '',
		category: '',
		showLowStock: false
	};
	
	// Inicialização
	function init() {
		loadItems();
		setupEventListeners();
		renderItems();
		updateStats();
	}
	
	function setupEventListeners() {
		// Lista
		btnNewItem?.addEventListener('click', createNewItem);
		btnLowStock?.addEventListener('click', toggleLowStockFilter);
		searchInput?.addEventListener('input', handleSearch);
		filterCategory?.addEventListener('change', handleFilterChange);
		btnToggleView?.addEventListener('click', toggleView);
		
		// Detalhes
		btnBackToInventory?.addEventListener('click', backToInventory);
		btnSaveItem?.addEventListener('click', saveCurrentItem);
		btnDeleteItem?.addEventListener('click', deleteCurrentItem);
		btnIncreaseStock?.addEventListener('click', () => adjustStock(1));
		btnDecreaseStock?.addEventListener('click', () => adjustStock(-1));
		
		// Inputs
		itemName?.addEventListener('input', debounce(autoSave, 1000));
		itemCategory?.addEventListener('change', debounce(autoSave, 500));
		itemDescription?.addEventListener('input', debounce(autoSave, 1000));
		itemQuantity?.addEventListener('input', () => {
			updateStockAlert();
			debounce(autoSave, 500)();
		});
		itemUnit?.addEventListener('input', debounce(autoSave, 500));
		itemMinStock?.addEventListener('input', () => {
			updateStockAlert();
			debounce(autoSave, 500)();
		});
		itemPrice?.addEventListener('input', debounce(autoSave, 500));
		itemLocation?.addEventListener('input', debounce(autoSave, 500));
		itemSupplier?.addEventListener('input', debounce(autoSave, 500));
		itemSku?.addEventListener('input', debounce(autoSave, 500));
		
		// Fotos
		document.getElementById('btn-upload-photo')?.addEventListener('click', () => {
			document.getElementById('photo-input')?.click();
		});
		document.getElementById('photo-input')?.addEventListener('change', handlePhotoUpload);
		
		// Datasheets
		document.getElementById('btn-upload-datasheet')?.addEventListener('click', () => {
			document.getElementById('datasheet-input')?.click();
		});
		document.getElementById('datasheet-input')?.addEventListener('change', handleDatasheetUpload);
		
		// Atalhos
		window.addEventListener('keydown', (e) => {
			if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
				e.preventDefault();
				createNewItem();
			}
		});
	}
	
	// ========== CRUD DE ITENS ==========
	
	function createNewItem() {
		const newItem = {
			id: uid(),
			name: '',
			category: 'componente',
			description: '',
			quantity: 0,
			unit: 'un',
			minStock: 0,
			price: 0,
			location: '',
			supplier: '',
			sku: '',
			photos: [],
			datasheets: [],
			usageHistory: [],
			linkedProjects: [],
			createdAt: Date.now(),
			updatedAt: Date.now()
		};
		
		items.unshift(newItem);
		saveItems();
		openItem(newItem.id);
	}
	
	function openItem(itemId) {
		const item = items.find(i => i.id === itemId);
		if (!item) return;
		
		currentItemId = itemId;
		
		// Preencher dados
		itemName.value = item.name || '';
		itemCategory.value = item.category;
		itemDescription.value = item.description || '';
		itemQuantity.value = item.quantity;
		itemUnit.value = item.unit || 'un';
		itemMinStock.value = item.minStock || 0;
		itemPrice.value = item.price || 0;
		itemLocation.value = item.location || '';
		itemSupplier.value = item.supplier || '';
		itemSku.value = item.sku || '';
		
		// Renderizar fotos
		renderPhotos(item);
		
		// Renderizar datasheets
		renderDatasheets(item);
		
		// Renderizar histórico de uso
		renderUsageHistory(item);
		
		// Renderizar projetos vinculados
		renderLinkedProjects(item);
		
		// Atualizar resumo
		updateSummary(item);
		
		// Atualizar alerta de estoque
		updateStockAlert();
		
		// Mostrar tela de detalhes: esconder os cards completamente
		if (inventoryContent) inventoryContent.hidden = true;
		inventoryDetail.hidden = false;
		
		// Focar no nome se vazio
		if (!item.name) {
			itemName.focus();
		}
	}
	
	function backToInventory() {
		// Voltar a mostrar a lista de itens sem mexer no scroll
		if (inventoryContent) inventoryContent.hidden = false;
		inventoryDetail.hidden = true;
		currentItemId = null;
	}
	
	function saveCurrentItem() {
		if (!currentItemId) return;
		
		const item = items.find(i => i.id === currentItemId);
		if (!item) return;
		
		item.name = itemName.value.trim();
		item.category = itemCategory.value;
		item.description = itemDescription.value.trim();
		item.quantity = parseInt(itemQuantity.value) || 0;
		item.unit = itemUnit.value.trim() || 'un';
		item.minStock = parseInt(itemMinStock.value) || 0;
		item.price = parseFloat(itemPrice.value) || 0;
		item.location = itemLocation.value.trim();
		item.supplier = itemSupplier.value.trim();
		item.sku = itemSku.value.trim();
		item.updatedAt = Date.now();
		
		saveItems();
		updateSummary(item);
		updateStats();
		showNotification('Item salvo com sucesso!');
	}
	
	function autoSave() {
		if (!currentItemId) return;
		
		const item = items.find(i => i.id === currentItemId);
		if (!item) return;
		
		item.name = itemName.value.trim();
		item.category = itemCategory.value;
		item.description = itemDescription.value.trim();
		item.quantity = parseInt(itemQuantity.value) || 0;
		item.unit = itemUnit.value.trim() || 'un';
		item.minStock = parseInt(itemMinStock.value) || 0;
		item.price = parseFloat(itemPrice.value) || 0;
		item.location = itemLocation.value.trim();
		item.supplier = itemSupplier.value.trim();
		item.sku = itemSku.value.trim();
		item.updatedAt = Date.now();
		
		saveItems();
		updateSummary(item);
	}
	
	function deleteCurrentItem() {
		if (!currentItemId) return;
		
		const item = items.find(i => i.id === currentItemId);
		if (!item) return;
		
		const itemName = item.name || 'Sem nome';
		
		if (!confirm(`Tem certeza que deseja excluir "${itemName}"?`)) return;
		
		items = items.filter(i => i.id !== currentItemId);
		saveItems();
		backToInventory();
		showNotification('Item excluído!');
	}
	
	// ========== CONTROLE DE ESTOQUE ==========
	
	function adjustStock(delta) {
		if (!currentItemId) return;
		
		const item = items.find(i => i.id === currentItemId);
		if (!item) return;
		
		const newQuantity = Math.max(0, item.quantity + delta);
		item.quantity = newQuantity;
		itemQuantity.value = newQuantity;
		
		// Registrar no histórico
		item.usageHistory.unshift({
			id: uid(),
			action: delta > 0 ? 'add' : 'remove',
			quantity: Math.abs(delta),
			date: Date.now(),
			note: delta > 0 ? 'Adicionado manualmente' : 'Removido manualmente'
		});
		
		saveItems();
		updateStockAlert();
		updateSummary(item);
		renderUsageHistory(item);
	}
	
	function updateStockAlert() {
		if (!currentItemId) return;
		
		const quantity = parseInt(itemQuantity.value) || 0;
		const minStock = parseInt(itemMinStock.value) || 0;
		
		if (quantity <= minStock) {
			stockAlert.hidden = false;
		} else {
			stockAlert.hidden = true;
		}
	}
	
	// ========== API PÚBLICA (para integração com Projetos) ==========
	
	// Expõe funções globalmente para integração
	window.InventoryAPI = {
		getAllItems: () => items,
		
		getItemById: (id) => items.find(i => i.id === id),
		
		getItemsByCategory: (category) => items.filter(i => i.category === category),
		
		searchItems: (query) => {
			query = query.toLowerCase().trim();
			return items.filter(i => {
				const name = (i.name || '').toLowerCase();
				const description = (i.description || '').toLowerCase();
				const sku = (i.sku || '').toLowerCase();
				return name.includes(query) || description.includes(query) || sku.includes(query);
			});
		},
		
		// Consome quantidade do estoque (chamado pelos Projetos)
		consumeStock: (itemId, quantity, projectId, projectName) => {
			const item = items.find(i => i.id === itemId);
			if (!item) return { success: false, error: 'Item não encontrado' };
			
			if (item.quantity < quantity) {
				return { success: false, error: 'Estoque insuficiente' };
			}
			
			item.quantity -= quantity;
			
			// Registrar no histórico
			item.usageHistory.unshift({
				id: uid(),
				action: 'remove',
				quantity: quantity,
				date: Date.now(),
				note: `Usado no projeto: ${projectName}`,
				projectId: projectId
			});
			
			// Vincular ao projeto
			if (!item.linkedProjects.find(p => p.id === projectId)) {
				item.linkedProjects.push({
					id: projectId,
					name: projectName,
					quantity: quantity,
					date: Date.now()
				});
			} else {
				const link = item.linkedProjects.find(p => p.id === projectId);
				link.quantity += quantity;
			}
			
			saveItems();
			
			return { success: true, newStock: item.quantity };
		},
		
		// Retorna quantidade ao estoque
		returnStock: (itemId, quantity, projectId, projectName) => {
			const item = items.find(i => i.id === itemId);
			if (!item) return { success: false, error: 'Item não encontrado' };
			
			item.quantity += quantity;
			
			// Registrar no histórico
			item.usageHistory.unshift({
				id: uid(),
				action: 'add',
				quantity: quantity,
				date: Date.now(),
				note: `Devolvido do projeto: ${projectName}`,
				projectId: projectId
			});
			
			saveItems();
			
			return { success: true, newStock: item.quantity };
		},
		
		// Recarrega os itens (útil após mudanças externas)
		reload: () => {
			loadItems();
			if (inventoryMain && !inventoryMain.hidden) {
				renderItems();
				updateStats();
			}
		}
	};
	
	// ========== RENDERIZAÇÃO ==========
	
	function renderItems() {
		if (!inventoryGrid) return;
		
		// Filtrar itens
		let filtered = items.filter(item => {
			// Busca
			if (filters.search) {
				const query = filters.search.toLowerCase();
				const name = (item.name || '').toLowerCase();
				const description = (item.description || '').toLowerCase();
				const sku = (item.sku || '').toLowerCase();
				
				if (!name.includes(query) && !description.includes(query) && !sku.includes(query)) {
					return false;
				}
			}
			
			// Filtro de categoria
			if (filters.category && item.category !== filters.category) {
				return false;
			}
			
			// Filtro de estoque baixo
			if (filters.showLowStock && item.quantity > item.minStock) {
				return false;
			}
			
			return true;
		});
		
		// Ordenar por nome
		filtered.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
		
		inventoryGrid.innerHTML = '';
		
		if (filtered.length === 0) {
			inventoryEmpty.hidden = false;
			return;
		}
		
		inventoryEmpty.hidden = true;
		
		filtered.forEach(item => {
			const card = createItemCard(item);
			inventoryGrid.appendChild(card);
		});
	}
	
	function createItemCard(item) {
		const card = document.createElement('div');
		card.className = `inventory-card ${viewMode}`;
		
		const categoryIcons = {
			componente: '🔌',
			ferramenta: '🔧',
			sensor: '📡',
			mecanica: '⚙️',
			cabo: '🔌',
			bateria: '🔋',
			motor: '⚡',
			outros: '📦'
		};
		
		const stockStatus = item.quantity === 0 ? 'out' : 
			item.quantity <= item.minStock ? 'low' : 'ok';
		
		const stockColors = {
			out: '#EF4444',
			low: '#F59E0B',
			ok: '#10B981'
		};
		
		const stockLabels = {
			out: 'Sem estoque',
			low: 'Estoque baixo',
			ok: 'Em estoque'
		};
		
		const totalValue = item.quantity * (item.price || 0);
		
		card.innerHTML = `
			<div class="inventory-card-header">
				<div class="item-icon">${categoryIcons[item.category] || '📦'}</div>
				<div class="stock-badge ${stockStatus}" style="background: ${stockColors[stockStatus]}20; color: ${stockColors[stockStatus]}; border-color: ${stockColors[stockStatus]}">
					${stockLabels[stockStatus]}
				</div>
			</div>
			<div class="inventory-card-body">
				<h3 class="item-card-title">${escapeHtml(item.name || 'Sem nome')}</h3>
				<p class="item-card-description">${escapeHtml(item.description || 'Sem descrição').substring(0, 80)}${item.description && item.description.length > 80 ? '...' : ''}</p>
				<div class="item-card-info">
					<div class="info-row">
						<span class="info-label">Estoque:</span>
						<span class="info-value">${item.quantity} ${item.unit || 'un'}</span>
					</div>
					${item.location ? `
					<div class="info-row">
						<span class="info-label">📍</span>
						<span class="info-value">${escapeHtml(item.location)}</span>
					</div>
					` : ''}
					${totalValue > 0 ? `
					<div class="info-row">
						<span class="info-label">Valor:</span>
						<span class="info-value">R$ ${totalValue.toFixed(2)}</span>
					</div>
					` : ''}
				</div>
			</div>
		`;
		
		card.addEventListener('click', () => openItem(item.id));
		
		return card;
	}
	
	function updateStats() {
		const total = items.length;
		const lowStock = items.filter(i => i.quantity > 0 && i.quantity <= i.minStock).length;
		const outStock = items.filter(i => i.quantity === 0).length;
		const categories = new Set(items.map(i => i.category)).size;
		
		document.getElementById('stat-total-items').textContent = total;
		document.getElementById('stat-low-stock').textContent = lowStock;
		document.getElementById('stat-out-stock').textContent = outStock;
		document.getElementById('stat-categories').textContent = categories;
	}
	
	function updateSummary(item) {
		document.getElementById('summary-stock').textContent = `${item.quantity} ${item.unit || 'un'}`;
		
		const totalValue = item.quantity * (item.price || 0);
		document.getElementById('summary-total-value').textContent = `R$ ${totalValue.toFixed(2)}`;
		
		document.getElementById('summary-updated').textContent = formatDate(new Date(item.updatedAt));
	}
	
	// ========== FOTOS ==========
	
	function renderPhotos(item) {
		const container = document.getElementById('photos-grid');
		if (!container) return;
		
		container.innerHTML = '';
		
		if (!item.photos || item.photos.length === 0) {
			container.innerHTML = '<p class="empty-text">Nenhuma foto adicionada</p>';
			return;
		}
		
		item.photos.forEach(photo => {
			const photoEl = document.createElement('div');
			photoEl.className = 'photo-item';
			photoEl.style.backgroundImage = `url(${photo.dataUrl})`;
			
			const deleteBtn = document.createElement('button');
			deleteBtn.className = 'photo-delete';
			deleteBtn.textContent = '×';
			deleteBtn.addEventListener('click', (e) => {
				e.stopPropagation();
				removePhoto(item, photo.id);
			});
			
			photoEl.appendChild(deleteBtn);
			container.appendChild(photoEl);
		});
	}
	
	function handlePhotoUpload(e) {
		if (!currentItemId) return;
		
		const item = items.find(i => i.id === currentItemId);
		if (!item) return;
		
		const files = Array.from(e.target.files);
		
		files.forEach(file => {
			if (!file.type.startsWith('image/')) return;
			
			const reader = new FileReader();
			reader.onload = (event) => {
				const photo = {
					id: uid(),
					dataUrl: event.target.result,
					name: file.name,
					size: file.size,
					uploadedAt: Date.now()
				};
				
				if (!item.photos) item.photos = [];
				item.photos.push(photo);
				saveItems();
				renderPhotos(item);
			};
			reader.readAsDataURL(file);
		});
		
		e.target.value = '';
	}
	
	function removePhoto(item, photoId) {
		item.photos = item.photos.filter(p => p.id !== photoId);
		saveItems();
		renderPhotos(item);
	}
	
	// ========== DATASHEETS ==========
	
	function renderDatasheets(item) {
		const container = document.getElementById('datasheets-list');
		if (!container) return;
		
		container.innerHTML = '';
		
		if (!item.datasheets || item.datasheets.length === 0) {
			container.innerHTML = '<p class="empty-text">Nenhum documento adicionado</p>';
			return;
		}
		
		item.datasheets.forEach(doc => {
			const docEl = document.createElement('div');
			docEl.className = 'datasheet-item';
			
			const icon = getFileIcon(doc.name);
			
			docEl.innerHTML = `
				<div class="datasheet-icon">${icon}</div>
				<div class="datasheet-content">
					<div class="datasheet-name">${escapeHtml(doc.name)}</div>
					<div class="datasheet-meta">${formatFileSize(doc.size)}</div>
				</div>
				<button class="datasheet-delete" title="Excluir">🗑️</button>
			`;
			
			docEl.querySelector('.datasheet-delete').addEventListener('click', () => {
				removeDatasheet(item, doc.id);
			});
			
			container.appendChild(docEl);
		});
	}
	
	function handleDatasheetUpload(e) {
		if (!currentItemId) return;
		
		const item = items.find(i => i.id === currentItemId);
		if (!item) return;
		
		const files = Array.from(e.target.files);
		
		files.forEach(file => {
			// Em produção, fazer upload real. Por enquanto, só metadata
			const doc = {
				id: uid(),
				name: file.name,
				size: file.size,
				type: file.type,
				uploadedAt: Date.now()
			};
			
			if (!item.datasheets) item.datasheets = [];
			item.datasheets.push(doc);
		});
		
		saveItems();
		renderDatasheets(item);
		e.target.value = '';
	}
	
	function removeDatasheet(item, docId) {
		item.datasheets = item.datasheets.filter(d => d.id !== docId);
		saveItems();
		renderDatasheets(item);
	}
	
	// ========== HISTÓRICO DE USO ==========
	
	function renderUsageHistory(item) {
		const container = document.getElementById('usage-history');
		if (!container) return;
		
		container.innerHTML = '';
		
		if (!item.usageHistory || item.usageHistory.length === 0) {
			container.innerHTML = '<p class="empty-text">Nenhum uso registrado</p>';
			return;
		}
		
		// Mostrar últimos 5
		const recent = item.usageHistory.slice(0, 5);
		
		recent.forEach(usage => {
			const usageEl = document.createElement('div');
			usageEl.className = 'usage-item';
			
			const actionIcon = usage.action === 'add' ? '➕' : '➖';
			const actionColor = usage.action === 'add' ? '#10B981' : '#EF4444';
			
			usageEl.innerHTML = `
				<div class="usage-icon" style="color: ${actionColor}">${actionIcon}</div>
				<div class="usage-content">
					<div class="usage-quantity">${usage.quantity} ${item.unit || 'un'}</div>
					<div class="usage-note">${escapeHtml(usage.note)}</div>
					<div class="usage-date">${formatDate(new Date(usage.date))}</div>
				</div>
			`;
			
			container.appendChild(usageEl);
		});
	}
	
	// ========== PROJETOS VINCULADOS ==========
	
	function renderLinkedProjects(item) {
		const container = document.getElementById('linked-projects');
		if (!container) return;
		
		container.innerHTML = '';
		
		if (!item.linkedProjects || item.linkedProjects.length === 0) {
			container.innerHTML = '<p class="empty-text">Nenhum projeto vinculado</p>';
			return;
		}
		
		item.linkedProjects.forEach(project => {
			const projectEl = document.createElement('div');
			projectEl.className = 'linked-project-item';
			
			projectEl.innerHTML = `
				<div class="project-link-name">${escapeHtml(project.name)}</div>
				<div class="project-link-quantity">${project.quantity} ${item.unit || 'un'}</div>
			`;
			
			container.appendChild(projectEl);
		});
	}
	
	// ========== FILTROS ==========
	
	function handleSearch(e) {
		filters.search = e.target.value.toLowerCase().trim();
		renderItems();
	}
	
	function handleFilterChange() {
		filters.category = filterCategory.value;
		renderItems();
	}
	
	function toggleLowStockFilter() {
		filters.showLowStock = !filters.showLowStock;
		btnLowStock.classList.toggle('active', filters.showLowStock);
		renderItems();
	}
	
	function toggleView() {
		viewMode = viewMode === 'grid' ? 'list' : 'grid';
		inventoryGrid.classList.toggle('list-mode', viewMode === 'list');
		renderItems();
	}
	
	// ========== UTILITÁRIOS ==========
	
	function getFileIcon(filename) {
		const ext = filename.split('.').pop().toLowerCase();
		if (ext === 'pdf') return '📄';
		if (['doc', 'docx'].includes(ext)) return '📝';
		if (['xls', 'xlsx'].includes(ext)) return '📊';
		if (ext === 'txt') return '📃';
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
	
	function saveItems() {
		try {
			localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
		} catch (e) {
			console.error('Erro ao salvar inventário:', e);
		}
	}
	
	function loadItems() {
		try {
			const raw = localStorage.getItem(STORAGE_KEY);
			if (raw) {
				items = JSON.parse(raw);
				if (!Array.isArray(items)) {
					items = [];
				}
			}
		} catch (e) {
			console.error('Erro ao carregar inventário:', e);
			items = [];
		}
	}
	
	// Iniciar
	init();
})();

