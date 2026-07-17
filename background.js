// background.js - Оптимизированная версия
class AdBlockerBackground {
    constructor() {
        this.rules = new Map();
        this.settings = {
            enabled: true,
            blockDuration: 5000,
            checkInterval: 1000,
            debug: false
        };
        this.stats = {
            today: 0,
            total: 0,
            lastDate: null,
            lastBlock: null
        };
        this.initialize();
    }

    async initialize() {
        await this.loadRules();
        await this.loadSettings();
        await this.loadStats();
        this.setupListeners();
        console.log('[FreeZone] Background service worker initialized');
    }

    async loadRules() {
        try {
            const response = await fetch(chrome.runtime.getURL('rules/ad-rules.json'));
            const rulesData = await response.json();

            rulesData.sites.forEach(site => {
                this.rules.set(site.domain, site);
            });

            if (this.settings.debug) {
                console.log('[FreeZone] Rules loaded:', this.rules.size, 'sites');
            }
        } catch (error) {
            console.error('[FreeZone] Failed to load rules:', error);
        }
    }

    async loadSettings() {
        try {
            const data = await chrome.storage.sync.get('settings');
            if (data.settings) {
                this.settings = { ...this.settings, ...data.settings };
            }
        } catch (error) {
            console.error('[FreeZone] Failed to load settings:', error);
        }
    }

    async loadStats() {
        try {
            const data = await chrome.storage.local.get('stats');
            if (data.stats) {
                this.stats = data.stats;
            }
            this.updateDailyStats();
        } catch (error) {
            console.error('[FreeZone] Failed to load stats:', error);
        }
    }

    updateDailyStats() {
        const today = new Date().toDateString();
        if (this.stats.lastDate !== today) {
            this.stats.today = 0;
            this.stats.lastDate = today;
            this.saveStats();
        }
    }

    async saveStats() {
        try {
            await chrome.storage.local.set({ stats: this.stats });
        } catch (error) {
            console.error('[FreeZone] Failed to save stats:', error);
        }
    }

    setupListeners() {
        // Обработка навигации
        chrome.webNavigation.onCommitted.addListener((details) => {
            if (details.frameId === 0 && this.settings.enabled) {
                this.injectContentScript(details.tabId, details.url);
            }
        });

        // Обработка сообщений
        chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
            this.handleMessage(message, sender, sendResponse);
            return true;
        });

        // Обработка установки/обновления
        chrome.runtime.onInstalled.addListener((details) => {
            if (details.reason === 'install') {
                this.showWelcomePage();
            }
        });
    }

    async injectContentScript(tabId, url) {
        try {
            const domain = new URL(url).hostname;
            const siteRules = this.getRulesForDomain(domain);

            if (siteRules) {
                await chrome.scripting.executeScript({
                    target: { tabId: tabId },
                    files: ['content.js']
                }).catch(() => {});
            }
        } catch (error) {
            // Игнорируем ошибки инъекции
        }
    }

    handleMessage(message, sender, sendResponse) {
        switch (message.type) {
            case 'GET_RULES':
                const domain = message.domain || '';
                const rules = this.getRulesForDomain(domain);
                sendResponse({
                    rules,
                    settings: this.settings,
                    stats: this.stats
                });
                break;

            case 'UPDATE_SETTINGS':
                this.settings = { ...this.settings, ...message.settings };
                chrome.storage.sync.set({ settings: this.settings });
                sendResponse({ success: true });
                break;

            case 'GET_SETTINGS':
                sendResponse({ settings: this.settings });
                break;

            case 'AD_BLOCKED':
                this.updateStats(message.count || 1);
                this.sendLog(`🚫 Заблокировано ${message.count || 1} рекламных элементов`, 'block');
                sendResponse({ success: true });
                break;

            case 'LOG':
                this.sendLog(message.message, message.logType || 'info');
                sendResponse({ success: true });
                break;

            case 'GET_STATS':
                sendResponse({ stats: this.stats });
                break;

            case 'RESET_STATS':
                this.resetStats();
                sendResponse({ success: true });
                break;

            case 'PING':
                sendResponse({ success: true, timestamp: Date.now() });
                break;
        }
    }

    getRulesForDomain(domain) {
        for (let [key, value] of this.rules) {
            if (domain.includes(key)) {
                return value;
            }
        }
        return null;
    }

    async updateStats(count = 1) {
        this.updateDailyStats();

        this.stats.today += count;
        this.stats.total += count;
        this.stats.lastBlock = new Date().toISOString();

        await this.saveStats();

        // Отправляем обновление в popup
        chrome.runtime.sendMessage({
            type: 'STATS_UPDATED',
            stats: this.stats
        }).catch(() => {});
    }

    async resetStats() {
        const today = new Date().toDateString();
        this.stats = {
            today: 0,
            total: 0,
            lastDate: today,
            lastBlock: null
        };
        await this.saveStats();

        chrome.runtime.sendMessage({
            type: 'STATS_UPDATED',
            stats: this.stats
        }).catch(() => {});
    }

    sendLog(message, type = 'info') {
        chrome.runtime.sendMessage({
            type: 'LOG',
            message: message,
            logType: type
        }).catch(() => {});
    }

    showWelcomePage() {
        chrome.tabs.create({
            url: chrome.runtime.getURL('popup/welcome.html')
        });
    }
}

// Инициализация
const background = new AdBlockerBackground();