import { createDataSource } from "./data";
import { Orb, THEMES, type ThemeName } from "./orb";

const app = document.getElementById("app")!;
const button = document.getElementById("theme") as HTMLButtonElement;

let theme: ThemeName = (localStorage.getItem("jarvis-theme") as ThemeName) in THEMES
  ? (localStorage.getItem("jarvis-theme") as ThemeName)
  : "cyan";
let orb: Orb | undefined;

function applyTheme(name: ThemeName) {
  theme = name;
  localStorage.setItem("jarvis-theme", name);
  document.documentElement.style.setProperty("--accent", THEMES[name].css);
  button.textContent = `Theme: ${name}`;
  orb?.setTheme(name);
}
const toggle = () => applyTheme(theme === "cyan" ? "gold" : "cyan");
button.addEventListener("click", toggle);
window.addEventListener("keydown", (e) => e.key.toLowerCase() === "t" && toggle());
applyTheme(theme);

createDataSource()
  .getGraph()
  .then((graph) => { orb = new Orb(app, graph, theme); })
  .catch((err) => {
    console.error(err);
    document.getElementById("caption")!.textContent = "Unable to reach the graph, sir.";
  });
