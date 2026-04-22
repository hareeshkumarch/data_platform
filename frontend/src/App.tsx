import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useThemeSync } from "@/hooks/useThemeSync";
import Insights from "./pages/Insights";
import DataSources from "./pages/DataSources";
import DataCleaning from "./pages/DataCleaning";
import Query from "./pages/Query";
import Dashboards from "./pages/Dashboards";
import Reports from "./pages/Reports";
import Settings from "./pages/Settings";
import NotFound from "./pages/NotFound";
import { CommandPalette } from "@/components/ui/CommandPalette";
import { Component, ErrorInfo, ReactNode } from "react";

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  constructor(props: any) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, errorInfo: ErrorInfo) {}
  render() {
    if (this.state.error) {
      return (
        <div className="fixed inset-0 z-[9999] bg-white p-10 text-red-500 font-mono overflow-auto">
          <h1 className="text-xl font-bold mb-4 flex items-center gap-2">
            <span className="p-1 bg-red-100 rounded">⚠️</span> Application Crash
          </h1>
          <div className="bg-red-50 p-6 rounded-xl border border-red-200 shadow-sm">
            <p className="font-bold mb-2">Error Message:</p>
            <p className="mb-4">{this.state.error.message}</p>
            <p className="font-bold mb-2">Stack Trace:</p>
            <pre className="text-xs whitespace-pre-wrap leading-relaxed opacity-80">
              {this.state.error.stack}
            </pre>
          </div>
          <div className="mt-8 flex gap-4">
            <button 
              onClick={() => window.location.reload()} 
              className="bg-red-500 hover:bg-red-600 text-white px-6 py-2.5 rounded-lg font-medium transition-colors shadow-md"
            >
              Refresh Application
            </button>
            <button 
              onClick={() => { localStorage.clear(); window.location.href = "/"; }} 
              className="bg-white border border-red-200 text-red-600 px-6 py-2.5 rounded-lg font-medium hover:bg-red-50 transition-colors"
            >
              Clear Local Storage & Reset
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}


const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 10_000, refetchOnWindowFocus: false } },
});

const ThemedApp = () => {
  useThemeSync();
  return (
    <BrowserRouter>
      <CommandPalette />
      <Routes>
        <Route path="/" element={<Insights />} />
        <Route path="/data" element={<DataSources />} />
        <Route path="/cleaning" element={<DataCleaning />} />
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
    <ErrorBoundary>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <ThemedApp />
      </TooltipProvider>
    </ErrorBoundary>
  </QueryClientProvider>
);

export default App;
