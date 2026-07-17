// content.js - Автономная версия (не зависит от background)
(function() {
    'use strict';

    console.log('[FreeZone] 🚀 Запуск на:', window.location.hostname);

    const isRutube = window.location.hostname.includes('rutube.ru');
    const isYoutube = window.location.hostname.includes('youtube.com');
    const isTwitch = window.location.hostname.includes('twitch.tv');

    if (!isRutube && !isYoutube && !isTwitch) {
        console.log('[FreeZone] Неподдерживаемый сайт');
        return;
    }

    // ========== ЛОКАЛЬНОЕ ХРАНИЛИЩЕ ДЛЯ СТАТИСТИКИ ==========
    function getStats() {
        try {
            const data = localStorage.getItem('freezone_stats');
            if (data) {
                return JSON.parse(data);
            }
        } catch (e) {}
        return { today: 0, total: 0, lastDate: null, lastBlock: null };
    }

    function saveStats(stats) {
        try {
            localStorage.setItem('freezone_stats', JSON.stringify(stats));
        } catch (e) {}
    }

    function updateStats() {
        const stats = getStats();
        const today = new Date().toDateString();
        if (stats.lastDate !== today) {
            stats.today = 0;
            stats.lastDate = today;
        }
        stats.total += 1;
        stats.today += 1;
        stats.lastBlock = new Date().toISOString();
        saveStats(stats);
        return stats;
    }

    // ========== СОСТОЯНИЕ ==========
    const state = {
        isProcessing: false,
        isBlocked: false,
        blockTimer: null,
        observer: null,
        intervalId: null,
        timeoutId: null,
        blockCount: 0,
        lastBlockTime: 0,
        processedElements: new WeakSet(),
        mainVideo: null,
        isAudioHijacked: false
    };

    // ========== НАСТРОЙКИ ==========
    const CONFIG = {
        BLOCK_DURATION: 3000,
        CHECK_INTERVAL: 1500,
        DEBOUNCE_DELAY: 300,
        MIN_BLOCK_INTERVAL: 2500
    };

    // ========== ЛОГГЕР (только в консоль) ==========
    function log(message, type = 'info') {
        const time = new Date().toLocaleTimeString();
        const prefix = type === 'error' ? '❌' :
                       type === 'success' ? '✅' :
                       type === 'warning' ? '⚠️' : 'ℹ️';
        console.log(`[FreeZone] ${time} ${prefix} ${message}`);
    }

    // ========== ПОЛНАЯ ОСТАНОВКА МЕДИА ==========
    function killMedia(element) {
        if (!element) return false;

        try {
            if (element.pause) {
                element.pause();
            }
            if (element.muted !== undefined) {
                element.muted = true;
            }
            if (element.volume !== undefined) {
                element.volume = 0;
            }
            if (element.currentTime !== undefined) {
                element.currentTime = 0;
            }
            if (element.src && !element.src.includes('blob:')) {
                try {
                    element.src = '';
                } catch (e) {}
            }
            if (element.load) {
                try {
                    element.load();
                } catch (e) {}
            }
            if (element.style) {
                element.style.display = 'none';
                element.style.visibility = 'hidden';
                element.style.opacity = '0';
                element.style.pointerEvents = 'none';
            }
            return true;
        } catch (error) {
            return false;
        }
    }

    // ========== БЛОКИРОВКА АУДИО КОНТЕКСТОВ ==========
    function killAllAudioContexts() {
        let count = 0;
        try {
            // Перехватываем новые AudioContext
            if (window.AudioContext) {
                if (!window._originalAudioContext) {
                    window._originalAudioContext = window.AudioContext;
                }
                window.AudioContext = function() {
                    const ctx = new window._originalAudioContext();
                    setTimeout(() => {
                        try {
                            if (ctx.state === 'running') {
                                ctx.suspend();
                                ctx.close();
                            }
                        } catch (e) {}
                    }, 0);
                    return ctx;
                };
                window.AudioContext.prototype = window._originalAudioContext.prototype;
            }

            // Блокируем все аудио элементы
            const allAudio = document.querySelectorAll('audio');
            for (const audio of allAudio) {
                if (killMedia(audio)) {
                    count++;
                }
            }

            return count;
        } catch (e) {
            return count;
        }
    }

    // ========== БЛОКИРОВКА VPAID ==========
    function killVpaidAds() {
        let count = 0;
        try {
            // Удаляем VPAID элементы
            const selectors = [
                '[class*="vpaid"]',
                '[class*="VPAID"]',
                '[id*="vpaid"]',
                '[id*="VPAID"]',
                '.vpaid-container',
                'iframe[src*="vpaid"]'
            ];

            for (const selector of selectors) {
                const elements = document.querySelectorAll(selector);
                for (const el of elements) {
                    if (el.offsetParent !== null || el.style.display !== 'none') {
                        const media = el.querySelectorAll('video, audio, iframe');
                        for (const m of media) {
                            if (killMedia(m)) {
                                count++;
                            }
                        }
                        el.style.display = 'none';
                        el.style.visibility = 'hidden';
                        el.style.pointerEvents = 'none';
                        el.style.opacity = '0';
                        el.style.width = '0';
                        el.style.height = '0';
                        if (el.tagName === 'IFRAME') {
                            try { el.src = ''; } catch (e) {}
                        }
                        count++;
                    }
                }
            }

            // Удаляем глобальные VPAID объекты
            const vpaidGlobals = ['_vpaid', 'vpaid', 'VPAID', '_VPAID'];
            for (const key of vpaidGlobals) {
                if (window[key]) {
                    try {
                        if (window[key].stopAd) window[key].stopAd();
                        if (window[key].pauseAd) window[key].pauseAd();
                        delete window[key];
                    } catch (e) {}
                }
            }

            count += killAllAudioContexts();
            return count;
        } catch (e) {
            return count;
        }
    }

    // ========== ПРОВЕРКИ ==========
    function getMainVideo() {
        if (state.mainVideo && document.contains(state.mainVideo)) {
            return state.mainVideo;
        }
        const video = document.querySelector('video[data-testid="video"]');
        if (video) {
            state.mainVideo = video;
        }
        return video;
    }

    function isMainVideoPlaying() {
        const video = getMainVideo();
        return video && !video.paused && video.currentTime > 0;
    }

    function isAdActive() {
        // Проверяем контейнер рекламы
        const adElement = document.querySelector('[data-testid="advert"]');
        if (adElement && adElement.style.display !== 'none') {
            return true;
        }

        // Проверяем рекламное видео
        const adVideo = document.querySelector('video[data-testid="advert-video"]');
        if (adVideo && adVideo.currentTime > 0) {
            return true;
        }

        // Проверяем Яндекс рекламу
        const yandexAd = document.getElementById('raichu_yasdk_container');
        if (yandexAd && yandexAd.style.display !== 'none') {
            return true;
        }

        // Проверяем VPAID
        const vpaidElements = document.querySelectorAll('[class*="vpaid"], [class*="VPAID"]');
        for (const el of vpaidElements) {
            if (el.offsetParent !== null && el.style.display !== 'none') {
                return true;
            }
        }

        return false;
    }

    // ========== БЛОКИРОВКА ==========
    function blockAds() {
        const now = Date.now();
        if (state.isProcessing || state.isBlocked) return false;
        if (now - state.lastBlockTime < CONFIG.MIN_BLOCK_INTERVAL) {
            return false;
        }

        state.isProcessing = true;
        let handled = false;

        try {
            // Проверяем наличие рекламы
            if (!isAdActive()) {
                // Всё равно блокируем звук на всякий случай
                killAllAudioContexts();
                state.isProcessing = false;
                return false;
            }

            // Если видео играет, но есть реклама - блокируем звук
            if (isMainVideoPlaying()) {
                killAllAudioContexts();
                state.isProcessing = false;
                return false;
            }

            log('Обнаружена реклама, блокируем...', 'info');

            const mainVideo = getMainVideo();

            // 1. Блокируем VPAID
            const vpaidCount = killVpaidAds();
            if (vpaidCount > 0) handled = true;

            // 2. Блокируем рекламное видео
            const adVideo = document.querySelector('video[data-testid="advert-video"]');
            if (adVideo) {
                killMedia(adVideo);
                try { adVideo.remove(); } catch (e) {}
                handled = true;
            }

            // 3. Блокируем контейнер
            const adElement = document.querySelector('[data-testid="advert"]');
            if (adElement && adElement.style.display !== 'none') {
                const videos = adElement.querySelectorAll('video, audio');
                for (const video of videos) {
                    killMedia(video);
                }
                adElement.style.display = 'none';
                adElement.style.visibility = 'hidden';
                adElement.style.pointerEvents = 'none';
                handled = true;
            }

            // 4. Блокируем Яндекс рекламу
            const yandexAd = document.getElementById('raichu_yasdk_container');
            if (yandexAd && yandexAd.style.display !== 'none') {
                const media = yandexAd.querySelectorAll('video, audio, iframe');
                for (const el of media) {
                    killMedia(el);
                }
                yandexAd.style.display = 'none';
                yandexAd.style.visibility = 'hidden';
                handled = true;
            }

            // 5. Блокируем звук
            const audioCount = killAllAudioContexts();
            if (audioCount > 0) handled = true;

            // 6. Блокируем дополнительные видео
            document.querySelectorAll('video').forEach(v => {
                if (v !== mainVideo && v.dataset.testid !== 'video') {
                    if (v.closest('[data-testid="advert"]') ||
                        v.closest('#raichu_yasdk_container') ||
                        v.dataset.testid === 'advert-video') {
                        killMedia(v);
                        handled = true;
                    }
                }
            });

            if (handled) {
                state.blockCount++;
                state.lastBlockTime = now;

                // Сохраняем статистику локально
                const stats = updateStats();
                log(`✅ Реклама заблокирована (всего: ${stats.total}, сегодня: ${stats.today})`, 'success');

                // Запускаем основное видео
                if (mainVideo) {
                    setTimeout(() => {
                        try {
                            mainVideo.muted = false;
                            mainVideo.volume = 1;
                            if (mainVideo.paused) {
                                mainVideo.play().catch(() => {});
                            }
                        } catch (e) {}
                    }, 100);
                }
            }

        } catch (e) {
            log('Ошибка при блокировке: ' + e.message, 'error');
        } finally {
            state.isProcessing = false;
        }

        if (handled) {
            state.isBlocked = true;
            stopMonitoring();

            if (state.blockTimer) clearTimeout(state.blockTimer);
            state.blockTimer = setTimeout(() => {
                state.isBlocked = false;
                startMonitoring();
                log('Мониторинг возобновлен', 'info');
            }, CONFIG.BLOCK_DURATION);
        }

        return handled;
    }

    // ========== МОНИТОРИНГ ==========
    function startMonitoring() {
        if (state.observer) {
            try { state.observer.disconnect(); } catch (e) {}
            state.observer = null;
        }
        if (state.intervalId) {
            clearInterval(state.intervalId);
            state.intervalId = null;
        }

        state.observer = new MutationObserver(() => {
            if (state.timeoutId) {
                clearTimeout(state.timeoutId);
            }
            state.timeoutId = setTimeout(() => {
                if (!state.isBlocked && !state.isProcessing) {
                    blockAds();
                }
                state.timeoutId = null;
            }, CONFIG.DEBOUNCE_DELAY);
        });

        try {
            state.observer.observe(document.body, {
                childList: true,
                subtree: true,
                attributes: true,
                attributeFilter: ['style', 'class', 'data-testid']
            });
        } catch (e) {}

        state.intervalId = setInterval(() => {
            if (!state.isBlocked && !state.isProcessing) {
                blockAds();
            }
        }, CONFIG.CHECK_INTERVAL);

        log('Мониторинг запущен', 'info');
    }

    function stopMonitoring() {
        if (state.observer) {
            try { state.observer.disconnect(); } catch (e) {}
            state.observer = null;
        }
        if (state.intervalId) {
            clearInterval(state.intervalId);
            state.intervalId = null;
        }
        if (state.timeoutId) {
            clearTimeout(state.timeoutId);
            state.timeoutId = null;
        }
    }

    // ========== ПЕРЕХВАТ WEB AUDIO ==========
    function hijackWebAudio() {
        if (state.isAudioHijacked) return;

        try {
            const originalAudioContext = window.AudioContext;
            if (originalAudioContext) {
                if (!window._originalAudioContext) {
                    window._originalAudioContext = originalAudioContext;
                }
                window.AudioContext = function() {
                    const ctx = new window._originalAudioContext();
                    setTimeout(() => {
                        try {
                            if (ctx.state === 'running') {
                                ctx.suspend();
                                ctx.close();
                            }
                        } catch (e) {}
                    }, 0);
                    return ctx;
                };
                window.AudioContext.prototype = originalAudioContext.prototype;
            }

            const originalOffline = window.OfflineAudioContext;
            if (originalOffline) {
                if (!window._originalOfflineAudioContext) {
                    window._originalOfflineAudioContext = originalOffline;
                }
                window.OfflineAudioContext = function() {
                    const ctx = new window._originalOfflineAudioContext(...arguments);
                    try { ctx.suspend(); ctx.close(); } catch (e) {}
                    return ctx;
                };
            }

            state.isAudioHijacked = true;
        } catch (e) {}
    }

    // ========== ИНИЦИАЛИЗАЦИЯ ==========
    function init() {
        const hasVideo = document.querySelector('video[data-testid="video"]') ||
                        document.querySelector('video');
        if (!hasVideo) {
            setTimeout(init, 2000);
            return;
        }

        state.mainVideo = document.querySelector('video[data-testid="video"]');

        log('Запуск защиты...', 'info');

        hijackWebAudio();

        setTimeout(() => {
            blockAds();
        }, 1000);

        startMonitoring();

        // Периодически блокируем звук
        const audioKillerInterval = setInterval(() => {
            if (!state.isBlocked && !state.isProcessing) {
                killAllAudioContexts();
            }
        }, 3000);

        window.addEventListener('beforeunload', () => {
            stopMonitoring();
            clearInterval(audioKillerInterval);
            if (state.blockTimer) {
                clearTimeout(state.blockTimer);
                state.blockTimer = null;
            }
        });

        log('✅ Защита активирована', 'success');
    }

    // ========== ЗАПУСК ==========
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            setTimeout(init, 500);
        });
    } else {
        setTimeout(init, 500);
    }

    // Fallback
    let initAttempts = 0;
    const fallbackInterval = setInterval(() => {
        initAttempts++;
        if (initAttempts < 15 && !state.observer) {
            if (document.body && document.querySelector('video')) {
                clearInterval(fallbackInterval);
                init();
            }
        } else if (initAttempts >= 15) {
            clearInterval(fallbackInterval);
            console.log('[FreeZone] Не удалось запустить защиту');
        }
    }, 1000);

})();