// content.js
class AdBlockerContent {
    constructor() {
        this.state = {
            isProcessing: false,
            isBlocked: false,
            blockTimer: null,
            observer: null,
            intervalId: null,
            timeoutId: null,
            rules: null,
            settings: null
        };
        this.initialize();
    }

    async initialize() {
        await this.loadRules();
        this.setupListeners();
        this.startBlocking();
        console.log('[AdBlocker] Content script initialized for:', window.location.hostname);
    }

    async loadRules() {
        try {
            const domain = window.location.hostname;
            const response = await chrome.runtime.sendMessage({
                type: 'GET_RULES',
                domain: domain
            });
            
            if (response) {
                this.state.rules = response.rules;
                this.state.settings = response.settings;
            }
        } catch (error) {
            console.error('[AdBlocker] Failed to load rules:', error);
        }
    }

    setupListeners() {
        // Слушаем сообщения от background
        chrome.runtime.onMessage.addListener((message) => {
            if (message.type === 'NAVIGATION') {
                this.state.rules = message.rules;
                this.state.settings = message.settings;
                if (message.rules) {
                    this.startBlocking();
                }
            }
        });

        // Слушаем изменения в DOM
        this.setupObserver();
    }

    setupObserver() {
        // Наблюдаем за изменениями в DOM
        const observer = new MutationObserver((mutations) => {
            if (this.state.isBlocked || !this.state.rules) return;
            
            let hasAd = false;
            for (const mutation of mutations) {
                if (mutation.addedNodes.length > 0) {
                    hasAd = true;
                    break;
                }
            }
            
            if (hasAd) {
                if (this.state.timeoutId) clearTimeout(this.state.timeoutId);
                this.state.timeoutId = setTimeout(() => {
                    this.handleAds();
                    this.state.timeoutId = null;
                }, this.state.settings?.debounceDelay || 300);
            }
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['style', 'class']
        });
    }

    startBlocking() {
        if (!this.state.rules) return;
        
        // Запускаем периодическую проверку
        if (this.state.intervalId) clearInterval(this.state.intervalId);
        this.state.intervalId = setInterval(() => {
            this.handleAds();
        }, this.state.settings?.checkInterval || 1000);

        // Первая проверка
        this.handleAds();
        
        console.log('[AdBlocker] Blocking started for:', window.location.hostname);
    }

    handleAds() {
        if (this.state.isProcessing || this.state.isBlocked || !this.state.rules) {
            return false;
        }

        this.state.isProcessing = true;
        let handled = false;

        try {
            const rules = this.state.rules;
            
            // Проверяем каждый тип рекламы
            for (const adType of rules.adTypes) {
                const selectors = adType.selectors || [adType.selector];
                const found = this.processAdType(adType, selectors);
                if (found) {
                    handled = true;
                    break;
                }
            }

            // Если реклама найдена - блокируем
            if (handled) {
                this.blockMonitoring();
                this.notifyBackground();
                console.log('[AdBlocker] Ad blocked successfully');
            }

            return handled;

        } catch (error) {
            console.error('[AdBlocker] Error handling ads:', error);
        } finally {
            this.state.isProcessing = false;
        }
        return false;
    }

    processAdType(adType, selectors) {
        for (const selector of selectors) {
            try {
                const elements = document.querySelectorAll(selector);
                if (elements.length > 0) {
                    console.log('[AdBlocker] Found ad with selector:', selector);
                    
                    elements.forEach(element => {
                        this.removeAdElement(element, adType);
                    });
                    
                    return true;
                }
            } catch (error) {
                console.warn('[AdBlocker] Selector error:', selector, error);
            }
        }
        return false;
    }

    removeAdElement(element, adType) {
        // Останавливаем видео/аудио
        element.querySelectorAll('video, audio, iframe').forEach(media => {
            this.stopMedia(media);
        });

        // Применяем действия в зависимости от типа
        switch (adType.action) {
            case 'remove':
                element.remove();
                break;
            case 'hide':
                element.style.display = 'none';
                break;
            case 'clean':
                this.cleanElement(element);
                break;
            default:
                element.style.display = 'none';
        }

        // Дополнительная очистка для видео
        if (adType.videoSelector) {
            const video = document.querySelector(adType.videoSelector);
            if (video) {
                this.stopMedia(video);
                video.remove();
            }
        }

        // Запускаем основное видео
        if (adType.mainVideoSelector) {
            const mainVideo = document.querySelector(adType.mainVideoSelector);
            if (mainVideo && mainVideo.paused) {
                mainVideo.play().catch(() => {});
            }
        }
    }

    stopMedia(media) {
        try {
            media.pause();
            media.currentTime = 0;
            media.muted = true;
            media.volume = 0;
            
            // Для некоторых сайтов очищаем src
            if (this.state.rules?.cleanSrc) {
                media.src = '';
                media.load();
            }
        } catch (error) {
            console.warn('[AdBlocker] Error stopping media:', error);
        }
    }

    cleanElement(element) {
        // Очищаем элемент от рекламного контента
        const children = element.children;
        for (let child of children) {
            if (child.tagName === 'VIDEO' || child.tagName === 'AUDIO') {
                this.stopMedia(child);
            }
            child.remove();
        }
        element.innerHTML = '';
        element.style.display = 'none';
    }

    blockMonitoring() {
        this.state.isBlocked = true;
        const duration = this.state.settings?.blockDuration || 5000;
        
        if (this.state.blockTimer) clearTimeout(this.state.blockTimer);
        this.state.blockTimer = setTimeout(() => {
            this.state.isBlocked = false;
            console.log('[AdBlocker] Monitoring resumed');
        }, duration);
    }

    notifyBackground() {
        chrome.runtime.sendMessage({
            type: 'AD_BLOCKED'
        }).catch(() => {});
    }
}

// Инициализация
const adBlocker = new AdBlockerContent();
