// popup.js - Исправленная версия
(function() {
    'use strict';

    console.log('[Popup] Загружен');

    // ========== DOM ЭЛЕМЕНТЫ ==========
    const elements = {
        statusCard: document.getElementById('statusCard'),
        statusIcon: document.getElementById('statusIcon'),
        statusText: document.getElementById('statusText'),
        statusSub: document.getElementById('statusSub'),
        toggleProtection: document.getElementById('toggleProtection'),
        blockedToday: document.getElementById('blockedToday'),
        blockedTotal: document.getElementById('blockedTotal'),
        blockRate: document.getElementById('blockRate'),
        logsContainer: document.getElementById('logsContainer'),
        clearLogs: document.getElementById('clearLogs'),
        refreshBtn: document.getElementById('refreshBtn'),
        resetStatsBtn: document.getElementById('resetStatsBtn'),
        currentSite: document.getElementById('currentSite')
    };

    // ========== ЛОГГЕР ==========
    const logs = [];
    const MAX_LOGS = 50;

    function addLog(message, type = 'info') {
        const time = new Date().toLocaleTimeString();
        const entry = { time, message, type };
        logs.push(entry);

        if (logs.length > MAX_LOGS) {
            logs.shift();
        }

        renderLogs();
    }

    function renderLogs() {
        if (!elements.logsContainer) return;

        elements.logsContainer.innerHTML = logs.map(log =>
            `<div class="log-entry log-${log.type}">
                <span class="time">${log.time}</span>
                ${log.message}
            </div>`
        ).join('');

        elements.logsContainer.scrollTop = elements.logsContainer.scrollHeight;
    }

    // ========== ОБНОВЛЕНИЕ СТАТУСА ==========
    function updateStatus(isActive, site = '') {
        if (!elements.statusCard) return;

        if (isActive) {
            elements.statusCard.className = 'status-card active';
            elements.statusIcon.textContent = '🛡️';
            elements.statusText.textContent = 'Защита активна';
            elements.statusSub.textContent = site ? `Работает на ${site}` : 'Готов к работе';
        } else {
            elements.statusCard.className = 'status-card inactive';
            elements.statusIcon.textContent = '⚠️';
            elements.statusText.textContent = 'Защита отключена';
            elements.statusSub.textContent = 'Нажмите переключатель для включения';
        }
    }

    // ========== ОБНОВЛЕНИЕ СТАТИСТИКИ ==========
    function updateStats() {
        chrome.runtime.sendMessage({ type: 'GET_STATS' }, function(response) {
            if (response && response.stats) {
                const stats = response.stats;
                elements.blockedToday.textContent = stats.today || 0;
                elements.blockedTotal.textContent = stats.total || 0;

                const rate = calculateBlockRate(stats);
                elements.blockRate.textContent = rate;

                if (stats.lastBlock) {
                    const time = new Date(stats.lastBlock).toLocaleTimeString();
                    elements.statusSub.textContent = `Последняя блокировка: ${time}`;
                }
            }
        });
    }

    function calculateBlockRate(stats) {
        const total = stats.total || 0;
        const lastBlock = stats.lastBlock ? new Date(stats.lastBlock) : null;

        if (!lastBlock || total === 0) return 0;

        const now = new Date();
        const diffMinutes = (now - lastBlock) / (1000 * 60);

        if (diffMinutes < 1) return Math.round(total);
        return Math.round(total / diffMinutes);
    }

    // ========== ОБНОВЛЕНИЕ ТЕКУЩЕГО САЙТА ==========
    function updateCurrentSite() {
        chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
            if (tabs[0] && elements.currentSite) {
                try {
                    const url = new URL(tabs[0].url);
                    const domain = url.hostname;
                    if (domain.includes('rutube')) {
                        elements.currentSite.textContent = '🌐 rutube.ru';
                    } else if (domain.includes('youtube')) {
                        elements.currentSite.textContent = '🌐 youtube.com';
                    } else if (domain.includes('twitch')) {
                        elements.currentSite.textContent = '🌐 twitch.tv';
                    } else {
                        elements.currentSite.textContent = `🌐 ${domain}`;
                    }
                } catch (e) {
                    elements.currentSite.textContent = '🌐 Неизвестный сайт';
                }
            }
        });
    }

    // ========== ОБРАБОТЧИКИ СООБЩЕНИЙ ==========
    chrome.runtime.onMessage.addListener(function(message, sender, sendResponse) {
        if (message.type === 'LOG') {
            addLog(message.message, message.logType || 'info');
            sendResponse({ success: true });
            return true;
        }

        if (message.type === 'STATS_UPDATED') {
            updateStats();
            sendResponse({ success: true });
            return true;
        }

        if (message.type === 'AD_BLOCKED') {
            addLog(`🚫 Заблокировано ${message.count || 1} рекламных элементов`, 'block');
            updateStats();

            if (elements.statusCard) {
                elements.statusCard.style.transition = 'all 0.1s';
                elements.statusCard.style.transform = 'scale(0.98)';
                setTimeout(() => {
                    elements.statusCard.style.transform = 'scale(1)';
                }, 100);
            }

            sendResponse({ success: true });
            return true;
        }
    });

    // ========== НАСТРОЙКИ ==========
    function loadSettings() {
        chrome.storage.sync.get(['enabled'], function(result) {
            const enabled = result.enabled !== undefined ? result.enabled : true;
            if (elements.toggleProtection) {
                elements.toggleProtection.checked = enabled;
            }
            updateStatus(enabled);

            if (enabled) {
                addLog('🟢 Защита включена', 'info');
            } else {
                addLog('🔴 Защита отключена', 'warning');
            }
        });
    }

    function saveSettings() {
        const enabled = elements.toggleProtection.checked;
        chrome.storage.sync.set({ enabled: enabled });
        updateStatus(enabled);

        // Отправляем в background
        chrome.runtime.sendMessage({
            type: 'UPDATE_SETTINGS',
            settings: { enabled: enabled }
        });

        if (enabled) {
            addLog('🟢 Защита включена', 'info');
        } else {
            addLog('🔴 Защита отключена', 'warning');
        }
    }

    // ========== КНОПКИ ==========

    function refreshAll() {
        addLog('🔄 Обновление...', 'info');

        chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
            if (tabs[0]) {
                chrome.tabs.reload(tabs[0].id);
                addLog('✅ Страница перезагружена', 'success');
            }
        });

        setTimeout(() => {
            updateStats();
            updateCurrentSite();
            addLog('✅ Статистика обновлена', 'success');
        }, 500);
    }

    function resetStats() {
        if (!confirm('Сбросить всю статистику блокировок?')) return;

        chrome.runtime.sendMessage({ type: 'RESET_STATS' }, function() {
            addLog('🗑️ Статистика сброшена', 'warning');
            setTimeout(updateStats, 200);
        });
    }

    function clearLogs() {
        logs.length = 0;
        addLog('🗑️ Логи очищены', 'warning');
    }


    // ========== ИНИЦИАЛИЗАЦИЯ ==========
    function init() {
        addLog('🚀 FreeZone запущен', 'info');
        addLog('🔄 Загрузка настроек...', 'info');

        loadSettings();
        setTimeout(updateStats, 300);
        updateCurrentSite();

        // Навешиваем обработчики
        if (elements.toggleProtection) {
            elements.toggleProtection.addEventListener('change', saveSettings);
        }

        if (elements.refreshBtn) {
            elements.refreshBtn.addEventListener('click', refreshAll);
        }

        if (elements.resetStatsBtn) {
            elements.resetStatsBtn.addEventListener('click', resetStats);
        }

        if (elements.clearLogs) {
            elements.clearLogs.addEventListener('click', clearLogs);
        }

        // Периодическое обновление
        setInterval(updateStats, 5000);
        setInterval(updateCurrentSite, 10000);

        setTimeout(() => {
            addLog('✅ Готов к работе', 'success');
        }, 500);
    }

    // В popup.js для получения статистики
    function getStatsFromPage() {
        chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
            if (tabs[0]) {
                chrome.scripting.executeScript({
                    target: { tabId: tabs[0].id },
                    function: () => {
                        try {
                            const data = localStorage.getItem('freezone_stats');
                            return data ? JSON.parse(data) : null;
                        } catch (e) {
                            return null;
                        }
                    }
                }, (results) => {
                    if (results && results[0] && results[0].result) {
                        const stats = results[0].result;
                        elements.blockedToday.textContent = stats.today || 0;
                        elements.blockedTotal.textContent = stats.total || 0;
                    }
                });
            }
        });
    }

    init();

})();