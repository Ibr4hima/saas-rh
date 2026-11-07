/**
 * Le cadre du focus suit la navigation au clavier (ADR-0138) : `data-clavier`
 * se pose sur <html> à la touche Tab, avec ou sans Maj, et s'ôte au premier
 * clic ou toucher. La variante `focus-visible` de globals.css ne montre le
 * cadre que sous lui. Un script inline du <head>, comme celui du thème : il
 * écoute avant que la page ne s'hydrate. Une ligne, sans dépendance.
 */
export const SCRIPT_CLAVIER = `(function(){var h=document.documentElement;addEventListener('keydown',function(e){if(e.key==='Tab')h.setAttribute('data-clavier','')},true);addEventListener('pointerdown',function(){h.removeAttribute('data-clavier')},true)})()`;
