const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;

let store = null;
let projects = [];
let currentProject = null;
let selectedCell = null;
let floorplanImage = null;
let scalePoint1 = null;
let scalePoint2 = null;
let draggingPoint = null;
let gridOffset = { x: 0, y: 0 };
let dragStart = null;
let speedTestRuns = 1;
let heatmapType = 'download';

const debugLogs = [];

function log(msg) {
    const time = new Date().toLocaleTimeString();
    debugLogs.push(`[${time}] ${msg}`);
    console.log(msg);
    updateDebugPanel();
}

function updateDebugPanel() {
    const content = document.getElementById('debug-content');
    if (content) {
        content.innerHTML = debugLogs.map(l => `<div class="log-line">${l}</div>`).join('');
        content.scrollTop = content.scrollHeight;
    }
}

function showToast(message) {
    const existing = document.getElementById('toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.id = 'toast';
    toast.textContent = message;
    toast.style.cssText = 'position:fixed;bottom:100px;left:50%;transform:translateX(-50%);background:var(--accent);color:white;padding:12px 24px;border-radius:8px;font-size:14px;z-index:300;';
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 2000);
}

document.addEventListener('DOMContentLoaded', async () => {
    log('App starting...');

    try {
        const { Store } = window.__TAURI_PLUGIN_STORE__;
        store = await Store.load('speedmap.json');

        await loadProjects();
        await loadSettings();
        setupEventListeners();
        setupSpeedtestListeners();
        setupSettingsListeners();
        log('Ready');
    } catch (e) {
        log('ERROR: ' + e.message);
    }
});

async function loadProjects() {
    const saved = await store.get('projects');
    projects = saved || [];
    renderProjectList();
}

async function saveProjects() {
    await store.set('projects', projects);
    await store.save();
}

async function loadSettings() {
    const savedRuns = await store.get('speedTestRuns');
    speedTestRuns = savedRuns || 1;
    updateRunsUI();
}

async function saveSettings() {
    await store.set('speedTestRuns', speedTestRuns);
    await store.save();
}

async function saveProject() {
    currentProject.updated_at = new Date().toISOString();
    const idx = projects.findIndex(p => p.id === currentProject.id);
    if (idx >= 0) projects[idx] = currentProject;
    await saveProjects();
}

function updateRunsUI() {
    document.querySelectorAll('.runs-btn').forEach(btn => {
        btn.classList.toggle('active', parseInt(btn.dataset.runs) === speedTestRuns);
    });
}

function setupSettingsListeners() {
    document.getElementById('settings-btn').addEventListener('click', () => {
        document.getElementById('settings-modal').classList.add('active');
        updateDebugPanel();
    });

    document.getElementById('close-settings').addEventListener('click', () => {
        document.getElementById('settings-modal').classList.remove('active');
    });

    document.querySelectorAll('.runs-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            speedTestRuns = parseInt(btn.dataset.runs);
            updateRunsUI();
            await saveSettings();
        });
    });

    document.querySelectorAll('.toggle-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.toggle-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            heatmapType = btn.dataset.type;
            drawHeatmapCanvas();
        });
    });

    document.getElementById('copy-logs').addEventListener('click', () => {
        navigator.clipboard.writeText(debugLogs.join('\n')).then(() => showToast('Logs copied'));
    });
}

function renderProjectList() {
    const list = document.getElementById('project-list');
    const form = document.getElementById('new-project-form');
    const newBtn = document.getElementById('new-project-btn');

    if (projects.length === 0) {
        list.innerHTML = '<p style="text-align:center;color:var(--text-secondary);padding:40px 0;">Create your first speedmap project</p>';
        form.style.display = 'flex';
        form.style.flexDirection = 'column';
        form.style.gap = '10px';
        newBtn.style.display = 'none';
    } else {
        list.innerHTML = projects.map(p => `
            <div class="project-item" data-id="${p.id}">
                <div class="project-info">
                    <h3>${p.name}</h3>
                    <p>${p.measurements.length} measurements · ${new Date(p.updated_at).toLocaleDateString()}</p>
                </div>
                <span class="project-arrow">›</span>
            </div>
        `).join('');
        form.style.display = 'none';
        newBtn.style.display = 'block';
        setupProjectListeners();
    }
}

function setupProjectListeners() {
    document.querySelectorAll('.project-item').forEach(item => {
        let longPressTimer = null;
        let didLongPress = false;

        item.addEventListener('touchstart', () => {
            didLongPress = false;
            longPressTimer = setTimeout(() => {
                didLongPress = true;
                item.classList.add('long-press');
                const project = projects.find(p => p.id === item.dataset.id);
                showDeleteDialog(project);
            }, 500);
        });

        item.addEventListener('touchend', () => {
            clearTimeout(longPressTimer);
            item.classList.remove('long-press');
            if (!didLongPress) {
                const project = projects.find(p => p.id === item.dataset.id);
                if (project) loadProject(project);
            }
        });

        item.addEventListener('touchmove', () => {
            clearTimeout(longPressTimer);
            item.classList.remove('long-press');
        });
    });
}

function showDeleteDialog(project) {
    if (!project) return;

    const dialog = document.createElement('div');
    dialog.className = 'action-sheet';
    dialog.innerHTML = `
        <div class="action-sheet-content">
            <div class="action-sheet-title">${project.name}</div>
            <button class="action-sheet-btn danger" id="delete-project-btn">
                <span class="material-symbols-outlined">delete</span>
                Delete Project
            </button>
            <button class="action-sheet-btn cancel" id="cancel-delete-btn">Cancel</button>
        </div>
    `;
    document.body.appendChild(dialog);
    requestAnimationFrame(() => dialog.classList.add('open'));

    document.getElementById('delete-project-btn').addEventListener('click', async () => {
        projects = projects.filter(p => p.id !== project.id);
        await saveProjects();
        dialog.classList.remove('open');
        setTimeout(() => dialog.remove(), 200);
        renderProjectList();
        showToast('Project deleted');
    });

    document.getElementById('cancel-delete-btn').addEventListener('click', () => {
        dialog.classList.remove('open');
        setTimeout(() => dialog.remove(), 200);
    });

    dialog.addEventListener('click', (e) => {
        if (e.target === dialog) {
            dialog.classList.remove('open');
            setTimeout(() => dialog.remove(), 200);
        }
    });
}

function setupEventListeners() {
    document.getElementById('create-btn').addEventListener('click', createProject);
    document.getElementById('project-name').addEventListener('keypress', e => {
        if (e.key === 'Enter') createProject();
    });

    document.getElementById('new-project-btn').addEventListener('click', () => {
        document.getElementById('new-project-form').style.display = 'flex';
        document.getElementById('new-project-form').style.flexDirection = 'column';
        document.getElementById('new-project-form').style.gap = '10px';
        document.getElementById('new-project-btn').style.display = 'none';
    });

    document.querySelectorAll('.back-btn, .icon-btn[data-target]').forEach(btn => {
        btn.addEventListener('click', () => showScreen(btn.dataset.target));
    });

    document.getElementById('select-image-btn').addEventListener('click', () => {
        document.getElementById('floorplan-input').click();
    });
    document.getElementById('floorplan-input').addEventListener('change', handleFloorplanSelect);
    document.getElementById('floorplan-continue-btn').addEventListener('click', () => showScreen('scale'));

    document.getElementById('set-scale-btn').addEventListener('click', setScale);
    document.getElementById('scale-continue-btn').addEventListener('click', () => showScreen('grid'));

    document.querySelectorAll('.cell-size-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.cell-size-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentProject.grid_cell_size = parseFloat(btn.dataset.size);
            recalculateGrid();
            drawGridCanvas();
        });
    });

    document.getElementById('grid-continue-btn').addEventListener('click', () => {
        saveProject();
        showScreen('measure');
    });

    document.getElementById('scan-btn').addEventListener('click', openSpeedtest);
    document.getElementById('create-heatmap-btn').addEventListener('click', () => showScreen('heatmap'));
    document.getElementById('save-heatmap-btn').addEventListener('click', saveHeatmapAsImage);

    document.getElementById('clear-btn')?.addEventListener('click', clearMeasurements);

    document.getElementById('close-speedtest').addEventListener('click', closeSpeedtest);
    document.getElementById('start-test-btn').addEventListener('click', startSpeedtest);
    document.getElementById('done-btn').addEventListener('click', finishSpeedtest);
}

async function createProject() {
    const nameInput = document.getElementById('project-name');
    const name = nameInput.value.trim();
    if (!name) return;

    const id = await invoke('generate_uuid');
    const now = new Date().toISOString();

    currentProject = {
        id, name,
        created_at: now,
        updated_at: now,
        floorplan_data: null,
        image_width: 0,
        image_height: 0,
        scale_point1_x: 0, scale_point1_y: 0,
        scale_point2_x: 0, scale_point2_y: 0,
        wall_length_meters: 1.0,
        meters_per_pixel: 0.01,
        scale_set: false,
        grid_offset_x: 0, grid_offset_y: 0,
        grid_cell_size: 1.0,
        grid_cols: 10, grid_rows: 10,
        measurements: []
    };

    projects.unshift(currentProject);
    await saveProjects();
    nameInput.value = '';
    showScreen('floorplan');
}

function loadProject(project) {
    currentProject = project;

    if (project.floorplan_data) {
        floorplanImage = new Image();
        floorplanImage.onload = () => {
            showScreen('measure');
            setTimeout(() => drawMeasureCanvas(), 100);
        };
        floorplanImage.src = project.floorplan_data;
    } else {
        showScreen('floorplan');
    }
}

function showScreen(screenId) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(screenId + '-screen').classList.add('active');

    if (screenId === 'start') {
        renderProjectList();
    } else if (screenId === 'scale' && floorplanImage) {
        setTimeout(() => { initScaleCanvas(); drawScaleCanvas(); }, 100);
    } else if (screenId === 'grid' && floorplanImage) {
        setTimeout(() => { initGridCanvas(); drawGridCanvas(); }, 200);
    } else if (screenId === 'measure' && floorplanImage) {
        setTimeout(() => { initMeasureCanvas(); drawMeasureCanvas(); }, 200);
    } else if (screenId === 'heatmap' && floorplanImage) {
        setTimeout(() => {
            initHeatmapCanvas();
            document.getElementById('heatmap-loading')?.remove();
            const loading = document.createElement('div');
            loading.id = 'heatmap-loading';
            loading.style.cssText = 'position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);background:rgba(0,0,0,0.7);color:white;padding:15px 25px;border-radius:8px;';
            loading.textContent = 'Generating heatmap...';
            document.getElementById('heatmap-canvas-container').appendChild(loading);
            requestAnimationFrame(() => { drawHeatmapCanvas(); loading.remove(); });
        }, 100);
    }
}

function handleFloorplanSelect(e) {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
        floorplanImage = new Image();
        floorplanImage.onload = () => {
            currentProject.floorplan_data = event.target.result;
            currentProject.image_width = floorplanImage.width;
            currentProject.image_height = floorplanImage.height;

            scalePoint1 = { x: floorplanImage.width * 0.2, y: floorplanImage.height * 0.5 };
            scalePoint2 = { x: floorplanImage.width * 0.8, y: floorplanImage.height * 0.5 };
            currentProject.scale_point1_x = scalePoint1.x;
            currentProject.scale_point1_y = scalePoint1.y;
            currentProject.scale_point2_x = scalePoint2.x;
            currentProject.scale_point2_y = scalePoint2.y;

            document.getElementById('floorplan-preview').innerHTML = `<img src="${event.target.result}">`;
            document.getElementById('floorplan-continue-btn').disabled = false;
            saveProject();
        };
        floorplanImage.src = event.target.result;
    };
    reader.readAsDataURL(file);
}

function getScaleTransform() {
    let container = document.getElementById('scale-canvas-container');
    if (!container || container.clientWidth === 0) container = document.getElementById('grid-canvas-container');
    if (!container || container.clientWidth === 0) container = document.getElementById('measure-canvas-container');
    if (!container || container.clientWidth === 0) container = document.getElementById('heatmap-canvas-container');

    const imgWidth = currentProject.image_width || 1;
    const imgHeight = currentProject.image_height || 1;
    const containerWidth = container?.clientWidth || 300;
    const containerHeight = container?.clientHeight || 400;

    const scale = Math.min(containerWidth / imgWidth, containerHeight / imgHeight) * 0.9;
    const offsetX = (containerWidth - imgWidth * scale) / 2;
    const offsetY = (containerHeight - imgHeight * scale) / 2;
    return { scale, offsetX, offsetY };
}

let scaleCanvas, scaleCtx;

function initScaleCanvas() {
    scaleCanvas = document.getElementById('scale-canvas');
    scaleCtx = scaleCanvas.getContext('2d');

    const container = document.getElementById('scale-canvas-container');
    scaleCanvas.width = container.clientWidth * window.devicePixelRatio;
    scaleCanvas.height = container.clientHeight * window.devicePixelRatio;
    scaleCtx.scale(window.devicePixelRatio, window.devicePixelRatio);

    scalePoint1 = { x: currentProject.scale_point1_x, y: currentProject.scale_point1_y };
    scalePoint2 = { x: currentProject.scale_point2_x, y: currentProject.scale_point2_y };

    scaleCanvas.addEventListener('pointerdown', scalePointerDown);
    scaleCanvas.addEventListener('pointermove', scalePointerMove);
    scaleCanvas.addEventListener('pointerup', scalePointerUp);
}

function drawScaleCanvas() {
    if (!scaleCtx || !floorplanImage) return;

    const container = document.getElementById('scale-canvas-container');
    scaleCtx.clearRect(0, 0, container.clientWidth, container.clientHeight);

    const { scale, offsetX, offsetY } = getScaleTransform();
    scaleCtx.drawImage(floorplanImage, offsetX, offsetY, currentProject.image_width * scale, currentProject.image_height * scale);

    const p1 = { x: offsetX + scalePoint1.x * scale, y: offsetY + scalePoint1.y * scale };
    const p2 = { x: offsetX + scalePoint2.x * scale, y: offsetY + scalePoint2.y * scale };

    scaleCtx.beginPath();
    scaleCtx.moveTo(p1.x, p1.y);
    scaleCtx.lineTo(p2.x, p2.y);
    scaleCtx.strokeStyle = '#4a69bd';
    scaleCtx.lineWidth = 3;
    scaleCtx.stroke();

    [{ p: p1, color: '#4a69bd' }, { p: p2, color: '#e74c3c' }].forEach(({ p, color }) => {
        scaleCtx.beginPath();
        scaleCtx.arc(p.x, p.y, 15, 0, Math.PI * 2);
        scaleCtx.fillStyle = color + '99';
        scaleCtx.fill();
        scaleCtx.strokeStyle = 'white';
        scaleCtx.lineWidth = 2;
        scaleCtx.stroke();
    });
}

function scalePointerDown(e) {
    const rect = scaleCanvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const { scale, offsetX, offsetY } = getScaleTransform();

    const p1 = { x: offsetX + scalePoint1.x * scale, y: offsetY + scalePoint1.y * scale };
    const p2 = { x: offsetX + scalePoint2.x * scale, y: offsetY + scalePoint2.y * scale };

    if (Math.hypot(x - p1.x, y - p1.y) < 25) draggingPoint = 1;
    else if (Math.hypot(x - p2.x, y - p2.y) < 25) draggingPoint = 2;
}

function scalePointerMove(e) {
    if (!draggingPoint) return;

    const rect = scaleCanvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const { scale, offsetX, offsetY } = getScaleTransform();

    const imgX = Math.max(0, Math.min(currentProject.image_width, (x - offsetX) / scale));
    const imgY = Math.max(0, Math.min(currentProject.image_height, (y - offsetY) / scale));

    if (draggingPoint === 1) scalePoint1 = { x: imgX, y: imgY };
    else scalePoint2 = { x: imgX, y: imgY };

    drawScaleCanvas();
}

function scalePointerUp() {
    if (draggingPoint) {
        currentProject.scale_point1_x = scalePoint1.x;
        currentProject.scale_point1_y = scalePoint1.y;
        currentProject.scale_point2_x = scalePoint2.x;
        currentProject.scale_point2_y = scalePoint2.y;
    }
    draggingPoint = null;
}

function setScale() {
    const length = parseFloat(document.getElementById('wall-length').value);
    if (!length || length <= 0) return;

    currentProject.wall_length_meters = length;

    const dx = scalePoint2.x - scalePoint1.x;
    const dy = scalePoint2.y - scalePoint1.y;
    const pixelDistance = Math.sqrt(dx * dx + dy * dy);
    if (pixelDistance < 10) return;

    currentProject.meters_per_pixel = length / pixelDistance;
    currentProject.scale_set = true;

    recalculateGrid();
    document.getElementById('scale-continue-btn').disabled = false;
    saveProject();
}

function recalculateGrid() {
    const cellPixels = currentProject.grid_cell_size / currentProject.meters_per_pixel;
    currentProject.grid_cols = Math.ceil(currentProject.image_width / cellPixels);
    currentProject.grid_rows = Math.ceil(currentProject.image_height / cellPixels);
}

let gridCanvas, gridCtx;

function initGridCanvas() {
    gridCanvas = document.getElementById('grid-canvas');
    gridCtx = gridCanvas.getContext('2d');

    const container = document.getElementById('grid-canvas-container');
    gridCanvas.width = container.clientWidth * window.devicePixelRatio;
    gridCanvas.height = container.clientHeight * window.devicePixelRatio;
    gridCtx.scale(window.devicePixelRatio, window.devicePixelRatio);

    gridOffset = { x: currentProject.grid_offset_x, y: currentProject.grid_offset_y };

    gridCanvas.addEventListener('pointerdown', gridPointerDown);
    gridCanvas.addEventListener('pointermove', gridPointerMove);
    gridCanvas.addEventListener('pointerup', gridPointerUp);
}

function drawGridCanvas() {
    if (!gridCtx || !floorplanImage) return;

    const container = document.getElementById('grid-canvas-container');
    gridCtx.clearRect(0, 0, container.clientWidth, container.clientHeight);

    const { scale, offsetX, offsetY } = getScaleTransform();
    gridCtx.drawImage(floorplanImage, offsetX, offsetY, currentProject.image_width * scale, currentProject.image_height * scale);

    const cellPixels = (currentProject.grid_cell_size / currentProject.meters_per_pixel) * scale;
    const gridX = offsetX + gridOffset.x * scale;
    const gridY = offsetY + gridOffset.y * scale;

    gridCtx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
    gridCtx.lineWidth = 1;

    for (let row = 0; row <= currentProject.grid_rows; row++) {
        gridCtx.beginPath();
        gridCtx.moveTo(gridX, gridY + row * cellPixels);
        gridCtx.lineTo(gridX + currentProject.grid_cols * cellPixels, gridY + row * cellPixels);
        gridCtx.stroke();
    }

    for (let col = 0; col <= currentProject.grid_cols; col++) {
        gridCtx.beginPath();
        gridCtx.moveTo(gridX + col * cellPixels, gridY);
        gridCtx.lineTo(gridX + col * cellPixels, gridY + currentProject.grid_rows * cellPixels);
        gridCtx.stroke();
    }
}

function gridPointerDown(e) {
    dragStart = { x: e.clientX, y: e.clientY, offsetX: gridOffset.x, offsetY: gridOffset.y };
}

function gridPointerMove(e) {
    if (!dragStart) return;
    const { scale } = getScaleTransform();
    gridOffset.x = dragStart.offsetX + (e.clientX - dragStart.x) / scale;
    gridOffset.y = dragStart.offsetY + (e.clientY - dragStart.y) / scale;
    drawGridCanvas();
}

function gridPointerUp() {
    if (dragStart) {
        currentProject.grid_offset_x = gridOffset.x;
        currentProject.grid_offset_y = gridOffset.y;
    }
    dragStart = null;
}

let measureCanvas, measureCtx;

function initMeasureCanvas() {
    measureCanvas = document.getElementById('measure-canvas');
    measureCtx = measureCanvas.getContext('2d');

    const container = document.getElementById('measure-canvas-container');
    measureCanvas.width = container.clientWidth * window.devicePixelRatio;
    measureCanvas.height = container.clientHeight * window.devicePixelRatio;
    measureCtx.scale(window.devicePixelRatio, window.devicePixelRatio);

    gridOffset = { x: currentProject.grid_offset_x, y: currentProject.grid_offset_y };

    measureCanvas.addEventListener('click', measureClick);
    updateMeasureUI();
}

function drawMeasureCanvas() {
    if (!measureCtx || !floorplanImage) return;

    const container = document.getElementById('measure-canvas-container');
    measureCtx.clearRect(0, 0, container.clientWidth, container.clientHeight);

    const { scale, offsetX, offsetY } = getScaleTransform();
    measureCtx.drawImage(floorplanImage, offsetX, offsetY, currentProject.image_width * scale, currentProject.image_height * scale);

    const cellPixels = (currentProject.grid_cell_size / currentProject.meters_per_pixel) * scale;
    const gridX = offsetX + gridOffset.x * scale;
    const gridY = offsetY + gridOffset.y * scale;

    currentProject.measurements.forEach(m => {
        const cx = gridX + (m.grid_x + 0.5) * cellPixels;
        const cy = gridY + (m.grid_y + 0.5) * cellPixels;
        measureCtx.fillStyle = getSpeedColor(m.download) + '99';
        measureCtx.fillRect(cx - cellPixels/2, cy - cellPixels/2, cellPixels, cellPixels);
    });

    if (selectedCell) {
        const cx = gridX + (selectedCell.col + 0.5) * cellPixels;
        const cy = gridY + (selectedCell.row + 0.5) * cellPixels;
        measureCtx.strokeStyle = '#4a69bd';
        measureCtx.lineWidth = 3;
        measureCtx.strokeRect(cx - cellPixels/2, cy - cellPixels/2, cellPixels, cellPixels);
        measureCtx.fillStyle = '#4a69bd4d';
        measureCtx.fillRect(cx - cellPixels/2, cy - cellPixels/2, cellPixels, cellPixels);
    }

    measureCtx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
    measureCtx.lineWidth = 1;

    for (let row = 0; row < currentProject.grid_rows; row++) {
        for (let col = 0; col < currentProject.grid_cols; col++) {
            const cx = gridX + (col + 0.5) * cellPixels;
            const cy = gridY + (row + 0.5) * cellPixels;
            measureCtx.strokeRect(cx - cellPixels/2, cy - cellPixels/2, cellPixels, cellPixels);
        }
    }
}

function measureClick(e) {
    const rect = measureCanvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const { scale, offsetX, offsetY } = getScaleTransform();

    const cellPixels = (currentProject.grid_cell_size / currentProject.meters_per_pixel) * scale;
    const gridX = offsetX + gridOffset.x * scale;
    const gridY = offsetY + gridOffset.y * scale;

    const col = Math.floor((x - gridX) / cellPixels);
    const row = Math.floor((y - gridY) / cellPixels);

    if (col >= 0 && col < currentProject.grid_cols && row >= 0 && row < currentProject.grid_rows) {
        if (selectedCell && selectedCell.col === col && selectedCell.row === row) {
            selectedCell = null;
            document.getElementById('download-value').textContent = '-';
            document.getElementById('upload-value').textContent = '-';
        } else {
            selectedCell = { col, row };
            const existing = currentProject.measurements.find(m => m.grid_x === col && m.grid_y === row);
            if (existing) {
                document.getElementById('download-value').textContent = Math.round(existing.download);
                document.getElementById('upload-value').textContent = Math.round(existing.upload);
            } else {
                document.getElementById('download-value').textContent = '-';
                document.getElementById('upload-value').textContent = '-';
            }
        }
        updateMeasureUI();
        drawMeasureCanvas();
    }
}

function updateMeasureUI() {
    const scanBtn = document.getElementById('scan-btn');
    const heatmapBtn = document.getElementById('create-heatmap-btn');

    scanBtn.disabled = !selectedCell;
    if (selectedCell) {
        const existing = currentProject.measurements.find(m => m.grid_x === selectedCell.col && m.grid_y === selectedCell.row);
        scanBtn.textContent = existing ? 'View' : 'Scan';
    }

    heatmapBtn.disabled = currentProject.measurements.length < 2;
}

async function clearMeasurements() {
    if (!currentProject) return;

    currentProject.measurements = [];
    selectedCell = null;
    document.getElementById('download-value').textContent = '-';
    document.getElementById('upload-value').textContent = '-';
    updateMeasureUI();
    drawMeasureCanvas();
    await saveProject();
    showToast('Measurements cleared');
}

// red->yellow->green gradient
function getSpeedColor(speed, minSpeed, maxSpeed) {
    if (minSpeed === undefined || maxSpeed === undefined) {
        if (speed > 50) return '#4cd137';
        if (speed > 20) return '#fbc531';
        return '#e74c3c';
    }

    const range = maxSpeed - minSpeed;
    if (range < 1) return '#4cd137';

    const normalized = Math.max(0, Math.min(1, (speed - minSpeed) / range));

    let r, g, b;
    if (normalized < 0.5) {
        const t = normalized * 2;
        r = 231;
        g = Math.round(76 + (188 - 76) * t);
        b = Math.round(60 + (49 - 60) * t);
    } else {
        const t = (normalized - 0.5) * 2;
        r = Math.round(251 + (76 - 251) * t);
        g = Math.round(197 + (209 - 197) * t);
        b = Math.round(49 + (55 - 49) * t);
    }

    return `rgb(${r}, ${g}, ${b})`;
}

// IDW interpolation
function interpolateSpeed(measurements, x, y, power = 2, isDownload = true) {
    if (measurements.length === 0) return 0;

    for (const m of measurements) {
        const dist = Math.hypot(x - m.grid_x, y - m.grid_y);
        if (dist < 0.01) return isDownload ? m.download : m.upload;
    }

    let weightedSum = 0;
    let totalWeight = 0;

    for (const m of measurements) {
        const distance = Math.hypot(x - m.grid_x, y - m.grid_y);
        const value = isDownload ? m.download : m.upload;
        const weight = 1 / Math.pow(distance, power);
        weightedSum += weight * value;
        totalWeight += weight;
    }

    return totalWeight > 0 ? weightedSum / totalWeight : 0;
}

let heatmapCanvas, heatmapCtx;

function initHeatmapCanvas() {
    heatmapCanvas = document.getElementById('heatmap-canvas');
    heatmapCtx = heatmapCanvas.getContext('2d');

    const container = document.getElementById('heatmap-canvas-container');
    heatmapCanvas.width = container.clientWidth * window.devicePixelRatio;
    heatmapCanvas.height = container.clientHeight * window.devicePixelRatio;
    heatmapCtx.scale(window.devicePixelRatio, window.devicePixelRatio);
}

function drawHeatmapCanvas() {
    if (!heatmapCtx || !floorplanImage) return;

    const container = document.getElementById('heatmap-canvas-container');
    heatmapCtx.clearRect(0, 0, container.clientWidth, container.clientHeight);

    const { scale, offsetX, offsetY } = getScaleTransform();
    heatmapCtx.drawImage(floorplanImage, offsetX, offsetY, currentProject.image_width * scale, currentProject.image_height * scale);

    const cellPixels = (currentProject.grid_cell_size / currentProject.meters_per_pixel) * scale;
    const gridX = offsetX + gridOffset.x * scale;
    const gridY = offsetY + gridOffset.y * scale;

    const measurements = currentProject.measurements;
    if (measurements.length === 0) return;

    const isDownload = heatmapType === 'download';
    const speeds = measurements.map(m => isDownload ? m.download : m.upload);
    const minSpeed = Math.min(...speeds);
    const maxSpeed = Math.max(...speeds);

    const subDivisions = 10;
    const subCellPixels = cellPixels / subDivisions;

    const heatmapData = [];
    for (let row = 0; row < currentProject.grid_rows * subDivisions; row++) {
        for (let col = 0; col < currentProject.grid_cols * subDivisions; col++) {
            const gridCol = (col + 0.5) / subDivisions;
            const gridRow = (row + 0.5) / subDivisions;
            const speed = interpolateSpeed(measurements, gridCol, gridRow, 2, isDownload);
            heatmapData.push({ col, row, speed });
        }
    }

    heatmapData.forEach(({ col, row, speed }) => {
        const x = gridX + col * subCellPixels;
        const y = gridY + row * subCellPixels;
        heatmapCtx.fillStyle = getSpeedColor(speed, minSpeed, maxSpeed);
        heatmapCtx.globalAlpha = 0.65;
        heatmapCtx.fillRect(x, y, subCellPixels + 0.5, subCellPixels + 0.5);
    });

    heatmapCtx.globalAlpha = 1.0;

    measurements.forEach(m => {
        const cx = gridX + (m.grid_x + 0.5) * cellPixels;
        const cy = gridY + (m.grid_y + 0.5) * cellPixels;
        const value = isDownload ? m.download : m.upload;

        heatmapCtx.beginPath();
        heatmapCtx.arc(cx, cy, Math.min(cellPixels * 0.3, 20), 0, Math.PI * 2);
        heatmapCtx.fillStyle = 'white';
        heatmapCtx.fill();
        heatmapCtx.strokeStyle = 'rgba(0,0,0,0.3)';
        heatmapCtx.lineWidth = 1;
        heatmapCtx.stroke();

        heatmapCtx.fillStyle = '#333';
        heatmapCtx.font = `bold ${Math.min(cellPixels * 0.25, 12)}px -apple-system, sans-serif`;
        heatmapCtx.textAlign = 'center';
        heatmapCtx.textBaseline = 'middle';
        heatmapCtx.fillText(Math.round(value), cx, cy);
    });

    updateHeatmapLegend(minSpeed, maxSpeed);
}

function updateHeatmapLegend(minSpeed, maxSpeed) {
    const midSpeed = (minSpeed + maxSpeed) / 2;

    document.getElementById('legend-fast').style.background = getSpeedColor(maxSpeed, minSpeed, maxSpeed);
    document.getElementById('legend-medium').style.background = getSpeedColor(midSpeed, minSpeed, maxSpeed);
    document.getElementById('legend-slow').style.background = getSpeedColor(minSpeed, minSpeed, maxSpeed);

    document.getElementById('legend-fast-text').textContent = `${Math.round(maxSpeed)} Mbps`;
    document.getElementById('legend-medium-text').textContent = `${Math.round(midSpeed)} Mbps`;
    document.getElementById('legend-slow-text').textContent = `${Math.round(minSpeed)} Mbps`;
}

async function saveHeatmapAsImage() {
    const canvas = document.getElementById('heatmap-canvas');
    const dataUrl = canvas.toDataURL('image/png');

    try {
        await invoke('save_image_to_photos', { imageBase64: dataUrl.split(',')[1] });
        showToast('Saved to Photos');
    } catch (e) {
        const link = document.createElement('a');
        link.download = `speedmap-${currentProject.name}-${heatmapType}.png`;
        link.href = dataUrl;
        link.click();
        showToast('Downloaded');
    }
}

let speedtestRunning = false;
let speedtestCell = null;

function setupSpeedtestListeners() {
    listen('speedtest_progress', (event) => {
        const { phase, progress, current_speed, run } = event.payload;
        document.getElementById('phase-label').textContent = phase === 'download' ? 'Download' : 'Upload';
        document.getElementById('current-speed').textContent = Math.round(current_speed);
        document.getElementById('current-speed').style.color = phase === 'download' ? 'var(--green)' : 'var(--blue)';
        document.getElementById('progress-fill').style.width = (progress * 100) + '%';
        document.getElementById('progress-fill').style.background = phase === 'download' ? 'var(--green)' : 'var(--blue)';
        document.getElementById('run-indicator').textContent = `Run ${run + 1} of ${speedTestRuns}`;
    });

    listen('speedtest_run_complete', (event) => {
        const { download_mbps, upload_mbps } = event.payload;
        const results = document.getElementById('run-results');
        results.innerHTML += `<div class="run-result"><div class="dl">${Math.round(download_mbps)}</div><div class="ul">${Math.round(upload_mbps)}</div></div>`;
    });
}

function openSpeedtest() {
    if (!selectedCell) return;

    const existing = currentProject.measurements.find(m => m.grid_x === selectedCell.col && m.grid_y === selectedCell.row);

    if (existing) {
        showViewDialog(existing);
    } else {
        startNewSpeedtest();
    }
}

function showViewDialog(measurement) {
    const overlay = document.createElement('div');
    overlay.id = 'view-dialog';
    overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.7);z-index:200;display:flex;align-items:center;justify-content:center;padding:24px;';

    const box = document.createElement('div');
    box.style.cssText = 'background:var(--bg-secondary);border-radius:12px;padding:24px;width:100%;max-width:300px;';
    box.innerHTML = `
        <h3 style="text-align:center;margin-bottom:20px;font-size:18px;">Measurement</h3>
        <div style="display:flex;gap:12px;margin-bottom:20px;">
            <div style="flex:1;text-align:center;padding:15px;background:var(--bg-tertiary);border-radius:8px;">
                <div style="font-size:10px;color:var(--text-secondary);">DOWNLOAD</div>
                <div style="font-size:24px;font-weight:bold;color:var(--green);">${Math.round(measurement.download)}</div>
                <div style="font-size:10px;color:var(--text-secondary);">Mbps</div>
            </div>
            <div style="flex:1;text-align:center;padding:15px;background:var(--bg-tertiary);border-radius:8px;">
                <div style="font-size:10px;color:var(--text-secondary);">UPLOAD</div>
                <div style="font-size:24px;font-weight:bold;color:var(--blue);">${Math.round(measurement.upload)}</div>
                <div style="font-size:10px;color:var(--text-secondary);">Mbps</div>
            </div>
        </div>
        <div style="display:flex;gap:12px;">
            <button id="view-close" style="flex:1;padding:12px;background:var(--bg-tertiary);border:none;border-radius:8px;color:var(--text-secondary);font-size:16px;cursor:pointer;">Close</button>
            <button id="view-rescan" style="flex:1;padding:12px;background:var(--accent);border:none;border-radius:8px;color:white;font-size:16px;cursor:pointer;">Rescan</button>
        </div>
    `;
    overlay.appendChild(box);
    document.body.appendChild(overlay);

    document.getElementById('view-close').addEventListener('click', () => overlay.remove());
    document.getElementById('view-rescan').addEventListener('click', () => {
        overlay.remove();
        startNewSpeedtest();
    });
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) overlay.remove();
    });
}

function startNewSpeedtest() {
    speedtestCell = { ...selectedCell };
    document.getElementById('speedtest-modal').classList.add('active');
    document.getElementById('run-indicator').textContent = `Run 1 of ${speedTestRuns}`;
    document.getElementById('phase-label').textContent = 'Starting...';
    document.getElementById('current-speed').textContent = '-';
    document.getElementById('current-speed').style.color = 'var(--text-secondary)';
    document.getElementById('progress-fill').style.width = '0%';
    document.getElementById('run-results').innerHTML = '';
    document.getElementById('start-test-btn').style.display = 'none';
    document.getElementById('final-results').style.display = 'none';

    setTimeout(() => startSpeedtest(), 100);
}

function closeSpeedtest() {
    document.getElementById('speedtest-modal').classList.remove('active');
}

async function startSpeedtest() {
    speedtestRunning = true;
    document.getElementById('start-test-btn').style.display = 'none';

    try {
        const result = await invoke('run_speedtest', { runs: speedTestRuns });

        document.getElementById('final-download').textContent = Math.round(result.download_mbps);
        document.getElementById('final-upload').textContent = Math.round(result.upload_mbps);
        document.getElementById('final-results').style.display = 'flex';

        const id = await invoke('generate_uuid');
        currentProject.measurements = currentProject.measurements.filter(
            m => !(m.grid_x === speedtestCell.col && m.grid_y === speedtestCell.row)
        );
        currentProject.measurements.push({
            id,
            grid_x: speedtestCell.col,
            grid_y: speedtestCell.row,
            download: result.download_mbps,
            upload: result.upload_mbps
        });

        document.getElementById('download-value').textContent = Math.round(result.download_mbps);
        document.getElementById('upload-value').textContent = Math.round(result.upload_mbps);

        await saveProject();
    } catch (error) {
        console.error('Speedtest failed:', error);
        document.getElementById('start-test-btn').style.display = 'block';
    }

    speedtestRunning = false;
}

function finishSpeedtest() {
    closeSpeedtest();
    updateMeasureUI();
    drawMeasureCanvas();
}
