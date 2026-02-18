const socket = io();

const term = new Terminal({
    theme: {
        background: '#0a0a0a',
        foreground: '#cccccc',
        cursor: '#ffffff'
    },
    fontFamily: 'Menlo, Monaco, "Courier New", monospace',
    fontSize: 13,
    lineHeight: 1.2,
    cursorBlink: true,
    convertEol: true
});
const fitAddon = new FitAddon.FitAddon();
term.loadAddon(fitAddon);
term.open(document.getElementById('terminal-container'));

setTimeout(() => fitAddon.fit(), 100);
window.addEventListener('resize', () => fitAddon.fit());

socket.on('connect', () => {
    updateConnectionStatus(true);
});

socket.on('disconnect', () => {
    updateConnectionStatus(false);
});

socket.on('console-output', data => {
    term.write(data);
});

socket.on('console-history', history => {
    term.reset();
    term.write(history);
});

let command = '';
term.onData(e => {
    switch (e) {
        case '\r':
            term.write('\r\n');
            if (command.length > 0) {
                socket.emit('console-input', command);
                command = '';
            }
            break;
        case '\u007F':
            if (command.length > 0) {
                term.write('\b \b');
                command = command.substr(0, command.length - 1);
            }
            break;
        default:
            if (e >= String.fromCharCode(0x20) && e <= String.fromCharCode(0x7E) || e >= '\u00a0') {
                command += e;
                term.write(e);
            }
    }
});

const commonChartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    scales: {
        x: { display: false },
        y: {
            beginAtZero: true,
            grid: { color: 'rgba(255,255,255,0.1)' },
            ticks: { color: '#aaa', font: { family: 'monospace', size: 10 } }
        }
    },
    plugins: { legend: { display: false } },
    elements: { point: { radius: 0 }, line: { tension: 0.2, borderWidth: 2 } },
    interaction: {
        mode: 'nearest',
        axis: 'x',
        intersect: false
    }
};

const initialLabels = Array(60).fill('');

const cpuChart = new Chart(document.getElementById('cpuChart').getContext('2d'), {
    type: 'line',
    data: { labels: [...initialLabels], datasets: [{ label: 'CPU %', data: Array(60).fill(0), borderColor: '#10b981', backgroundColor: 'rgba(16, 185, 129, 0.1)', fill: true }] },
    options: { ...commonChartOptions, scales: { ...commonChartOptions.scales, y: { ...commonChartOptions.scales.y, max: 100 } } }
});

const ramChart = new Chart(document.getElementById('ramChart').getContext('2d'), {
    type: 'line',
    data: { labels: [...initialLabels], datasets: [{ label: 'RAM (MB)', data: Array(60).fill(0), borderColor: '#3b82f6', backgroundColor: 'rgba(59, 130, 246, 0.1)', fill: true }] },
    options: commonChartOptions
});

const tpsChart = new Chart(document.getElementById('tpsChart').getContext('2d'), {
    type: 'line',
    data: { labels: [...initialLabels], datasets: [{ label: 'TPS', data: Array(60).fill(20), borderColor: '#a855f7', backgroundColor: 'rgba(168, 85, 247, 0.1)', fill: true }] },
    options: { ...commonChartOptions, scales: { ...commonChartOptions.scales, y: { ...commonChartOptions.scales.y, max: 20, min: 0 } } }
});

const networkChart = new Chart(document.getElementById('networkChart').getContext('2d'), {
    type: 'line',
    data: { labels: [...initialLabels], datasets: [{ label: 'Network', data: Array(60).fill(0), borderColor: '#f59e0b', backgroundColor: 'rgba(245, 158, 11, 0.1)', fill: true }] },
    options: commonChartOptions
});

const diskChart = new Chart(document.getElementById('diskChart').getContext('2d'), {
    type: 'line',
    data: { labels: [...initialLabels], datasets: [{ label: 'Disk (GB)', data: Array(60).fill(0), borderColor: '#8b5cf6', backgroundColor: 'rgba(139, 92, 246, 0.1)', fill: true }] },
    options: commonChartOptions
});

const versionTypeSelect = document.getElementById('version-type');
const versionSelect = document.getElementById('version-select');
const installBtn = document.getElementById('btn-install');
const settingsModal = document.getElementById('settings-modal');

async function loadVersions() {
    if (!versionSelect) return;
    versionSelect.innerHTML = '<option>Loading...</option>';
    if (installBtn) installBtn.disabled = true;
    try {
        const type = versionTypeSelect ? versionTypeSelect.value : 'paper';
        const res = await fetch(`/api/versions?type=${type}`);
        const versions = await res.json();

        versionSelect.innerHTML = '';
        versions.forEach(v => {
            const opt = document.createElement('option');
            opt.value = v;
            opt.innerText = v;
            versionSelect.appendChild(opt);
        });
        if (installBtn) installBtn.disabled = false;
    } catch (e) {
        versionSelect.innerHTML = '<option>Error</option>';
        console.error(e);
    }
}

if (versionTypeSelect) {
    versionTypeSelect.addEventListener('change', loadVersions);
}

const dispSftpUser = document.getElementById('disp-sftp-user');
const dispSftpHost = document.getElementById('disp-sftp-host');
const dispSftpPass = document.getElementById('disp-sftp-pass');

const btnSettings = document.getElementById('btn-settings');
if (btnSettings) {
    btnSettings.addEventListener('click', async () => {
        settingsModal.classList.remove('hidden');
        setTimeout(() => {
            settingsModal.classList.remove('opacity-0');
            settingsModal.querySelector('div').classList.remove('scale-95');
            settingsModal.querySelector('div').classList.add('scale-100');
        }, 10);
        loadVersions();

        try {
            const [resConfig, resSettings] = await Promise.all([
                fetch('/api/config'),
                fetch('/api/settings')
            ]);

            if (resConfig.ok) {
                const conf = await resConfig.json();
                if (dispSftpUser) dispSftpUser.innerText = conf.sftpUser || 'error';
                if (dispSftpHost) dispSftpHost.innerText = window.location.hostname;
                if (dispSftpPass && conf.sftpPass) dispSftpPass.innerText = conf.sftpPass;
            }

            if (resSettings.ok) {
                const settings = await resSettings.json();
                const ipInput = document.getElementById('input-ip');
                const ramInput = document.getElementById('input-ram');
                const portInput = document.getElementById('input-port');

                if (ipInput) ipInput.value = settings.serverIp || 'localhost';
                if (ramInput) ramInput.value = settings.ram || 4096;
                if (portInput) portInput.value = settings.port || 25565;
            }
        } catch (e) { }
    });
}

const btnCloseSettings = document.getElementById('btn-close-settings');
if (btnCloseSettings) {
    btnCloseSettings.addEventListener('click', () => {
        settingsModal.classList.add('opacity-0');
        settingsModal.querySelector('div').classList.add('scale-95');
        settingsModal.querySelector('div').classList.remove('scale-100');
        setTimeout(() => settingsModal.classList.add('hidden'), 300);
    });
}

const btnLogout = document.getElementById('btn-logout');
if (btnLogout) {
    btnLogout.addEventListener('click', async () => {
        if (confirm('Are you sure you want to logout?')) {
            try {
                await fetch('/logout', { method: 'POST' });
                window.location.reload();
            } catch (e) { window.location.reload(); }
        }
    });
}

const installModal = document.getElementById('install-modal');
const installStatus = document.getElementById('install-status-text');
const installBar = document.getElementById('install-progress-bar');
const installLog = document.getElementById('install-log');

if (installBtn) {
    installBtn.addEventListener('click', async () => {
        if (!confirm('This will wipe existing server data. Are you sure?')) return;

        const version = versionSelect.value;
        const type = versionTypeSelect.value;

        if (settingsModal) settingsModal.classList.add('hidden');
        installModal.classList.remove('hidden');
        setTimeout(() => installModal.classList.remove('opacity-0'), 10);

        installLog.innerHTML = '';
        installBar.style.width = '0%';
        installStatus.innerText = 'Initializing...';
        installStatus.className = 'text-gray-400 text-sm mb-6 text-center';

        try {
            const res = await fetch('/api/install', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ version, type })
            });

            if (res.ok) {
                setTimeout(() => window.location.reload(), 2000);
            } else {
                installStatus.innerText = 'Request Failed';
            }
        } catch (e) {
            installStatus.innerText = 'Error: ' + e.message;
        }
    });
}

socket.on('install-progress', data => {
    if (data.error) {
        installStatus.innerText = 'Error: ' + data.error;
        installStatus.className = 'text-red-500 text-sm mb-6 text-center';
        setTimeout(() => {
            installModal.classList.add('opacity-0');
            setTimeout(() => installModal.classList.add('hidden'), 300);
        }, 3000);
        return;
    }

    if (data.message) {
        installStatus.innerText = data.message;
        const p = document.createElement('div');
        p.innerText = `> ${data.message}`;
        installLog.appendChild(p);
        installLog.scrollTop = installLog.scrollHeight;
    }

    if (data.percent) {
        installBar.style.width = data.percent + '%';
    }
});

const inputNewPass = document.getElementById('input-new-pass');
const inputNewSftp = document.getElementById('input-new-sftp');
const saveSettingsBtn = document.getElementById('btn-save-settings');

if (saveSettingsBtn) {
    saveSettingsBtn.addEventListener('click', async () => {
        const ipInput = document.getElementById('input-ip');
        const ramInput = document.getElementById('input-ram');
        const portInput = document.getElementById('input-port');

        const serverIp = ipInput ? ipInput.value : 'localhost';
        const ram = ramInput ? ramInput.value : '4096';
        const port = portInput ? portInput.value : '25565';

        const newPass = inputNewPass ? inputNewPass.value : '';
        const newSftp = inputNewSftp ? inputNewSftp.value : '';


        try {
            await fetch('/api/settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ serverIp, ram, port })
            });
        } catch (e) { console.error('Failed to save settings', e); }

        if (newPass || newSftp) {
            if (!confirm('You are changing credentials. You will need to login again. Continue?')) return;
            try {
                const body = {
                    adminPass: newPass,
                    sftpPass: newSftp
                };

                await fetch('/api/change-password', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body)
                });
            } catch (e) { alert('Failed to update passwords'); }
        }


        await fetch('/api/start', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ram, port })
        });

        window.location.reload();
    });
}

const tpsVal = document.getElementById('tps-val');

socket.on('tps', val => {
    if (tpsVal) {
        tpsVal.innerText = val.toFixed(1);
        if (val < 18) tpsVal.className = tpsVal.className.replace('text-white', 'text-yellow-400');
        if (val < 10) tpsVal.className = tpsVal.className.replace('text-yellow-400', 'text-red-500');
    }
    removeFirstAndPush(tpsChart, val);
});

socket.on('server-stats', stats => {
    const cpuVal = document.getElementById('cpu-val');
    const ramVal = document.getElementById('ram-val');
    const diskVal = document.getElementById('disk-val');
    const netVal = document.getElementById('network-val');

    if (cpuVal) cpuVal.innerText = stats.cpu + '%';
    if (ramVal) ramVal.innerText = stats.memory.toFixed(1) + ' MB';
    if (diskVal && stats.disk) diskVal.innerText = stats.disk;
    if (netVal && stats.network) netVal.innerText = stats.network;

    removeFirstAndPush(cpuChart, stats.cpu);
    removeFirstAndPush(ramChart, stats.memory);
});

socket.on('stats-history', history => {
    const cpuData = history.map(h => h.cpu);
    const ramData = history.map(h => h.memory);

    while (cpuData.length < 60) cpuData.unshift(0);
    while (ramData.length < 60) ramData.unshift(0);

    cpuChart.data.datasets[0].data = cpuData;
    ramChart.data.datasets[0].data = ramData;
    cpuChart.update();
    ramChart.update();
});

function removeFirstAndPush(chart, value) {
    if (!chart) return;
    chart.data.datasets[0].data.shift();
    chart.data.datasets[0].data.push(value);
    chart.update('none');
}

socket.on('player-list', data => {
    const countSpan = document.getElementById('player-count');
    const playerList = document.getElementById('player-grid');

    if (countSpan) countSpan.innerText = `${data.online}/${data.max}`;

    if (playerList) {
        if (data.list && data.list.length > 0) {
            playerList.innerHTML = '';
            data.list.forEach(player => {
                const identifier = player.uuid || player.name;
                const headUrl = `https://api.mineatar.io/face/${identifier}`;
                const div = document.createElement('div');
                div.className = 'flex flex-col items-center p-2 bg-white/5 rounded hover:bg-white/10 transition cursor-pointer group relative';
                div.innerHTML = `
                    <div class="absolute -top-8 left-1/2 -translate-x-1/2 bg-black/80 text-white text-[10px] px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition pointer-events-none whitespace-nowrap z-20 border border-white/10">
                        ${player.name}
                    </div>
                    <img src="${headUrl}" class="w-8 h-8 rounded mb-1 shadow-sm group-hover:scale-110 transition">
                    <span class="text-[10px] text-gray-300 truncate w-full text-center opacity-0 group-hover:opacity-100 transition-opacity absolute bottom-0 bg-black/80 rounded px-1">${player.name}</span>
                `;
                playerList.appendChild(div);
            });
        } else {
            playerList.innerHTML = '<div class="col-span-4 text-center mt-10 opacity-30 text-sm italic">No players online</div>';
        }
    }
});

function updateConnectionStatus(connected) {
    const el = document.getElementById('connection-status');
    if (el) {
        if (connected) {
            el.innerText = 'Connected';
            el.className = 'px-3 py-1 rounded-full text-xs font-mono bg-green-500/20 text-green-300 border border-green-500/30 transition-all';
        } else {
            el.innerText = 'Disconnected';
            el.className = 'px-3 py-1 rounded-full text-xs font-mono bg-red-500/20 text-red-300 border border-red-500/30 transition-all';
        }
    }
}

function updateServerState(status) {
    const text = document.getElementById('server-state-text');
    const ring = document.getElementById('status-ring');
    const icon = document.getElementById('status-icon');
    const btnStart = document.getElementById('btn-start');
    const btnStop = document.getElementById('btn-stop');

    if (!text || !ring || !icon || !btnStart || !btnStop) return;

    if (status === 'ONLINE') {
        text.innerText = 'ONLINE';
        text.className = 'text-2xl font-bold text-green-400 tracking-wide drop-shadow-[0_0_10px_rgba(74,222,128,0.5)]';
        ring.className = 'w-24 h-24 rounded-full border-4 border-green-500 flex items-center justify-center transition-all duration-500 shadow-[0_0_30px_rgba(34,197,94,0.4)]';
        icon.className = 'h-10 w-10 text-green-400';

        btnStart.disabled = true;
        btnStop.disabled = false;
    } else if (status === 'OFFLINE') {
        text.innerText = 'OFFLINE';
        text.className = 'text-2xl font-bold text-gray-400 tracking-wide';
        ring.className = 'w-24 h-24 rounded-full border-4 border-gray-600 flex items-center justify-center transition-all duration-500 shadow-none';
        icon.className = 'h-10 w-10 text-gray-500';

        btnStart.disabled = false;
        btnStop.disabled = true;
    } else {
        text.innerText = status;
        text.className = 'text-2xl font-bold text-yellow-400 tracking-wide animate-pulse';
        ring.className = 'w-24 h-24 rounded-full border-4 border-yellow-500 flex items-center justify-center transition-all duration-500 animate-spin-slow shadow-[0_0_20px_rgba(234,179,8,0.4)]';
        icon.className = 'h-10 w-10 text-yellow-400';

        btnStart.disabled = true;
        btnStop.disabled = true;
    }
}

const btnStart = document.getElementById('btn-start');
if (btnStart) {
    btnStart.onclick = async () => {

        let ram = '4096';
        let port = '25565';
        try {
            const s = await (await fetch('/api/settings')).json();
            if (s.ram) ram = s.ram;
            if (s.port) port = s.port;
        } catch (e) { }

        updateServerState('STARTING...');
        await fetch('/api/start', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ram, port })
        });
    };
}

const btnStop = document.getElementById('btn-stop');
if (btnStop) {
    btnStop.onclick = async () => {
        updateServerState('STOPPING...');
        await fetch('/api/stop', { method: 'POST' });
    };
}

async function checkStatus() {
    try {
        const res = await fetch('/api/status');
        const data = await res.json();
        updateServerState(data.status);
    } catch (e) {
        console.error(e);
    }
}
setInterval(checkStatus, 3000);
checkStatus();

const btnFiles = document.getElementById('btn-files');
const sftpModal = document.getElementById('sftp-modal');
const btnCloseSftp = document.getElementById('btn-close-sftp');
const sftpFrame = document.getElementById('sftp-frame');
const sftpLoader = document.getElementById('sftp-loader');
const btnSftpExternal = document.getElementById('btn-sftp-external');

if (btnFiles && sftpModal) {
    btnFiles.addEventListener('click', () => {
        // Construct SFTP URL assuming port 8080 on the same hostname
        const protocol = window.location.protocol;
        const hostname = window.location.hostname;
        const sftpUrl = `${protocol}//${hostname}:8080/web/client`;

        sftpFrame.src = sftpUrl;
        btnSftpExternal.href = sftpUrl;

        sftpModal.classList.remove('hidden');
        setTimeout(() => {
            sftpModal.classList.remove('opacity-0');
            sftpModal.querySelector('div').classList.remove('scale-95');
            sftpModal.querySelector('div').classList.add('scale-100');
        }, 10);

        sftpLoader.classList.remove('hidden');
        sftpFrame.onload = () => {
            sftpLoader.classList.add('hidden');
        };
    });

    const closeSftp = () => {
        sftpModal.classList.add('opacity-0');
        sftpModal.querySelector('div').classList.add('scale-95');
        sftpModal.querySelector('div').classList.remove('scale-100');
        setTimeout(() => {
            sftpModal.classList.add('hidden');
            sftpFrame.src = ''; // Clear iframe to stop resources
        }, 300);
    };

    btnCloseSftp.addEventListener('click', closeSftp);

    // Close on click outside
    sftpModal.addEventListener('click', (e) => {
        if (e.target === sftpModal) closeSftp();
    });
}
