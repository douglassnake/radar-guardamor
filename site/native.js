(() => {
  const cap = window.Capacitor;
  const isNative = Boolean(cap && typeof cap.isNativePlatform === "function" && cap.isNativePlatform());
  if (!isNative) return;
  document.documentElement.classList.add("native-app");
  const install = document.getElementById("installDialog");
  if (install) install.remove();
})();
