const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const sftpService = require('./services/sftpService');
const MinecraftManager = require('./services/minecraftManager');
const session = require('express-session');

const fs = require('fs');

const app = express();
const server = http.createServer(app);

// Security Middleware
app.use(helmet({
    contentSecurityPolicy: false, // Disabled for xterm.js/chart.js inline scripts
}));

const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100 // limit each IP to 100 requests per windowMs
});
app.use('/login', limiter);

const sessionMiddleware = session({
    secret: process.env.SESSION_SECRET || 'minecraft-secret-key-change-this',
    resave: false,
    saveUninitialized: true,
    cookie: {
        secure: process.env.NODE_ENV === 'production', // true if https
        httpOnly: true
    }
});

app.use(sessionMiddleware);

const io = new Server(server, {
    cors: { origin: "*" }
});

const wrap = middleware => (socket, next) => middleware(socket.request, {}, next);
io.use(wrap(sessionMiddleware));

io.use((socket, next) => {
    if (socket.request.session && socket.request.session.authenticated) {
        next();
    } else {
        next(new Error("Unauthorized"));
    }
});


app.use(express.json());

const authConfigPath = path.join(__dirname, 'config', 'auth.json');
function getAuthConfig() {
    try {
        if (fs.existsSync(authConfigPath)) {
            return JSON.parse(fs.readFileSync(authConfigPath, 'utf8'));
        }
    } catch (e) { console.error('Error reading auth config:', e); }
    return {
        adminUser: process.env.SFTPGO_USER || 'admin',
        adminPass: process.env.SFTPGO_PASS || 'admin',
        sftpUser: 'mcuser',
        sftpPass: 'mcpassword123'
    };
}

function saveAuthConfig(config) {
    const dir = path.dirname(authConfigPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(authConfigPath, JSON.stringify(config, null, 4));
}

const requireAuth = (req, res, next) => {
    if (req.session.authenticated) {
        const config = getAuthConfig();
        if (config.adminUser === 'admin' && config.adminPass === 'admin' && req.path !== '/change-password.html' && req.path !== '/api/change-password') {
            return res.redirect('/change-password.html');
        }
        next();
    } else {
        if (req.path.startsWith('/api')) {
            res.status(401).json({ error: 'Unauthorized' });
        } else {
            res.redirect('/login.html');
        }
    }
};

app.post('/login', (req, res) => {
    const { username, password } = req.body;
    const config = getAuthConfig();

    if (username === config.adminUser && password === config.adminPass) {
        req.session.authenticated = true;
        req.session.username = username;
        res.json({ success: true });
    } else {
        res.status(401).json({ error: 'Invalid credentials' });
    }
});

app.post('/logout', (req, res) => {
    req.session.destroy();
    res.json({ success: true });
});

app.get('/api/config', (req, res) => {
    if (!req.session.authenticated) return res.status(401).json({ error: 'Unauthorized' });
    const config = getAuthConfig();
    res.json({
        adminUser: config.adminUser,
        sftpUser: config.sftpUser,
        sftpPass: config.sftpPass
    });
});

app.post('/api/change-password', (req, res) => {
    if (!req.session.authenticated) return res.status(401).json({ error: 'Unauthorized' });

    const { adminUser, adminPass, sftpPass } = req.body;
    const config = getAuthConfig();

    if (adminUser) config.adminUser = adminUser;
    if (adminPass) config.adminPass = adminPass;
    if (sftpPass) config.sftpPass = sftpPass;

    saveAuthConfig(config);

    if (sftpPass) {
        sftpService.updateUserPassword(config.sftpUser, config.sftpPass)
            .catch(err => console.error('Failed to update SFTP password:', err.message));
    }

    res.json({ success: true });
});

const settingsPath = path.join(__dirname, 'config', 'settings.json');
function getSettings() {
    try {
        if (fs.existsSync(settingsPath)) {
            return JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
        }
    } catch (e) { console.error('Error reading settings:', e); }
    return { serverIp: 'localhost', ram: '4096', port: '25565' };
}

function saveSettings(settings) {
    const dir = path.dirname(settingsPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 4));
}

app.get('/api/settings', (req, res) => {
    if (!req.session.authenticated) return res.status(401).json({ error: 'Unauthorized' });
    res.json(getSettings());
});

app.post('/api/settings', (req, res) => {
    if (!req.session.authenticated) return res.status(401).json({ error: 'Unauthorized' });
    const current = getSettings();
    const { serverIp, ram, port } = req.body;

    if (serverIp) current.serverIp = serverIp;
    if (ram) current.ram = ram;
    if (port) current.port = port;

    saveSettings(current);
    res.json({ success: true });
});

app.use('/login.html', express.static(path.join(__dirname, '../public/login.html')));
app.use('/change-password.html', express.static(path.join(__dirname, '../public/change-password.html')));

app.use('/css', express.static(path.join(__dirname, '../public/css')));
app.use('/js', express.static(path.join(__dirname, '../public/js')));

app.use(requireAuth);
app.use(express.static(path.join(__dirname, '../public')));

const mcManager = new MinecraftManager(io);

async function init() {
    try {
        const config = getAuthConfig();
        await sftpService.ensureUser(config.sftpUser, config.sftpPass);
        await mcManager.init();
    } catch (error) {
        console.error('Initialization Error:', error.message);
    }
}

init();

app.get('/api/status', async (req, res) => {
    try {
        if (!mcManager.container) {
            return res.json({ status: 'OFFLINE' });
        }
        const data = await mcManager.container.inspect();
        res.json({ status: data.State.Running ? 'ONLINE' : 'OFFLINE' });
    } catch (e) {
        res.json({ status: 'OFFLINE' });
    }
});

app.post('/api/start', async (req, res) => {
    try {
        const { ram, port } = req.body;
        await mcManager.startServer({ ram, port, forceRecreate: true });
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/stop', async (req, res) => {
    try {
        await mcManager.stopServer();
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/versions', async (req, res) => {
    try {
        const type = req.query.type || 'paper';
        const versions = await mcManager.getVersions(type);
        res.json(versions);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/install', async (req, res) => {
    try {
        const { version, type } = req.body;
        if (mcManager.container) {
            try { await mcManager.stopServer(); } catch (e) { }
        }

        await mcManager.installVersion(version, type);
        res.json({ success: true });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: e.message });
    }
});

io.on('connection', (socket) => {
    console.log('Frontend connected');
});

const PORT = 3000;
server.listen(PORT, () => {
    console.log(`Dashboard running on http://localhost:${PORT}`);
});
