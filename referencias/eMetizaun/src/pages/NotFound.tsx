import { useLocation, Link } from "react-router-dom";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Home, ArrowLeft } from "lucide-react";

const NotFound = () => {
  const location = useLocation();

  useEffect(() => {
    console.error("404 Error: User attempted to access non-existent route:", location.pathname);
  }, [location.pathname]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-background to-muted/50">
      <div className="text-center space-y-6 p-8 max-w-md">
        <div className="space-y-4">
          <div className="relative">
            <h1 className="text-8xl font-bold text-primary/20 select-none">404</h1>
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center animate-pulse">
                <div className="w-8 h-8 rounded-full bg-primary/20"></div>
              </div>
            </div>
          </div>
          <h2 className="text-2xl font-semibold text-foreground">Page Not Found</h2>
          <p className="text-muted-foreground max-w-sm mx-auto leading-relaxed">
            The page you're looking for doesn't exist or has been moved to another location.
          </p>
        </div>
        
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Button asChild variant="default" className="group">
            <Link to="/">
              <Home className="w-4 h-4 mr-2 group-hover:scale-110 transition-transform" />
              Go Home
            </Link>
          </Button>
          <Button asChild variant="outline" className="group">
            <button onClick={() => window.history.back()}>
              <ArrowLeft className="w-4 h-4 mr-2 group-hover:translate-x-0.5 transition-transform" />
              Go Back
            </button>
          </Button>
        </div>
        
        <div className="text-xs text-muted-foreground/60">
          Attempted to access: <code className="bg-muted px-1 py-0.5 rounded text-xs">{location.pathname}</code>
        </div>
      </div>
    </div>
  );
};

export default NotFound;
