/* Chargement différé de la bibliothèque PDF (vendor/pdf-lib.min.js).
   Contrôle d'intégrité (SRI) : le fichier n'est exécuté que s'il correspond exactement à la version vérifiée.
   Délai : au bout de 30 s sans réponse, une erreur claire est signalée. */
(function () {
  var PDF_LIB_SRC = "vendor/pdf-lib.min.js";
  var PDF_LIB_SRI = "sha384-weMABwrltA6jWR8DDe9Jp5blk+tZQh7ugpCsF3JwSA53WZM9/14PjS5LAJNHNjAI";
  var TIMEOUT_MS = 30000;
  var pending = null;
  window.__loadPdfLib = function () {
    if (window.PDFLib) return Promise.resolve(window.PDFLib);
    if (pending) return pending;
    pending = new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      var timer = setTimeout(function () {
        cleanup();
        reject(new Error("La bibliothèque PDF n'a pas répondu dans le délai prévu (30 s). Vérifiez votre connexion, puis rechargez l'application."));
      }, TIMEOUT_MS);
      function cleanup() { clearTimeout(timer); pending = null; }
      s.src = PDF_LIB_SRC;
      s.integrity = PDF_LIB_SRI;
      s.onload = function () {
        cleanup();
        if (window.PDFLib) resolve(window.PDFLib);
        else reject(new Error("La bibliothèque PDF est incomplète. Rechargez l'application."));
      };
      s.onerror = function () {
        cleanup();
        reject(new Error("La bibliothèque PDF n'a pas pu être chargée. Vérifiez votre connexion, puis rechargez l'application."));
      };
      document.head.appendChild(s);
    });
    return pending;
  };
})();
