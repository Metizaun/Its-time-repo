import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import { AppProvider } from "@/context/AppContext";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { PendingApprovalModal } from "@/components/auth/PendingApprovalModal";
import { MainLayout } from "@/components/layout/MainLayout";
import { ModalManager } from "@/components/modals/ModalManager";
import Dashboard from "./pages/Dashboard";
import Pipeline from "./pages/Pipeline";
import Leads from "./pages/Leads";
import Buscar from "./pages/Buscar";
import Automacao from "./pages/Automacao";
import Admin from "./pages/Admin";
import Chat from "./pages/Chat";
import Auth from "./pages/Auth";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <BrowserRouter>
        <AuthProvider>
          <AppProvider>
            <Toaster />
            <Sonner position="top-right" />
            <PendingApprovalModal />
            <ModalManager />
            <Routes>
              <Route path="/auth" element={<Auth />} />
              <Route path="/" element={<ProtectedRoute><MainLayout><Dashboard /></MainLayout></ProtectedRoute>} />
              <Route path="/pipeline" element={<ProtectedRoute><MainLayout><Pipeline /></MainLayout></ProtectedRoute>} />
              <Route path="/chat" element={<ProtectedRoute><MainLayout><Chat /></MainLayout></ProtectedRoute>} />
              <Route path="/leads" element={<ProtectedRoute><MainLayout><Leads /></MainLayout></ProtectedRoute>} />
              <Route path="/buscar" element={<ProtectedRoute><MainLayout><Buscar /></MainLayout></ProtectedRoute>} />
              <Route path="/automacao" element={<ProtectedRoute><MainLayout><Automacao /></MainLayout></ProtectedRoute>} />
              <Route path="/admin" element={<ProtectedRoute><MainLayout><Admin /></MainLayout></ProtectedRoute>} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </AppProvider>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
