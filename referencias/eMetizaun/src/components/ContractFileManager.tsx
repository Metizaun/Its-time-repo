import { useState } from "react";
import { Upload, Download, Trash2, FileText, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { usePartners, PartnerContract } from "@/hooks/usePartners";
import { useToast } from "@/hooks/use-toast";

interface ContractFileManagerProps {
  contract: PartnerContract;
  onFileUpdated: () => void;
}

export function ContractFileManager({ contract, onFileUpdated }: ContractFileManagerProps) {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const { uploadContractFile, downloadContractFile, deleteContractFile, updatePartnerContract } = usePartners();
  const { toast } = useToast();

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      // Check file size (20MB limit)
      if (file.size > 20 * 1024 * 1024) {
        toast({
          title: "File too large",
          description: "Please select a file smaller than 20MB.",
          variant: "destructive",
        });
        return;
      }
      setSelectedFile(file);
    }
  };

  const handleUpload = async () => {
    if (!selectedFile) return;

    try {
      setUploading(true);
      await uploadContractFile(contract.id, selectedFile);
      
      toast({
        title: "File uploaded",
        description: "Contract document has been uploaded successfully.",
      });
      
      setSelectedFile(null);
      onFileUpdated();
    } catch (error) {
      toast({
        title: "Upload failed",
        description: "Failed to upload contract document. Please try again.",
        variant: "destructive",
      });
    } finally {
      setUploading(false);
    }
  };

  const handleDownload = async () => {
    if (!contract.file_url) return;

    try {
      const blob = await downloadContractFile(contract.file_url);
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${contract.title}.pdf`;
      document.body.appendChild(link);
      link.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(link);
    } catch (error) {
      toast({
        title: "Download failed",
        description: "Failed to download contract document.",
        variant: "destructive",
      });
    }
  };

  const handleDelete = async () => {
    if (!contract.file_url) return;

    try {
      await deleteContractFile(contract.file_url);
      await updatePartnerContract(contract.id, { file_url: undefined });
      
      toast({
        title: "File deleted",
        description: "Contract document has been deleted.",
      });
      
      setShowDeleteDialog(false);
      onFileUpdated();
    } catch (error) {
      toast({
        title: "Delete failed",
        description: "Failed to delete contract document.",
        variant: "destructive",
      });
    }
  };

  const removeSelectedFile = () => {
    setSelectedFile(null);
    const fileInput = document.getElementById(`contract-file-${contract.id}`) as HTMLInputElement;
    if (fileInput) {
      fileInput.value = '';
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center space-x-2">
          <FileText className="h-5 w-5" />
          <span>Contract Document</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {contract.file_url ? (
          /* Existing File */
          <div className="flex items-center justify-between p-4 border rounded-lg">
            <div className="flex items-center space-x-3">
              <div className="h-10 w-10 bg-primary/10 rounded-lg flex items-center justify-center">
                <FileText className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="font-medium">Contract Document</p>
                <p className="text-sm text-muted-foreground">
                  {contract.title}.pdf
                </p>
              </div>
            </div>
            <div className="flex items-center space-x-2">
              <Button size="sm" variant="outline" onClick={handleDownload}>
                <Download className="h-4 w-4 mr-2" />
                Download
              </Button>
              <Button 
                size="sm" 
                variant="outline" 
                onClick={() => setShowDeleteDialog(true)}
                className="text-destructive hover:text-destructive"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </div>
        ) : selectedFile ? (
          /* File Selected for Upload */
          <div className="space-y-4">
            <div className="flex items-center justify-between p-4 border rounded-lg">
              <div className="flex items-center space-x-3">
                <div className="h-10 w-10 bg-primary/10 rounded-lg flex items-center justify-center">
                  <Upload className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p className="font-medium">{selectedFile.name}</p>
                  <p className="text-sm text-muted-foreground">
                    {(selectedFile.size / (1024 * 1024)).toFixed(2)} MB
                  </p>
                </div>
              </div>
              <Button
                size="sm"
                variant="ghost"
                onClick={removeSelectedFile}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="flex items-center space-x-2">
              <Button 
                onClick={handleUpload} 
                disabled={uploading}
                size="sm"
              >
                {uploading ? "Uploading..." : "Upload Document"}
              </Button>
              <Button 
                variant="outline" 
                onClick={removeSelectedFile}
                size="sm"
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          /* No File - Upload Area */
          <div className="border-2 border-dashed border-gray-200 rounded-lg p-8">
            <div className="text-center">
              <Upload className="mx-auto h-12 w-12 text-gray-400" />
              <div className="mt-4">
                <label htmlFor={`contract-file-${contract.id}`} className="cursor-pointer">
                  <span className="text-lg font-medium text-primary hover:text-primary/80">
                    Upload contract document
                  </span>
                  <input
                    id={`contract-file-${contract.id}`}
                    type="file"
                    className="hidden"
                    accept=".pdf,.doc,.docx,.txt,.png,.jpg,.jpeg"
                    onChange={handleFileSelect}
                  />
                </label>
              </div>
              <p className="text-sm text-muted-foreground mt-2">
                PDF, DOC, DOCX, TXT, images up to 20MB
              </p>
            </div>
          </div>
        )}

        <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete Contract Document</AlertDialogTitle>
              <AlertDialogDescription>
                Are you sure you want to delete this contract document? This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction 
                onClick={handleDelete}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                Delete Document
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  );
}