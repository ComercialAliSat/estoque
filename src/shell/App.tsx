import { Suspense } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { BASE } from "../modules/estoque/routes";
import { SCREENS } from "../modules/estoque/screens/registry";
import { screenComponent } from "../modules/estoque/screens/load";
import { SessionProvider, useSession } from "../modules/estoque/session";
import { ErrorBox, Loading, ToastProvider } from "../modules/estoque/components/ui";
import { Component, type ReactNode } from "react";
import { Layout } from "./Layout";
import { Guard } from "./Guard";

class Boundary extends Component<{ children: ReactNode }, { err: Error | null }> {
  state = { err: null as Error | null };
  static getDerivedStateFromError(err: Error) {
    return { err };
  }
  render() {
    if (this.state.err) return <ErrorBox text={`Não foi possível abrir esta tela: ${this.state.err.message}. Volte e tente de novo.`} />;
    return this.props.children;
  }
}

function RequireAuth({ children }: { children: ReactNode }) {
  const { user } = useSession();
  const loc = useLocation();
  if (!user) return <Navigate to="/login" replace state={{ from: loc.pathname + loc.search }} />;
  return <>{children}</>;
}

export function App() {
  const publicScreens = SCREENS.filter((s) => s.paths[0].startsWith("!"));
  const appScreens = SCREENS.filter((s) => !s.paths[0].startsWith("!"));
  return (
    <ToastProvider>
      <SessionProvider>
        <Routes>
          {publicScreens.map((s) => {
            const C = screenComponent(s.code);
            return (
              <Route
                key={s.code}
                path={s.paths[0].slice(1)}
                element={<Boundary><Suspense fallback={<Loading />}><C /></Suspense></Boundary>}
              />
            );
          })}
          <Route
            path={BASE}
            element={<RequireAuth><Layout /></RequireAuth>}
          >
            {appScreens.flatMap((s) =>
              s.paths.map((path) => {
                const C = screenComponent(s.code);
                return (
                  <Route
                    key={`${s.code}${path}`}
                    {...(path === "" ? { index: true } : { path: path.slice(1) })}
                    element={
                      <Boundary>
                        <Guard screen={s}>
                          <Suspense fallback={<Loading />}><C /></Suspense>
                        </Guard>
                      </Boundary>
                    }
                  />
                );
              }),
            )}
          </Route>
          <Route path="*" element={<Navigate to={BASE} replace />} />
        </Routes>
      </SessionProvider>
    </ToastProvider>
  );
}
