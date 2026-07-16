// background.js
class AdBlockerBackground {
    constructor() {
        this.rules = new Map();
        this.settings = {
            enabled: true,
            blockDuration: 5000,
            checkInterval: 1000,
            debug: false
        };
        this.initialize();
    }

    async initialize() {
        await this.loadRules();
        await this.loadSettings();
        this.setupListeners();
        console.log('[AdBlocker] Background service worker initialized');
    }

    async loadRules() {
        try {
            const response = await fetch(chrome.runtime.getURL('rules/ad-rules.json'));
            const rulesData = await response.json();
            
            rulesData.sites.forEach(site => {
                this.rules.set(site.domain, site);
            });
            
            if (this.settings.debug) {
                console.log('[AdBlocker] Rules loaded:', this.rules.size, 'sites');
            }
        } catch (error) {
            console.error('[AdBlocker] Failed to load rules:', error);
        }
    }

    async loadSettings() {
        try {
            const data = await chrome.storage.sync.get('settings');
            if (data.settings) {
                this.settings = { ...this.settings, ...data.settings };
            }
        } catch (error) {
            console.error('[AdBlocker] Failed to load settings:', error);
        }
    }

    setupListeners() {
        // Обработка навигации
        chrome.webNavigation.onCommitted.addListener((details) => {
            if (details.frameId === 0) {
                this.handleNavigation(details.url);
            }
        });

        // Обработка сообщений от content script
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

    handleNavigation(url) {
        try {
            const domain = new URL(url).hostname;
            const siteRules = this.getRulesForDomain(domain);
            
            if (siteRules && this.settings.enabled) {
                chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                    if (tabs[0]) {
                        chrome.tabs.sendMessage(tabs[0].id, {
                            type: 'NAVIGATION',
                            rules: siteRules,
                            settings: this.settings
                        });
                    }
                });
            }
        } catch (error) {
            console.error('[AdBlocker] Navigation error:', error);
        }
    }

    handleMessage(message, sender, sendResponse) {
        switch (message.type) {
            case 'GET_RULES':
                const domain = message.domain;
                const rules = this.getRulesForDomain(domain);
                sendResponse({ rules, settings: this.settings });
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
                if (this.settings.debug) {
                    console.log('[AdBlocker] Ad blocked on:', sender.tab?.url);
                }
                this.updateStats(sender.tab?.id);
                sendResponse({ success: true });
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

    async updateStats(tabId) {
        try {
            const data = await chrome.storage.local.get('stats');
            const stats = data.stats || { total: 0, today: 0, lastDate: new Date().toDateString() };
            
            stats.total += 1;
            const today = new Date().toDateString();
            if (stats.lastDate !== today) {
                stats.today = 1;
                stats.lastDate = today;
            } else {
                stats.today += 1;
            }
            
            await chrome.storage.local.set({ stats });
        } catch (error) {
            console.error('[AdBlocker] Failed to update stats:', error);
        }
    }

    showWelcomePage() {
        chrome.tabs.create({
            url: chrome.runtime.getURL('popup/welcome.html')
        });
    }
}

// Инициализация
const background = new AdBlockerBackground();
