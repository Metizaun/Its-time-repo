import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { BrowserRouter, Navigate, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/hooks/useAuth";
import { OrganizationProvider } from "@/hooks/useOrganizationContext";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import Index from "./pages/Index";
import Auth from "./pages/Auth";
import ResetPassword from "./pages/ResetPassword";
import Dashboard from "./pages/Dashboard";
import Contacts from "./pages/Contacts";
import Companies from "./pages/Companies";
import Leads from "./pages/Leads";
import Lists from "./pages/Lists";
import Deals from "./pages/Deals";
import Tasks from "./pages/Tasks";
import Calendar from "./pages/Calendar";
import Reports from "./pages/Reports";
import Settings from "./pages/Settings";
import SearchResults from "./pages/SearchResults";
import Search from "./pages/Search";
import Partners from "./pages/Partners";
import Notes from "./pages/Notes";
import AIAssistant from "./pages/AIAssistant";
import Create from "./pages/Create";
import Notifications from "./pages/Notifications";
import Inbox from "./pages/Inbox";
import InstagramAnalyzer from "./pages/InstagramAnalyzer";
import InstagramAnalyzerChat from "./pages/InstagramAnalyzerChat";
import InstagramProject from "./pages/InstagramProject";
import NotFound from "./pages/NotFound";
import { MainLayout } from "./components/layout/MainLayout";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <ThemeProvider attribute="class" defaultTheme="light" enableSystem>
      <AuthProvider>
        <OrganizationProvider>
          <TooltipProvider>
            <Toaster />
            <Sonner />
            <BrowserRouter>
              <Routes>
                <Route path="/" element={<Index />} />
                <Route path="/auth" element={<Auth />} />
                <Route path="/reset-password" element={<ResetPassword />} />
                <Route path="/dashboard" element={<ProtectedRoute><MainLayout><Dashboard /></MainLayout></ProtectedRoute>} />
                <Route path="/contacts" element={<ProtectedRoute><MainLayout><Contacts /></MainLayout></ProtectedRoute>} />
                <Route path="/companies" element={<ProtectedRoute><MainLayout><Companies /></MainLayout></ProtectedRoute>} />
                <Route path="/leads" element={<ProtectedRoute><MainLayout><Leads /></MainLayout></ProtectedRoute>} />
                <Route path="/lists" element={<ProtectedRoute><MainLayout><Lists /></MainLayout></ProtectedRoute>} />
                <Route path="/deals" element={<ProtectedRoute><MainLayout><Deals /></MainLayout></ProtectedRoute>} />
                <Route path="/partners" element={<ProtectedRoute><MainLayout><Partners /></MainLayout></ProtectedRoute>} />
                <Route path="/tasks" element={<ProtectedRoute><MainLayout><Tasks /></MainLayout></ProtectedRoute>} />
                <Route path="/calendar" element={<ProtectedRoute><MainLayout fluid><Calendar /></MainLayout></ProtectedRoute>} />
                <Route path="/reports" element={<ProtectedRoute><MainLayout><Reports /></MainLayout></ProtectedRoute>} />
                <Route path="/notifications" element={<ProtectedRoute><MainLayout><Notifications /></MainLayout></ProtectedRoute>} />
                <Route path="/inbox" element={<ProtectedRoute><MainLayout fluid noPadding><Inbox /></MainLayout></ProtectedRoute>} />
                <Route path="/settings" element={<ProtectedRoute><MainLayout><Settings /></MainLayout></ProtectedRoute>} />
                <Route path="/search" element={<ProtectedRoute><MainLayout><Search /></MainLayout></ProtectedRoute>} />
                <Route path="/search-results" element={<ProtectedRoute><MainLayout><SearchResults /></MainLayout></ProtectedRoute>} />
                <Route path="/notes" element={<ProtectedRoute><MainLayout><Notes /></MainLayout></ProtectedRoute>} />
                <Route path="/ai-assistant" element={<ProtectedRoute><MainLayout fluid noPadding><AIAssistant /></MainLayout></ProtectedRoute>} />
                <Route path="/create" element={<ProtectedRoute><MainLayout><Create /></MainLayout></ProtectedRoute>} />
                <Route path="/instagram-analyzer" element={<ProtectedRoute><MainLayout fluid><InstagramAnalyzer /></MainLayout></ProtectedRoute>} />
                <Route path="/instagram-analyzer/chat" element={<ProtectedRoute><MainLayout><InstagramAnalyzerChat /></MainLayout></ProtectedRoute>} />
                <Route path="/instagram-analyzer/projects/:projectId" element={<ProtectedRoute><MainLayout fluid><InstagramProject /></MainLayout></ProtectedRoute>} />
                <Route path="/composer" element={<ProtectedRoute><Navigate to="/create" replace /></ProtectedRoute>} />
                {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
                <Route path="*" element={<NotFound />} />
              </Routes>
            </BrowserRouter>
          </TooltipProvider>
        </OrganizationProvider>
      </AuthProvider>
    </ThemeProvider>
  </QueryClientProvider>
);

export default App;
