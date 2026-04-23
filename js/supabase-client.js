(function () {
  function getConfig() {
    var cfg = window.__SUPABASE_CONFIG__;
    if (!cfg || !cfg.url || !cfg.anonKey) {
      throw new Error("Не задан Supabase config. Проверьте js/supabase-config.js");
    }
    return cfg;
  }

  function createClient() {
    if (!window.supabase || !window.supabase.createClient) {
      throw new Error("Supabase SDK не загружен.");
    }
    var config = getConfig();
    return window.supabase.createClient(config.url, config.anonKey);
  }

  window.__SUPABASE__ = createClient();
})();
