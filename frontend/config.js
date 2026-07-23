// Local API keys and other external-service config.
//
// Values set here take priority over anything the user pastes into the UI
// (which is kept in localStorage as a fallback). Leave any field blank if
// you'd rather manage it via the UI + browser storage.
//
// NOTE: this file is served to the browser, so any key placed here is
// visible to anyone who opens the page in devtools. Fine for a local tool
// running on your own machine; do not deploy this file to a public host
// without moving the key server-side first.
window.APP_CONFIG = {
  // Get a free key at https://basemaps.linz.govt.nz -> Login -> API Keys.
  LINZ_API_KEY: "",
};
