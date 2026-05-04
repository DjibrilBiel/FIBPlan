// --- DATA & STATE ---

let SUBJECTS = []; // Will be populated from API
const DAYS_MAP = { "mo": 0, "tu": 1, "we": 2, "th": 3, "fr": 4 };
// Mapeig dia_setmana de la API FIB (1 = Dilluns, 5 = Divendres)
const FIB_DAYS_MAP = { 1: 0, 2: 1, 3: 2, 4: 3, 5: 4, 6: 5, 7: 6 };
const DAYS_NAMES = ["Dilluns", "Dimarts", "Dimecres", "Dijous", "Divendres"];

let selectedSubjects = []; // ["SO", "AC"]
let selectedGroups = {}; // { "SO": ["11"], "AC": ["12", "13"] }
let userPreferences = {
    minStart: 8,
    maxEnd: 21
};

let openAccordions = new Set(); // Keep track of open accordions
let subjectColors = {}; // Maps subject names to assigned colors

// --- DOM ELEMENTS ---
const subjectList = document.getElementById('subject-list');
const subjectSearch = document.getElementById('subject-search');
const timetableGrid = document.getElementById('timetable-grid');
const statCount = document.getElementById('stat-count');
const statHours = document.getElementById('stat-hours');
const statGaps = document.getElementById('stat-gaps');
const userComments = document.getElementById('user-comments');
const clearBtn = document.getElementById('clear-btn');
const exportBtn = document.getElementById('export-btn');

// Color Palette for Subjects (10 high-contrast, modern colors)
const PALETTE = [
    'rgba(34, 211, 238, 0.8)',  // Cyan
    'rgba(168, 85, 247, 0.8)',  // Purple
    'rgba(251, 146, 60, 0.8)',  // Orange
    'rgba(244, 63, 94, 0.8)',   // Pinkish Red
    'rgba(16, 185, 129, 0.8)',  // Emerald Green
    'rgba(59, 130, 246, 0.8)',  // Blue
    'rgba(234, 179, 8, 0.8)',   // Yellow
    'rgba(236, 72, 153, 0.8)',  // Pink
    'rgba(20, 184, 166, 0.8)',  // Teal
    'rgba(139, 92, 246, 0.8)'   // Violet
];

const FIB_CLIENT_ID = "YsihMaSp0jdWWMawyh27dCJwkq96H0dya1kMjWo6";

// --- INITIALIZATION ---
function init() {
    renderGrid();
    loadState();

    subjectSearch.addEventListener('input', (e) => renderSubjectList(e.target.value));
    userComments.addEventListener('input', saveState);
    clearBtn.addEventListener('click', clearAll);
    if (exportBtn) {
        exportBtn.addEventListener('click', exportToImage);
    }

    // Mobile Menu Toggles
    const menuToggle = document.getElementById('menu-toggle');
    const sidebarOverlay = document.getElementById('sidebar-overlay');
    const sidebar = document.querySelector('.sidebar');

    if (menuToggle && sidebarOverlay) {
        menuToggle.addEventListener('click', () => {
            sidebar.classList.toggle('open');
            sidebarOverlay.classList.toggle('visible');
        });

        sidebarOverlay.addEventListener('click', () => {
            sidebar.classList.remove('open');
            sidebarOverlay.classList.remove('visible');
        });
    }

    // Force API load if cache is empty or if it's the old cache (missing categories array)
    if (SUBJECTS.length === 0 || !SUBJECTS[0].categories) {
        loadFIBData();
    } else {
        renderSubjectList();
    }
}

// --- FIB API LOGIC ---

async function fetchFIB(url, clientId) {
    const separator = url.includes('?') ? '&' : '?';
    let fetchUrl = `${url}${separator}format=json`;
    if (clientId && clientId.trim() !== '') {
        fetchUrl += `&client_id=${clientId.trim()}`;
    }

    // Mode 'cors' and include credentials so that if user is logged in via CAS, the session cookie is sent.
    const response = await fetch(fetchUrl, {
        method: 'GET',
        headers: {
            'Accept': 'application/json'
        },
        credentials: 'omit' // Start with omit, but if they logged in, we might need 'include'. 
        // Actually, FIB API public endpoints with client_id work with 'omit'.
    });

    if (!response.ok) {
        throw new Error(`Error API: ${response.status} ${response.statusText}`);
    }
    return response.json();
}

async function loadFIBData() {
    subjectList.innerHTML = `<div style="padding:1rem; text-align:center;">Carregant dades des de la FIB...<br><small>Això pot trigar uns segons</small></div>`;

    try {
        // 1. Get current semester
        const quadActual = await fetchFIB("https://api.fib.upc.edu/v2/quadrimestres/actual/", FIB_CLIENT_ID);
        const classesUrl = quadActual.classes; // e.g. "https://api.fib.upc.edu/v2/quadrimestres/2025Q2/classes/"

        // 2. Fetch all classes
        let classesData = [];
        let nextClassesUrl = classesUrl;

        while (nextClassesUrl) {
            const pageData = await fetchFIB(nextClassesUrl, FIB_CLIENT_ID);
            classesData = classesData.concat(pageData.results);
            nextClassesUrl = pageData.next;
        }

        // 3. Fetch all subjects details to get categories
        subjectList.innerHTML = `<div style="padding:1rem; text-align:center;">Processant dades i categories...<br><small>Falta poc!</small></div>`;
        let assignaturesData = [];
        let nextAssigUrl = "https://api.fib.upc.edu/v2/assignatures/";

        while (nextAssigUrl) {
            const pageData = await fetchFIB(nextAssigUrl, FIB_CLIENT_ID);
            assignaturesData = assignaturesData.concat(pageData.results);
            nextAssigUrl = pageData.next;
        }

        // 4. Process classes into SUBJECTS structure
        processAPIClasses(classesData, assignaturesData);

        saveState(); // Save SUBJECTS to local storage as cache
        renderSubjectList();
        updateTimetable();

    } catch (error) {
        console.error("Error fetching from FIB API:", error);
        subjectList.innerHTML = `<div style="padding:1rem; color:var(--accent-red); text-align:center;">
            <b>Error de connexió</b><br>
            ${error.message}
        </div>`;
    }
}

function processAPIClasses(apiClasses, apiAssignatures) {
    const subjMap = {};
    const assigMap = {};

    // Build map for quick assignatura lookup
    apiAssignatures.forEach(a => {
        assigMap[a.id] = a;
    });

    const skippedSubjects = new Set();

    apiClasses.forEach(cls => {
        const subjId = cls.assignatura || cls.codi_assig || "Desconegut";

        if (skippedSubjects.has(subjId)) return;
        const groupId = cls.grup || "??";
        const dayIdx = FIB_DAYS_MAP[cls.dia_setmana] !== undefined ? FIB_DAYS_MAP[cls.dia_setmana] : -1;

        if (dayIdx === -1 || dayIdx > 4) return;

        let startH = 8;
        if (cls.inici) {
            const parts = cls.inici.split(':');
            startH = parseInt(parts[0]) + (parseInt(parts[1] || 0) / 60);
        }

        let endH = startH + (cls.durada || 1);
        if (cls.fi) {
            const parts = cls.fi.split(':');
            endH = parseInt(parts[0]) + (parseInt(parts[1] || 0) / 60);
        }

        if (!subjMap[subjId]) {
            const assigDetails = assigMap[subjId];
            let cats = [];

            if (assigDetails && assigDetails.obligatorietats && assigDetails.obligatorietats.length > 0) {
                const obls = assigDetails.obligatorietats;

                for (const obl of obls) {
                    if (obl.pla === "GRAU") {
                        let cat = "Opcional";
                        let subCat = "General";

                        if (obl.codi_oblig === "OBL") {
                            cat = "Obligatòria";
                        } else if (obl.codi_oblig === "CPL_ESP" || obl.codi_oblig === "OBL_ESP") {
                            cat = "Especialitat";
                            const specName = obl.nom_especialitat || "";
                            if (specName.includes("Computació") || obl.codi_especialitat === "C") subCat = "Computació";
                            else if (specName.includes("Software") || obl.codi_especialitat === "ES") subCat = "Enginyeria del Software";
                            else if (specName.includes("Computadors") || obl.codi_especialitat === "EC") subCat = "Enginyeria de Computadors";
                            else if (specName.includes("Informació") && !specName.includes("Tecnologies") || obl.codi_especialitat === "SI") subCat = "Sistemes d'Informació";
                            else if (specName.includes("Tecnologies") || obl.codi_especialitat === "TI") subCat = "Tecnologies de la Informació";
                        } else if (obl.codi_oblig === "OPT") {
                            cat = "Opcional";
                        }

                        cats.push({ cat, subCat });
                    }
                }
            }

            if (cats.length === 0) {
                // Sense informació de GRAU, ho ignorem completament.
                skippedSubjects.add(subjId);
                return;
            }

            subjMap[subjId] = {
                name: subjId,
                groups: {},
                categories: cats
            };
        }

        if (!subjMap[subjId].groups[groupId]) {
            subjMap[subjId].groups[groupId] = [];
        }

        subjMap[subjId].groups[groupId].push({
            day: Object.keys(DAYS_MAP).find(key => DAYS_MAP[key] === dayIdx),
            start: startH,
            end: endH,
            type: cls.tipus || ""
        });
    });

    SUBJECTS = Object.values(subjMap);
    SUBJECTS.sort((a, b) => a.name.localeCompare(b.name));
}


function renderSubjectList(query = "") {
    if (SUBJECTS.length === 0) return;

    subjectList.innerHTML = "";
    const filtered = SUBJECTS.filter(s => s.name.toLowerCase().includes(query.toLowerCase()));

    // Group filtered subjects by category
    const categories = {
        "Obligatòria": {},
        "Especialitat": {},
        "Opcional": {}
    };

    filtered.forEach(s => {
        const cats = s.categories || [{ cat: s.category || "Opcional", subCat: s.subCategory || "General" }];

        cats.forEach(c => {
            let catName = c.cat;
            if (!categories[catName]) catName = "Opcional";

            let subCatName = c.subCat || "General";
            if (!categories[catName][subCatName]) categories[catName][subCatName] = [];

            // Check if not already added to avoid duplicates from multiple similar obligatorietats
            if (!categories[catName][subCatName].includes(s)) {
                categories[catName][subCatName].push(s);
            }
        });
    });

    // Render Categories
    Object.keys(categories).forEach(catName => {
        const subCats = categories[catName];
        if (Object.keys(subCats).length === 0) return;

        // Check if this category has any subjects
        let hasSubjects = false;
        Object.values(subCats).forEach(arr => { if (arr.length > 0) hasSubjects = true; });
        if (!hasSubjects) return;

        const catId = `cat-${catName}`;
        const catDiv = document.createElement('div');
        catDiv.className = 'accordion-category';
        if (openAccordions.has(catId)) catDiv.classList.add('open');

        const catHeader = document.createElement('div');
        catHeader.className = 'accordion-header';
        catHeader.innerHTML = `${catName} <span class="accordion-icon">▼</span>`;
        catHeader.onclick = () => {
            catDiv.classList.toggle('open');
            if (catDiv.classList.contains('open')) openAccordions.add(catId);
            else openAccordions.delete(catId);
        };
        catDiv.appendChild(catHeader);

        const catContent = document.createElement('div');
        catContent.className = 'accordion-content';

        Object.keys(subCats).forEach(subCatName => {
            const subSubjects = subCats[subCatName];
            if (subSubjects.length === 0) return;

            let containerToAppend = catContent;

            // If it's Especialitat and has subcategories
            if (catName === "Especialitat" && subCatName !== "General") {
                const subCatId = `subcat-${catName}-${subCatName}`;
                const subCatDiv = document.createElement('div');
                subCatDiv.className = 'accordion-subcategory';
                if (openAccordions.has(subCatId)) subCatDiv.classList.add('open');

                const subCatHeader = document.createElement('div');
                subCatHeader.className = 'accordion-header sub-header';
                subCatHeader.innerHTML = `${subCatName} <span class="accordion-icon">▼</span>`;
                subCatHeader.onclick = (e) => {
                    e.stopPropagation();
                    subCatDiv.classList.toggle('open');
                    if (subCatDiv.classList.contains('open')) openAccordions.add(subCatId);
                    else openAccordions.delete(subCatId);
                };
                subCatDiv.appendChild(subCatHeader);

                const subCatContent = document.createElement('div');
                subCatContent.className = 'accordion-content';
                subCatDiv.appendChild(subCatContent);
                catContent.appendChild(subCatDiv);

                containerToAppend = subCatContent;
            }

            subSubjects.forEach(subject => {
                const isSubjectSelected = selectedSubjects.includes(subject.name);

                const node = document.createElement('div');
                node.className = 'tree-subject-node';

                const subLabel = document.createElement('label');
                subLabel.className = `tree-label subject-label ${isSubjectSelected ? 'active' : ''}`;
                subLabel.innerHTML = `
                    <input type="checkbox" onchange="toggleSubject('${subject.name}')" ${isSubjectSelected ? 'checked' : ''}>
                    ${subject.name}
                `;
                node.appendChild(subLabel);

                if (isSubjectSelected) {
                const groupsContainer = document.createElement('div');
                groupsContainer.className = 'tree-groups-grid'; 

                // Inject dynamic subject color as inline border-left to label 
                // so the user knows what color it has in the calendar
                if (subjectColors[subject.name]) {
                    subLabel.style.borderLeft = `4px solid ${subjectColors[subject.name].replace('0.8)', '1)')}`;
                    subLabel.style.paddingLeft = '5px';
                }

                const subjGroups = selectedGroups[subject.name] || [];
                    const allGroups = Object.keys(subject.groups).sort((a, b) => parseInt(a) - parseInt(b));

                    // Organize by decades (rows)
                    const decades = {};
                    allGroups.forEach(gid => {
                        const num = parseInt(gid);
                        const decade = Math.floor(num / 10) * 10;
                        if (!decades[decade]) decades[decade] = [];
                        decades[decade].push(gid);
                    });

                    Object.keys(decades).sort().forEach(dec => {
                        const rowDiv = document.createElement('div');
                        rowDiv.className = 'tree-group-row';

                        decades[dec].forEach(gid => {
                            const isGroupSelected = subjGroups.includes(gid);

                            const groupLabel = document.createElement('label');
                            groupLabel.className = `tree-label group-label ${isGroupSelected ? 'active' : ''}`;
                            groupLabel.innerHTML = `
                                <input type="checkbox" onchange="toggleGroup('${subject.name}', '${gid}')" ${isGroupSelected ? 'checked' : ''}>
                                ${gid}
                            `;
                            rowDiv.appendChild(groupLabel);
                        });
                        groupsContainer.appendChild(rowDiv);
                    });

                    node.appendChild(groupsContainer);
                }

                containerToAppend.appendChild(node);
            });
        });

        catDiv.appendChild(catContent);
        subjectList.appendChild(catDiv);
    });
}

window.toggleSubject = (subjectName) => {
    if (selectedSubjects.includes(subjectName)) {
        selectedSubjects = selectedSubjects.filter(s => s !== subjectName);
        delete selectedGroups[subjectName]; // clear groups when subject is unselected
        delete subjectColors[subjectName]; // free up the color
    } else {
        selectedSubjects.push(subjectName);
        if (!selectedGroups[subjectName]) selectedGroups[subjectName] = [];
        
        // --- DYNAMIC COLOR ASSIGNMENT ---
        const usedColors = Object.values(subjectColors);
        const availableColors = PALETTE.filter(c => !usedColors.includes(c));
        
        if (availableColors.length > 0) {
            subjectColors[subjectName] = availableColors[0];
        } else {
            subjectColors[subjectName] = PALETTE[Math.floor(Math.random() * PALETTE.length)];
        }
    }
    renderSubjectList(subjectSearch.value);
    updateTimetable();
    saveState();
};

window.toggleGroup = (subjectName, groupId) => {
    if (!selectedGroups[subjectName]) selectedGroups[subjectName] = [];

    const subjGroups = selectedGroups[subjectName];
    const subject = SUBJECTS.find(s => s.name === subjectName);
    const allGroups = Object.keys(subject.groups);

    const num = parseInt(groupId);
    const isMultipleOf10 = (num % 10 === 0);
    const baseDecade = Math.floor(num / 10) * 10;

    const isCurrentlySelected = subjGroups.includes(groupId);

    if (isCurrentlySelected) {
        // Deselect logic
        const idx = subjGroups.indexOf(groupId);
        subjGroups.splice(idx, 1);

        if (isMultipleOf10) {
            // Unselect all in this decade
            for (let i = baseDecade + 1; i <= baseDecade + 9; i++) {
                const s = i.toString();
                const sIdx = subjGroups.indexOf(s);
                if (sIdx > -1) subjGroups.splice(sIdx, 1);
            }
        }
    } else {
        // Select logic
        subjGroups.push(groupId);

        if (isMultipleOf10) {
            // Select all existing groups in this decade
            allGroups.forEach(g => {
                const gNum = parseInt(g);
                if (gNum > baseDecade && gNum < baseDecade + 10 && !subjGroups.includes(g)) {
                    subjGroups.push(g);
                }
            });
        } else {
            // Also select the decade base (e.g. 40)
            const baseStr = baseDecade.toString();
            if (allGroups.includes(baseStr) && !subjGroups.includes(baseStr)) {
                subjGroups.push(baseStr);
            }
        }
    }

    renderSubjectList(subjectSearch.value);
    updateTimetable();
    saveState();
};

function renderGrid() {
    timetableGrid.innerHTML = "";

    // Top-left empty corner
    timetableGrid.appendChild(createGridCell("", "grid-header"));

    // Day headers
    DAYS_NAMES.forEach(day => {
        timetableGrid.appendChild(createGridCell(day, "grid-header"));
    });

    // Rows
    for (let h = 8; h < 22; h++) {
        // Time label
        timetableGrid.appendChild(createGridCell(`${h}:00`, "time-label"));

        // Cells for each day
        for (let d = 0; d < 5; d++) {
            const cell = createGridCell("", "grid-cell");
            cell.dataset.time = h;
            cell.dataset.day = d;
            timetableGrid.appendChild(cell);
        }
    }
}

function createGridCell(content, className) {
    const div = document.createElement('div');
    div.className = className;
    div.innerText = content;
    return div;
}

function updateTimetable() {
    // Clear existing slots
    document.querySelectorAll('.slot').forEach(s => s.remove());

    let totalHours = 0;
    let subjectCount = 0;
    let daySchedules = [[], [], [], [], []];
    let allRenderSlots = { 0: [], 1: [], 2: [], 3: [], 4: [] };

    // Collect all slots
    Object.entries(selectedGroups).forEach(([subjectName, groupIds]) => {
        if (!groupIds || groupIds.length === 0) return;

        const subject = SUBJECTS.find(s => s.name === subjectName);
        if (!subject) return;

        groupIds.forEach(groupId => {
            const slots = subject.groups[groupId];
            if (!slots) return;

            subjectCount++;

            slots.forEach(slot => {
                const dayIdx = DAYS_MAP[slot.day];
                const startH = slot.start;
                const endH = slot.end;
                const duration = endH - startH;
                totalHours += duration;

                if (dayIdx >= 0 && dayIdx < 5) {
                    daySchedules[dayIdx].push({ start: startH, end: endH });
                    allRenderSlots[dayIdx].push({
                        subjectName, groupId, type: slot.type,
                        start: startH, end: endH, duration: duration, color: subjectColors[subjectName]
                    });
                }
            });
        });
    });

    // Process overlaps and render
    Object.keys(allRenderSlots).forEach(dayIdx => {
        let daySlots = allRenderSlots[dayIdx];
        if (daySlots.length === 0) return;

        // Sort by start time
        daySlots.sort((a, b) => a.start - b.start);

        // Find overlapping clusters
        let clusters = [];
        let currentCluster = [];
        let clusterEnd = -1;

        daySlots.forEach(slot => {
            if (currentCluster.length === 0) {
                currentCluster.push(slot);
                clusterEnd = slot.end;
            } else if (slot.start < clusterEnd) {
                currentCluster.push(slot);
                clusterEnd = Math.max(clusterEnd, slot.end);
            } else {
                clusters.push(currentCluster);
                currentCluster = [slot];
                clusterEnd = slot.end;
            }
        });
        if (currentCluster.length > 0) clusters.push(currentCluster);

        // Process each cluster
        clusters.forEach(cluster => {
            let columns = [];

            cluster.forEach(slot => {
                let placed = false;
                for (let i = 0; i < columns.length; i++) {
                    let lastInCol = columns[i][columns[i].length - 1];
                    if (slot.start >= lastInCol.end) {
                        columns[i].push(slot);
                        slot.colIdx = i;
                        placed = true;
                        break;
                    }
                }
                if (!placed) {
                    slot.colIdx = columns.length;
                    columns.push([slot]);
                }
            });

            let maxCols = columns.length;

            cluster.forEach(slot => {
                const targetCell = document.querySelector(`.grid-cell[data-time="${Math.floor(slot.start)}"][data-day="${dayIdx}"]`);
                if (targetCell) {
                    const slotDiv = document.createElement('div');
                    slotDiv.className = 'slot';
                    slotDiv.style.backgroundColor = slot.color;

                    const topOffset = (slot.start % 1) * 100;
                    const height = slot.duration * 100;

                    slotDiv.style.top = `${topOffset}%`;
                    slotDiv.style.height = `calc(${height}% - 2px)`;

                    // Width and Left for overlapping
                    const leftPercent = (slot.colIdx / maxCols) * 100;
                    const widthPercent = (100 / maxCols);

                    slotDiv.style.left = `calc(${leftPercent}% + 2px)`;
                    slotDiv.style.width = `calc(${widthPercent}% - 4px)`;
                    slotDiv.style.right = 'auto'; // override default CSS

                    slotDiv.innerHTML = `
                        <span class="slot-name">${slot.subjectName}</span>
                        <span class="slot-group">Grup ${slot.groupId} ${slot.type ? `(${slot.type})` : ''}</span>
                    `;

                    targetCell.appendChild(slotDiv);
                }
            });
        });
    });

    // Stats
    statCount.innerText = subjectCount;
    statHours.innerText = `${totalHours}h`;
    statGaps.innerText = `${calculateGaps(daySchedules)}h`;
}

function calculateGaps(daySchedules) {
    let totalGaps = 0;
    daySchedules.forEach(day => {
        if (day.length < 2) return;
        day.sort((a, b) => a.start - b.start);
        for (let i = 0; i < day.length - 1; i++) {
            const gap = day[i + 1].start - day[i].end;
            if (gap > 0) totalGaps += gap;
        }
    });
    return totalGaps;
}

// --- PERSISTENCE ---
function saveState() {
    const state = {
        version: 6, // Increment to invalidate cache
        selectedSubjects,
        selectedGroups,
        subjectColors,
        comments: userComments.value,
        cachedSubjects: SUBJECTS // Cache fetched subjects
    };
    localStorage.setItem('fibplan_state', JSON.stringify(state));
}

function loadState() {
    const saved = localStorage.getItem('fibplan_state');
    if (saved) {
        try {
            const state = JSON.parse(saved);
            selectedSubjects = state.selectedSubjects || [];
            selectedGroups = state.selectedGroups || {};
            subjectColors = state.subjectColors || {};

            // Migrate old state if necessary
            Object.keys(selectedGroups).forEach(key => {
                if (typeof selectedGroups[key] === 'string') {
                    selectedGroups[key] = [selectedGroups[key]];
                    if (!selectedSubjects.includes(key)) {
                        selectedSubjects.push(key);
                    }
                }
            });

            userComments.value = state.comments || "";

            if (state.version === 5 && state.cachedSubjects && state.cachedSubjects.length > 0) {
                SUBJECTS = state.cachedSubjects;
            } else {
                // Invalidate old cache
                SUBJECTS = [];
            }
        } catch (e) {
            console.error("Failed to load state", e);
        }
    }
}

function clearAll() {
    if (confirm("Segur que vols esborrar tot l'horari?")) {
        selectedSubjects = [];
        selectedGroups = {};
        userComments.value = "";
        saveState();
        renderSubjectList();
        updateTimetable();
    }
}

// Mobile Day Selector Logic
window.setMobileDay = (dayIdx) => {
    const grid = document.getElementById('timetable-grid');
    const tabs = document.querySelectorAll('.day-tab');
    
    // Update grid class
    for (let i = 0; i < 5; i++) {
        grid.classList.remove(`show-day-${i}`);
    }
    grid.classList.add(`show-day-${dayIdx}`);
    
    // Update active tab
    tabs.forEach((tab, i) => {
        tab.classList.toggle('active', i === dayIdx);
    });
};

// Initialize mobile view with Monday
document.addEventListener('DOMContentLoaded', () => {
    const grid = document.getElementById('timetable-grid');
    if (grid) grid.classList.add('show-day-0');
});

function exportToImage() {
    alert("Funcionalitat d'exportació en desenvolupament. Pots fer una captura de pantalla de moment!");
}

init();
