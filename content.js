// content.js - Исправленная версия с защитой от двойного запуска
(function() {
    'use strict';

    // ========== ЗАЩИТА ОТ ДВОЙНОЙ ИНИЦИАЛИЗАЦИИ ==========
    if (window.__freezone_initialized) {
        console.log('[FreeZone] ⚠️ Уже инициализирован, пропускаем');
        return;
    }
    window.__freezone_initialized = true;

    console.log('[FreeZone] 🚀 Запуск на:', window.location.hostname);

    // ========== КОНФИГУРАЦИЯ ==========
    const CONFIG = {
        BLOCK_DURATION: 5000,
        CHECK_INTERVAL: 2000,
        DEBOUNCE_DELAY: 300,
        MIN_BLOCK_INTERVAL: 3000
    };

    // ========== СОСТОЯНИЕ ==========
    let state = {
        isProcessing: false,
        isBlocked: false,
        blockTimer: null,
        observer: null,
        intervalId: null,
        timeoutId: null,
        lastBlockTime: 0,
        blockCount: 0,
        processedContainers: new WeakSet(),
        isDestroyed: false,
        isInitialized: false
    };

    const isRutube = window.location.hostname.includes('rutube.ru');

    // ========== ЖЕСТКАЯ ОСТАНОВКА МЕДИА ==========
    function killMedia(element, removeFromDOM = true) {
        if (!element) return false;

        try {
            if (element.pause) element.pause();
            element.currentTime = 0;
            element.muted = true;
            element.volume = 0;

            try {
                element.src = '';
                element.removeAttribute('src');
                element.load();
            } catch(e) {}

            element.style.display = 'none';
            element.style.visibility = 'hidden';
            element.style.opacity = '0';
            element.style.pointerEvents = 'none';

            if (removeFromDOM) {
                try { element.remove(); } catch(e) {}
            }

            return true;
        } catch(e) {
            return false;
        }
    }

    // ========== БЛОКИРОВКА WEB AUDIO API ==========
    function hijackAudioContexts() {
        try {
            if (window.AudioContext && !window._freezone_audio_hijacked) {
                window._freezone_audio_hijacked = true;
                const OriginalAudioContext = window.AudioContext;

                window.AudioContext = function() {
                    const ctx = new OriginalAudioContext();
                    setTimeout(() => {
                        try {
                            if (ctx.state === 'running') {
                                ctx.suspend();
                                ctx.close();
                            }
                        } catch(e) {}
                    }, 0);
                    return ctx;
                };
                window.AudioContext.prototype = OriginalAudioContext.prototype;
            }

            if (AudioContext.prototype.createMediaElementSource) {
                const origCreate = AudioContext.prototype.createMediaElementSource;
                AudioContext.prototype.createMediaElementSource = function(element) {
                    if (element && element.closest && (
                        element.closest('[data-testid="advert"]') ||
                        element.closest('#raichu_yasdk_container') ||
                        (element.dataset && element.dataset.testid === 'advert-video')
                    )) {
                        return {
                            connect: () => {},
                            disconnect: () => {},
                            gain: { value: 0 }
                        };
                    }
                    return origCreate.call(this, element);
                };
            }
        } catch(e) {}
    }

    // ========== ОСНОВНАЯ ЛОГИКА ==========
    function handleAds() {
        if (state.isProcessing || state.isBlocked || state.isDestroyed) return false;

        const now = Date.now();
        if (now - state.lastBlockTime < CONFIG.MIN_BLOCK_INTERVAL) return false;

        state.isProcessing = true;
        let handled = false;

        try {
            if (isRutube) {
                // Проверяем наличие рекламы
                const adElement = document.querySelector('[data-testid="advert"]');
                const adVideo = document.querySelector('video[data-testid="advert-video"]');
                const yandexAd = document.getElementById('raichu_yasdk_container');

                // Проверяем, видна ли реклама (не скрыта)
                let isAdVisible = false;

                if (adElement) {
                    const style = window.getComputedStyle(adElement);
                    if (style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0') {
                        isAdVisible = true;
                    }
                }

                // Если нет видимой рекламы - выходим
                if (!isAdVisible && !adVideo && !yandexAd) {
                    state.isProcessing = false;
                    return false;
                }

                // Проверяем, не обрабатывали ли мы уже этот контейнер
                if (adElement && state.processedContainers.has(adElement)) {
                    state.isProcessing = false;
                    return false;
                }

                console.log('[FreeZone] 🎯 Обнаружена реклама, блокируем...');

                // 1. Блокируем рекламное видео
                if (adVideo) {
                    killMedia(adVideo, true);
                    handled = true;
                }

                // 2. Блокируем Яндекс рекламу
                if (yandexAd) {
                    yandexAd.querySelectorAll('video, audio, iframe').forEach(el => {
                        killMedia(el, true);
                    });
                    yandexAd.style.display = 'none';
                    yandexAd.style.visibility = 'hidden';
                    handled = true;
                }

                // 3. Блокируем основной контейнер
                if (adElement) {
                    state.processedContainers.add(adElement);

                    adElement.style.display = 'none';
                    adElement.style.visibility = 'hidden';
                    adElement.style.pointerEvents = 'none';
                    adElement.style.opacity = '0';

                    adElement.querySelectorAll('video, audio, iframe').forEach(el => {
                        killMedia(el, true);
                    });
                    handled = true;
                }

                // 4. Блокируем аудио-контексты
                hijackAudioContexts();

                // 5. Запускаем основное видео
                if (handled) {
                    const mainVideo = document.querySelector('video[data-testid="video"]');
                    if (mainVideo) {
                        mainVideo.muted = false;
                        mainVideo.volume = 1;
                        // Если видео на паузе или только что началось - запускаем
                        if (mainVideo.paused || mainVideo.currentTime === 0) {
                            mainVideo.play().catch(() => {});
                        }
                    }

                    state.blockCount++;
                    state.lastBlockTime = now;
                    console.log(`[FreeZone] ✅ Реклама заблокирована (${state.blockCount})`);
                }

            } else {
                // Другие сайты
                function findAdContainer(root = document) {
                    const selectors = [
                        '.ads-container',
                        '.video-ads',
                        '.ytp-ad-player-overlay',
                        '.advertisement-overlay',
                        '#ad-container'
                    ];

                    for (const selector of selectors) {
                        const el = root.querySelector(selector);
                        if (el) return { container: el, shadow: root };
                    }

                    for (let el of root.querySelectorAll('*')) {
                        if (el.shadowRoot) {
                            let found = findAdContainer(el.shadowRoot);
                            if (found) return found;
                        }
                    }
                    return null;
                }

                const result = findAdContainer();
                if (result) {
                    const container = result.container;
                    console.log('[FreeZone] 🎯 Найден рекламный контейнер, удаляем...');

                    container.querySelectorAll('video, audio, iframe').forEach(el => {
                        killMedia(el, true);
                    });

                    container.remove();
                    handled = true;

                    if (result.shadow) {
                        const videoWrapper = result.shadow.querySelector('.video-wrapper');
                        if (videoWrapper) {
                            videoWrapper.classList.remove('hidden');
                            videoWrapper.style.display = '';
                        }
                        result.shadow.querySelectorAll('.rb-adman-ad-actions, .rb-adman-cta-block-wrapper, .rb-adman-cta-block')
                            .forEach(el => el.remove());
                    }

                    console.log('[FreeZone] ✅ Рекламный контейнер удален');
                }
            }

            if (handled) {
                state.isBlocked = true;
                console.log(`[FreeZone] ⏸️ Мониторинг приостановлен на ${CONFIG.BLOCK_DURATION/1000} сек`);

                stopMonitoring();
                if (state.blockTimer) clearTimeout(state.blockTimer);

                state.blockTimer = setTimeout(() => {
                    state.isBlocked = false;
                    startMonitoring();
                    console.log('[FreeZone] ▶️ Мониторинг возобновлен');
                }, CONFIG.BLOCK_DURATION);
            }

            return handled;

        } catch(e) {
            console.warn('[FreeZone] Ошибка:', e);
        } finally {
            state.isProcessing = false;
        }
        return false;
    }

    // ========== УПРАВЛЕНИЕ МОНИТОРИНГОМ ==========
    function startMonitoring() {
        if (state.isDestroyed || state.isInitialized) return;
        state.isInitialized = true;

        if (state.observer) {
            try { state.observer.disconnect(); } catch(e) {}
            state.observer = null;
        }
        if (state.intervalId) {
            clearInterval(state.intervalId);
            state.intervalId = null;
        }

        state.observer = new MutationObserver(() => {
            if (state.isDestroyed) return;
            if (state.timeoutId) clearTimeout(state.timeoutId);
            state.timeoutId = setTimeout(() => {
                if (!state.isBlocked && !state.isProcessing) {
                    handleAds();
                }
                state.timeoutId = null;
            }, CONFIG.DEBOUNCE_DELAY);
        });

        try {
            state.observer.observe(document.body, {
                childList: true,
                subtree: true,
                attributes: true,
                attributeFilter: ['style', 'class', 'data-testid', 'display', 'src']
            });
        } catch(e) {}

        state.intervalId = setInterval(() => {
            if (!state.isDestroyed && !state.isBlocked && !state.isProcessing) {
                handleAds();
            }
        }, CONFIG.CHECK_INTERVAL);

        console.log('[FreeZone] 🔍 Мониторинг запущен');
    }

    function stopMonitoring() {
        state.isInitialized = false;
        if (state.observer) {
            try { state.observer.disconnect(); } catch(e) {}
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

    // ========== ИНИЦИАЛИЗАЦИЯ ==========
    function init() {
        // Проверяем, что мы на правильном сайте
        if (!isRutube && !window.location.hostname.includes('youtube.com') &&
            !window.location.hostname.includes('twitch.tv')) {
            console.log('[FreeZone] ⚠️ Сайт не поддерживается');
            return;
        }

        // Перехватываем аудио-контексты
        hijackAudioContexts();

        // Первая блокировка с задержкой
        setTimeout(() => {
            handleAds();
        }, 1000);

        // Запускаем мониторинг
        setTimeout(startMonitoring, 1500);

        // Очистка
        window.addEventListener('beforeunload', () => {
            state.isDestroyed = true;
            stopMonitoring();
            if (state.blockTimer) {
                clearTimeout(state.blockTimer);
                state.blockTimer = null;
            }
        });

        console.log('[FreeZone] 🚀 Защита активирована');
    }

    // ========== ЗАПУСК ==========
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        // Если DOM уже загружен, запускаем с небольшой задержкой
        setTimeout(init, 500);
    }

})();