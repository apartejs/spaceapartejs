import { mount } from 'svelte';

// The stylesheet before the package: the elements it styles are registered by that second
// import, so this is the order that gives them their rules first. It is tidiness, not a
// fix — see the composer note in `App.svelte`, and what it took to find that out.
import '@aparte/core/styles.css';
import '@aparte/core';

import './styles/tokens.css';
import './styles/scene.css';

import App from './App.svelte';

const target = document.getElementById('app');
if (!target) throw new Error('#app is missing from index.html');

export default mount(App, { target });
