import { mount } from 'svelte';

// THE STYLESHEET FIRST, and the order is load-bearing rather than tidy.
//
// Importing the package registers the <aparte-*> custom elements, and the composer sizes
// its editor by measuring `scrollHeight` and writing the answer back as an inline
// `height`. Measured before the stylesheet lands, the editor is stretched by its parent,
// the measurement comes back at the auto-grow ceiling, and an EMPTY composer is frozen at
// 200px tall — a `height: 200px` that no reflow takes back.
//
// In dev that is a real race: Vite injects CSS from JavaScript, so `styles.css` used to
// arrive after the elements it styles. It showed up on the very first load after a server
// start and vanished on every reload afterwards, which is what made it look like an HMR
// artefact — it was the opposite. The production build links the CSS in <head> and never
// showed it. Importing the stylesheet first closes the window in both.
import '@aparte/core/styles.css';
import '@aparte/core';

import './styles/tokens.css';
import './styles/scene.css';

import App from './App.svelte';

const target = document.getElementById('app');
if (!target) throw new Error('#app is missing from index.html');

export default mount(App, { target });
