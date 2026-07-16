// popup.js
class PopupController {
    constructor() {
        this.settings = {};
        this.stats = {};
        this.initialize();
    }

    async initialize() {
        await this.loadData();
        this.setupEventListeners();
        this.updateUI();
        console.log('[Popup] Initialized');
    }

    async loadData() {
        try {
            // Загружаем настройки
            const settingsData = await chrome.storage.sync.get('settings');
            this.settings = settingsData.settings || {
                enabled: true,
                blockDuration: 5000,
                checkInterval: 1000,
                debug: false
            };

            // Загружаем статистику
            const statsData = await chrome.storage.local.get('stats');
            this.stats = statsData.stats || { total: 0, today: 0 };
        } catch (error) {
            console.error('[Popup] Error loading data:', error);
        }
    }

    setupEventListeners() {
        // Включение/выключение
        document.getElementById('enabled').addEventListener('change', (e) => {
            this.settings.enabled = e.target.checked;
            this.saveSettings();
            this.updateStatusText();
        });

        // Настройки
        document.getElementById('block-duration').addEventListener('change', (e) => {
            this.settings.blockDuration = parseInt(e.target.value) || 5000;
            this.saveSettings();
        });

        document.getElementById('check-interval').addEventListener('change', (e) => {
            this.settings.checkInterval = parseInt(e.target.value) || 1000;
            this.saveSettings();
        });

        document.getElementById('debug-mode').addEventListener('change', (e) => {
            this.settings.debug = e.target.checked;
            this.saveSettings();
        });

        // Кнопки
        document.getElementById('refresh-rules').addEventListener('click', () => {
            this.refreshRules();
        });

        document.getElementById('clear-stats').addEventListener('click', () => {
            this.clearStats();
        });

        document.getElementById('open-settings').addEventListener('click', (e) => {
            e.preventDefault();
            chrome.runtime.openOptionsPage();
        });
    }

    updateUI() {
        // Обновляем состояние переключателя
        document.getElementById('enabled').checked = this.settings.enabled;
        document.getElementById('block-duration').value = this.settings.blockDuration;
        document.getElementById('check-interval').value = this.settings.checkInterval;
        document.getElementById('debug-mode').checked = this.settings.debug;

        // Обновляем статус
        this.updateStatusText();

        // Обновляем статистику
        document.getElementById('today-stats').textContent = this.stats.today || 0;
        document.getElementById('total-stats').textContent = this.stats.total || 0;
    }

    updateStatusText() {
        const statusText = document.getElementById('status-text');
        statusText.textContent = this.settings.enabled ? 'Включен' : 'Выключен';
        statusText.style.color = this.settings.enabled ? '#4fc3f7' : '#ff6b6b';
    }

    async saveSettings() {
        try {
            await chrome.storage.sync.set({ settings: this.settings });
            
            // Уведомляем background
            chrome.runtime.sendMessage({
                type: 'UPDATE_SETTINGS',
                settings: this.settings
            });

            // Обновляем активную вкладку
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (tab) {
                chrome.tabs.sendMessage(tab.id, {
                    type: 'UPDATE_SETTINGS',
                    settings: this.settings
                }).catch(() => {});
            }
        } catch (error) {
            console.error('[Popup] Error saving settings:', error);
        }
    }

    async refreshRules() {
        try {
            document.getElementById('refresh-rules').textContent = 'Обновление...';
            document.getElementById('refresh-rules').disabled = true;

            // Перезагружаем правила в background
            chrome.runtime.sendMessage({ type: 'RELOAD_RULES' }, (response) => {
                if (response?.success) {
                    this.showNotification('Правила обновлены');
                } else {
                    this.showNotification('Ошибка обновления правил', true);
                }
            });

        } catch (error) {
            console.error('[Popup] Error refreshing rules:', error);
            this.showNotification('Ошибка обновления правил', true);
        } finally {
            document.getElementById('refresh-rules').textContent = 'Обновить правила';
            document.getElementById('refresh-rules').disabled = false;
        }
    }

    async clearStats() {
        if (confirm('Сбросить статистику блокировки?')) {
            try {
                await chrome.storage.local.set({ stats: { total: 0, today: 0 } });
                this.stats = { total: 0, today: 0 };
                this.updateUI();
                this.showNotification('Статистика сброшена');
            } catch (error) {
                console.error('[Popup] Error clearing stats:', error);
                this.showNotification('Ошибка сброса статистики', true);
            }
        }
    }

    showNotification(message, isError = false) {
        const notification = document.createElement('div');
        notification.textContent = message;
        notification.style.cssText = `
            position: fixed;
            bottom: 16px;
            left: 50%;
            transform: translateX(-50%);
            padding: 8px 16px;
            background: ${isError ? '#ff6b6b' : '#4fc3f7'};
            color: ${isError ? 'white' : '#1a1a2e'};
            border-radius: 6px;
            font-size: 12px;
            font-weight: 500;
            z-index: 1000;
            opacity: 0;
            transition: opacity 0.3s;
        `;
        
        document.body.appendChild(notification);
        
        setTimeout(() => {
            notification.style.opacity = '1';
        }, 50);
        
        setTimeout(() => {
            notification.style.opacity = '0';
            setTimeout(() => {
                notification.remove();
            }, 300);
        }, 2000);
    }
}

// Инициализация при загрузке
document.addEventListener('DOMContentLoaded', () => {
    new PopupController();
});
