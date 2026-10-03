// 1. Initialize Leaflet Base Map
const map = L.map('map').setView([20, 0], 2);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 10, 
    attribution: '© OpenStreetMap contributors'
}).addTo(map);

const canvasRenderer = L.canvas({ padding: 0.5 });
const activeDisplayLayer = L.layerGroup().addTo(map);

// Core Filter Status Master Toggles
const rangesMasterEnable = document.getElementById('ranges-master-enable');
const dpMasterEnable = document.getElementById('dp-master-enable');

// Group Sub-Toggle Elements for Direct Layer Control
const UI_Toggles = {
    wMin: document.getElementById('winter-min-enable'),
    wMax: document.getElementById('winter-max-enable'),
    sMin: document.getElementById('summer-min-enable'),
    sMax: document.getElementById('summer-max-enable'),
    wDp: document.getElementById('winter-dp-enable'),
    sDp: document.getElementById('summer-dp-enable')
};

// Group 1 Dom Elements: Temperature Extremes
const UI_Extremes = {
    wMinMin: document.getElementById('winter-min-min'), wMinMax: document.getElementById('winter-min-max'),
    wMaxMin: document.getElementById('winter-max-min'), wMaxMax: document.getElementById('winter-max-max'),
    sMinMin: document.getElementById('summer-min-min'), sMinMax: document.getElementById('summer-min-max'),
    sMaxMin: document.getElementById('summer-max-min'), sMaxMax: document.getElementById('summer-max-max'),
    
    wMinMinDsp: document.getElementById('winter-min-min-val'), wMinMaxDsp: document.getElementById('winter-min-max-val'),
    wMaxMinDsp: document.getElementById('winter-max-min-val'), wMaxMaxDsp: document.getElementById('winter-max-max-val'),
    sMinMinDsp: document.getElementById('summer-min-min-val'), sMinMaxDsp: document.getElementById('summer-min-max-val'),
    sMaxMinDsp: document.getElementById('summer-max-min-val'), sMaxMaxDsp: document.getElementById('summer-max-max-val')
};

// Group 2 Dom Elements: Dew Points
const UI_DewPoint = {
    wDpMin: document.getElementById('winter-dp-min'), wDpMax: document.getElementById('winter-dp-max'),
    sDpMin: document.getElementById('summer-dp-min'), sDpMax: document.getElementById('summer-dp-max'),
    
    wDpMinDsp: document.getElementById('winter-dp-min-val'), wDpMaxDsp: document.getElementById('winter-dp-max-val'),
    sDpMinDsp: document.getElementById('summer-dp-min-val'), sDpMaxDsp: document.getElementById('summer-dp-max-val')
};

// Search Box References
const cityInput = document.getElementById('city-search');
const searchBtn = document.getElementById('search-btn');
const searchError = document.getElementById('search-error');

let globalGridPoints = [];
const STEP = 0.5; 

// --- DEBOUNCE UTILITY ---
function debounce(func, delay) {
    let timeout;
    return function(...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), delay);
    };
}
const debouncedUpdateClimateMap = debounce(updateClimateMap, 150);

// --- INTERACTIVE ACCORDION UI LOGIC ---
document.querySelectorAll('.main-trigger').forEach(trigger => {
    trigger.addEventListener('click', (e) => {
        const item = e.currentTarget.closest('.accordion-item');
        if (!item) return;
        item.classList.toggle('active');

        const content = item.querySelector(':scope > .accordion-content');
        if (!content) return;

        if (item.classList.contains('active')) {
            // Auto-expand any sub-section whose checkbox is already checked,
            // so checked filters are visible without an extra click.
            item.querySelectorAll('.sub-accordion').forEach(sub => {
                const toggle = sub.querySelector('.sub-toggle');
                if (toggle && toggle.checked) {
                    sub.classList.add('active');
                }
            });
            // Uncapped (rather than relying on the CSS's fixed 600px max-height)
            // so however many sub-sections end up expanded, none get clipped.
            content.style.maxHeight = 'none';
        } else {
            // Let the CSS collapsed-state rule (max-height: 0) take over.
            content.style.maxHeight = '';
        }
    });
});

document.querySelectorAll('.sub-accordion-header').forEach(header => {
    header.addEventListener('click', (e) => {
        // Any click inside the checkbox's label (the checkbox, the checkmark,
        // or the text) should only toggle the checkbox, not the accordion.
        if (e.target.closest('.toggle-container')) return;
        
        const subAccordion = e.currentTarget.parentElement;
        if (!subAccordion) return;
        
        subAccordion.classList.toggle('active');
        const parentPanel = subAccordion.closest('.accordion-content');
        if (parentPanel) parentPanel.style.maxHeight = "none"; 
    });
});

// Sections that start expanded (see the "active" class in the HTML) get the
// same uncapped height a manual click would give them, so nothing is clipped.
document.querySelectorAll('.accordion-item.active > .accordion-content').forEach(content => {
    content.style.maxHeight = 'none';
});

// --- TWO-TIER INTERACTIVE TOGGLE DELEGATION ---
const controlsPanel = document.getElementById('controls');

function handleControlInput(e) {
    const target = e.target;
    if (!target.matches('input[type="checkbox"], input[type="range"]')) return;
    const accordionItem = target.closest('.accordion-item');
    if (!accordionItem) return;

    const subContainer = accordionItem.querySelector('.accordion-content');
    const subToggles = Array.from(accordionItem.querySelectorAll('.sub-toggle'));

    // 1. Master Toggle changes: Batch update child elements
    if (target.classList.contains('master-toggle')) {
        subToggles.forEach(toggle => {
            toggle.checked = target.checked;
        });
        if (subContainer) {
            subContainer.classList.toggle('disabled-opacity', !target.checked);
            subContainer.classList.remove('dimmed-opacity');
        }
    }

    // 2. Individual Sub-Toggle changes: Evaluate Master status
    if (target.classList.contains('sub-toggle')) {
        const masterToggle = accordionItem.querySelector('.master-toggle');
        const allChecked = subToggles.every(t => t.checked);
        const noneChecked = subToggles.every(t => !t.checked);

        if (masterToggle) masterToggle.checked = allChecked;

        // Dim (but don't disable) the section when every individual toggle is
        // off, so the checkboxes stay clickable and you can turn them back on
        // one at a time. 'disabled-opacity' is reserved for the master-off
        // case above, since it also blocks clicks.
        if (subContainer) {
            subContainer.classList.toggle('dimmed-opacity', noneChecked);
        }
    }
    
    debouncedUpdateClimateMap();
}

if (controlsPanel) {
    controlsPanel.addEventListener('input', handleControlInput);
}

// --- DATA SOURCE SEEDING ---
fetch('weatherData.json')
    .then(res => {
        if (!res.ok) throw new Error("Network error loading file.");
        return res.json();
    })
    .then(data => {
        globalGridPoints = data;
        searchBtn.addEventListener('click', lookupCityClimate);
        cityInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') lookupCityClimate(); });
        updateClimateMap();
    })
    .catch(err => console.error(err));

// --- GEOGRAPHIC LOOKUP ENGINE ---
function lookupCityClimate() {
    const query = cityInput.value.trim();
    if (!query) return;

    searchError.innerText = "Locating city...";

    fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1`)
        .then(res => res.json())
        .then(results => {
            if (!results || results.length === 0) {
                searchError.innerText = "City not found.";
                return;
            }
            searchError.innerText = "";
            
            const targetLat = parseFloat(results[0].lat);
            const targetLon = parseFloat(results[0].lon);

            let closestPoint = null;
            let shortestDistance = Infinity;

            for (let i = 0; i < globalGridPoints.length; i++) {
                const point = globalGridPoints[i];
                const distance = Math.pow(targetLat - point.coords[1], 2) + Math.pow(targetLon - point.coords[0], 2);
                if (distance < shortestDistance) {
                    shortestDistance = distance;
                    closestPoint = point;
                }
            }

            if (closestPoint) {
                map.flyTo([targetLat, targetLon], 6);

                if (closestPoint.winter_min !== undefined) {
                    rangesMasterEnable.checked = true;
                    const item = rangesMasterEnable.closest('.accordion-item');
                    item.querySelector('.accordion-content').classList.remove('disabled-opacity');
                    item.querySelectorAll('.sub-toggle').forEach(t => t.checked = true);
                    
                    UI_Extremes.wMinMin.value = Math.round(closestPoint.winter_min - 4);
                    UI_Extremes.wMinMax.value = Math.round(closestPoint.winter_min + 4);
                    UI_Extremes.wMaxMin.value = Math.round(closestPoint.winter_max - 4);
                    UI_Extremes.wMaxMax.value = Math.round(closestPoint.winter_max + 4);
                    UI_Extremes.sMinMin.value = Math.round(closestPoint.summer_min - 4);
                    UI_Extremes.sMinMax.value = Math.round(closestPoint.summer_min + 4);
                    UI_Extremes.sMaxMin.value = Math.round(closestPoint.summer_max - 4);
                    UI_Extremes.sMaxMax.value = Math.round(closestPoint.summer_max + 4);
                }

                if (closestPoint.winter_dp !== undefined) {
                    dpMasterEnable.checked = true;
                    const item = dpMasterEnable.closest('.accordion-item');
                    item.querySelector('.accordion-content').classList.remove('disabled-opacity');
                    item.querySelectorAll('.sub-toggle').forEach(t => t.checked = true);
                    
                    UI_DewPoint.wDpMin.value = Math.max(0, Math.round(closestPoint.winter_dp - 4));
                    UI_DewPoint.wDpMax.value = Math.min(90, Math.round(closestPoint.winter_dp + 4));
                    UI_DewPoint.sDpMin.value = Math.max(0, Math.round(closestPoint.summer_dp - 4));
                    UI_DewPoint.sDpMax.value = Math.min(90, Math.round(closestPoint.summer_dp + 4));
                }

                document.querySelectorAll('.accordion-item:not(#presets-section), .sub-accordion').forEach(el => el.classList.add('active'));
                document.querySelectorAll('.accordion-item.active > .accordion-content').forEach(c => c.style.maxHeight = 'none');
                updateClimateMap();
            }
        })
        .catch(err => {
            console.error(err);
            searchError.innerText = "Lookup error.";
        });
}

// --- RENDER CONTROL MAP PROCESSING METHOD ---
function updateClimateMap() {
    if (globalGridPoints.length === 0) return;

    // 1. Parse & Clamp Temperature Range Values
    let wMinMin = parseInt(UI_Extremes.wMinMin.value) || 0; let wMinMax = parseInt(UI_Extremes.wMinMax.value) || 0;
    let wMaxMin = parseInt(UI_Extremes.wMaxMin.value) || 0; let wMaxMax = parseInt(UI_Extremes.wMaxMax.value) || 0;
    let sMinMin = parseInt(UI_Extremes.sMinMin.value) || 0; let sMinMax = parseInt(UI_Extremes.sMinMax.value) || 0;
    let sMaxMin = parseInt(UI_Extremes.sMaxMin.value) || 0; let sMaxMax = parseInt(UI_Extremes.sMaxMax.value) || 0;

    if (wMinMin > wMinMax) { wMinMax = wMinMin; UI_Extremes.wMinMax.value = wMinMin; }
    if (wMaxMin > wMaxMax) { wMaxMax = wMaxMin; UI_Extremes.wMaxMax.value = wMaxMin; }
    if (sMinMin > sMinMax) { sMinMax = sMinMin; UI_Extremes.sMinMax.value = sMinMin; }
    if (sMaxMin > sMaxMax) { sMaxMax = sMaxMin; UI_Extremes.sMaxMax.value = sMaxMin; }

    UI_Extremes.wMinMinDsp.innerText = wMinMin; UI_Extremes.wMinMaxDsp.innerText = wMinMax;
    UI_Extremes.wMaxMinDsp.innerText = wMaxMin; UI_Extremes.wMaxMaxDsp.innerText = wMaxMax;
    UI_Extremes.sMinMinDsp.innerText = sMinMin; UI_Extremes.sMinMaxDsp.innerText = sMinMax;
    UI_Extremes.sMaxMinDsp.innerText = sMaxMin; UI_Extremes.sMaxMaxDsp.innerText = sMaxMax;

    // 2. Parse & Clamp Dew Point Values
    let wDpMin = parseInt(UI_DewPoint.wDpMin.value) || 0; let wDpMax = parseInt(UI_DewPoint.wDpMax.value) || 0;
    let sDpMin = parseInt(UI_DewPoint.sDpMin.value) || 0; let sDpMax = parseInt(UI_DewPoint.sDpMax.value) || 0;

    if (wDpMin > wDpMax) { wDpMax = wDpMin; UI_DewPoint.wDpMax.value = wDpMin; }
    if (sDpMin > sDpMax) { sDpMax = sDpMin; UI_DewPoint.sDpMax.value = sDpMin; }

    UI_DewPoint.wDpMinDsp.innerText = wDpMin; UI_DewPoint.wDpMaxDsp.innerText = wDpMax;
    UI_DewPoint.sDpMinDsp.innerText = sDpMin; UI_DewPoint.sDpMaxDsp.innerText = sDpMax;

    activeDisplayLayer.clearLayers();

    // Independent Filter Evaluators
    const useWMin = UI_Toggles.wMin.checked;
    const useWMax = UI_Toggles.wMax.checked;
    const useSMin = UI_Toggles.sMin.checked;
    const useSMax = UI_Toggles.sMax.checked;
    const useWDp  = UI_Toggles.wDp.checked;
    const useSDp  = UI_Toggles.sDp.checked;

    const matchedTiles = [];

    for (let i = 0; i < globalGridPoints.length; i++) {
        const point = globalGridPoints[i];
        
        // Step-by-step point validation
        const wMinMatches = !useWMin || (point.winter_min >= wMinMin && point.winter_min <= wMinMax);
        const wMaxMatches = !useWMax || (point.winter_max >= wMaxMin && point.winter_max <= wMaxMax);
        const sMinMatches = !useSMin || (point.summer_min >= sMinMin && point.summer_min <= sMinMax);
        const sMaxMatches = !useSMax || (point.summer_max >= sMaxMin && point.summer_max <= sMaxMax);

        const wDpMatches  = !useWDp  || (point.winter_dp >= wDpMin && point.winter_dp <= wDpMax);
        const sDpMatches  = !useSDp  || (point.summer_dp >= sDpMin && point.summer_dp <= sDpMax);

        if (wMinMatches && wMaxMatches && sMinMatches && sMaxMatches && wDpMatches && sDpMatches) {
            
            const lon = point.coords[0];
            const lat = point.coords[1];

            const tile = L.rectangle([[lat - STEP / 2, lon - STEP / 2], [lat + STEP / 2, lon + STEP / 2]], {
                renderer: canvasRenderer,
                stroke: false,
                fillColor: "#2ecc71",
                fillOpacity: 0.45
            });
            matchedTiles.push(tile);
        }
    }

    activeDisplayLayer.addLayer(L.layerGroup(matchedTiles));
}

// --- PRESETS ---
const PRESET_STORAGE_KEY = 'globalClimate.presets';
const presetNameInput = document.getElementById('preset-name');
const presetSaveBtn = document.getElementById('preset-save-btn');
const presetMessage = document.getElementById('preset-message');
const presetList = document.getElementById('preset-list');

let presets = loadPresetsFromStorage();
let presetMessageTimer;

function loadPresetsFromStorage() {
    try {
        const parsed = JSON.parse(localStorage.getItem(PRESET_STORAGE_KEY));
        return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
        return [];
    }
}

function persistPresets() {
    try {
        localStorage.setItem(PRESET_STORAGE_KEY, JSON.stringify(presets));
        return true;
    } catch (err) {
        console.error(err);
        return false;
    }
}

function showPresetMessage(text, isError) {
    presetMessage.textContent = text;
    presetMessage.classList.toggle('error', !!isError);
    clearTimeout(presetMessageTimer);
    presetMessageTimer = setTimeout(() => { presetMessage.textContent = ''; }, 3000);
}

// Snapshot every slider value and every per-layer on/off checkbox.
function captureCurrentRanges() {
    const ranges = {};
    controlsPanel.querySelectorAll('input[type="range"]').forEach(el => { ranges[el.id] = el.value; });
    const toggles = {};
    controlsPanel.querySelectorAll('.sub-toggle').forEach(el => { toggles[el.id] = el.checked; });
    return { ranges, toggles };
}

function applyPreset(preset) {
    Object.entries(preset.ranges || {}).forEach(([id, value]) => {
        const el = document.getElementById(id);
        if (el) el.value = value;
    });
    Object.entries(preset.toggles || {}).forEach(([id, checked]) => {
        const el = document.getElementById(id);
        if (el) el.checked = checked;
    });

    // Re-derive each master checkbox and dimming from the sub-toggles.
    document.querySelectorAll('.master-toggle').forEach(master => {
        const item = master.closest('.accordion-item');
        if (!item) return;
        const subs = Array.from(item.querySelectorAll('.sub-toggle'));
        const content = item.querySelector(':scope > .accordion-content');
        master.checked = subs.length > 0 && subs.every(t => t.checked);
        if (content) {
            content.classList.remove('disabled-opacity');
            content.classList.toggle('dimmed-opacity', subs.every(t => !t.checked));
        }
    });

    updateClimateMap();
}

function renderPresetList() {
    presetList.textContent = '';

    if (presets.length === 0) {
        const empty = document.createElement('li');
        empty.className = 'preset-empty';
        empty.textContent = 'No presets saved yet.';
        presetList.appendChild(empty);
        return;
    }

    presets.forEach(preset => {
        const li = document.createElement('li');

        const loadBtn = document.createElement('button');
        loadBtn.type = 'button';
        loadBtn.className = 'preset-load';
        loadBtn.textContent = preset.name;
        loadBtn.title = 'Load "' + preset.name + '"';
        loadBtn.addEventListener('click', () => {
            applyPreset(preset);
            showPresetMessage('Loaded "' + preset.name + '".');
        });

        const delBtn = document.createElement('button');
        delBtn.type = 'button';
        delBtn.className = 'preset-delete';
        delBtn.textContent = '×';
        delBtn.title = 'Delete "' + preset.name + '"';
        delBtn.setAttribute('aria-label', 'Delete preset ' + preset.name);
        delBtn.addEventListener('click', () => {
            if (!confirm('Delete preset "' + preset.name + '"?')) return;
            presets = presets.filter(p => p !== preset);
            persistPresets();
            renderPresetList();
            showPresetMessage('Deleted "' + preset.name + '".');
        });

        li.appendChild(loadBtn);
        li.appendChild(delBtn);
        presetList.appendChild(li);
    });
}

function savePreset() {
    const name = presetNameInput.value.trim();
    if (!name) {
        showPresetMessage('Enter a name first.', true);
        return;
    }

    const snapshot = captureCurrentRanges();
    const existing = presets.find(p => p.name.toLowerCase() === name.toLowerCase());

    if (existing) {
        if (!confirm('A preset named "' + existing.name + '" already exists. Overwrite it?')) return;
        existing.ranges = snapshot.ranges;
        existing.toggles = snapshot.toggles;
    } else {
        presets.push({ name, ranges: snapshot.ranges, toggles: snapshot.toggles });
    }

    const saved = persistPresets();
    renderPresetList();
    presetNameInput.value = '';
    if (saved) {
        showPresetMessage((existing ? 'Updated "' : 'Saved "') + (existing ? existing.name : name) + '".');
    } else {
        showPresetMessage('Could not write to browser storage; preset will be lost on reload.', true);
    }
}

presetSaveBtn.addEventListener('click', savePreset);
presetNameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') savePreset(); });
renderPresetList();


// --- MAP RIGHT-CLICK MENU & TOOLS ---
const LAT_LIMIT = 85.0511;               // Web Mercator's northern/southern edge
const toolsLayer = L.layerGroup().addTo(map);
let toolLines = [];                      // latitude / longitude lines currently drawn
let measure = null;                      // the current measurement, if any
let menuLatLng = null;                   // where the menu was opened
let suppressNextMapClick = false;

const ctxMenu = document.getElementById('map-context-menu');
const ctxCoords = document.getElementById('ctx-coords');
const toolsBar = document.getElementById('tools-bar');
const toolsReadout = document.getElementById('tools-readout');
const toolsDone = document.getElementById('tools-done');
const toolsClear = document.getElementById('tools-clear');

// ---------- helpers ----------
function formatLat(v) { return Math.abs(v).toFixed(4) + '° ' + (v >= 0 ? 'N' : 'S'); }
function formatLng(v) { return Math.abs(v).toFixed(4) + '° ' + (v >= 0 ? 'E' : 'W'); }

function formatCoords(ll) {
    const w = ll.wrap();
    return w.lat.toFixed(5) + ', ' + w.lng.toFixed(5);
}

function formatDistance(meters) {
    if (meters < 1000) {
        return Math.round(meters * 3.28084).toLocaleString() + ' ft · ' + Math.round(meters).toLocaleString() + ' m';
    }
    const fmt = n => n.toLocaleString(undefined, { maximumFractionDigits: n < 10 ? 2 : (n < 1000 ? 1 : 0) });
    return fmt(meters / 1609.344) + ' mi · ' + fmt(meters / 1000) + ' km';
}

// Shortest signed longitude difference, in degrees (-180..180].
function wrapDelta(d) {
    return ((((d + 180) % 360) + 360) % 360) - 180;
}

// Points along the great-circle path from a to b (longitudes unwrapped so the
// line never jumps across the map when it crosses the antimeridian).
function greatCircle(a, b) {
    const rad = Math.PI / 180, deg = 180 / Math.PI;
    const p1 = a.lat * rad, l1 = a.lng * rad, p2 = b.lat * rad, l2 = b.lng * rad;
    const h = Math.pow(Math.sin((p2 - p1) / 2), 2) +
              Math.cos(p1) * Math.cos(p2) * Math.pow(Math.sin((l2 - l1) / 2), 2);
    const d = 2 * Math.asin(Math.min(1, Math.sqrt(h)));
    if (d < 1e-6) return [a, b];

    const steps = Math.max(2, Math.ceil((d * deg) / 1.5));
    const pts = [];
    let prevLng = a.lng;
    for (let i = 0; i <= steps; i++) {
        const f = i / steps;
        const A = Math.sin((1 - f) * d) / Math.sin(d);
        const B = Math.sin(f * d) / Math.sin(d);
        const x = A * Math.cos(p1) * Math.cos(l1) + B * Math.cos(p2) * Math.cos(l2);
        const y = A * Math.cos(p1) * Math.sin(l1) + B * Math.cos(p2) * Math.sin(l2);
        const z = A * Math.sin(p1) + B * Math.sin(p2);
        let lng = Math.atan2(y, x) * deg;
        while (lng - prevLng > 180) lng -= 360;
        while (lng - prevLng < -180) lng += 360;
        prevLng = lng;
        pts.push(L.latLng(Math.atan2(z, Math.sqrt(x * x + y * y)) * deg, lng));
    }
    pts[0] = a;
    pts[pts.length - 1] = b;
    return pts;
}

function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
        return navigator.clipboard.writeText(text);
    }
    return new Promise((resolve, reject) => {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand('copy') ? resolve() : reject(); }
        catch (err) { reject(err); }
        document.body.removeChild(ta);
    });
}

// ---------- context menu ----------
function hideMenu() { ctxMenu.hidden = true; }

map.on('contextmenu', (e) => {
    e.originalEvent.preventDefault();
    menuLatLng = e.latlng;
    ctxCoords.textContent = formatCoords(e.latlng);
    ctxMenu.hidden = false;

    const w = ctxMenu.offsetWidth, h = ctxMenu.offsetHeight;
    const x = Math.max(8, Math.min(e.originalEvent.clientX, window.innerWidth - w - 8));
    const y = Math.max(8, Math.min(e.originalEvent.clientY, window.innerHeight - h - 8));
    ctxMenu.style.left = x + 'px';
    ctxMenu.style.top = y + 'px';
});

ctxMenu.addEventListener('contextmenu', (e) => e.preventDefault());

// Any press outside the menu closes it, and that same click shouldn't also
// drop a measuring point on the map underneath.
document.addEventListener('mousedown', (e) => {
    suppressNextMapClick = false;
    if (ctxMenu.hidden || ctxMenu.contains(e.target)) return;
    hideMenu();
    suppressNextMapClick = true;
}, true);

map.on('movestart zoomstart', hideMenu);
window.addEventListener('resize', hideMenu);

document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!ctxMenu.hidden) hideMenu();
    else if (measure && measure.active) finishMeasure();
});

ctxCoords.addEventListener('click', () => {
    const text = ctxCoords.textContent;
    copyText(text).then(() => { ctxCoords.textContent = 'Copied ✓'; })
                  .catch(() => { ctxCoords.textContent = 'Copy failed'; })
                  .finally(() => setTimeout(hideMenu, 700));
});

document.getElementById('ctx-measure').addEventListener('click', () => { hideMenu(); startMeasure(menuLatLng); });
document.getElementById('ctx-lat').addEventListener('click', () => { hideMenu(); addLatLine(menuLatLng.lat); });
document.getElementById('ctx-lng').addEventListener('click', () => { hideMenu(); addLngLine(menuLatLng.wrap().lng); });

// ---------- latitude / longitude lines ----------
function addLatLine(lat) {
    // A latitude line is horizontal in Web Mercator; run it far past the
    // edges so it covers every repeated copy of the world.
    const line = L.polyline([[lat, -1080], [lat, 1080]], {
        color: '#e74c3c', weight: 3, opacity: 0.9, className: 'tool-line'
    }).addTo(toolsLayer);
    line.bindTooltip('Latitude ' + formatLat(lat), { sticky: true });
    toolLines.push(line);
    updateToolsBar();
}

function addLngLine(lng) {
    const segments = [];
    for (let k = -3; k <= 3; k++) {
        segments.push([[-LAT_LIMIT, lng + 360 * k], [LAT_LIMIT, lng + 360 * k]]);
    }
    const line = L.polyline(segments, {
        color: '#2980b9', weight: 3, opacity: 0.9, className: 'tool-line'
    }).addTo(toolsLayer);
    line.bindTooltip('Longitude ' + formatLng(lng), { sticky: true });
    toolLines.push(line);
    updateToolsBar();
}

// ---------- measuring tool ----------
function startMeasure(ll) {
    clearMeasure();
    const group = L.layerGroup().addTo(toolsLayer);
    measure = {
        group,
        points: [],
        path: [],
        total: 0,
        active: true,
        line: L.polyline([], { color: '#1a1e26', weight: 3, interactive: false }).addTo(group),
        preview: L.polyline([], { color: '#1a1e26', weight: 2, dashArray: '6 6', opacity: 0.7, interactive: false }).addTo(group)
    };
    map.getContainer().classList.add('measuring');
    map.doubleClickZoom.disable();
    addMeasurePoint(ll);
}

function addMeasurePoint(ll) {
    const m = measure;
    if (!m) return;
    const prev = m.points[m.points.length - 1];

    if (prev) {
        // Keep the new point in the same copy of the world as the previous one.
        ll = L.latLng(ll.lat, prev.lng + wrapDelta(ll.lng - prev.lng));
        const seg = map.distance(prev, ll);
        if (seg < 1) return;
        m.total += seg;
        m.path.push(...greatCircle(prev, ll).slice(1));
    } else {
        m.path.push(ll);
    }

    m.points.push(ll);
    m.line.setLatLngs(m.path);

    const dot = L.circleMarker(ll, {
        radius: 5, color: '#1a1e26', weight: 2, fillColor: '#fff', fillOpacity: 1, interactive: false
    }).addTo(m.group);
    if (prev) {
        dot.bindTooltip(formatDistance(m.total), {
            permanent: true, direction: 'top', offset: [0, -6], className: 'measure-label'
        });
    }
    updateToolsBar();
}

function finishMeasure() {
    if (!measure) return;
    measure.active = false;
    measure.preview.setLatLngs([]);
    map.getContainer().classList.remove('measuring');
    map.doubleClickZoom.enable();
    if (measure.points.length < 2) clearMeasure();   // nothing worth keeping
    updateToolsBar();
}

function clearMeasure() {
    if (!measure) return;
    toolsLayer.removeLayer(measure.group);
    measure = null;
    map.getContainer().classList.remove('measuring');
    map.doubleClickZoom.enable();
    updateToolsBar();
}

map.on('click', (e) => {
    if (suppressNextMapClick) { suppressNextMapClick = false; return; }
    if (measure && measure.active) addMeasurePoint(e.latlng);
});

map.on('mousemove', (e) => {
    if (!measure || !measure.active || measure.points.length === 0) return;
    const last = measure.points[measure.points.length - 1];
    const end = L.latLng(e.latlng.lat, last.lng + wrapDelta(e.latlng.lng - last.lng));
    measure.preview.setLatLngs(greatCircle(last, end));
});

// ---------- bottom bar ----------
function updateToolsBar() {
    toolsBar.hidden = !(toolLines.length > 0 || measure);

    if (measure) {
        toolsReadout.hidden = false;
        toolsReadout.textContent = measure.points.length < 2
            ? 'Click the map to add points'
            : 'Total distance: ' + formatDistance(measure.total);
    } else {
        toolsReadout.hidden = true;
    }
    toolsDone.hidden = !(measure && measure.active);
}

toolsDone.addEventListener('click', finishMeasure);

toolsClear.addEventListener('click', () => {
    toolLines.forEach(l => toolsLayer.removeLayer(l));
    toolLines = [];
    clearMeasure();
    updateToolsBar();
});
