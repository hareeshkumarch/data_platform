import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useThemeSync } from "@/hooks/useThemeSync";
import Insights from "./pages/Insights";
import DataSources from "./pages/DataSources";
import Query from "./pages/Query";
import Dashboards from "./pages/Dashboards";
import Reports from "./pages/Reports";
import Settings from "./pages/Settings";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 10_000, refetchOnWindowFocus: false } },
});

const ThemedApp = () => {
  useThemeSync();
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Insights />} />
        <Route path="/data" element={<DataSources />} />
        <Route path="/query" element={<Query />} />
        <Route path="/dashboards" element={<Dashboards />} />
        <Route path="/reports" element={<Reports />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </BrowserRouter>
  );
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <ThemedApp />
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
