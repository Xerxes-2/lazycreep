import { render } from "solid-js/web";
import { App } from "./App";
import { stripReauthParam } from "./boot/access-gate.ts";
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("#root not found");

stripReauthParam();
render(() => <App />, root);
