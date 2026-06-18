import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Plus, Search, Pin, Edit, Trash2, Tag, User, Building } from "lucide-react";
import { useNotes } from "@/hooks/useNotes";
import { useToast } from "@/hooks/use-toast";
import { NotionStyleNoteEditor } from "@/components/NotionStyleNoteEditor";
import { useContacts } from "@/hooks/useContacts";
import { useCompanies } from "@/hooks/useCompanies";

const Notes = () => {
  const [searchTerm, setSearchTerm] = useState("");
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [editingNote, setEditingNote] = useState<any>(null);

  const { notes, loading, createNote, updateNote, deleteNote } = useNotes();
  const { contacts } = useContacts();
  const { companies } = useCompanies();
  const { toast } = useToast();

  const filteredNotes = notes?.filter(note =>
    note.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
    note.content?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    note.tags?.some((tag: string) => tag.toLowerCase().includes(searchTerm.toLowerCase()))
  ) || [];

  const handleSaveNote = async (noteData: any) => {
    try {
      if (editingNote) {
        await updateNote({ ...noteData, id: editingNote.id });
        toast({ title: "Note updated successfully" });
      } else {
        await createNote(noteData);
        toast({ title: "Note created successfully" });
      }
      setIsEditorOpen(false);
      setEditingNote(null);
    } catch (error) {
      toast({ 
        title: "Error", 
        description: editingNote ? "Failed to update note" : "Failed to create note",
        variant: "destructive" 
      });
    }
  };

  const handleEdit = (note: any) => {
    setEditingNote(note);
    setIsEditorOpen(true);
  };

  const handleDelete = async (id: string) => {
    if (confirm('Are you sure you want to delete this note?')) {
      try {
        await deleteNote(id);
        toast({ title: "Note deleted successfully" });
      } catch (error) {
        toast({ 
          title: "Error", 
          description: "Failed to delete note",
          variant: "destructive" 
        });
      }
    }
  };

  const pinnedNotes = filteredNotes.filter(note => note.is_pinned);
  const regularNotes = filteredNotes.filter(note => !note.is_pinned);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-pulse">Loading notes...</div>
      </div>
    );
  }

  return (
    <>
      {isEditorOpen && (
        <NotionStyleNoteEditor
          note={editingNote}
          onSave={handleSaveNote}
          onCancel={() => {
            setIsEditorOpen(false);
            setEditingNote(null);
          }}
        />
      )}

      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h1 className="text-3xl font-bold">Notes</h1>
            <p className="text-muted-foreground">Keep track of your thoughts and ideas</p>
          </div>

          <Button onClick={() => setIsEditorOpen(true)}>
            <Plus className="w-4 h-4 mr-2" />
            Add Note
          </Button>
        </div>

        <div className="flex items-center space-x-2">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search notes..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-8"
            />
          </div>
        </div>

        {pinnedNotes.length > 0 && (
          <div className="space-y-4">
            <h2 className="text-xl font-semibold flex items-center gap-2">
              <Pin className="w-5 h-5" />
              Pinned Notes
            </h2>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {pinnedNotes.map((note) => (
                <Card key={note.id} className="hover:shadow-md transition-shadow">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-lg flex items-start justify-between">
                      <span className="flex-1">{note.title}</span>
                      <Pin className="w-4 h-4 text-primary flex-shrink-0 ml-2" />
                    </CardTitle>
                    {note.content && (
                      <CardDescription className="line-clamp-3">
                        {note.content}
                      </CardDescription>
                    )}
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      {/* Linked entities */}
                      <div className="flex flex-wrap gap-2">
                        {note.contact_id && (() => {
                          const contact = contacts?.find(c => c.id === note.contact_id);
                          return contact ? (
                            <Badge variant="outline" className="text-xs">
                              <User className="w-3 h-3 mr-1" />
                              {contact.first_name} {contact.last_name}
                            </Badge>
                          ) : null;
                        })()}
                        {note.company_id && (() => {
                          const company = companies?.find(c => c.id === note.company_id);
                          return company ? (
                            <Badge variant="outline" className="text-xs">
                              <Building className="w-3 h-3 mr-1" />
                              {company.name}
                            </Badge>
                          ) : null;
                        })()}
                      </div>
                      
                      {/* Tags */}
                      {note.tags && note.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {note.tags.map((tag: string, index: number) => (
                            <Badge key={index} variant="secondary" className="text-xs">
                              <Tag className="w-3 h-3 mr-1" />
                              {tag}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </div>
                  </CardContent>
                  <CardFooter className="pt-0">
                    <div className="flex items-center justify-between w-full text-sm text-muted-foreground">
                      <span>{new Date(note.created_at).toLocaleDateString()}</span>
                      <div className="flex gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleEdit(note)}
                        >
                          <Edit className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDelete(note.id)}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  </CardFooter>
                </Card>
              ))}
            </div>
          </div>
        )}

        <div className="space-y-4">
          {pinnedNotes.length > 0 && (
            <h2 className="text-xl font-semibold">All Notes</h2>
          )}
          {regularNotes.length === 0 && pinnedNotes.length === 0 ? (
            <Card className="text-center py-12">
              <CardContent>
                <p className="text-muted-foreground mb-4">No notes found.</p>
                <Button onClick={() => setIsEditorOpen(true)}>
                  <Plus className="w-4 h-4 mr-2" />
                  Create your first note
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {regularNotes.map((note) => (
                <Card key={note.id} className="hover:shadow-md transition-shadow">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-lg">{note.title}</CardTitle>
                    {note.content && (
                      <CardDescription className="line-clamp-3">
                        {note.content}
                      </CardDescription>
                    )}
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      {/* Linked entities */}
                      <div className="flex flex-wrap gap-2">
                        {note.contact_id && (() => {
                          const contact = contacts?.find(c => c.id === note.contact_id);
                          return contact ? (
                            <Badge variant="outline" className="text-xs">
                              <User className="w-3 h-3 mr-1" />
                              {contact.first_name} {contact.last_name}
                            </Badge>
                          ) : null;
                        })()}
                        {note.company_id && (() => {
                          const company = companies?.find(c => c.id === note.company_id);
                          return company ? (
                            <Badge variant="outline" className="text-xs">
                              <Building className="w-3 h-3 mr-1" />
                              {company.name}
                            </Badge>
                          ) : null;
                        })()}
                      </div>
                      
                      {/* Tags */}
                      {note.tags && note.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {note.tags.map((tag: string, index: number) => (
                            <Badge key={index} variant="secondary" className="text-xs">
                              <Tag className="w-3 h-3 mr-1" />
                              {tag}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </div>
                  </CardContent>
                  <CardFooter className="pt-0">
                    <div className="flex items-center justify-between w-full text-sm text-muted-foreground">
                      <span>{new Date(note.created_at).toLocaleDateString()}</span>
                      <div className="flex gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleEdit(note)}
                        >
                          <Edit className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDelete(note.id)}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  </CardFooter>
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
};

export default Notes;