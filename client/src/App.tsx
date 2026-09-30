import { Switch, Route } from "wouter";
import GrassInteractive from "./pages/GrassInteractive";
import Home from "./pages/Home";
import NotFound from "./pages/NotFound";

export default function App() {
  return (
    <Switch>
      {/* Main radar classifier app — grass animation is embedded inside */}
      <Route path="/" component={Home} />
      {/* Standalone full-page grass demo */}
      <Route path="/grass" component={GrassInteractive} />
      <Route component={NotFound} />
    </Switch>
  );
}
