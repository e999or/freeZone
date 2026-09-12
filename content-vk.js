// content-vk.js — блокировка рекламы в VK Video (vkvideo.ru, vk.com/video)
// Стратегия: скрыть + замьютить + форсировать окончание рекламы.
// НЕ удаляем DOM-узлы — иначе плеер зависает в фазе "ad-playing" с чёрным экраном.
(function () {
    'use strict';

    if (window.__fzVKLoaded) return;
    window.__fzVKLoaded = true;

    const HOST_RE = /(^|\.)vk(video)?\.(ru|com)$/;
    if (!HOST_RE.test(location.hostname)) return;

    console.log('[FreeZone/VK] 🚀 Запуск на VK Video');

    // ========== КОНФИГ ==========
    const CONFIG = {
        PATCH_INTERVAL: 1000,   // как часто проверять shadowRoot
        CLEANUP_DEBOUNCE: 50,   // мс, чтобы не дёргать DOM в цикле
        DEBUG: true,
    };

    // Рекламные селекторы ВНУТРИ Shadow DOM
    const AD_SELECTORS = [
        '.ads-container',
        '[data-testid="ad-container"]',
        '[data-testid="ad-timeline"]',
        '.rb-adman-ad-actions',
        '.rb-adman-cta-block-wrapper',
        '[data-testid="ad-skip-button"]',
    ];

    // Рекламные селекторы В light DOM (слот annotation)
    const LIGHT_AD_SELECTORS = [
        'vk-video-player a[href*="vkpremium"]',
        '.PlayerOverlayContainer__container--oooa7 a[href*="vkpremium"]',
    ];

    // CSS-скрытие: реклама остаётся в DOM (движок её не пересоздаёт),
    // но визуально её нет, и клики по ней невозможны.
    const CSS_HIDE = `
        ${AD_SELECTORS.join(',\n')} {
            display: none !important;
            visibility: hidden !important;
            opacity: 0 !important;
            pointer-events: none !important;
            width: 0 !important;
            height: 0 !important;
            overflow: hidden !important;
            position: absolute !important;
            z-index: -9999 !important;
        }
        ${LIGHT_AD_SELECTORS.join(',\n')} {
            display: none !important;
            visibility: hidden !important;
        }
    `;

    // ========== УТИЛИТЫ ==========
    const log = (...a) => CONFIG.DEBUG && console.log('[FreeZone/VK]', ...a);

    function getHost() {
        return document.querySelector('vk-video-player .shadow-root-container');
    }

    function getSR() {
        const host = getHost();
        return host && host.shadowRoot ? host.shadowRoot : null;
    }

    function isAdVideo(v) {
        return v && v.src && (
            v.src.includes('mradx.net') ||
            v.src.includes('/vrs/') ||
            v.src.includes('r.mradx')
        );
    }

    // ========== СОСТОЯНИЕ ==========
    let cleanupTimer = null;
    let blockCount = 0;
    let lastAdState = false;

    // ========== ОСНОВНАЯ ЛОГИКА ==========
    function scheduleCleanup(reason) {
        if (cleanupTimer) return;
        cleanupTimer = setTimeout(() => {
            cleanupTimer = null;
            cleanup(reason);
        }, CONFIG.CLEANUP_DEBOUNCE);
    }

    function cleanup(reason = 'scheduled') {
        const sr = getSR();
        if (!sr) return;

        // 1. Инъектим CSS-скрытие один раз на каждый shadowRoot
        if (!sr.__fz_cssInjected) {
            const style = document.createElement('style');
            style.setAttribute('data-fz', 'vk');
            style.textContent = CSS_HIDE;
            sr.appendChild(style);
            sr.__fz_cssInjected = true;
            log('CSS-скрытие рекламы внедрено в shadowRoot');
        }

        // 2. Мьютим + форсируем окончание рекламного <video>
        let adVideoFound = false;
        sr.querySelectorAll('video').forEach(v => {
            if (!isAdVideo(v)) return;
            adVideoFound = true;

            try { v.muted = true; } catch (e) {}
            try { v.volume = 0; } catch (e) {}

            // Форсируем окончание: перемотка в конец + событие 'ended'.
            // Плеер получает сигнал «реклама закончилась» и переключается
            // на основной контент быстрее, чем по своему таймауту.
            try {
                if (v.duration && isFinite(v.duration) && v.duration > 0.1) {
                    if (v.currentTime < v.duration - 0.2) {
                        v.currentTime = Math.max(0, v.duration - 0.1);
                    }
                }
            } catch (e) {}

            try {
                v.dispatchEvent(new Event('ended', { bubbles: true }));
                v.dispatchEvent(new Event('timeupdate', { bubbles: true }));
            } catch (e) {}
        });

        // 3. Прячем Premium-кнопку в light DOM
        LIGHT_AD_SELECTORS.forEach(sel => {
            document.querySelectorAll(sel).forEach(el => {
                el.style.setProperty('display', 'none', 'important');
                el.style.setProperty('visibility', 'hidden', 'important');
            });
        });

        // 4. Логируем только смену состояния
        if (adVideoFound && !lastAdState) {
            lastAdState = true;
            blockCount++;
            log(`🚫 Реклама обнаружена (блок #${blockCount})`);
            try {
                chrome.runtime?.sendMessage?.({
                    type: 'AD_BLOCKED',
                    count: 1,
                    site: 'vkvideo',
                });
            } catch (e) {}
        } else if (!adVideoFound && lastAdState) {
            lastAdState = false;
            log('✅ Реклама закончилась, основное видео пошло');
        }

        // 5. Если основное видео уже с src, но на паузе — пробуем запустить
        const main = sr.querySelector('.video-container video');
        if (main && main.src && main.paused) {
            main.play().catch(() => {});
        }
    }

    // ========== MUTATION OBSERVER НА АКТУАЛЬНЫЙ SHADOWROOT ==========
    let currentSR = null;
    let srObserver = null;

    function attachToShadowRoot() {
        const sr = getSR();
        if (!sr) return;
        if (sr === currentSR && srObserver) return;

        if (srObserver) {
            try { srObserver.disconnect(); } catch (e) {}
            srObserver = null;
        }

        currentSR = sr;

        srObserver = new MutationObserver(() => {
            scheduleCleanup('shadow-mutation');
        });
        srObserver.observe(sr, {
            childList: true,
            subtree: true,
            // attributes НЕ наблюдаем: плеер дёргает их сотни раз в секунду
        });

        log('Observer привязан к shadowRoot');
        cleanup('shadow-attached');
    }

    // ========== НАБЛЮДЕНИЕ ЗА LIGHT DOM (плеер может пересоздаваться) ==========
    const lightObserver = new MutationObserver(() => {
        attachToShadowRoot();
    });
    lightObserver.observe(document.documentElement, {
        childList: true,
        subtree: true,
    });

    // ========== ПЕРЕХВАТ attachShadow (на случай closed-режима) ==========
    (function hookAttachShadow() {
        const orig = Element.prototype.attachShadow;
        Element.prototype.attachShadow = function (init) {
            const sr = orig.call(this, init);
            if (sr && !sr.__fz_hooked) {
                sr.__fz_hooked = true;
                setTimeout(() => attachToShadowRoot(), 0);
            }
            return sr;
        };
        log('attachShadow перехвачен');
    })();

    // ========== ПЕРЕХВАТ play() ДЛЯ РЕКЛАМНОГО ВИДЕО ==========
    (function hookPlay() {
        const origPlay = HTMLVideoElement.prototype.play;
        HTMLVideoElement.prototype.play = function () {
            if (isAdVideo(this)) {
                try {
                    this.muted = true;
                    this.volume = 0;
                } catch (e) {}
            }
            return origPlay.apply(this, arguments);
        };
        log('play() перехвачен');
    })();

    // ========== ПЕРИОДИЧЕСКАЯ ПРОВЕРКА ==========
    setInterval(() => {
        attachToShadowRoot();
        scheduleCleanup('interval');
    }, CONFIG.PATCH_INTERVAL);

    // ========== ПЕРВЫЙ ЗАПУСК ==========
    setTimeout(() => attachToShadowRoot(), 300);
    setTimeout(() => attachToShadowRoot(), 1000);
    setTimeout(() => attachToShadowRoot(), 2500);

    // ========== БЛОКИРОВКА ТЕЛЕМЕТРИИ VK (чтобы не засорять консоль) ==========
    (function blockVKTelemetry() {
        const TELEMETRY = ['stats.vk-portal.net', 'akashi.vk-portal.net'];
        const origFetch = window.fetch;
        window.fetch = function (input, init) {
            const url = typeof input === 'string' ? input : input?.url;
            if (url && TELEMETRY.some(d => url.includes(d))) {
                return Promise.resolve(new Response('', { status: 204 }));
            }
            return origFetch.apply(this, arguments);
        };
        log('Телеметрия VK заблокирована');
    })();

    // ========== ПУБЛИЧНЫЙ API ==========
    window.__fzVK = {
        cleanup: () => cleanup('manual'),
        status() {
            const sr = getSR();
            if (!sr) return console.log('[FreeZone/VK] shadowRoot не найден');
            console.table({
                adsContainer: !!sr.querySelector('.ads-container'),
                adContainer: !!sr.querySelector('[data-testid="ad-container"]'),
                adTimeline: !!sr.querySelector('[data-testid="ad-timeline"]'),
                adActions: !!sr.querySelector('.rb-adman-ad-actions'),
                cta: !!sr.querySelector('.rb-adman-cta-block-wrapper'),
                adVideos: [...sr.querySelectorAll('video')].filter(isAdVideo).length,
                mainVideoSrc: sr.querySelector('.video-container video')?.src || '(пусто)',
                mainVideoPaused: sr.querySelector('.video-container video')?.paused,
            });
        },
        getSR,
    };

    log('Готово. Команды: __fzVK.status(), __fzVK.cleanup()');
})();