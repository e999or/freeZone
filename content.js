// content.js - С защитой от "Extension context invalidated"
(function() {
    'use strict';

    if (!window.location.hostname.includes('rutube.ru')) return;

    console.log('[FreeZone] 🚀 Запуск на Rutube');

    // ========== КОНФИГУРАЦИЯ ==========
    const CONFIG = {
        BLOCK_DURATION: 5000,
        CHECK_INTERVAL: 300,
        DEBOUNCE_DELAY: 50,
        MAX_RECOVERY_ATTEMPTS: 5,
    };

    // ========== СОСТОЯНИЕ ==========
    let isProcessing = false;
    let isBlocked = false;
    let blockTimer = null;
    let observer = null;
    let intervalId = null;
    let debounceTimer = null;
    let blockCount = 0;
    let isExtensionAlive = true;

    // ========== ПРОВЕРКА ЖИВОСТИ РАСШИРЕНИЯ ==========
    function isExtensionValid() {
        try {
            // Проверяем, жив ли контекст расширения
            return chrome && chrome.runtime && chrome.runtime.id &&
                   !chrome.runtime?.onRestartRequired &&
                   chrome.runtime?.sendMessage !== undefined;
        } catch(e) {
            return false;
        }
    }

    // ========== БЕЗОПАСНАЯ ОТПРАВКА СООБЩЕНИЙ ==========
    function safeSendMessage(message) {
        if (!isExtensionValid()) {
            console.log('[FreeZone] ⚠️ Расширение перезагружено, пропускаем отправку');
            return Promise.resolve({ error: 'context_invalidated' });
        }

        return new Promise((resolve) => {
            try {
                chrome.runtime.sendMessage(message, (response) => {
                    if (chrome.runtime.lastError) {
                        // Игнорируем ошибку, если контекст уже недействителен
                        if (chrome.runtime.lastError.message?.includes('Extension context invalidated')) {
                            isExtensionAlive = false;
                            console.log('[FreeZone] ⚠️ Контекст расширения стал недействительным');
                        }
                        resolve({ error: chrome.runtime.lastError.message });
                    } else {
                        resolve(response || { success: true });
                    }
                });
            } catch(e) {
                if (e.message?.includes('Extension context invalidated')) {
                    isExtensionAlive = false;
                }
                resolve({ error: e.message });
            }
        });
    }

    // ========== СОХРАНЕНИЕ ГРОМКОСТИ ==========
    let savedVolume = 1;
    let savedMuted = false;

    function saveVolumeState() {
        const mainVideo = findMainVideo();
        if (mainVideo) {
            savedVolume = mainVideo.volume || 1;
            savedMuted = mainVideo.muted || false;
            console.log(`[FreeZone] 💾 Сохранена громкость: ${Math.round(savedVolume * 100)}%, muted: ${savedMuted}`);
        }
    }

    function restoreVolumeState() {
        const mainVideo = findMainVideo();
        if (mainVideo) {
            mainVideo.volume = savedVolume;
            mainVideo.muted = savedMuted;
            if (!savedMuted) {
                mainVideo.muted = false;
                setTimeout(() => {
                    if (mainVideo.volume === 0) {
                        mainVideo.volume = savedVolume || 0.5;
                    }
                    console.log(`[FreeZone] 🔊 Восстановлена громкость: ${Math.round(mainVideo.volume * 100)}%`);
                }, 50);
            } else {
                console.log('[FreeZone] 🔇 Видео было muted, оставляем');
            }
        }
    }

    // ========== НАХОДИМ ОСНОВНОЕ ВИДЕО ==========
    function findMainVideo() {
        return document.querySelector('video[data-testid="video"]') ||
               document.querySelector('.video-wrapper video') ||
               document.querySelector('video[playsinline]');
    }

    // ========== ПОЛНАЯ БЛОКИРОВКА РЕКЛАМЫ ==========
    function killAdCompletely() {
        if (isProcessing || isBlocked) return false;

        let found = false;

        try {
            // Проверяем, есть ли активная реклама
            const adContainer = document.querySelector('[data-testid="advert"]');
            const adVideo = document.querySelector('video[data-testid="advert-video"]');
            const yandexAd = document.getElementById('raichu_yasdk_container');

            // Проверяем, видна ли реклама
            let isAdVisible = false;

            if (adContainer) {
                const style = window.getComputedStyle(adContainer);
                if (style.display !== 'none' && style.visibility !== 'hidden') {
                    isAdVisible = true;
                }
            }

            if (adVideo && adVideo.src && !adVideo.ended) {
                isAdVisible = true;
            }

            if (yandexAd) {
                const style = window.getComputedStyle(yandexAd);
                if (style.display !== 'none' && style.visibility !== 'hidden') {
                    isAdVisible = true;
                }
            }

            // Если реклама не видна - выходим
            if (!isAdVisible) {
                return false;
            }

            console.log('[FreeZone] 🎯 Обнаружена реклама, блокируем...');

            // СОХРАНЯЕМ ГРОМКОСТЬ ПЕРЕД БЛОКИРОВКОЙ
            saveVolumeState();

            // 1. Рекламный контейнер
            if (adContainer) {
                adContainer.style.cssText = `
                    display: none !important;
                    visibility: hidden !important;
                    opacity: 0 !important;
                    pointer-events: none !important;
                    width: 0 !important;
                    height: 0 !important;
                    overflow: hidden !important;
                    position: absolute !important;
                    z-index: -9999 !important;
                `;
                found = true;
            }

            // 2. Рекламное видео
            if (adVideo) {
                try {
                    adVideo.pause();
                    adVideo.muted = true;
                    adVideo.volume = 0;
                    adVideo.currentTime = 0;
                    adVideo.src = '';
                    adVideo.load();
                } catch(e) {}
                adVideo.style.cssText = `
                    display: none !important;
                    visibility: hidden !important;
                    width: 0 !important;
                    height: 0 !important;
                `;
                found = true;
            }

            // 3. Яндекс реклама
            if (yandexAd) {
                yandexAd.querySelectorAll('video, audio, iframe').forEach(el => {
                    try {
                        if (el.tagName === 'VIDEO' || el.tagName === 'AUDIO') {
                            el.pause();
                            el.muted = true;
                            el.volume = 0;
                            el.currentTime = 0;
                            el.src = '';
                            el.load();
                        }
                        el.style.display = 'none';
                        el.remove();
                    } catch(e) {}
                });

                yandexAd.innerHTML = '';
                yandexAd.style.cssText = `
                    display: none !important;
                    visibility: hidden !important;
                    width: 0 !important;
                    height: 0 !important;
                `;
                found = true;
            }

            // 4. Блокируем посторонние видео
            document.querySelectorAll('video').forEach(v => {
                const isMain = v.dataset?.testid === 'video' ||
                              v.closest('.video-wrapper')?.querySelector('[data-testid="video"]') === v;

                if (!isMain && v.src) {
                    try {
                        v.pause();
                        v.muted = true;
                        v.volume = 0;
                        v.currentTime = 0;
                        v.src = '';
                        v.load();
                    } catch(e) {}
                    v.style.cssText = `
                        display: none !important;
                        visibility: hidden !important;
                    `;
                    found = true;
                }
            });

            // 5. ВОССТАНАВЛИВАЕМ ОСНОВНОЕ ВИДЕО С ГРОМКОСТЬЮ
            if (found) {
                const mainVideo = findMainVideo();
                if (mainVideo) {
                    restoreVolumeState();

                    mainVideo.style.display = '';
                    mainVideo.style.visibility = '';
                    mainVideo.style.opacity = '';

                    const tryPlay = (attempt = 0) => {
                        if (attempt > CONFIG.MAX_RECOVERY_ATTEMPTS) return;
                        mainVideo.play().catch(() => {
                            setTimeout(() => tryPlay(attempt + 1), 200);
                        });
                    };
                    setTimeout(() => tryPlay(), 100);

                    console.log(`[FreeZone] ✅ Основное видео восстановлено (громкость: ${Math.round(mainVideo.volume * 100)}%)`);
                }

                blockCount++;
                console.log(`[FreeZone] 🛑 Реклама заблокирована (${blockCount})`);

                // ========== БЕЗОПАСНАЯ ОТПРАВКА СТАТИСТИКИ ==========
                if (isExtensionValid()) {
                    safeSendMessage({
                        type: 'AD_BLOCKED',
                        count: 1
                    }).catch(() => {});
                }

                // Блокируем повторные срабатывания
                isBlocked = true;
                stopMonitoring();

                if (blockTimer) clearTimeout(blockTimer);
                blockTimer = setTimeout(() => {
                    isBlocked = false;
                    startMonitoring();
                    console.log('[FreeZone] 🔄 Мониторинг возобновлен');
                }, CONFIG.BLOCK_DURATION);

                return true;
            }

            return false;

        } catch(e) {
            console.warn('[FreeZone] Ошибка:', e);
            return false;
        } finally {
            isProcessing = false;
        }
    }

    // ========== ПЕРЕХВАТ PLAY() ==========
    function interceptPlay() {
        const originalPlay = HTMLVideoElement.prototype.play;
        HTMLVideoElement.prototype.play = function() {
            const isAd = this.dataset?.testid === 'advert-video' ||
                        this.closest?.('[data-testid="advert"]') !== null ||
                        this.closest?.('#raichu_yasdk_container') !== null;

            if (isAd) {
                console.log('[FreeZone] 🛑 Перехвачен play() для рекламы');
                this.pause();
                this.muted = true;
                this.volume = 0;
                this.currentTime = 0;
                try {
                    this.src = '';
                    this.load();
                } catch(e) {}
                return Promise.resolve();
            }
            return originalPlay.call(this);
        };

        const origCreateElement = document.createElement;
        document.createElement = function(tagName, options) {
            const el = origCreateElement.call(this, tagName, options);
            if (tagName.toLowerCase() === 'video') {
                const origSetAttr = el.setAttribute.bind(el);
                el.setAttribute = function(name, value) {
                    origSetAttr(name, value);
                    if (name === 'data-testid' && value === 'advert-video') {
                        setTimeout(() => {
                            try {
                                el.pause();
                                el.muted = true;
                                el.volume = 0;
                                el.currentTime = 0;
                                el.src = '';
                                el.load();
                                el.style.display = 'none';
                            } catch(e) {}
                        }, 0);
                    }
                    return el;
                };
                return el;
            }
            return el;
        };
    }

    // ========== ПЕРЕХВАТ ИЗМЕНЕНИЯ ГРОМКОСТИ ==========
    function interceptVolumeChanges() {
        document.addEventListener('volumechange', function(e) {
            const video = e.target;
            if (video && video.dataset?.testid === 'video') {
                savedVolume = video.volume;
                savedMuted = video.muted;
                console.log(`[FreeZone] 📢 Громкость изменена: ${Math.round(savedVolume * 100)}%`);
            }
        }, true);
    }

    // ========== МОНИТОРИНГ ==========
    function startMonitoring() {
        if (observer) {
            try { observer.disconnect(); } catch(e) {}
            observer = null;
        }
        if (intervalId) {
            clearInterval(intervalId);
            intervalId = null;
        }

        observer = new MutationObserver(() => {
            if (isBlocked || isProcessing) return;

            if (debounceTimer) clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
                killAdCompletely();
                debounceTimer = null;
            }, CONFIG.DEBOUNCE_DELAY);
        });

        try {
            observer.observe(document.body, {
                childList: true,
                subtree: true,
                attributes: true,
                attributeFilter: ['style', 'display', 'src', 'data-testid']
            });
        } catch(e) {}

        intervalId = setInterval(() => {
            if (!isBlocked && !isProcessing) {
                killAdCompletely();
            }
        }, CONFIG.CHECK_INTERVAL);

        console.log('[FreeZone] 🟢 Мониторинг запущен');
    }

    function stopMonitoring() {
        if (observer) {
            try { observer.disconnect(); } catch(e) {}
            observer = null;
        }
        if (intervalId) {
            clearInterval(intervalId);
            intervalId = null;
        }
        if (debounceTimer) {
            clearTimeout(debounceTimer);
            debounceTimer = null;
        }
    }

    // ========== ИНИЦИАЛИЗАЦИЯ ==========
    function init() {
        interceptPlay();
        interceptVolumeChanges();

        setTimeout(() => {
            const mainVideo = findMainVideo();
            if (mainVideo) {
                savedVolume = mainVideo.volume || 1;
                savedMuted = mainVideo.muted || false;
                console.log(`[FreeZone] 💾 Начальная громкость: ${Math.round(savedVolume * 100)}%`);
            }
        }, 500);

        setTimeout(() => killAdCompletely(), 300);
        setTimeout(() => killAdCompletely(), 800);
        setTimeout(() => killAdCompletely(), 1500);

        setTimeout(startMonitoring, 500);

        window.addEventListener('beforeunload', () => {
            stopMonitoring();
            if (blockTimer) clearTimeout(blockTimer);
            if (debounceTimer) clearTimeout(debounceTimer);
        });

        console.log('[FreeZone] 🟢 Защита активирована');
    }

    // Запуск
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();