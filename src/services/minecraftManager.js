const Docker = require('dockerode');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

class MinecraftManager {
    async getVersions(type = 'paper') {
        try {
            if (type === 'vanilla') {
                const res = await axios.get('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json');
                return res.data.versions
                    .filter(v => v.type === 'release')
                    .map(v => v.id);
            } else {
                const res = await axios.get('https://api.papermc.io/v2/projects/paper');
                return res.data.versions.reverse();
            }
        } catch (e) {
            console.error('Error fetching versions:', e.message);
            return [];
        }
    }

    async installVersion(version, type = 'paper') {
        const emitProgress = (msg, percent) => {
            if (this.io) this.io.emit('install-progress', { message: msg, percent });
            console.log(`[Install] ${msg}`);
        };

        emitProgress(`Initializing ${type} version ${version} install...`, 10);
        const dataDir = '/data';
        const jarPath = path.join(dataDir, 'server.jar');
        let downloadUrl;

        try {
            if (type === 'vanilla') {
                emitProgress('Fetching Vanilla manifest...', 20);
                const manifest = await axios.get('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json');
                const versionData = manifest.data.versions.find(v => v.id === version);
                if (!versionData) throw new Error('Version not found');

                const packageRes = await axios.get(versionData.url);
                downloadUrl = packageRes.data.downloads.server.url;
            } else {
                emitProgress('Fetching PaperMC builds...', 20);
                const buildsRes = await axios.get(`https://api.papermc.io/v2/projects/paper/versions/${version}/builds`);
                const builds = buildsRes.data.builds;
                builds.sort((a, b) => a.build - b.build);
                const latestBuild = builds[builds.length - 1];
                downloadUrl = `https://api.papermc.io/v2/projects/paper/versions/${version}/builds/${latestBuild.build}/downloads/${latestBuild.downloads.application.name}`;
            }

            emitProgress(`Downloading core from ${downloadUrl}...`, 40);
            const writer = fs.createWriteStream(jarPath);
            const response = await axios({
                url: downloadUrl,
                method: 'GET',
                responseType: 'stream'
            });

            const totalLength = response.headers['content-length'];

            response.data.pipe(writer);

            await new Promise((resolve, reject) => {
                let downloaded = 0;
                response.data.on('data', (chunk) => {
                    downloaded += chunk.length;
                    if (totalLength) {
                        const percent = 40 + Math.round((downloaded / totalLength) * 40);
                    }
                });
                writer.on('finish', resolve);
                writer.on('error', reject);
            });

            emitProgress('Download complete. Configuring environment...', 85);
            await this.updateJavaImage(version);

            emitProgress('Installation finished! Restarting server...', 100);
            return true;
        } catch (e) {
            console.error('Install error:', e.message);
            if (this.io) this.io.emit('install-progress', { error: e.message });
            throw e;
        }
    }

    async updateJavaImage(version) {
        let javaTag = '8-jre';
        const parts = version.split('.').map(Number);
        const minor = parts[1];
        const patch = parts[2] || 0;

        if (minor >= 20 && (minor > 20 || patch >= 5)) {
            javaTag = '21-jre';
        } else if (minor >= 18) {
            javaTag = '17-jre';
        } else if (minor === 17) {
            javaTag = '17-jre';
        } else if (minor >= 8) {
            javaTag = '8-jre';
        }

        this.image = `eclipse-temurin:${javaTag}`;
        if (this.io) this.io.emit('install-progress', { message: `Selected Docker image: ${this.image}`, percent: 90 });
    }
    constructor(io) {
        const socketPath = process.env.DOCKER_SOCKET || '/var/run/docker.sock';
        this.docker = new Docker({ socketPath });
        this.containerName = 'minecraft-server';
        this.image = 'eclipse-temurin:21-jre';
        this.io = io;
        this.container = null;
        this.stream = null;
        this.logBuffer = [];
        this.maxLogLines = 100;
        this.statsHistory = [];
        this.statsHistory = [];
        this.maxStatsPoints = 60;
        this.uuidCache = new Map();

        this.io.on('connection', (socket) => {
            socket.emit('console-history', this.logBuffer.join(''));
            socket.emit('stats-history', this.statsHistory);

            socket.on('console-input', (command) => {
                if (this.stream) {
                    this.writeToStdin(command);
                } else {
                    console.warn('Console stream not available. Is server running?');
                }
            });
        });

        this.diskUsage = 'Calculating...';

        const getAllFiles = (dirPath, arrayOfFiles) => {
            let files = fs.readdirSync(dirPath);
            arrayOfFiles = arrayOfFiles || [];
            files.forEach((file) => {
                if (fs.statSync(dirPath + "/" + file).isDirectory()) {
                    arrayOfFiles = getAllFiles(dirPath + "/" + file, arrayOfFiles);
                } else {
                    arrayOfFiles.push(path.join(dirPath, "/", file));
                }
            });
            return arrayOfFiles;
        };

        const getTotalSize = (dirPath) => {
            const arrayOfFiles = getAllFiles(dirPath);
            let totalSize = 0;
            arrayOfFiles.forEach((filePath) => {
                totalSize += fs.statSync(filePath).size;
            });
            return totalSize;
        };

        const checkDiskUsage = () => {
            try {
                if (fs.existsSync('/data')) {
                    const bytes = getTotalSize('/data');
                    if (bytes > 1024 * 1024 * 1024) {
                        this.diskUsage = (bytes / 1024 / 1024 / 1024).toFixed(2) + ' GB';
                    } else {
                        this.diskUsage = (bytes / 1024 / 1024).toFixed(2) + ' MB';
                    }
                } else {
                    this.diskUsage = 'Unavailable';
                }
            } catch (e) {
                console.error('Disk calc error:', e.message);
                this.diskUsage = 'Error';
            }
        };

        setInterval(checkDiskUsage, 10000);
        setTimeout(checkDiskUsage, 1000);
    }

    async resolveUUID(name) {
        if (this.uuidCache.has(name)) return this.uuidCache.get(name);

        try {
            const res = await axios.get(`https://api.mojang.com/users/profiles/minecraft/${name}`);
            if (res.status === 200 && res.data && res.data.id) {
                const uuid = res.data.id;
                this.uuidCache.set(name, uuid);
                return uuid;
            }
        } catch (e) {
        }
        return null;
    }

    async processPlayerList(current, max, names) {
        const players = await Promise.all(names.map(async (name) => {
            const uuid = await this.resolveUUID(name);
            return { name, uuid };
        }));
        this.io.emit('player-list', { online: current, max, list: players });
    }

    writeToStdin(data) {
        if (this.stream && data) {
            if (typeof data === 'object') {
                if (data.stream && data.stdin && data.hijack) return;
                try { data = data.toString(); } catch (e) { return; }
            }
            this.stream.write(data + '\n', (err) => {
                if (err) console.error('Write callback error:', err);
            });
        }
    }

    async init() {
        const dataDir = '/data';
        const eulaPath = path.join(dataDir, 'eula.txt');

        try {
            if (!fs.existsSync(dataDir)) {
                fs.mkdirSync(dataDir, { recursive: true });
            }

            if (!fs.existsSync(eulaPath)) {
                fs.writeFileSync(eulaPath, 'eula=true\n');
                console.log('eula.txt created.');
            }
        } catch (err) {
            console.error('Error initializing data directory:', err.message);
        }

        this.container = this.docker.getContainer(this.containerName);
        try {
            const data = await this.container.inspect();
            console.log('Found existing Minecraft container.');
            if (data.State.Running) {
                console.log('Container is running, attaching to logs and stats...');
                this.attachToLogs();
                this.startStats();
            }
        } catch (e) {
            if (e.statusCode === 404) {
                console.log('Minecraft container not found. It will be created on start.');
                this.container = null;
            }
        }
    }

    async startServer(options = {}) {
        if (this.isStarting) {
            console.log('Server is already starting, ignoring request.');
            return;
        }
        this.isStarting = true;

        try {
            if (this.container) {
                const info = await this.container.inspect();
                if (info.State.Running) {
                    console.log('Server is already running.');
                    return;
                }

                if (options.forceRecreate) {
                    await this.container.remove({ force: true });
                    this.container = null;
                } else {
                    await this.container.start();
                    console.log('Minecraft server started.');
                    this.attachToLogs();
                    this.startStats();
                    return;
                }
            }

            await this.createContainer(options);
            await this.attachToLogs();
            await this.container.start();
            console.log('Minecraft server started.');
            this.startStats();
        } catch (error) {
            console.error('Error starting server:', error);
            throw error;
        } finally {
            this.isStarting = false;
        }
    }

    async createContainer(options = {}) {
        console.log('Creating Minecraft container...');
        const ramMB = parseInt(options.ram) || 2048;
        const port = parseInt(options.port) || 25565;
        const ramBytes = ramMB * 1024 * 1024;

        try {
            const image = this.docker.getImage(this.image);
            await image.inspect();
        } catch (e) {
            console.log(`Image ${this.image} not found. Pulling...`);
            await new Promise((resolve, reject) => {
                this.docker.pull(this.image, (err, stream) => {
                    if (err) return reject(err);
                    this.docker.modem.followProgress(stream, onFinished, onProgress);
                    function onFinished(err, output) {
                        if (err) reject(err);
                        else resolve(output);
                    }
                    function onProgress(event) {
                    }
                });
            });
            console.log(`Image ${this.image} pulled successfully.`);
        }

        const jarPath = path.join('/data', 'server.jar');
        try {
            if (fs.existsSync(jarPath)) {
                fs.chmodSync(jarPath, '777');
                console.log(`Updated permissions for ${jarPath}`);
            } else {
                console.warn(`WARNING: ${jarPath} not found on host mount point!`);
            }
        } catch (e) {
            console.error(`Error updating permissions for ${jarPath}:`, e.message);
        }

        this.container = await this.docker.createContainer({
            Image: this.image,
            name: this.containerName,
            Tty: true,
            OpenStdin: true,
            AttachStdin: true,
            AttachStdout: true,
            AttachStderr: true,
            Env: ['EULA=true'],
            HostConfig: {
                Memory: ramBytes,
                AutoRemove: false,
                Binds: ['minecraft_data:/data'],
                PortBindings: {
                    '25565/tcp': [{ HostPort: String(port) }]
                }
            },
            WorkingDir: '/data',
            Cmd: ['java', `-Xmx${ramMB}M`, `-Xms${ramMB}M`, '-jar', '/data/server.jar', 'nogui']
        });
    }

    async stopServer() {
        if (!this.container) return;
        try {
            await this.container.stop();
            console.log('Minecraft server stopped.');
        } catch (e) {
            console.log('Error stopping server (maybe already stopped):', e.message);
        }
    }

    addLog(data) {
        const str = data.toString();
        this.logBuffer.push(str);
        if (this.logBuffer.length > this.maxLogLines) this.logBuffer.shift();
        this.io.emit('console-output', str);
    }

    async attachToLogs() {
        if (!this.container) return;

        try {
            const stream = await this.container.attach({
                stream: true,
                stdin: true,
                stdout: true,
                stderr: true,
                hijack: true
            });

            this.stream = stream;

            stream.on('data', (chunk) => {
                const str = chunk.toString('utf8');
                const cleanStr = str.replace(/\u001b\[[0-9;]*m/g, '');

                const tpsMatch = cleanStr.match(/TPS from last 1m, 5m, 15m:\s*([\d\.]+)/);
                if (tpsMatch && this.io) {
                    this.io.emit('tps', parseFloat(tpsMatch[1]));
                }

                const listMatch = cleanStr.match(/There are (\d+) of a max of (\d+) players online:?(.*)/);
                if (listMatch && this.io) {
                    const current = parseInt(listMatch[1]);
                    const max = parseInt(listMatch[2]);
                    const rawNames = listMatch[3].trim().length > 0 ? listMatch[3].split(',').map(n => n.trim()) : [];

                    let userCache = [];
                    try {
                        if (fs.existsSync('/data/usercache.json')) {
                            userCache = JSON.parse(fs.readFileSync('/data/usercache.json', 'utf8'));
                        }
                    } catch (e) { console.error('Error reading usercache:', e.message); }

                    const players = rawNames.map(name => {
                        const cached = userCache.find(u => u.name === name);
                        return { name, uuid: cached ? cached.uuid : null };
                    });

                    this.io.emit('player-list', { online: current, max: max, list: players });
                }

                this.addLog(chunk);
            });

            stream.on('end', () => console.log('Stream ended'));
            stream.on('error', (err) => console.error('Stream error:', err));
        } catch (e) {
            console.error('Error attaching to container:', e);
        }
    }

    async startStats() {
        if (!this.container) return;

        this.container.stats({ stream: true }, (err, stream) => {
            if (err) return console.error('Error getting stats:', err);

            let buffer = '';
            stream.on('data', (chunk) => {
                buffer += chunk.toString();
                const lines = buffer.split('\n');
                buffer = lines.pop();

                for (const line of lines) {
                    if (!line.trim()) continue;
                    try {
                        const stats = JSON.parse(line);
                        let cpuPercent = 0.0;
                        const cpuDelta = stats.cpu_stats.cpu_usage.total_usage - stats.precpu_stats.cpu_usage.total_usage;
                        const systemDelta = stats.cpu_stats.system_cpu_usage - stats.precpu_stats.system_cpu_usage;

                        if (systemDelta > 0 && cpuDelta > 0) {
                            cpuPercent = (cpuDelta / systemDelta) * 100.0;
                        }

                        let memUsage = 0;
                        if (stats.memory_stats && stats.memory_stats.stats && stats.memory_stats.stats.rss) {
                            memUsage = stats.memory_stats.stats.rss;
                        } else {
                            const totalUsage = stats.memory_stats?.usage || 0;
                            const cache = stats.memory_stats?.stats?.cache || 0;
                            memUsage = totalUsage > cache ? totalUsage - cache : totalUsage;
                        }

                        const memLimit = stats.memory_stats?.limit || 1;

                        let networkStr = '0 B/s';
                        if (stats.networks) {
                            const ifaceKey = Object.keys(stats.networks).find(k => k !== 'lo') || Object.keys(stats.networks)[0];
                            const iface = stats.networks[ifaceKey];

                            if (iface) {
                                const now = Date.now();
                                if (this.lastNetworkStats) {
                                    const timeDiff = (now - this.lastNetworkStats.time) / 1000;
                                    if (timeDiff > 0) {
                                        const rxDiff = iface.rx_bytes - this.lastNetworkStats.rx;
                                        const txDiff = iface.tx_bytes - this.lastNetworkStats.tx;

                                        const rxBps = Math.max(0, rxDiff / timeDiff);
                                        const txBps = Math.max(0, txDiff / timeDiff);

                                        const formatSpeed = (bytes) => {
                                            if (bytes > 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + ' MB/s';
                                            if (bytes > 1024) return (bytes / 1024).toFixed(1) + ' KB/s';
                                            return bytes.toFixed(0) + ' B/s';
                                        };

                                        networkStr = `↓${formatSpeed(rxBps)} ↑${formatSpeed(txBps)}`;
                                    }
                                }
                                this.lastNetworkStats = { time: now, rx: iface.rx_bytes, tx: iface.tx_bytes };
                            }
                        }

                        let diskStr = this.diskUsage || "Calc...";

                        const statsData = {
                            time: Date.now(),
                            cpu: parseFloat(cpuPercent.toFixed(2)),
                            memory: parseFloat((memUsage / 1024 / 1024).toFixed(2)),
                            memoryLimit: parseFloat((memLimit / 1024 / 1024).toFixed(2)),
                            disk: diskStr,
                            network: networkStr
                        };

                        this.statsHistory.push(statsData);
                        if (this.statsHistory.length > this.maxStatsPoints) this.statsHistory.shift();

                        this.io.emit('server-stats', statsData);
                    } catch (e) {
                    }
                }
            });
        });

        if (this.tpsInterval) clearInterval(this.tpsInterval);
        this.tpsInterval = setInterval(() => {
            this.writeToStdin('tps');
        }, 30000);

        if (this.listInterval) clearInterval(this.listInterval);
        this.listInterval = setInterval(() => {
            this.writeToStdin('list');
        }, 30000);
    }
}

module.exports = MinecraftManager;
