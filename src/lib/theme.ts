/**
 * Light and dark themes.
 *
 * The theme is `data-theme` on <html>, `'light'` or `'dark'`. Every colour in
 * the stylesheet and the accent layer (lib/accent.ts) is a custom property
 * with a value per theme, so that one attribute repaints the whole page --
 * charts included, since they paint with `var()` too.
 *
 * The CHOICE is 'dark', 'light' or 'system', kept per browser in
 * localStorage. It is a viewing preference, not part of the history, so it
 * does not belong in the database the way renames do: two browsers may well
 * want different themes. Dark is the default because it is what this
 * dashboard has always been; 'system' follows the OS and keeps following it.
 *
 * It is applied by `THEME_SCRIPT`, inlined at the top of <head>, BEFORE first
 * paint -- a stylesheet or an effect would paint one frame of the wrong theme
 * on every navigation that reloads the page. The same script is what the
 * toggle calls after a change, so there is exactly one implementation.
 */

export type ThemeChoice = 'dark' | 'light' | 'system';

export const THEME_KEY = 'du-theme';

/** The page canvas per theme, for the browser/installed-app title bar. */
export const THEME_COLORS = { dark: '#000000', light: '#f4f5f7' } as const;

/**
 * Resolves the stored choice, sets `data-theme` and `color-scheme` (native
 * controls, scrollbars and the colour picker follow it), updates the
 * theme-color meta, and keeps following the OS while the choice is 'system'.
 * Exposed as `window.__duTheme()` for the toggle, and re-run on `storage` so a
 * change in one tab reaches the others.
 *
 * Plain ES5 and wrapped in try/catch: it runs before anything else, and
 * localStorage throws in some private modes.
 */
export const THEME_SCRIPT = `(function(){
var mq=window.matchMedia('(prefers-color-scheme: light)');
function choice(){try{return localStorage.getItem('${THEME_KEY}')||'dark'}catch(e){return 'dark'}}
function apply(){
var c=choice(),t=c==='system'?(mq.matches?'light':'dark'):(c==='light'?'light':'dark'),d=document.documentElement;
d.setAttribute('data-theme',t);d.style.colorScheme=t;
var m=document.querySelector('meta[name="theme-color"]');
if(m)m.setAttribute('content',t==='light'?'${THEME_COLORS.light}':'${THEME_COLORS.dark}');
}
apply();
if(mq.addEventListener)mq.addEventListener('change',apply);
window.addEventListener('storage',function(e){if(e.key==='${THEME_KEY}')apply()});
document.addEventListener('DOMContentLoaded',apply);
window.__duTheme=apply;
})();`;
