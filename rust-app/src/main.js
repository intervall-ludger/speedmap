const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;

// Tell CSS which platform we're on (used for iOS safe-area handling).
invoke('get_platform')
    .then((platform) => {
        document.documentElement.dataset.platform = platform;
    })
    .catch(() => {
        // Running in a plain browser during dev; keep defaults.
    });

// Prevent iOS double-tap zoom and scroll position jumps.
let lastTouchEnd = 0;
document.addEventListener('touchend', function (e) {
    const now = Date.now();
    if (now - lastTouchEnd <= 300) {
        e.preventDefault();
    }
    lastTouchEnd = now;
}, { passive: false });

window.addEventListener('scroll', () => {
    window.scrollTo(0, 0);
});

let keyboardActive = false;
function isTextInput(el) {
    if (!el) return false;
    const tag = el.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}
document.addEventListener('focusin', (e) => {
    if (isTextInput(e.target)) {
        keyboardActive = true;
        updateAppHeight();
    }
});
document.addEventListener('focusout', (e) => {
    if (isTextInput(e.target)) {
        keyboardActive = false;
        updateAppHeight();
    }
});

function updateAppHeight() {
    const vv = window.visualViewport;
    document.documentElement.style.setProperty('--app-height', `${window.innerHeight}px`);

    // When the keyboard opens, visualViewport shrinks; use the delta as bottom padding.
    let keyboardHeight = 0;
    if (vv) {
        const activeEl = document.activeElement;
        const inputFocused = isTextInput(activeEl) && !!activeEl?.offsetParent;
        keyboardActive = inputFocused;
        const potentialKeyboard = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
        // Filter out small safe-area deltas; only apply when an input is focused.
        keyboardHeight = inputFocused && potentialKeyboard > 120 ? potentialKeyboard : 0;
        document.documentElement.style.setProperty('--keyboard-height', `${keyboardHeight}px`);
    } else {
        document.documentElement.style.setProperty('--keyboard-height', '0px');
    }
}
window.addEventListener('resize', updateAppHeight);
if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', updateAppHeight);
    window.visualViewport.addEventListener('scroll', updateAppHeight);
}
updateAppHeight();

let store = null;
let projects = [];
let currentProject = null;
let selectedCell = null;
let floorplanImage = null;
let gridOffset = { x: 0, y: 0 };
let dragStart = null;
let speedTestRuns = 1;
let heatmapType = 'download';
let suggestedCell = null;

function getMinDistanceToMeasurement(col, row, measurements) {
    if (measurements.length === 0) return Infinity;
    let minDist = Infinity;
    for (const m of measurements) {
        const dist = Math.hypot(col - m.grid_x, row - m.grid_y);
        if (dist < minDist) minDist = dist;
    }
    return minDist;
}

function findSuggestedCell() {
    if (!currentProject) return null;
    const measurements = currentProject.measurements;

    let maxDist = -1;
    let suggested = null;

    for (let row = 0; row < currentProject.grid_rows; row++) {
        for (let col = 0; col < currentProject.grid_cols; col++) {
            const hasMeasurement = measurements.some(m => m.grid_x === col && m.grid_y === row);
            if (hasMeasurement) continue;

            const dist = measurements.length === 0
                ? Math.hypot(col - currentProject.grid_cols/2, row - currentProject.grid_rows/2)
                : getMinDistanceToMeasurement(col, row, measurements);

            if (dist > maxDist) {
                maxDist = dist;
                suggested = { col, row };
            }
        }
    }
    return suggested;
}

function getConfidence(col, row, measurements) {
    if (measurements.length === 0) return 0;
    const dist = getMinDistanceToMeasurement(col, row, measurements);
    return Math.max(0, Math.min(1, 1 - dist / 5));
}

function getConfidenceColor(confidence) {
    if (confidence > 0.7) return '#51cf66';
    if (confidence > 0.4) return '#fcc419';
    return '#ff6b6b';
}

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
        list.innerHTML = projects.map(p => {
            const date = new Date(p.updated_at).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit' });
            const thumb = p.floorplan_data
                ? `<img src="${p.floorplan_data}" class="project-thumb">`
                : '<div class="project-thumb-empty"><span class="material-symbols-outlined">image</span></div>';
            const count = p.measurements?.length || 0;
            return `
                <div class="project-item" data-id="${p.id}">
                    ${thumb}
                    <div class="project-content">
                        <h3>${p.name}</h3>
                        <p>${count} measurements</p>
                        <p class="date">${date}</p>
                    </div>
                    <button class="project-delete" data-id="${p.id}"><span class="material-symbols-outlined">delete</span></button>
                </div>
            `;
        }).join('');
        form.style.display = 'none';
        newBtn.style.display = 'block';
        setupProjectListeners();
    }
}

function setupProjectListeners() {
    document.querySelectorAll('.project-item').forEach(item => {
        let startY = 0;
        let moved = false;

        item.addEventListener('touchstart', (e) => {
            if (e.target.closest('.project-delete')) return;
            startY = e.touches[0].clientY;
            moved = false;
        });

        item.addEventListener('touchmove', (e) => {
            if (Math.abs(e.touches[0].clientY - startY) > 10) {
                moved = true;
            }
        });

        item.addEventListener('touchend', (e) => {
            if (e.target.closest('.project-delete')) return;
            if (!moved) {
                const project = projects.find(p => p.id === item.dataset.id);
                if (project) loadProject(project);
            }
        });
    });

    document.querySelectorAll('.project-delete').forEach(btn => {
        btn.addEventListener('touchend', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const project = projects.find(p => p.id === btn.dataset.id);
            log(`Delete tapped: ${project?.name}`);
            if (project) showDeleteDialog(project);
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
        log(`Deleting project: ${project.name}`);
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
    const createBtn = document.getElementById('create-btn');
    createBtn.addEventListener('click', createProject);
    createBtn.addEventListener('touchend', (e) => {
        e.preventDefault();
        createProject();
    });
    document.getElementById('project-name').addEventListener('keypress', e => {
        if (e.key === 'Enter') createProject();
    });

    const newProjectBtn = document.getElementById('new-project-btn');
    const showNewProjectForm = () => {
        const form = document.getElementById('new-project-form');
        const nameInput = document.getElementById('project-name');

        form.style.display = 'flex';
        form.style.flexDirection = 'column';
        form.style.gap = '10px';
        newProjectBtn.style.display = 'none';

        requestAnimationFrame(() => {
            nameInput.focus();
            updateAppHeight();
        });
    };
    newProjectBtn.addEventListener('click', showNewProjectForm);
    newProjectBtn.addEventListener('touchend', (e) => {
        e.preventDefault();
        showNewProjectForm();
    });

    document.querySelectorAll('.back-btn, .icon-btn[data-target]').forEach(btn => {
        btn.addEventListener('click', () => showScreen(btn.dataset.target));
    });

    document.getElementById('select-image-btn').addEventListener('click', () => {
        document.getElementById('floorplan-input').click();
    });
    document.getElementById('floorplan-input').addEventListener('change', handleFloorplanSelect);
    document.getElementById('floorplan-continue-btn').addEventListener('click', () => showScreen('grid'));

    document.querySelectorAll('.cell-size-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.cell-size-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            setGridDensity(btn.dataset.density);
        });
    });

    document.getElementById('grid-continue-btn').addEventListener('click', () => {
        saveProject();
        showScreen('measure');
    });

    document.getElementById('create-heatmap-btn').addEventListener('click', () => showScreen('heatmap'));
    document.getElementById('save-heatmap-btn').addEventListener('click', saveHeatmapAsImage);

    document.getElementById('clear-btn')?.addEventListener('click', clearMeasurements);

    document.getElementById('close-speedtest').addEventListener('click', closeSpeedtest);
    document.getElementById('start-test-btn').addEventListener('click', startSpeedtest);
    document.getElementById('done-btn').addEventListener('click', finishSpeedtest);

    document.getElementById('action-btn').addEventListener('click', actionBtnClick);
    document.getElementById('close-measurement').addEventListener('click', closeMeasurementModal);
    document.getElementById('rescan-btn').addEventListener('click', scanCell);
    document.getElementById('delete-btn').addEventListener('click', deleteMeasurement);
}

async function createProject() {
    const nameInput = document.getElementById('project-name');
    const name = nameInput.value.trim();
    if (!name) return;

    log(`Creating project: ${name}`);
    const id = await invoke('generate_uuid');
    const now = new Date().toISOString();

    currentProject = {
        id, name,
        created_at: now,
        updated_at: now,
        floorplan_data: null,
        image_width: 0,
        image_height: 0,
        grid_offset_x: 0, grid_offset_y: 0,
        grid_density: 'medium',
        grid_cols: 10, grid_rows: 10,
        measurements: []
    };

    projects.unshift(currentProject);
    await saveProjects();
    log(`Project created: ${id}`);
    nameInput.value = '';
    showScreen('floorplan');
}

function loadProject(project) {
    log(`Loading project: ${project.name} (${project.measurements?.length || 0} measurements)`);
    currentProject = project;

    if (project.floorplan_data) {
        floorplanImage = new Image();
        floorplanImage.onload = () => {
            log(`Floorplan loaded: ${project.image_width}x${project.image_height}`);
            showScreen('measure');
            setTimeout(() => drawMeasureCanvas(), 100);
        };
        floorplanImage.src = project.floorplan_data;
    } else {
        showScreen('floorplan');
    }
}

function showScreen(screenId) {
    log(`Screen: ${screenId}`);
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(screenId + '-screen').classList.add('active');

    if (screenId === 'start') {
        renderProjectList();
    } else if (screenId === 'grid' && floorplanImage) {
        setGridDensity(currentProject.grid_density || 'medium');
        setTimeout(() => { initGridCanvas(); drawGridCanvas(); }, 100);
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

function setGridDensity(density) {
    currentProject.grid_density = density;
    const targetCols = density === 'coarse' ? 6 : density === 'fine' ? 16 : 10;
    currentProject.grid_cols = targetCols;
    currentProject.grid_rows = Math.max(1, Math.round(targetCols * (currentProject.image_height / currentProject.image_width)));
    log(`Grid: ${density} (${currentProject.grid_cols}x${currentProject.grid_rows})`);
    drawGridCanvas();
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

    const cellPixels = (currentProject.image_width / currentProject.grid_cols) * scale;
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
let measureZoom = 1;
let measurePan = { x: 0, y: 0 };
let measureTouches = [];
let measureLastDist = 0;
let measureLastCenter = null;
let measureIsPanning = false;

function initMeasureCanvas() {
    measureCanvas = document.getElementById('measure-canvas');
    measureCtx = measureCanvas.getContext('2d');

    const container = document.getElementById('measure-canvas-container');
    measureCanvas.width = container.clientWidth * window.devicePixelRatio;
    measureCanvas.height = container.clientHeight * window.devicePixelRatio;
    measureCtx.scale(window.devicePixelRatio, window.devicePixelRatio);

    gridOffset = { x: currentProject.grid_offset_x, y: currentProject.grid_offset_y };
    measureZoom = 1;
    measurePan = { x: 0, y: 0 };

    measureCanvas.addEventListener('touchstart', measureTouchStart, { passive: false });
    measureCanvas.addEventListener('touchmove', measureTouchMove, { passive: false });
    measureCanvas.addEventListener('touchend', measureTouchEnd);
    measureCanvas.addEventListener('click', measureClick);
    updateMeasureUI();
    startMeasureAnimation();
}

function measureTouchStart(e) {
    measureTouches = Array.from(e.touches);
    if (measureTouches.length === 2) {
        e.preventDefault();
        measureLastDist = Math.hypot(
            measureTouches[0].clientX - measureTouches[1].clientX,
            measureTouches[0].clientY - measureTouches[1].clientY
        );
        measureLastCenter = {
            x: (measureTouches[0].clientX + measureTouches[1].clientX) / 2,
            y: (measureTouches[0].clientY + measureTouches[1].clientY) / 2
        };
    } else if (measureTouches.length === 1 && measureZoom > 1) {
        measureIsPanning = false;
        measureLastCenter = { x: measureTouches[0].clientX, y: measureTouches[0].clientY };
    }
}

function measureTouchMove(e) {
    const touches = Array.from(e.touches);

    if (touches.length === 2) {
        e.preventDefault();
        const dist = Math.hypot(
            touches[0].clientX - touches[1].clientX,
            touches[0].clientY - touches[1].clientY
        );
        const center = {
            x: (touches[0].clientX + touches[1].clientX) / 2,
            y: (touches[0].clientY + touches[1].clientY) / 2
        };

        if (measureLastDist > 0) {
            const scale = dist / measureLastDist;
            measureZoom = Math.max(1, Math.min(5, measureZoom * scale));
        }

        if (measureLastCenter && measureZoom > 1) {
            measurePan.x += center.x - measureLastCenter.x;
            measurePan.y += center.y - measureLastCenter.y;
        }

        measureLastDist = dist;
        measureLastCenter = center;
        clampMeasurePan();
        drawMeasureCanvas();
    } else if (touches.length === 1 && measureZoom > 1 && measureLastCenter) {
        e.preventDefault();
        measureIsPanning = true;
        measurePan.x += touches[0].clientX - measureLastCenter.x;
        measurePan.y += touches[0].clientY - measureLastCenter.y;
        measureLastCenter = { x: touches[0].clientX, y: touches[0].clientY };
        clampMeasurePan();
        drawMeasureCanvas();
    }
}

function measureTouchEnd(e) {
    measureTouches = Array.from(e.touches);
    if (measureTouches.length < 2) {
        measureLastDist = 0;
    }
    if (measureTouches.length === 0) {
        measureLastCenter = null;
    }
}

function clampMeasurePan() {
    const container = document.getElementById('measure-canvas-container');
    const maxPan = (measureZoom - 1) * container.clientWidth / 2;
    const maxPanY = (measureZoom - 1) * container.clientHeight / 2;
    measurePan.x = Math.max(-maxPan, Math.min(maxPan, measurePan.x));
    measurePan.y = Math.max(-maxPanY, Math.min(maxPanY, measurePan.y));
}

let measureAnimationId = null;
function startMeasureAnimation() {
    if (measureAnimationId) cancelAnimationFrame(measureAnimationId);
    function animate() {
        if (document.getElementById('measure-screen').classList.contains('active')) {
            drawMeasureCanvas();
            measureAnimationId = requestAnimationFrame(animate);
        }
    }
    animate();
}

function drawMeasureCanvas() {
    if (!measureCtx || !floorplanImage) return;

    const container = document.getElementById('measure-canvas-container');
    measureCtx.clearRect(0, 0, container.clientWidth, container.clientHeight);

    measureCtx.save();
    measureCtx.translate(container.clientWidth / 2 + measurePan.x, container.clientHeight / 2 + measurePan.y);
    measureCtx.scale(measureZoom, measureZoom);
    measureCtx.translate(-container.clientWidth / 2, -container.clientHeight / 2);

    const { scale, offsetX, offsetY } = getScaleTransform();
    measureCtx.drawImage(floorplanImage, offsetX, offsetY, currentProject.image_width * scale, currentProject.image_height * scale);

    const cellPixels = (currentProject.image_width / currentProject.grid_cols) * scale;
    const gridX = offsetX + gridOffset.x * scale;
    const gridY = offsetY + gridOffset.y * scale;

    suggestedCell = findSuggestedCell();
    const totalCells = currentProject.grid_rows * currentProject.grid_cols;
    const measured = currentProject.measurements.length;

    const hint = document.querySelector('#measure-screen .hint');
    if (hint) {
        hint.textContent = measured === 0
            ? 'Tap the suggested cell to start'
            : `${measured} of ${totalCells} cells measured`;
    }

    currentProject.measurements.forEach(m => {
        const cx = gridX + (m.grid_x + 0.5) * cellPixels;
        const cy = gridY + (m.grid_y + 0.5) * cellPixels;
        measureCtx.fillStyle = getSpeedColor(m.download) + '99';
        measureCtx.fillRect(cx - cellPixels/2, cy - cellPixels/2, cellPixels, cellPixels);

        measureCtx.fillStyle = 'white';
        measureCtx.font = `bold ${Math.min(cellPixels * 0.35, 14)}px -apple-system, sans-serif`;
        measureCtx.textAlign = 'center';
        measureCtx.textBaseline = 'middle';
        measureCtx.fillText(Math.round(m.download), cx, cy);
    });

    if (suggestedCell && !selectedCell) {
        const cx = gridX + (suggestedCell.col + 0.5) * cellPixels;
        const cy = gridY + (suggestedCell.row + 0.5) * cellPixels;
        const pulse = 0.5 + 0.5 * Math.sin(Date.now() / 300);
        measureCtx.strokeStyle = `rgba(92, 124, 250, ${0.5 + pulse * 0.5})`;
        measureCtx.lineWidth = 3;
        measureCtx.strokeRect(cx - cellPixels/2, cy - cellPixels/2, cellPixels, cellPixels);
        measureCtx.fillStyle = `rgba(92, 124, 250, ${0.1 + pulse * 0.15})`;
        measureCtx.fillRect(cx - cellPixels/2, cy - cellPixels/2, cellPixels, cellPixels);
    }

    if (selectedCell) {
        const cx = gridX + (selectedCell.col + 0.5) * cellPixels;
        const cy = gridY + (selectedCell.row + 0.5) * cellPixels;
        measureCtx.strokeStyle = '#5c7cfa';
        measureCtx.lineWidth = 3;
        measureCtx.strokeRect(cx - cellPixels/2, cy - cellPixels/2, cellPixels, cellPixels);
        measureCtx.fillStyle = 'rgba(92, 124, 250, 0.3)';
        measureCtx.fillRect(cx - cellPixels/2, cy - cellPixels/2, cellPixels, cellPixels);
    }

    measureCtx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
    measureCtx.lineWidth = 1;

    for (let row = 0; row < currentProject.grid_rows; row++) {
        for (let col = 0; col < currentProject.grid_cols; col++) {
            const hasMeasurement = currentProject.measurements.some(m => m.grid_x === col && m.grid_y === row);
            if (!hasMeasurement) {
                const cx = gridX + (col + 0.5) * cellPixels;
                const cy = gridY + (row + 0.5) * cellPixels;
                measureCtx.strokeRect(cx - cellPixels/2, cy - cellPixels/2, cellPixels, cellPixels);
            }
        }
    }

    measureCtx.restore();
}

function measureClick(e) {
    if (measureIsPanning) {
        measureIsPanning = false;
        return;
    }

    const rect = measureCanvas.getBoundingClientRect();
    const container = document.getElementById('measure-canvas-container');

    let x = e.clientX - rect.left;
    let y = e.clientY - rect.top;

    x = (x - container.clientWidth / 2 - measurePan.x) / measureZoom + container.clientWidth / 2;
    y = (y - container.clientHeight / 2 - measurePan.y) / measureZoom + container.clientHeight / 2;

    const { scale, offsetX, offsetY } = getScaleTransform();

    const cellPixels = (currentProject.image_width / currentProject.grid_cols) * scale;
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
    const actionBtn = document.getElementById('action-btn');
    const heatmapBtn = document.getElementById('create-heatmap-btn');

    actionBtn.disabled = !selectedCell;
    if (selectedCell) {
        const existing = currentProject.measurements.find(
            m => m.grid_x === selectedCell.col && m.grid_y === selectedCell.row
        );
        actionBtn.textContent = existing ? 'View' : 'Scan';
    }

    heatmapBtn.disabled = currentProject.measurements.length < 2;
}

function actionBtnClick() {
    if (!selectedCell || !currentProject) return;
    const existing = currentProject.measurements.find(
        m => m.grid_x === selectedCell.col && m.grid_y === selectedCell.row
    );
    if (existing) {
        openMeasurementModal(existing);
    } else {
        openSpeedtest();
    }
}

function openMeasurementModal(measurement) {
    document.getElementById('modal-download').textContent = Math.round(measurement.download);
    document.getElementById('modal-upload').textContent = Math.round(measurement.upload);
    document.getElementById('measurement-modal').classList.add('active');
}

function closeMeasurementModal() {
    document.getElementById('measurement-modal').classList.remove('active');
    selectedCell = null;
    document.getElementById('download-value').textContent = '-';
    document.getElementById('upload-value').textContent = '-';
    updateMeasureUI();
    drawMeasureCanvas();
}

async function deleteMeasurement() {
    if (!currentProject || !selectedCell) return;

    log(`Deleting measurement at (${selectedCell.col}, ${selectedCell.row})`);
    currentProject.measurements = currentProject.measurements.filter(
        m => !(m.grid_x === selectedCell.col && m.grid_y === selectedCell.row)
    );

    await saveProject();
    closeMeasurementModal();
    drawMeasureCanvas();
    showToast('Measurement deleted');
}

function scanCell() {
    document.getElementById('measurement-modal').classList.remove('active');
    openSpeedtest();
}

async function clearMeasurements() {
    if (!currentProject) return;
    log(`Clearing all measurements from ${currentProject.name}`);
    currentProject.measurements = [];
    selectedCell = null;
    document.getElementById('download-value').textContent = '-';
    document.getElementById('upload-value').textContent = '-';
    await saveProject();
    showToast('Measurements cleared');
    showScreen('grid');
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

    const cellPixels = (currentProject.image_width / currentProject.grid_cols) * scale;
    const gridX = offsetX + gridOffset.x * scale;
    const gridY = offsetY + gridOffset.y * scale;

    const measurements = currentProject.measurements;
    if (measurements.length === 0) return;

    const isConfidence = heatmapType === 'confidence';
    const isDownload = heatmapType === 'download';

    let minSpeed = 0, maxSpeed = 100;
    if (!isConfidence) {
        const speeds = measurements.map(m => isDownload ? m.download : m.upload);
        minSpeed = Math.min(...speeds);
        maxSpeed = Math.max(...speeds);
    }

    const subDivisions = 10;
    const subCellPixels = cellPixels / subDivisions;

    for (let row = 0; row < currentProject.grid_rows * subDivisions; row++) {
        for (let col = 0; col < currentProject.grid_cols * subDivisions; col++) {
            const gridCol = (col + 0.5) / subDivisions;
            const gridRow = (row + 0.5) / subDivisions;
            const x = gridX + col * subCellPixels;
            const y = gridY + row * subCellPixels;

            if (isConfidence) {
                const conf = getConfidence(gridCol, gridRow, measurements);
                heatmapCtx.fillStyle = getConfidenceColor(conf);
            } else {
                const speed = interpolateSpeed(measurements, gridCol, gridRow, 2, isDownload);
                heatmapCtx.fillStyle = getSpeedColor(speed, minSpeed, maxSpeed);
            }
            heatmapCtx.globalAlpha = 0.7;
            heatmapCtx.fillRect(x, y, subCellPixels + 0.5, subCellPixels + 0.5);
        }
    }

    heatmapCtx.globalAlpha = 1.0;

    measurements.forEach(m => {
        const cx = gridX + (m.grid_x + 0.5) * cellPixels;
        const cy = gridY + (m.grid_y + 0.5) * cellPixels;

        heatmapCtx.beginPath();
        heatmapCtx.arc(cx, cy, Math.min(cellPixels * 0.3, 20), 0, Math.PI * 2);
        heatmapCtx.fillStyle = 'white';
        heatmapCtx.fill();
        heatmapCtx.strokeStyle = 'rgba(0,0,0,0.3)';
        heatmapCtx.lineWidth = 1;
        heatmapCtx.stroke();

        if (!isConfidence) {
            const value = isDownload ? m.download : m.upload;
            heatmapCtx.fillStyle = '#333';
            heatmapCtx.font = `bold ${Math.min(cellPixels * 0.25, 12)}px -apple-system, sans-serif`;
            heatmapCtx.textAlign = 'center';
            heatmapCtx.textBaseline = 'middle';
            heatmapCtx.fillText(Math.round(value), cx, cy);
        }
    });

    updateHeatmapLegend(minSpeed, maxSpeed, isConfidence);
}

function updateHeatmapLegend(minSpeed, maxSpeed, isConfidence) {
    if (isConfidence) {
        document.getElementById('legend-fast').style.background = '#51cf66';
        document.getElementById('legend-medium').style.background = '#fcc419';
        document.getElementById('legend-slow').style.background = '#ff6b6b';
        document.getElementById('legend-fast-text').textContent = 'High';
        document.getElementById('legend-medium-text').textContent = 'Medium';
        document.getElementById('legend-slow-text').textContent = 'Low';
    } else {
        const midSpeed = (minSpeed + maxSpeed) / 2;
        document.getElementById('legend-fast').style.background = getSpeedColor(maxSpeed, minSpeed, maxSpeed);
        document.getElementById('legend-medium').style.background = getSpeedColor(midSpeed, minSpeed, maxSpeed);
        document.getElementById('legend-slow').style.background = getSpeedColor(minSpeed, minSpeed, maxSpeed);
        document.getElementById('legend-fast-text').textContent = `${Math.round(maxSpeed)} Mbps`;
        document.getElementById('legend-medium-text').textContent = `${Math.round(midSpeed)} Mbps`;
        document.getElementById('legend-slow-text').textContent = `${Math.round(minSpeed)} Mbps`;
    }
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
    log(`Speedtest starting (${speedTestRuns} runs) at cell [${speedtestCell.col}, ${speedtestCell.row}]`);
    speedtestRunning = true;
    document.getElementById('start-test-btn').style.display = 'none';

    try {
        const result = await invoke('run_speedtest', { runs: speedTestRuns });
        log(`Speedtest complete: ${Math.round(result.download_mbps)} ↓ / ${Math.round(result.upload_mbps)} ↑ Mbps`);

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
        log(`Measurement saved (${currentProject.measurements.length} total)`);
    } catch (error) {
        log(`Speedtest ERROR: ${error.message || error}`);
        document.getElementById('start-test-btn').style.display = 'block';
    }

    speedtestRunning = false;
}

function finishSpeedtest() {
    closeSpeedtest();
    updateMeasureUI();
    drawMeasureCanvas();
}
