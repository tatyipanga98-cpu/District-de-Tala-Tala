/* Apparence : automatique (suit le système), claire ou sombre. Le choix est mémorisé sur cet appareil.
   Le CSS lit l'attribut data-theme ; sans attribut, il suit prefers-color-scheme. */
(function (root) {
  var KEY = "tt:theme";
  function get() {
    try { var v = localStorage.getItem(KEY); return v === "light" || v === "dark" ? v : "auto"; } catch (e) { return "auto"; }
  }
  function apply(v) {
    var el = document.documentElement;
    if (v === "auto") el.removeAttribute("data-theme"); else el.setAttribute("data-theme", v);
  }
  function set(v) {
    try { if (v === "auto") localStorage.removeItem(KEY); else localStorage.setItem(KEY, v); } catch (e) {}
    apply(v);
  }
  apply(get());
  root.TTTheme = { get: get, set: set };
})(window);
