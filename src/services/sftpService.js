const axios = require('axios');

class SftpService {
    constructor() {
        this.apiUrl = process.env.SFTPGO_URL || 'http://sftpgo:8080/api/v2';
        this.adminUser = process.env.SFTPGO_USER || 'admin';
        this.adminPass = process.env.SFTPGO_PASS || 'password';
        this.token = null;
    }

    async authenticate(retries = 5, delay = 2000) {
        for (let attempt = 1; attempt <= retries; attempt++) {
            try {
                const response = await axios.get(`${this.apiUrl}/token`, {
                    auth: {
                        username: this.adminUser,
                        password: this.adminPass
                    }
                });
                this.token = response.data.access_token;
                console.log('Authenticated with SFTPGo');
                return;
            } catch (error) {
                console.error(`SFTPGo Authentication failed (attempt ${attempt}/${retries}):`, error.message);
                if (attempt === retries) {
                    console.error('Max retries reached. SFTPGo service might not be ready or credentials are invalid.');
                    throw error;
                }
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
    }

    async ensureUser(username, password) {
        if (!this.token) await this.authenticate();

        try {
            await axios.get(`${this.apiUrl}/users/${username}`, {
                headers: { Authorization: `Bearer ${this.token}` }
            });
            console.log(`SFTP User ${username} already exists.`);
        } catch (error) {
            if (error.response && error.response.status === 404) {
                console.log(`Creating SFTP user ${username}...`);
                await this.createUser(username, password);
            } else {
                console.error('Error checking SFTP user:', error.message);
            }
        }
    }

    async createUser(username, password) {
        try {
            const payload = {
                username: username,
                password: password,
                home_dir: '/srv/sftpgo/data',
                permissions: {
                    "/": ["*"]
                },
                status: 1
            };

            await axios.post(`${this.apiUrl}/users`, payload, {
                headers: { Authorization: `Bearer ${this.token}` }
            });
            console.log(`SFTP User ${username} created successfully.`);
        } catch (error) {
            console.error('Error creating SFTP user:', error.message);
            if (error.response) {
                console.error('SFTPGo Response:', error.response.data);
            }
        }
    }
    async updateUserPassword(username, password) {
        if (!this.token) await this.authenticate();
        try {
            await axios.put(`${this.apiUrl}/users/${username}`, {
                username: username,
                password: password,
                home_dir: '/srv/sftpgo/data',
                permissions: { "/": ["*"] },
                status: 1
            }, {
                headers: { Authorization: `Bearer ${this.token}` }
            });
            console.log(`SFTP password updated for ${username}`);
        } catch (error) {
            console.error('Error updating SFTP password:', error.message);
            if (error.response && error.response.status === 404) {
                await this.createUser(username, password);
            }
        }
    }
}

module.exports = new SftpService();
