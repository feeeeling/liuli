function applyAppearance(value) {
  document.documentElement.dataset.appearance = value.dark ? "dark" : "light";
  document.documentElement.classList.toggle("native-glass", value.nativeGlass);
  document.documentElement.classList.toggle("reduced-transparency", value.reducedTransparency || value.highContrast);
}
window.liuli.onAppearance(applyAppearance);
void window.liuli.appearance().then(applyAppearance);
