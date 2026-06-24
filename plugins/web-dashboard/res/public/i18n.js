
const I18n = {
    currentLang: localStorage.getItem('lang') || (navigator.language.startsWith('zh') ? 'zh' : 'en'),
    locales: {},
    isReady: false,

    async init() {
        await this.loadLocale(this.currentLang);
        this.isReady = true;
        this.applyTranslations();
        this.updateToggleButton();
        document.dispatchEvent(new Event('i18nReady'));
    },

    async loadLocale(lang) {
        try {
            const response = await fetch(`/locales/${lang}.json`);
            this.locales = await response.json();
            this.currentLang = lang;
            localStorage.setItem('lang', lang);
        } catch (error) {
            console.error('Failed to load locale:', lang, error);
        }
    },

    t(key, params = {}) {
        const keys = key.split('.');
        let value = this.locales;
        for (const k of keys) {
            if (value && value[k]) {
                value = value[k];
            } else {
                return key;
            }
        }
        
        // Handle placeholders like {user}
        if (typeof value === 'string') {
            Object.keys(params).forEach(param => {
                value = value.replace(`{${param}}`, params[param]);
            });
        }
        return value;
    },

    async toggleLanguage() {
        const newLang = this.currentLang === 'zh' ? 'en' : 'zh';
        await this.loadLocale(newLang);
        location.reload(); // Simplest way to re-render everything
    },

    applyTranslations() {
        // Data-i18n attribute based translation
        document.querySelectorAll('[data-i18n]').forEach(el => {
            const key = el.getAttribute('data-i18n');
            el.textContent = this.t(key);
        });
        
        // Update placeholders
        document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
            const key = el.getAttribute('data-i18n-placeholder');
            el.placeholder = this.t(key);
        });

        // Update titles/titles
        document.querySelectorAll('[data-i18n-title]').forEach(el => {
            const key = el.getAttribute('data-i18n-title');
            el.title = this.t(key);
        });
    },

    updateToggleButton() {
        const btn = document.getElementById('lang-toggle-text');
        if (btn) {
            btn.textContent = this.t('common.lang_toggle');
        }
    }
};

window.I18n = I18n;
