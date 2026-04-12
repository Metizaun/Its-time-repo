import { useApp } from "@/context/AppContext";
import { LeadModal } from "./LeadModal";
import { LeadDrawer } from "@/components/drawers/LeadDrawer";
import { StageModal } from "@/components/kanban/StageModal";
import { DeleteStageModal } from "@/components/kanban/DeleteStageModal";

export function ModalManager() {
  const { ui, closeModal } = useApp();

  return (
    <>
      {ui.modal?.type === "createLead" && (
        <LeadModal isOpen={true} onClose={closeModal} />
      )}

      {ui.modal?.type === "STAGE_FORM" && (
        <StageModal 
          isOpen={true} 
          onClose={closeModal} 
          stage={ui.modal.payload?.stage} 
        />
      )}

      {ui.modal?.type === "DELETE_STAGE" && (
        <DeleteStageModal 
          isOpen={true} 
          onClose={closeModal} 
          stage={ui.modal.payload?.stage} 
        />
      )}

      <LeadDrawer />
    </>
  );
}
