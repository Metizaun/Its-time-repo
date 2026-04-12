import { useAuth } from "@/contexts/AuthContext";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";
import { Clock } from "lucide-react";

export function PendingApprovalModal() {
  const { isPendingApproval, signOut } = useAuth();

  return (
    <AlertDialog open={isPendingApproval}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <div className="flex items-center justify-center mb-4">
            <div className="rounded-full bg-warning/20 p-3">
              <Clock className="w-8 h-8 text-warning" />
            </div>
          </div>
          <AlertDialogTitle className="text-center">
            Conta Pendente de Aprovação
          </AlertDialogTitle>
          <AlertDialogDescription className="text-center">
            Sua conta está aguardando aprovação do Administrador. 
            <br />
            Você receberá acesso assim que sua conta for aprovada.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogAction onClick={() => signOut()}>
          Fazer Logout
        </AlertDialogAction>
      </AlertDialogContent>
    </AlertDialog>
  );
}