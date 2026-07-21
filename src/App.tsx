import { Suspense, lazy } from "react";
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
import { ChatUnreadProvider } from "@/contexts/ChatUnreadContext";
const Dashboard = lazy(() => import("./pages/Dashboard"));
const Pipeline = lazy(() => import("./pages/Pipeline"));
const Leads = lazy(() => import("./pages/Leads"));
const Buscar = lazy(() => import("./pages/Buscar"));
const Automacao = lazy(() => import("./pages/Automacao"));
const Admin = lazy(() => import("./pages/Admin"));
const Chat = lazy(() => import("./pages/Chat"));
const Calendar = lazy(() => import("./pages/Calendar"));
const Agentes = lazy(() => import("./pages/Agentes"));
const Auth = lazy(() => import("./pages/Auth"));
const Updates = lazy(() => import("./pages/Updates"));
const NotFound = lazy(() => import("./pages/NotFound"));

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <BrowserRouter>
        <AuthProvider>
          <ChatUnreadProvider>
          <AppProvider>
            <Toaster />
            <Sonner position="top-right" />
            <PendingApprovalModal />
            <ModalManager />
            <Suspense
              fallback={
                <div className="flex min-h-[40vh] items-center justify-center text-sm text-[var(--color-text-secondary)]">
                  Carregando pagina...
                </div>
              }
            >
              <Routes>
                <Route path="/auth" element={<Auth />} />
                <Route path="/updates" element={<Updates />} />
                <Route path="/" element={<ProtectedRoute><MainLayout><Dashboard /></MainLayout></ProtectedRoute>} />
                <Route path="/pipeline" element={<ProtectedRoute><MainLayout><Pipeline /></MainLayout></ProtectedRoute>} />
                <Route path="/chat" element={<ProtectedRoute><MainLayout><Chat /></MainLayout></ProtectedRoute>} />
                <Route path="/calendar" element={<ProtectedRoute><MainLayout><Calendar /></MainLayout></ProtectedRoute>} />
                <Route path="/leads" element={<ProtectedRoute><MainLayout><Leads /></MainLayout></ProtectedRoute>} />
                <Route path="/buscar" element={<ProtectedRoute><MainLayout><Buscar /></MainLayout></ProtectedRoute>} />
                <Route path="/automacao" element={<ProtectedRoute><MainLayout><Automacao /></MainLayout></ProtectedRoute>} />
                <Route path="/agentes" element={<ProtectedRoute><MainLayout><Agentes /></MainLayout></ProtectedRoute>} />
                <Route path="/admin" element={<ProtectedRoute><MainLayout><Admin /></MainLayout></ProtectedRoute>} />
                <Route path="*" element={<NotFound />} />
              </Routes>
            </Suspense>
          </AppProvider>
          </ChatUnreadProvider>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
