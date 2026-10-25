/**
 * LINHA MORTA — entry point.
 * Fonts are bundled locally (Latin subsets only) so the game works offline and never depends on
 * external URLs.
 */
import '@fontsource/barlow-condensed/latin-300.css';
import '@fontsource/barlow-condensed/latin-500.css';
import '@fontsource/barlow/latin-400.css';
import '@fontsource/barlow/latin-500.css';
import '@fontsource/cormorant-garamond/latin-500.css';
import '@fontsource/cormorant-garamond/latin-400-italic.css';
import './styles/main.css';
import { App } from './app/App';

const app = new App();
app.start();
